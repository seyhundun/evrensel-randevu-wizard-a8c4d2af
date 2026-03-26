import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { elements, pageText, pageUrl, step, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const account = context?.account || {};
    const country = context?.country || "";
    const city = context?.city || "";
    const visaCategory = context?.visa_category || "";
    const visaSubcategory = context?.visa_subcategory || "";
    const applicants = context?.applicants || [];
    const recentActions = context?.recentActions || [];

    const systemPrompt = `Sen bir VFS Global randevu takip botunun otonom navigasyon ajanısın. Sayfayı analiz edip ne yapılması gerektiğini KENDİN karar ver.

## GÖREV
VFS Global web sitesinde:
1. Giriş yap (email ve şifre ile)
2. Randevu sayfasına git
3. Müsait randevu olup olmadığını kontrol et
4. Randevu varsa otomatik al

## HESAP BİLGİLERİ
- E-posta: ${account.email || ""}
- Şifre: ${account.password || ""}

## RANDEVU BİLGİLERİ  
- Ülke: ${country}
- Şehir: ${city}
- Vize kategorisi: ${visaCategory || "belirtilmemiş"}
- Vize alt kategorisi: ${visaSubcategory || "belirtilmemiş"}
${applicants.length > 0 ? "- Başvuru sahipleri: " + applicants.map((a: any) => `${a.first_name} ${a.last_name}`).join(", ") : ""}

## ELEMENTLER
Her element: { index, tag, type, text, id, name, value, checked, role, rect:{x,y,w,h}, isInCookieBanner }

## SAYFA ANALİZ MANTIĞI

### GİRİŞ SAYFASI (login)
- E-posta alanını bul (input type="email" veya name/id içinde "email" geçen) → email yaz
- Şifre alanını bul (input type="password") → şifre yaz
- Giriş/Sign In/Login butonunu bul → tıkla
- Cookie banner varsa → "Accept/Kabul" tıkla
- Google/Facebook/Apple giriş butonlarından KAÇIN, normal email/şifre ile giriş yap

### OTP SAYFASI
- "Doğrulama kodu", "OTP", "tek kullanımlık", "verification code" gibi ifadeler varsa → status: "otp_required"

### RANDEVU SAYFASI
- Randevu takvimi, tarih seçici veya "müsait randevu" gibi ifadeler varsa → tarihler metin içinden çıkar
- "Uygun randevu bulunmamaktadır", "No appointment", "Slot not available" gibi mesajlar varsa → status: "no_appointment"
- Tarih görünüyorsa → status: "appointment_found", availableDates dizisi döndür

### HESAP SORUNLARI
- "Hesabınız engellenmiş", "account blocked/banned/suspended" → status: "account_banned"
- "429002", "yetkisiz etkinlik", "unauthorized activity", "erişim reddedildi" → status: "account_banned"
- "Oturum süresi doldu", "session expired" → status: "session_expired"

### CLOUDFLARE / CAPTCHA
- Turnstile, CAPTCHA, challenge sayfası → status: "captcha_needed"

### NAVİGASYON
- Menülerden "New Booking" / "Yeni Randevu" / "Book Appointment" bul → tıkla
- Ülke, şehir, kategori seçimi gerekiyorsa uygun değerleri seç
- Devam/Continue/Next/İleri butonlarını tıkla
- Sayfa boşsa veya yükleniyorsa → scroll veya wait

## SON YAPILAN AKSİYONLAR (tekrar etme!)
${recentActions.slice(-5).join("\n")}

## KRİTİK KURALLAR
1. E-posta ve şifre alanlarını MUTLAKA doldur — boş bırakma!
2. Alanlara yazarken "type" aksiyonu kullan, value olarak tam değeri ver
3. Önce email yaz, sonra password yaz, sonra login butonunu tıkla — 3 ayrı aksiyon olarak döndür
4. Aynı aksiyonu tekrarlama
5. Sayfa yükleniyorsa "wait" döndür
6. Element index numarasını doğru kullan

## CEVAP FORMATI (JSON)
{
  "actions": [
    {
      "type": "click" | "type" | "scroll" | "select" | "wait" | "none",
      "elementIndex": <element index numarası>,
      "value": "<sadece type/select için değer>",
      "reason": "<kısa açıklama>"
    }
  ],
  "status": "continue" | "appointment_found" | "no_appointment" | "otp_required" | "account_banned" | "session_expired" | "ip_blocked" | "captcha_needed" | "booking_confirmed",
  "availableDates": ["tarih1", "tarih2"],
  "thinking": "<sayfayı nasıl analiz ettin>",
  "message": "<kısa durum mesajı>"
}`;

    const userPrompt = `ADIM: ${step || 1}

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
        result = { actions: [], status: "continue", message: "AI cevabi parse edilemedi" };
      }
    }

    if (!result || typeof result !== "object") {
      result = { actions: [], status: "continue", message: "Gecersiz ajan cevabi" };
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

    const validStatuses = ["continue", "appointment_found", "no_appointment", "otp_required", "account_banned", "session_expired", "ip_blocked", "captcha_needed", "booking_confirmed"];
    if (!validStatuses.includes(result.status)) {
      result.status = result.actions.length > 0 ? "continue" : "no_appointment";
    }

    if (typeof result.message !== "string") {
      result.message = "";
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
