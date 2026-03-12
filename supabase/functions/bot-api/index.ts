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
    // GET — Returns all active tracking configs with applicants + available VFS accounts
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

      // Get available VFS accounts (active or cooldown expired)
      const now = new Date().toISOString();
      const { data: accounts } = await supabase
        .from("vfs_accounts")
        .select("id, email, password, status, banned_until, fail_count, last_used_at")
        .or(`status.eq.active,and(status.eq.cooldown,banned_until.lt.${now})`)
        .order("last_used_at", { ascending: true, nullsFirst: true });

      return new Response(JSON.stringify({ ok: true, configs: results, accounts: accounts ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST — Bot posts check results or account status updates
    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") || "";
      
      // Check if this is an account status update
      if (contentType.includes("application/json")) {
        const bodyText = await req.text();
        const body = JSON.parse(bodyText);
        
        // Account status update endpoint
        if (body.action === "update_account") {
          const { account_id, status, banned_until, fail_count } = body;
          if (!account_id) {
            return new Response(
              JSON.stringify({ ok: false, error: "account_id required" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          
          const updateData: Record<string, unknown> = { status, last_used_at: new Date().toISOString() };
          if (banned_until) updateData.banned_until = banned_until;
          if (fail_count !== undefined) updateData.fail_count = fail_count;
          
          const { error: updateError } = await supabase
            .from("vfs_accounts")
            .update(updateData)
            .eq("id", account_id);
          
          if (updateError) throw updateError;
          
          return new Response(
            JSON.stringify({ ok: true, message: `Account ${account_id} updated to ${status}` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get manual OTP for account
        if (body.action === "get_account_otp") {
          const { account_id } = body;
          if (!account_id) {
            return new Response(
              JSON.stringify({ ok: false, error: "account_id required" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          const { data } = await supabase
            .from("vfs_accounts")
            .select("manual_otp")
            .eq("id", account_id)
            .single();
          return new Response(
            JSON.stringify({ ok: true, manual_otp: data?.manual_otp || null }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Clear manual OTP after use
        if (body.action === "clear_account_otp") {
          const { account_id } = body;
          await supabase
            .from("vfs_accounts")
            .update({ manual_otp: null, otp_requested_at: null })
            .eq("id", account_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Set OTP requested (bot signals it needs OTP)
        if (body.action === "set_otp_requested") {
          const { account_id } = body;
          await supabase
            .from("vfs_accounts")
            .update({ otp_requested_at: new Date().toISOString(), manual_otp: null })
            .eq("id", account_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // Regular log posting (JSON)
        let config_id = body.config_id;
        let status = body.status;
        let message = body.message ?? null;
        let slots_available = body.slots_available ?? 0;
        let screenshot_url: string | null = null;
        
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

        if (!config_id || !status) {
          return new Response(
            JSON.stringify({ ok: false, error: "config_id and status are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: logError } = await supabase.from("tracking_logs").insert({
          config_id, status, message: message ?? null, slots_available, screenshot_url,
        });
        if (logError) throw logError;

        if (status === "found") {
          await supabase.from("tracking_configs").update({ is_active: false }).eq("id", config_id);
        }

        return new Response(
          JSON.stringify({ ok: true, message: `Log recorded: ${status}`, screenshot_url }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Multipart form data
      if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        const config_id = formData.get("config_id") as string;
        const status = formData.get("status") as string;
        const message = (formData.get("message") as string) || null;
        const slots_available = parseInt(formData.get("slots_available") as string) || 0;
        let screenshot_url: string | null = null;
        const file = formData.get("screenshot") as File | null;

        if (file && file.size > 0) {
          const fileName = `${config_id}/${Date.now()}_${status}.png`;
          const { error: uploadError } = await supabase.storage
            .from("bot-screenshots")
            .upload(fileName, file, { contentType: "image/png", upsert: false });
          if (!uploadError) {
            const { data: urlData } = supabase.storage.from("bot-screenshots").getPublicUrl(fileName);
            screenshot_url = urlData.publicUrl;
          }
        }

        if (!config_id || !status) {
          return new Response(
            JSON.stringify({ ok: false, error: "config_id and status are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: logError } = await supabase.from("tracking_logs").insert({
          config_id, status, message, slots_available, screenshot_url,
        });
        if (logError) throw logError;

        if (status === "found") {
          await supabase.from("tracking_configs").update({ is_active: false }).eq("id", config_id);
        }

        return new Response(
          JSON.stringify({ ok: true, message: `Log recorded: ${status}`, screenshot_url }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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
