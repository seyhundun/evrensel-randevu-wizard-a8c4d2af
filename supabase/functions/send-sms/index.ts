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

  try {
    const { to, message } = await req.json();

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");

    if (!accountSid || !authToken) {
      throw new Error("Twilio credentials not configured");
    }

    // Get "from" number from bot_settings if not provided
    let fromNumber: string | undefined;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: fromSetting } = await supabase
      .from("bot_settings")
      .select("value")
      .eq("key", "twilio_from_number")
      .single();

    fromNumber = fromSetting?.value;

    if (!fromNumber) {
      throw new Error("Twilio from number not configured in bot_settings");
    }

    // Determine recipient: use provided 'to' or fall back to bot_settings
    let toNumber = to;
    if (!toNumber) {
      const { data: toSetting } = await supabase
        .from("bot_settings")
        .select("value")
        .eq("key", "twilio_to_number")
        .single();
      toNumber = toSetting?.value;
    }

    if (!toNumber) {
      throw new Error("No recipient phone number provided");
    }

    // Send SMS via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = btoa(`${accountSid}:${authToken}`);

    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: toNumber,
        From: fromNumber,
        Body: message || "Randevu bulundu! 🎉",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Twilio error [${response.status}]: ${JSON.stringify(data)}`);
    }

    return new Response(
      JSON.stringify({ ok: true, sid: data.sid }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("SMS error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
