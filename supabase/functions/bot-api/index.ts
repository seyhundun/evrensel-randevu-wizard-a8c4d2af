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

      const now = new Date().toISOString();
      const { data: accounts } = await supabase
        .from("vfs_accounts")
        .select("id, email, password, phone, status, banned_until, fail_count, last_used_at, imap_host, imap_password, booking_enabled, otp_mode")
        .eq("booking_enabled", true)
        .or(`status.eq.active,and(status.eq.cooldown,banned_until.lt.${now})`)
        .order("last_used_at", { ascending: true, nullsFirst: true });

      return new Response(JSON.stringify({ ok: true, configs: results, accounts: accounts ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET — iDATA config + accounts
    if (req.method === "GET" && path === "idata") {
      const { data: config } = await supabase
        .from("idata_config")
        .select("*")
        .limit(1)
        .single();

      const { data: accounts } = await supabase
        .from("idata_accounts")
        .select("*")
        .in("status", ["active"])
        .eq("booking_enabled", true)
        .order("last_used_at", { ascending: true, nullsFirst: true });

      return new Response(
        JSON.stringify({ ok: true, config, accounts: accounts ?? [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST — Bot posts check results or account status updates
    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") || "";
      
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

        if (body.action === "set_account_otp") {
          const { account_id, code } = body;
          if (!account_id || !code) {
            return new Response(
              JSON.stringify({ ok: false, error: "account_id and code required" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const normalizedCode = String(code).replace(/\s+/g, "").trim();

          const { error } = await supabase
            .from("vfs_accounts")
            .update({ manual_otp: normalizedCode })
            .eq("id", account_id);

          if (error) throw error;

          return new Response(
            JSON.stringify({ ok: true, manual_otp: normalizedCode }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "clear_account_otp") {
          const { account_id } = body;
          await supabase
            .from("vfs_accounts")
            .update({ manual_otp: null })
            .eq("id", account_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

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

        if (body.action === "get_pending_registrations") {
          const { data } = await supabase
            .from("vfs_accounts")
            .select("id, email, password, phone, registration_status, registration_otp_type, registration_otp")
            .eq("registration_status", "pending");
          return new Response(
            JSON.stringify({ ok: true, accounts: data ?? [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "set_registration_otp_needed") {
          const { account_id, otp_type } = body;
          await supabase
            .from("vfs_accounts")
            .update({ registration_otp_type: otp_type, registration_otp: null })
            .eq("id", account_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "get_registration_otp") {
          const { account_id } = body;
          const { data } = await supabase
            .from("vfs_accounts")
            .select("registration_otp, registration_otp_type")
            .eq("id", account_id)
            .single();
          return new Response(
            JSON.stringify({ ok: true, registration_otp: data?.registration_otp || null, otp_type: data?.registration_otp_type }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ===== iDATA LOGIN OTP ENDPOINTS =====
        if (body.action === "idata_set_login_otp_requested") {
          const { account_id } = body;
          await supabase
            .from("idata_accounts")
            .update({ otp_requested_at: new Date().toISOString(), manual_otp: null })
            .eq("id", account_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "idata_get_login_otp") {
          const { account_id } = body;
          const { data } = await supabase
            .from("idata_accounts")
            .select("manual_otp")
            .eq("id", account_id)
            .single();
          return new Response(
            JSON.stringify({ ok: true, manual_otp: data?.manual_otp || null }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "idata_clear_login_otp") {
          const { account_id } = body;
          await supabase
            .from("idata_accounts")
            .update({ manual_otp: null })
            .eq("id", account_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ===== iDATA ENDPOINTS =====
        if (body.action === "get_idata_pending_registrations") {
          const { data } = await supabase
            .from("idata_accounts")
            .select("*")
            .eq("registration_status", "pending");
          return new Response(
            JSON.stringify({ ok: true, accounts: data ?? [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "idata_log") {
          const { status: logStatus, message, screenshot_base64 } = body;
          let screenshot_url: string | null = null;

          if (screenshot_base64) {
            const bytes = Uint8Array.from(atob(screenshot_base64), c => c.charCodeAt(0));
            const fileName = `idata/${Date.now()}_${logStatus || "info"}.png`;
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

          const { error: logErr } = await supabase
            .from("idata_tracking_logs")
            .insert({ status: logStatus || "info", message, screenshot_url });
          if (logErr) throw logErr;

          if (["appt_found", "appt_booked", "appt_payment_page"].includes(logStatus)) {
            try {
              const funcUrl = `${supabaseUrl}/functions/v1/send-sms`;
              const loginUrl = "https://it-tr-appointment.idata.com.tr/tr/membership/login";
              let smsText = "";
              if (logStatus === "appt_booked") {
                smsText = `🎉 iDATA Randevu Alındı!\\n${message || ""}\\n\\nGiriş: ${loginUrl}`;
              } else if (logStatus === "appt_payment_page") {
                smsText = `💳 iDATA Ödeme Sayfası!\\n${message || ""}\\n\\nGiriş: ${loginUrl}`;
              } else {
                smsText = `🎉 iDATA Randevu Açıldı!\\n${message || ""}\\n\\nHemen giriş yapın: ${loginUrl}`;
              }
              await fetch(funcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
                body: JSON.stringify({ message: smsText }),
              });
            } catch (smsErr) { console.error("iDATA SMS hatası:", smsErr); }
          }

          return new Response(
            JSON.stringify({ ok: true, screenshot_url }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "sync_idata_city_offices") {
          const { mappings } = body;
          if (Array.isArray(mappings) && mappings.length > 0) {
            for (const m of mappings) {
              await supabase
                .from("idata_city_offices")
                .upsert(
                  { city: m.city, office_name: m.office_name, office_value: m.office_value },
                  { onConflict: "city,office_value" }
                );
            }
          }
          return new Response(
            JSON.stringify({ ok: true, synced: mappings?.length || 0 }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "complete_idata_registration") {
          const { account_id, success } = body;
          await supabase
            .from("idata_accounts")
            .update({
              registration_status: success ? "completed" : "failed",
              status: success ? "active" : "active",
            })
            .eq("id", account_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "complete_registration") {
          const { account_id, success } = body;
          await supabase
            .from("vfs_accounts")
            .update({
              registration_status: success ? "completed" : "failed",
              registration_otp: null,
              registration_otp_type: null,
              status: success ? "active" : "active",
            })
            .eq("id", account_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (body.action === "clear_screenshot_requested") {
          const { config_id: cfgId } = body;
          if (cfgId) {
            await supabase
              .from("tracking_configs")
              .update({ screenshot_requested: false })
              .eq("id", cfgId);
          }
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Request manual browser launch (with proxy via bot)
        if (body.action === "request_manual_browser") {
          await supabase
            .from("bot_settings")
            .update({ value: "true" })
            .eq("key", "manual_browser_requested");
          return new Response(
            JSON.stringify({ ok: true, message: "Manuel tarayıcı isteği gönderildi" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Request manual browser launch WITHOUT proxy (clean Chrome on DISPLAY=:99)
        if (body.action === "request_manual_noproxy") {
          const { data: existing } = await supabase
            .from("bot_settings")
            .select("id")
            .eq("key", "manual_noproxy_requested")
            .single();
          if (existing) {
            await supabase
              .from("bot_settings")
              .update({ value: "true" })
              .eq("key", "manual_noproxy_requested");
          } else {
            await supabase
              .from("bot_settings")
              .insert({ key: "manual_noproxy_requested", value: "true", label: "Manuel proxy'siz tarayıcı isteği" });
          }
          return new Response(
            JSON.stringify({ ok: true, message: "Proxy'siz manuel tarayıcı isteği gönderildi" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check if manual noproxy browser is requested (bot polls this)
        if (body.action === "check_manual_noproxy") {
          const { data } = await supabase
            .from("bot_settings")
            .select("value")
            .eq("key", "manual_noproxy_requested")
            .single();
          const requested = data?.value === "true";
          if (requested) {
            await supabase
              .from("bot_settings")
              .update({ value: "false" })
              .eq("key", "manual_noproxy_requested");
          }
          return new Response(
            JSON.stringify({ ok: true, requested }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check if manual browser is requested (bot polls this)
        if (body.action === "check_manual_browser") {
          const { data } = await supabase
            .from("bot_settings")
            .select("value")
            .eq("key", "manual_browser_requested")
            .single();
          const requested = data?.value === "true";
          if (requested) {
            await supabase
              .from("bot_settings")
              .update({ value: "false" })
              .eq("key", "manual_browser_requested");
          }
          return new Response(
            JSON.stringify({ ok: true, requested }),
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
          try {
            const funcUrl = `${supabaseUrl}/functions/v1/send-sms`;
            await fetch(funcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
              body: JSON.stringify({ message: `🎉 VFS Randevu Bulundu!\\n${message || "Hemen kontrol edin!"}` }),
            });
          } catch (smsErr) { console.error("SMS gönderim hatası:", smsErr); }
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
