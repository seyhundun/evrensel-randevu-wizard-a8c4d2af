import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { elements, task, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `Sen bir web otomasyon ajanısın. Sana sayfadaki görünür interaktif elementlerin listesi ve yapman gereken görev verilecek.

Her element şu formatta:
{ index, tag, type, text, id, name, className, href, placeholder, ariaLabel, rect: {x,y,w,h}, isInCookieBanner }

Görev tanımına göre hangi element(ler) ile nasıl etkileşim kurulacağını belirle.

CEVABINI MUTLAKA şu JSON formatında ver (başka hiçbir şey yazma):
{
  "actions": [
    {
      "type": "click" | "type" | "wait" | "none",
      "elementIndex": <element index number>,
      "value": "<sadece type action için, yazılacak metin>",
      "reason": "<kısa açıklama>"
    }
  ],
  "status": "found" | "not_found" | "already_done",
  "message": "<kısa durum mesajı>"
}

Kurallar:
- Sadece verilen elementlerden birini seç, index numarasını kullan
- Birden fazla action gerekiyorsa sırayla listele
- Element bulunamadıysa status: "not_found" döndür
- Google/Apple/Facebook sosyal giriş butonlarından KAÇIN
- Cookie banner'da "accept", "kabul", "agree" gibi butonları tercih et, "reject", "manage", "preferences" gibi butonlardan kaçın
- Login için email alanını, şifre alanını ve giriş butonunu sırayla bul`;

    const userPrompt = `GÖREV: ${task}

${context ? "EK BAĞLAM: " + context + "\n\n" : ""}SAYFADAKI ELEMENTLER:
${JSON.stringify(elements, null, 2)}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI error: " + response.status);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let result;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      result = JSON.parse(jsonMatch ? jsonMatch[1].trim() : content.trim());
    } catch {
      console.error("Failed to parse AI response:", content);
      result = { actions: [], status: "not_found", message: "AI cevabi parse edilemedi" };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("dom-agent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});