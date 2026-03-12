/**
 * VFS Global Randevu Takip Botu v4
 * 
 * Akış:
 * 1. Cookie banner'ı kapat
 * 2. Cloudflare Turnstile CAPTCHA çöz (2captcha)
 * 3. Login yap ve doğrula
 * 4. Dashboard'dan randevu sayfasına git
 * 5. Randevu kontrol et
 * 6. Screenshot + sonuç API'ye bildir
 */

require("dotenv").config();
const puppeteer = require("puppeteer");

// 2captcha (opsiyonel)
let Solver;
try {
  const mod = require("2captcha-ts");
  Solver = mod.Solver || mod.default?.Solver || mod;
} catch (e) {
  console.log("⚠ 2captcha-ts yüklü değil, CAPTCHA çözülemeyecek.");
}

const CONFIG = {
  API_URL: "https://ocrpzwrsyiprfuzsyivf.supabase.co/functions/v1/bot-api",
  API_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc",
  VFS_URL: "https://visa.vfsglobal.com/tur/tr/fra/login",
  VFS_EMAIL: process.env.VFS_EMAIL || "",
  VFS_PASSWORD: process.env.VFS_PASSWORD || "",
  CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY || "",
  HEADLESS: true,
  SLOW_MO: 50,
};

// ==================== HELPERS ====================

function delay(min = 1000, max = 3000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

async function reportResult(configId, status, message = "", slotsAvailable = 0, screenshotBase64 = null) {
  try {
    const body = { config_id: configId, status, message, slots_available: slotsAvailable };
    if (screenshotBase64) body.screenshot_base64 = screenshotBase64;
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.API_KEY}`,
        apikey: CONFIG.API_KEY,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log(`  [API] ${status}: ${data.message || data.error}`);
  } catch (err) {
    console.error("  [API] Bildirim hatası:", err.message);
  }
}

async function fetchActiveConfigs() {
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.API_KEY}`, apikey: CONFIG.API_KEY },
    });
    const data = await res.json();
    if (data.ok) return data.configs;
    console.error("API hatası:", data.error);
    return [];
  } catch (err) {
    console.error("API bağlantı hatası:", err.message);
    return [];
  }
}

async function takeScreenshotBase64(page) {
  try {
    const buf = await page.screenshot({ fullPage: true, encoding: "base64" });
    return buf;
  } catch { return null; }
}

// ==================== CAPTCHA ====================

async function solveTurnstile(page) {
  if (!CONFIG.CAPTCHA_API_KEY || !Solver) {
    console.log("  [CAPTCHA] API key veya 2captcha modülü yok, atlıyorum.");
    return false;
  }

  // Turnstile iframe bul
  const sitekey = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
    if (!iframe) return null;
    const container = iframe.closest("div[data-sitekey]") || document.querySelector("[data-sitekey]");
    if (container) return container.getAttribute("data-sitekey");
    // iframe src'den çıkar
    const src = iframe.getAttribute("src") || "";
    const match = src.match(/[?&]k=([^&]+)/);
    return match ? match[1] : null;
  });

  if (!sitekey) {
    // Alternatif: cf-turnstile div ara
    const altKey = await page.evaluate(() => {
      const el = document.querySelector(".cf-turnstile");
      return el ? el.getAttribute("data-sitekey") : null;
    });
    if (!altKey) {
      console.log("  [CAPTCHA] Turnstile bulunamadı, sayfa zaten geçmiş olabilir.");
      return true; // CAPTCHA yok, devam et
    }
    return await _solve(page, altKey);
  }

  return await _solve(page, sitekey);
}

