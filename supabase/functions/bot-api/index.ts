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
    // GET /bot-api/config — Returns all active tracking configs with applicants
    if (req.method === "GET" && (!path || path === "bot-api" || path === "config")) {
      const { data: configs, error } = await supabase
        .from("tracking_configs")
        .select("*")
        .eq("is_active", true);

      if (error) throw error;

      // Fetch applicants for each config
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

    // POST /bot-api — Bot posts check results
    // Body: { config_id, status: "checking"|"found"|"error", message?, slots_available? }
    if (req.method === "POST") {
      const body = await req.json();
      const { config_id, status, message, slots_available } = body;

      if (!config_id || !status) {
        return new Response(
          JSON.stringify({ ok: false, error: "config_id and status are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Insert log
      const { error: logError } = await supabase.from("tracking_logs").insert({
        config_id,
        status,
        message: message ?? null,
        slots_available: slots_available ?? 0,
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
        JSON.stringify({ ok: true, message: `Log recorded: ${status}` }),
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
