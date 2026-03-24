import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { elements, task, context, pageText, pageUrl, step } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `Sen tam otonom bir web otomasyon ajanısın. Sayfayı TAMAMEN analiz edip, ne yapılması gerektiğini KENDİN karar ver.

## GİRDİLER
1. Sayfadaki görünen METİN (pageText) — soruları, seçenekleri, başlıkları oku
2. İnteraktif ELEMENTLER listesi — tıklanabilir/yazılabilir öğeler
3. Son yapılan aksiyonlar — tekrar etme

Her element: { index, tag, type, text, id, name, value, checked, role, rect:{x,y,w,h}, isInCookieBanner }

## PERSONA (TÜM CEVAPLARDA BU KİŞİLİĞİ KULLAN)
- Ad: Alex Johnson | Yaş: 29 | Cinsiyet: Male | Medeni hal: Single
- Ülke: US | Eyalet: California | Şehir: Los Angeles | ZIP: 90210
- Eğitim: Bachelor's Degree (4-year college)
- Meslek: Marketing Coordinator | Sektör: Technology/Software
- Yıllık gelir: $55,000-$74,999 | Etnik köken: Caucasian/White
- Çocuk yok | Telefon: (310) 555-0147
- Araba: 2020 Honda Civic | Sigorta: BlueCross BlueShield
- Markalar: Nike, Apple, Starbucks, Netflix
- Hobiler: hiking, photography, gaming, cooking
- Sosyal medya: Instagram, YouTube, Reddit (~2 saat/gün)
- Alışveriş: Amazon, Target — ayda 3-4 kez online

## KARAR ALMA SÜRECİ
1. Önce sayfadaki METNİ oku — ne soruluyor, ne isteniyor?
2. Soru tipini belirle:
   - Çoktan seçmeli (radio) → persona bilgilerine göre EN UYGUN seçeneği tıkla
   - Checkbox listesi → 1-3 uygun seçenek tıkla (her seferinde 1 tane)
   - Açık uçlu (textarea/input) → KISA doğal İngilizce cevap yaz (5-8 kelime)
   - Sayısal giriş → ZIP:90210, yaş:29, çocuk:0, hane:1
   - Slider → %60-80 arası değer
   - Dropdown → uygun seçeneği seç
   - Attention check → DİKKATLİ oku, doğru cevabı ver
   - Sürükle-bırak → kaynak ve hedefi belirle
3. Soru cevaplandıysa → Next/Continue/Submit butonunu bul ve tıkla
4. Cookie/popup varsa → kapat
5. Login gerekiyorsa → email ve şifre ile giriş yap (Google/Facebook KULLANMA)
6. Anket bittiyse (Thank you, Complete, Congratulations) → status: "completed"

## SAYFA ANALİZ MANTIĞI
- Sayfada soru metni var mı? Varsa oku ve cevapla.
- Sayfada seçenekler var mı? Varsa persona bilgilerine göre en uygununu seç.
- Input/textarea boş mu? Boşsa uygun cevabı yaz.
- Next/Continue butonu var mı ve aktif mi? Soruyu cevapladıysan tıkla.
- Sayfa kaydırılmalı mı? Buton görünmüyorsa scroll yap.
- Popup/overlay var mı? Kapat.

## CEVAP KURALLARI
- Açık uçlu sorulara KISA cevap ver: "I really enjoy it" veya "Pretty good quality"
- ASLA uzun paragraf yazma, max 8 kelime
- ZIP Code = 90210, yaş = 29, gelir = 55000-74999
- "12345" veya "test" gibi sahte değerler KULLANMA
- "Prefer not to answer" / "None of the above" KULLANMA — gerçekçi cevap ver
- Matris sorularında Agree/Somewhat Agree gibi olumlu seçenekleri tercih et
- Mantık soruları (2+3=?) dikkatli oku, DOĞRU cevabı ver

## JSON CEVAP FORMATI
{
  "actions": [
    {
      "type": "click" | "type" | "scroll" | "select" | "wait" | "none",
      "elementIndex": <element index numarası>,
      "value": "<sadece type/select için değer>",
      "reason": "<kısa açıklama>"
    }
  ],
  "status": "found" | "not_found" | "completed",
  "thinking": "<sayfayı nasıl analiz ettin, kısa düşünce süreci>",
  "message": "<kısa durum mesajı>"
}

## KRİTİK KURALLAR
- Sadece verilen elementlerden birini seç, index numarasını kullan
- Birden fazla action sırayla listele (max 3)
- Google/Apple/Facebook sosyal giriş butonlarından KAÇIN
- Cookie banner'da "accept/kabul/agree" butonlarını tercih et
- Aynı elemente tekrar tıklama — son aksiyonlardan farklı bir şey yap
- Anket bittiyse status: "completed" döndür
- Sayfada hiçbir şey yapılamıyorsa status: "not_found" döndür`;

    const userPrompt = `GÖREV: ${task}

${context ? "EK BAĞLAM: " + context + "\n\n" : ""}${pageUrl ? "SAYFA URL: " + pageUrl + "\n\n" : ""}${step ? "ADIM: " + step + "\n\n" : ""}SAYFADAKI METİN (ilk 3000 karakter):
${(pageText || "").slice(0, 3000)}

İNTERAKTİF ELEMENTLER (${(elements || []).length} adet):
${JSON.stringify(elements, null, 2)}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
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
      try {
        const objectMatch = content.match(/\{[\s\S]*\}/);
        result = JSON.parse(objectMatch ? objectMatch[0] : "{}");
      } catch {
        console.error("Failed to parse AI response:", content);
        result = { actions: [], status: "not_found", message: "AI cevabi parse edilemedi" };
      }
    }

    if (!result || typeof result !== "object") {
      result = { actions: [], status: "not_found", message: "Gecersiz ajan cevabi" };
    }

    if (!Array.isArray(result.actions)) {
      result.actions = [];
    }

    result.actions = result.actions
      .filter((action: any) => action && typeof action === "object")
      .map((action: any) => ({
        type: ["click", "type", "scroll", "select", "wait", "none"].includes(action.type) ? action.type : "none",
        elementIndex: Number.isInteger(action.elementIndex) ? action.elementIndex : -1,
        value: typeof action.value === "string" ? action.value : undefined,
        reason: typeof action.reason === "string" ? action.reason : "Ajan eylemi",
      }))
      .filter((action: any) => action.type === "wait" || action.type === "none" || action.type === "scroll" || action.elementIndex >= 0);

    if (!["found", "not_found", "completed", "already_done"].includes(result.status)) {
      result.status = result.actions.length > 0 ? "found" : "not_found";
    }

    if (typeof result.message !== "string") {
      result.message = result.status === "found" ? "Aksiyon bulundu" : "Aksiyon bulunamadi";
    }

    // Log thinking process
    if (result.thinking) {
      console.log("AI Thinking:", result.thinking);
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
