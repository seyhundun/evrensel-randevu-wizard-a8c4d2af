import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { image_base64 } = await req.json();
    if (!image_base64) {
      return new Response(JSON.stringify({ ok: false, error: "image_base64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are a CAPTCHA OCR specialist. Read ONLY the CAPTCHA text from the image and return only the exact code. CAPTCHA matching is CASE-SENSITIVE, so preserve uppercase/lowercase exactly as seen. Ignore logos, labels, headers, helper text, watermarks, and decorative strokes crossing the letters. Do not correct, normalize, explain, or add quotes. Be precise for confusing pairs like 0/O/o, 1/l/I, 5/S/s, 8/B, 9/g/q, 2/Z/z, 6/G. If one character is uncertain, choose the most visually likely character while preserving case."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read the CAPTCHA code in this image. Return ONLY the exact characters with original uppercase/lowercase preserved.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${image_base64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 20,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ ok: false, error: "Rate limited" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ ok: false, error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ ok: false, error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content?.trim() || "";

    // Clean: only keep alphanumeric characters, preserve original case
    const code = rawText.replace(/[^a-zA-Z0-9]/g, "");
    const normalizedCode = code.toUpperCase();
    const blockedTokens = new Set(["IDATA", "ITALYA", "ITALIA", "LOGIN", "REGISTER", "CAPTCHA"]);
    const isValidCode = code.length >= 1 && code.length <= 8 && !blockedTokens.has(normalizedCode) && !/^(.)\1{3,}$/i.test(code);

    console.log(`CAPTCHA solved: raw="${rawText}" clean="${code}" valid=${isValidCode}`);

    if (!isValidCode) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_captcha_read", raw: rawText, code, normalized_code: normalizedCode }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, code, normalized_code: normalizedCode, raw: rawText }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("solve-captcha error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