async function _solve(page, sitekey) {
  console.log(`  [CAPTCHA] Sitekey: ${sitekey.substring(0, 20)}...`);
  console.log("  [CAPTCHA] 2captcha'ya gönderiliyor...");

  try {
    const solver = new (Solver.Solver || Solver)(CONFIG.CAPTCHA_API_KEY);
    const result = await solver.cloudflareTurnstile({
      pageurl: page.url(),
      sitekey: sitekey,
    });

    const token = result.data;
    console.log("  [CAPTCHA] ✅ Çözüldü!");

    // Token'ı sayfaya enjekte et
    await page.evaluate((t) => {
      // Tüm olası input'lara yaz
      const inputs = document.querySelectorAll(
        'input[name="cf-turnstile-response"], input[name="g-recaptcha-response"], [name*="turnstile"]'
      );
      inputs.forEach((inp) => { inp.value = t; });

      // Callback çağır
      if (typeof window.turnstileCallback === "function") window.turnstileCallback(t);
      if (typeof window.onTurnstileSuccess === "function") window.onTurnstileSuccess(t);
      
      // turnstile global objesinden callback bul
      if (window.turnstile) {
        try { window.turnstile.getResponse = () => t; } catch {}
      }
    }, token);

    await delay(1000, 2000);
    return true;
  } catch (err) {
    console.error("  [CAPTCHA] Hata:", err.message);
    return false;
  }
}

// ==================== MAIN CHECK ====================

