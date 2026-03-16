import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MUTLUCELL_API_URL = "https://smsgw.mutlucell.com/smsgw-ws/sndblkex";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, message } = await req.json();

    const username = Deno.env.get("MUTLUCELL_USERNAME");
    const password = Deno.env.get("MUTLUCELL_PASSWORD");
    const originator = Deno.env.get("MUTLUCELL_ORIGINATOR");

    if (!username || !password || !originator) {
      throw new Error("Mutlucell credentials not configured");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Build recipient list: use provided 'to' or fall back to bot_settings
    let recipients: string[] = [];
    if (to) {
      recipients = to.split(",").map((n: string) => n.trim()).filter(Boolean);
    } else {
      const { data: toSetting } = await supabase
        .from("bot_settings")
        .select("value")
        .eq("key", "twilio_to_numbers")
        .single();
      if (toSetting?.value) {
        recipients = toSetting.value.split(",").map((n: string) => n.trim()).filter(Boolean);
      }
    }

    if (recipients.length === 0) {
      throw new Error("No recipient phone numbers configured");
    }

    // Normalize phone numbers for Mutlucell (remove + prefix, ensure 90 prefix for Turkish)
    const normalizedNums = recipients.map((num) => {
      let n = num.replace(/[\s\-\(\)]/g, "");
      if (n.startsWith("+")) n = n.substring(1);
      if (n.startsWith("0")) n = "90" + n.substring(1);
      return n;
    });

    const smsBody = message || "Randevu bulundu!";

    // Build Mutlucell XML
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<smspack ka="${escapeXml(username)}" pwd="${escapeXml(password)}" org="${escapeXml(originator)}">
  <mesaj>
    <metin>${escapeXml(smsBody)}</metin>
    <nums>${normalizedNums.join(",")}</nums>
  </mesaj>
</smspack>`;

    const response = await fetch(MUTLUCELL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8" },
      body: xml,
    });

    const responseText = await response.text();
    console.log("Mutlucell response:", responseText);

    // Response starting with $ means success (e.g. $34672#13.0)
    const success = responseText.trim().startsWith("$");

    if (!success) {
      throw new Error(`Mutlucell error: ${responseText}`);
    }

    return new Response(
      JSON.stringify({ ok: true, response: responseText.trim(), recipients: normalizedNums }),
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
