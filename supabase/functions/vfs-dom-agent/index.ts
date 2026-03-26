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

## GÖREV AKIŞI (SIRAYLA İLERLE)
1. **GİRİŞ**: E-posta ve şifre ile oturum aç
2. **OTP**: OTP ekranı gelirse → status: "otp_required" döndür (kullanıcı manuel girecek)
3. **RANDEVU SEÇİMİ**: "New Booking" / "Yeni Randevu" tıkla, sonra sırayla:
   - Şehir seç (örn: ${city || "Gaziantep"})
   - Kategori seç (örn: ${visaCategory || "Short Stay"})
   - Alt kategori seç (örn: ${visaSubcategory || "Tourism / Multiple Entry"})
   - Devam/Continue tıkla
4. **RANDEVU KONTROLÜ**: Müsait tarih varsa → status: "appointment_found"
5. **BAŞVURU FORMU**: Pasaport, uyruk, ad-soyad, doğum tarihi vb. alanları doldur
6. **ÇOKLU BAŞVURU**: 1. kişi bittikten sonra "Add Applicant" tıkla ve 2. kişiyi doldur
7. **ONAY**: Form tamamlandıktan sonra status: "wait_manual" döndür — kullanıcı manuel ilerleyecek

## HESAP BİLGİLERİ
- E-posta: ${account.email || ""}
- Şifre: ${account.password || ""}

## RANDEVU BİLGİLERİ  
- Ülke: ${country}
- Şehir: ${city}
- Vize kategorisi: ${visaCategory || "belirtilmemiş"}
- Vize alt kategorisi: ${visaSubcategory || "belirtilmemiş"}
${applicants.length > 0 ? `
## BAŞVURU SAHİPLERİ BİLGİLERİ (FORM DOLDURMA İÇİN)
Toplam ${applicants.length} kişi — sırayla doldur, her biri için ayrı form doldur.
${applicants.map((a: any, i: number) => `### ${i + 1}. Başvuru Sahibi
- Ad: ${a.first_name || ""}
- Soyad: ${a.last_name || ""}
- Pasaport No: ${a.passport || ""}
- Doğum Tarihi: ${a.birth_date || ""}
- Uyruk: ${a.nationality || "Turkey"}
- Pasaport Son Kullanma: ${a.passport_expiry || ""}`).join("\n")}
` : ""}

## ELEMENTLER
Her element: { index, tag, type, text, id, name, value, checked, role, rect:{x,y,w,h}, isInCookieBanner }

## SAYFA ANALİZ MANTIĞI

### GİRİŞ SAYFASI (login)
- E-posta alanını bul → email yaz
- Şifre alanını bul → şifre yaz
- Login butonunu tıkla
- Cookie banner varsa → "Accept/Kabul" tıkla
- Google/Facebook/Apple butonlarından KAÇIN

### OTP SAYFASI
- "Doğrulama kodu", "OTP", "tek kullanımlık", "verification code" → status: "otp_required"

### RANDEVU SEÇİM SAYFASI
- Dropdown/select alanlarından şehir, kategori, alt kategori seçilecek
- Eğer "Appointment Type" veya "Visa Type" dropdown'u varsa → uygun değeri seç
- "Short Stay" veya kısa süreli seçeneği bul
- "Tourism" veya turizm seçeneği bul  
- Devam/Continue/Submit tıkla

### RANDEVU SAYFASI
- "Uygun randevu bulunmamaktadır", "No appointment", "Slot not available" → status: "no_appointment"
- Tarih görünüyorsa → status: "appointment_found", availableDates dizisi döndür

### BAŞVURU FORMU DOLDURMA (ÇOK ÖNEMLİ!)
- Ad, soyad alanlarını bul → başvuru sahibi bilgilerinden yaz
- Pasaport numarası alanını bul → yaz
- Uyruk/Nationality dropdown'u varsa → başvuru sahibinin uyruk bilgisini seç (varsayılan "Turkey")
- Doğum tarihi alanını bul → DD/MM/YYYY formatında yaz
- Pasaport son kullanma tarihi alanını bul → DD/MM/YYYY formatında yaz
- Cinsiyet dropdown'u varsa → uygun değeri seç
- TÜM alanlar doldurulduğunda "Continue/Devam/Save" tıkla

### ÇOKLU BAŞVURU SAHİBİ
- 1. kişinin formu bittikten sonra "Add Applicant" / "Başvuru Sahibi Ekle" butonunu tıkla
- 2. kişinin bilgilerini doldur
- Her kişi için ayrı ayrı doldur, ${applicants.length} kişi var

### HESAP SORUNLARI
- "Hesabınız engellenmiş", "account blocked/banned/suspended" → status: "account_banned"
- "429002", "yetkisiz etkinlik", "unauthorized activity" → status: "account_banned"
- "Oturum süresi doldu", "session expired" → status: "session_expired"

### CLOUDFLARE / CAPTCHA
- Turnstile, CAPTCHA, challenge → status: "captcha_needed"

### MANUEL KONTROL GEREKTİĞİNDE
- Form tamamen doldurulduysa ve son onay sayfasına gelindiyse → status: "wait_manual"
- Ödeme sayfası gelirse → status: "wait_manual"
- Emin olmadığın bir adımda → status: "wait_manual"
- ASLA sayfayı kapatma veya geri gitme

## SON YAPILAN AKSİYONLAR (tekrar etme!)
${recentActions.slice(-5).join("\n")}

## KRİTİK KURALLAR
1. E-posta ve şifre alanlarını MUTLAKA doldur — boş bırakma!
2. Alanlara yazarken "type" aksiyonu kullan, value olarak tam değeri ver
3. Önce email yaz, sonra password yaz, sonra login tıkla — 3 ayrı aksiyon
4. Aynı aksiyonu tekrarlama
5. Sayfa yükleniyorsa "wait" döndür
6. Element index numarasını doğru kullan
7. SAYFAYI ASLA KAPATMA — emin olmadığında "wait_manual" döndür
8. Birden fazla başvuru sahibi varsa, 1. kişiyi doldur, kaydet, sonra 2. kişiye geç

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
  "status": "continue" | "appointment_found" | "no_appointment" | "otp_required" | "account_banned" | "session_expired" | "ip_blocked" | "captcha_needed" | "booking_confirmed" | "wait_manual",
  "availableDates": ["tarih1", "tarih2"],
  "thinking": "<sayfayı nasıl analiz ettin>",
  "message": "<kısa durum mesajı>",
  "currentApplicantIndex": <şu an doldurduğun kişi sırası, 0'dan başlar>
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

    const validStatuses = ["continue", "appointment_found", "no_appointment", "otp_required", "account_banned", "session_expired", "ip_blocked", "captcha_needed", "booking_confirmed", "wait_manual"];
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