async function checkAppointments(config) {
  const { id, country, city, visa_category, applicants } = config;
  const ts = new Date().toLocaleTimeString("tr-TR");

  console.log(`\n[${ts}] Kontrol: ${country} ${city}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS ? "new" : false,
      slowMo: CONFIG.SLOW_MO,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled", "--window-size=1920,1080"],
    });

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["tr-TR", "tr", "en-US", "en"] });
    });
    await page.setViewport({ width: 1920, height: 1080 });

    // ===== STEP 1: Giriş sayfası =====
    console.log("  [1/5] Giriş sayfası...");
    await page.goto(CONFIG.VFS_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(2000, 4000);

    // ===== STEP 2: Cookie banner kapat =====
    console.log("  [2/5] Cookie banner...");
    try {
      const cookieBtn = await page.evaluateHandle(() => {
        const btns = [...document.querySelectorAll("button")];
        return btns.find((b) => {
          const txt = b.textContent.toLowerCase();
          return txt.includes("accept all") || txt.includes("kabul") || txt.includes("tümünü kabul");
        }) || null;
      });
      if (cookieBtn && cookieBtn.asElement()) {
        await cookieBtn.asElement().click();
        console.log("  [2/5] ✅ Cookie kabul edildi.");
        await delay(1000, 2000);
      } else {
        console.log("  [2/5] Cookie banner yok veya zaten kapatılmış.");
      }
    } catch (e) {
      console.log("  [2/5] Cookie banner bulunamadı, devam.");
    }

    // ===== STEP 3: CAPTCHA çöz =====
    console.log("  [3/5] CAPTCHA kontrol...");
    await solveTurnstile(page);
    await delay(1000, 2000);

    // ===== STEP 4: Login =====
    console.log("  [4/5] Giriş yapılıyor...");
    try {
      // Email
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await page.click('input[type="email"]');
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await delay(100, 300);
      for (const ch of CONFIG.VFS_EMAIL) {
        await page.keyboard.type(ch, { delay: Math.random() * 100 + 30 });
      }
      await delay(500, 1000);

      // Password
      await page.click('input[type="password"]');
      await delay(200, 400);
      for (const ch of CONFIG.VFS_PASSWORD) {
        await page.keyboard.type(ch, { delay: Math.random() * 100 + 30 });
      }
      await delay(500, 1000);

      // Submit
      const submitBtn = await page.evaluateHandle(() => {
        const btns = [...document.querySelectorAll("button")];
        return btns.find((b) => {
          const txt = b.textContent.toLowerCase();
          return txt.includes("oturum") || txt.includes("sign in") || txt.includes("login") || txt.includes("giriş");
        }) || document.querySelector('button[type="submit"]') || null;
      });
      
      if (submitBtn && submitBtn.asElement()) {
        await submitBtn.asElement().click();
        console.log("  [4/5] Giriş butonu tıklandı.");
      } else {
        await page.click('button[type="submit"]');
        console.log("  [4/5] Submit butonu tıklandı.");
      }

      // Navigasyon bekle
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
      await delay(3000, 5000);

    } catch (loginErr) {
      console.log("  [4/5] ⚠ Giriş formu hatası:", loginErr.message);
    }

    // ===== LOGIN DOĞRULAMA =====
    const currentUrl = page.url();
    console.log("  [4/5] Mevcut URL:", currentUrl);

    const isStillOnLogin = currentUrl.includes("/login") || currentUrl.includes("login");
    
    if (isStillOnLogin) {
      console.log("  [4/5] ❌ GİRİŞ BAŞARISIZ! Hala login sayfasında.");
      
      // Detaylı teşhis bilgisi topla
      const diagnostics = await page.evaluate(() => {
        // Hata mesajları
        const errEls = document.querySelectorAll(".error, .alert-danger, .text-danger, [role='alert'], .toast-error, .notification-error, .invalid-feedback");
        const errors = [...errEls].map((e) => e.textContent.trim()).filter(Boolean);

        // CAPTCHA durumu
        const turnstileFrame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
        const turnstileDiv = document.querySelector(".cf-turnstile");
        const captchaInput = document.querySelector('input[name="cf-turnstile-response"]');
        const captchaStatus = {
          frameExists: !!turnstileFrame,
          divExists: !!turnstileDiv,
          inputValue: captchaInput ? (captchaInput.value ? "HAS_TOKEN" : "EMPTY") : "NO_INPUT",
        };

        // Submit buton durumu
        const submitBtn = document.querySelector('button[type="submit"]');
        const btnStatus = submitBtn ? {
          disabled: submitBtn.disabled,
          text: submitBtn.textContent.trim(),
          classes: submitBtn.className,
        } : null;

        // Form alanları dolu mu
        const emailInput = document.querySelector('input[type="email"], #email');
        const passInput = document.querySelector('input[type="password"]');
        const formStatus = {
          emailFilled: emailInput ? !!emailInput.value : false,
          passFilled: passInput ? !!passInput.value : false,
        };

        // Sayfa title
        const title = document.title;

        return { errors, captchaStatus, btnStatus, formStatus, title };
      });

      console.log("  [DIAG] Sayfa title:", diagnostics.title);
      console.log("  [DIAG] Form durumu:", JSON.stringify(diagnostics.formStatus));
      console.log("  [DIAG] CAPTCHA durumu:", JSON.stringify(diagnostics.captchaStatus));
      console.log("  [DIAG] Submit buton:", JSON.stringify(diagnostics.btnStatus));
      if (diagnostics.errors.length > 0) {
        console.log("  [DIAG] Hata mesajları:", diagnostics.errors.join(" | "));
      }

      const ss = await takeScreenshotBase64(page);
      const diagMsg = [
        `URL: ${currentUrl}`,
        diagnostics.errors.length > 0 ? `Hatalar: ${diagnostics.errors.join("; ")}` : null,
        `CAPTCHA: ${diagnostics.captchaStatus.inputValue}`,
        `Buton: ${diagnostics.btnStatus ? (diagnostics.btnStatus.disabled ? "DISABLED" : "ENABLED") : "YOK"}`,
        `Form: email=${diagnostics.formStatus.emailFilled}, şifre=${diagnostics.formStatus.passFilled}`,
      ].filter(Boolean).join(" | ");

      await reportResult(id, "error", `Giriş başarısız! ${diagMsg}`, 0, ss);
      return false;
    }

    console.log("  [4/5] ✅ Giriş başarılı! Dashboard'a yönlendirildi.");

    // ===== STEP 5: Randevu kontrol =====
    console.log("  [5/5] Randevu kontrol...");
    await delay(2000, 3000);

    // Dashboard'dan randevu sayfasına git
    // VFS Global yapısı: /tur/tr/fra/dashboard -> appointment bölümü
    try {
      // "Yeni Başvuru" / "Start New Booking" butonu ara
      const bookBtn = await page.evaluateHandle(() => {
        const links = [...document.querySelectorAll("a, button")];
        return links.find((el) => {
          const txt = (el.textContent || "").toLowerCase();
          return txt.includes("new booking") || txt.includes("yeni başvuru") || 
                 txt.includes("start new") || txt.includes("randevu") ||
                 txt.includes("book appointment");
        }) || null;
      });

      if (bookBtn && bookBtn.asElement()) {
        await bookBtn.asElement().click();
        console.log("  [5/5] Randevu sayfasına tıklandı.");
        await delay(3000, 5000);
        
        // İkinci CAPTCHA olabilir
        await solveTurnstile(page);
        await delay(2000, 3000);
      } else {
        console.log("  [5/5] Randevu butonu bulunamadı, mevcut sayfada kontrol ediliyor.");
      }
    } catch (navErr) {
      console.log("  [5/5] Navigasyon hatası:", navErr.message);
    }

    // Sayfa içeriğini oku
    const bodyText = await page.evaluate(() => document.body.innerText);
    const lowerText = bodyText.toLowerCase();

    const noAppointmentPhrases = [
      "no appointment", "no available", "currently no date",
      "randevu bulunmamaktadır", "müsait randevu yok", "no open schedule",
      "fully booked", "no slot", "appointment is not available",
      "no dates available", "no timeslot available",
    ];

    const appointmentFoundPhrases = [
      "select date", "available slot", "tarih seçin",
      "available appointment", "open slot", "choose a date",
      "select a time", "appointment available",
    ];

    const noAppointment = noAppointmentPhrases.some((p) => lowerText.includes(p));
    const hasAppointment = appointmentFoundPhrases.some((p) => lowerText.includes(p));

    const ss = await takeScreenshotBase64(page);

    if (hasAppointment && !noAppointment) {
      console.log("  ✅ RANDEVU BULUNDU!");
      await reportResult(id, "found", "Randevu müsait! Hemen giriş yapın.", 1, ss);
      return true;
    } else {
      console.log("  ❌ Randevu yok.");
      const msg = noAppointment ? "Müsait randevu yok." : "Dashboard yüklendi, randevu yok.";
      await reportResult(id, "checking", msg, 0, ss);
      return false;
    }

  } catch (err) {
    console.error("  [!] Genel hata:", err.message);
    await reportResult(id, "error", `Bot hatası: ${err.message}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

// ==================== MAIN LOOP ====================

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  VFS Randevu Takip Botu v4");
  console.log("═══════════════════════════════════════════");

  if (!CONFIG.VFS_EMAIL || !CONFIG.VFS_PASSWORD) {
    console.error("❌ VFS_EMAIL ve VFS_PASSWORD .env'de tanımlanmalı!");
    process.exit(1);
  }

  if (CONFIG.CAPTCHA_API_KEY) {
    console.log("✅ CAPTCHA çözücü aktif");
  } else {
    console.log("⚠ CAPTCHA_API_KEY yok, Turnstile çözülemeyecek!");
  }

  while (true) {
    try {
      const configs = await fetchActiveConfigs();

      if (configs.length === 0) {
        console.log("\n⏸ Aktif görev yok. 60s sonra tekrar...");
        await new Promise((r) => setTimeout(r, 60000));
        continue;
      }

      for (const config of configs) {
        const found = await checkAppointments(config);
        if (found) console.log("\n🎉 RANDEVU BULUNDU! Dashboard'u kontrol edin!");

        const interval = (config.check_interval || 120) * 1000;
        const jitter = Math.floor(Math.random() * 30000);
        const wait = interval + jitter;
        console.log(`\n⏳ Sonraki: ${Math.round(wait / 1000)}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    } catch (err) {
      console.error("Ana döngü hatası:", err.message);
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
}

main();
