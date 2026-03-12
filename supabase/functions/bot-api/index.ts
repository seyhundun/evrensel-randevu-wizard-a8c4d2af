import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  try {
    // GET — Returns all active tracking configs with applicants
    if (req.method === "GET" && (!path || path === "bot-api" || path === "config")) {
      const { data: configs, error } = await supabase
        .from("tracking_configs")
        .select("*")
        .eq("is_active", true);

      if (error) throw error;

      const results = await Promise.all(
        (configs ?? []).map(async (cfg: Record<string, unknown>) => {
          const { data: applicants } = await supabase
            .from("applicants")
            .select("*")
            .eq("config_id", cfg.id)
            .order("sort_order", { ascending: true });
          return { ...cfg, applicants: applicants ?? [] };
        })
      );

      return new Response(JSON.stringify({ ok: true, configs: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST — Bot posts check results (JSON or multipart with screenshot)
    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") || "";

      let config_id: string;
      let status: string;
      let message: string | null = null;
      let slots_available = 0;
      let screenshot_url: string | null = null;

      if (contentType.includes("multipart/form-data")) {
        // Multipart: screenshot + fields
        const formData = await req.formData();
        config_id = formData.get("config_id") as string;
        status = formData.get("status") as string;
        message = (formData.get("message") as string) || null;
        slots_available = parseInt(formData.get("slots_available") as string) || 0;
        const file = formData.get("screenshot") as File | null;

        if (file && file.size > 0) {
          const fileName = `${config_id}/${Date.now()}_${status}.png`;
          const { error: uploadError } = await supabase.storage
            .from("bot-screenshots")
            .upload(fileName, file, { contentType: "image/png", upsert: false });

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from("bot-screenshots")
              .getPublicUrl(fileName);
            screenshot_url = urlData.publicUrl;
          } else {
            console.error("Upload error:", uploadError);
          }
        }
      } else {
        // JSON body
        const body = await req.json();
        config_id = body.config_id;
        status = body.status;
        message = body.message ?? null;
        slots_available = body.slots_available ?? 0;
        // Support base64 screenshot in JSON
        if (body.screenshot_base64) {
          const bytes = Uint8Array.from(atob(body.screenshot_base64), c => c.charCodeAt(0));
          const fileName = `${config_id}/${Date.now()}_${status}.png`;
          const { error: uploadError } = await supabase.storage
            .from("bot-screenshots")
            .upload(fileName, bytes, { contentType: "image/png", upsert: false });
          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from("bot-screenshots")
              .getPublicUrl(fileName);
            screenshot_url = urlData.publicUrl;
          }
        }
      }

      if (!config_id || !status) {
        return new Response(
          JSON.stringify({ ok: false, error: "config_id and status are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Insert log with screenshot
      const { error: logError } = await supabase.from("tracking_logs").insert({
        config_id,
        status,
        message: message ?? null,
        slots_available,
        screenshot_url,
      });

      if (logError) throw logError;

      // If found, deactivate the config
      if (status === "found") {
        await supabase
          .from("tracking_configs")
          .update({ is_active: false })
          .eq("id", config_id);
      }

      return new Response(
        JSON.stringify({ ok: true, message: `Log recorded: ${status}`, screenshot_url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Bot API error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
