import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { elements, pageText, pageUrl, step, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `Sen VFS Global vize randevu sistemi için tam otonom bir web otomasyon ajanısın. 
Görevin: VFS Global sitesine giriş yapmak, randevu sayfasına gitmek, müsait randevu olup olmadığını kontrol etmek ve varsa otomatik almak.

## GİRDİLER
1. Sayfadaki görünen METİN (pageText) — formları, butonları, hata mesajlarını oku
2. İnteraktif ELEMENTLER listesi — tıklanabilir/yazılabilir öğeler
3. BAĞLAM (context) — hesap bilgileri, ülke, şehir, vize kategorisi, başvuru sahipleri

Her element: { index, tag, type, text, id, name, value, checked, role, rect:{x,y,w,h}, isInCookieBanner }

## VFS GLOBAL AKIŞ ADIMLARI
1. **Cookie Banner** → "Accept All", "Tümünü Kabul Et" gibi butonları tıkla
2. **Login Sayfası** → Email ve şifre alanlarını doldur, "Sign In" / "Oturum Aç" butonunu tıkla
3. **OTP Doğrulama** → OTP girişi gerekiyorsa status: "otp_required" döndür
4. **Dashboard** → "New Booking" / "Start New Booking" / "Yeni Başvuru" butonunu bul ve tıkla
5. **Kategori Seçimi** → Vize kategorisini dropdown'dan seç (context'teki visa_category değerini kullan)
6. **Alt Kategori** → Alt kategoriyi dropdown'dan seç (context'teki visa_subcategory değerini kullan)
7. **Merkez Seçimi** → Şehir/merkezi dropdown'dan seç (context'teki city değerini kullan)
8. **Continue/Devam** → "Continue", "Devam", "Search", "Ara" butonunu tıkla
9. **Takvim Kontrolü** → Müsait tarih var mı kontrol et:
   - "no appointment", "no available", "randevu bulunmamaktadır" → status: "no_appointment"
   - Aktif/seçilebilir takvim hücresi varsa → status: "appointment_found"
   - "select date", "tarih seçin" varsa → status: "appointment_found"
10. **Tarih Seçimi** → İlk müsait tarihi tıkla
11. **Saat Seçimi** → İlk müsait saati tıkla
12. **Form Doldurma** → Başvuru sahibi bilgilerini doldur (context'teki applicants verisini kullan)
13. **Onay** → "Confirm", "Onayla", "Book", "Complete" butonunu tıkla

## DROPDOWN SEÇİMİ (Angular Material)
VFS Angular Material kullanır. Dropdown seçmek için:
1. Önce mat-select/dropdown elemanını tıkla (açmak için)
2. Sonra açılan listeden (mat-option) doğru seçeneği tıkla
Her seferinde SADECE BİR aksiyon yap — önce aç, sonraki adımda seç.

## HATA TESPİTİ
- "yetkisiz etkinlik", "429002", "engellenmiş", "blocked", "banned" → status: "account_banned"
- "oturum süresi doldu", "session expired" → status: "session_expired"
- "izin sorunları", "403", "access denied" → status: "ip_blocked"
- "page not found", "404" → status: "error"
- Turnstile/CAPTCHA widget görünüyorsa ve token yoksa → status: "captcha_needed"

## SAYFA ANALİZ ÖNCELİĞİ
1. Hata durumu varsa → hata status'u döndür
2. Cookie banner varsa → kapat
3. Login formu varsa → bilgileri doldur ve giriş yap
4. OTP formu varsa → otp_required döndür
5. Dashboard'daysa → booking'e git
6. Booking formundaysa → kategori/şehir seç
7. Takvim sayfasındaysa → randevu kontrol et
8. Onay sayfasındaysa → onayla

## FORM DOLDURMA KURALLARI
- Email alanı: context'teki account.email değerini kullan
- Şifre alanı: context'teki account.password değerini kullan
- İsim alanları: context'teki applicants verisini kullan
- Dropdown'lar: context'teki visa_category, visa_subcategory, city değerlerini kullan
- Angular formlarında input sonrası "input" ve "change" event'leri tetiklenir

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
  "status": "continue" | "appointment_found" | "no_appointment" | "otp_required" | "account_banned" | "session_expired" | "ip_blocked" | "captcha_needed" | "booking_confirmed" | "error",
  "thinking": "<sayfayı nasıl analiz ettin, kısa düşünce süreci>",
  "message": "<kısa durum mesajı>",
  "availableDates": ["tarih1", "tarih2"]
}

## KRİTİK KURALLAR
- Sadece verilen elementlerden birini seç, index numarasını kullan
- Birden fazla action sırayla listele (max 3)
- Cookie banner'da "accept/kabul/agree" butonlarını tercih et
- Google/Apple/Facebook sosyal giriş butonlarından KAÇIN
- Aynı elemente tekrar tıklama — son aksiyonlardan farklı bir şey yap
- Randevu BULUNDUĞUNDA mutlaka status: "appointment_found" döndür ve availableDates dizisini doldur
- Randevu YOKSA mutlaka status: "no_appointment" döndür
- Sayfa yükleniyorsa veya beklenmesi gerekiyorsa type: "wait" aksiyonu döndür
- Sayfada hiçbir şey yapılamıyorsa scroll dene`;

    const userPrompt = `ADIM: ${step || "?"}

BAĞLAM:
${context ? JSON.stringify(context, null, 2) : "Bağlam yok"}

SAYFA URL: ${pageUrl || "bilinmiyor"}

SAYFADAKI METİN (ilk 4000 karakter):
${(pageText || "").slice(0, 4000)}

İNTERAKTİF ELEMENTLER (${(elements || []).length} adet):
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
        temperature: 0.05,
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
        result = { actions: [], status: "error", message: "AI cevabi parse edilemedi" };
      }
    }

    if (!result || typeof result !== "object") {
      result = { actions: [], status: "error", message: "Gecersiz ajan cevabi" };
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
        reason: typeof action.reason === "string" ? action.reason : "VFS ajan eylemi",
      }))
      .filter((action: any) => action.type === "wait" || action.type === "none" || action.type === "scroll" || action.elementIndex >= 0);

    const validStatuses = ["continue", "appointment_found", "no_appointment", "otp_required", "account_banned", "session_expired", "ip_blocked", "captcha_needed", "booking_confirmed", "error"];
    if (!validStatuses.includes(result.status)) {
      result.status = result.actions.length > 0 ? "continue" : "error";
    }

    if (typeof result.message !== "string") {
      result.message = "VFS ajan adımı";
    }

    if (result.thinking) {
      console.log("VFS AI Thinking:", result.thinking);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("vfs-dom-agent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
