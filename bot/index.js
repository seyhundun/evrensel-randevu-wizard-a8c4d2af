/**
 * VFS Global Randevu Takip Botu v5
 * 
 * Yenilikler:
 * - Çoklu VFS hesap desteği (dashboard'dan yönetim)
 * - Hesap rotasyonu (ban durumunda sıradaki hesaba geç)
 * - Email/SMS OTP doğrulama desteği
 * - Banlanan hesaplar otomatik beklemeye alınır
 */

require("dotenv").config();
const puppeteer = require("puppeteer");

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
  CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY || "",
  HEADLESS: true,
  SLOW_MO: 50,
  QUEUE_MAX_WAIT_MS: Number(process.env.QUEUE_MAX_WAIT_MS || 180000), // 3dk (300→180)
  QUEUE_POLL_MS: Number(process.env.QUEUE_POLL_MS || 10000), // 10sn (8→10)
  COOLDOWN_HOURS: Number(process.env.COOLDOWN_HOURS || 2),
  OTP_WAIT_MS: Number(process.env.OTP_WAIT_MS || 120000),
  OTP_POLL_MS: Number(process.env.OTP_POLL_MS || 5000),
  MIN_ACCOUNT_GAP_MS: Number(process.env.MIN_ACCOUNT_GAP_MS || 600000), // Aynı hesap min 10dk arayla
  BASE_INTERVAL_MS: Number(process.env.BASE_INTERVAL_MS || 180000), // Kontroller arası min 3dk
  MAX_BACKOFF_MS: Number(process.env.MAX_BACKOFF_MS || 900000), // Max backoff 15dk
};

// Hesap bazlı son kullanım zamanı ve hata sayısı
const accountLastUsed = new Map(); // accountId → timestamp
let consecutiveErrors = 0; // art arda hata sayısı

// ==================== HELPERS ====================

function delay(min = 1000, max = 3000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

const apiHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${CONFIG.API_KEY}`,
  apikey: CONFIG.API_KEY,
};

async function reportResult(configId, status, message = "", slotsAvailable = 0, screenshotBase64 = null) {
  try {
    const body = { config_id: configId, status, message, slots_available: slotsAvailable };
    if (screenshotBase64) body.screenshot_base64 = screenshotBase64;
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log(`  [API] ${status}: ${data.message || data.error}`);
  } catch (err) {
    console.error("  [API] Bildirim hatası:", err.message);
  }
}

async function updateAccountStatus(accountId, status, failCount = null) {
  try {
    const body = { action: "update_account", account_id: accountId, status };
    if (status === "cooldown") {
      const until = new Date(Date.now() + CONFIG.COOLDOWN_HOURS * 3600000).toISOString();
      body.banned_until = until;
    }
    if (failCount !== null) body.fail_count = failCount;
    await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(body),
    });
    console.log(`  [ACCOUNT] ${accountId.substring(0, 8)}... → ${status}`);
  } catch (err) {
    console.error("  [ACCOUNT] Güncelleme hatası:", err.message);
  }
}

async function fetchActiveConfigs() {
  try {
    const res = await fetch(CONFIG.API_URL, { method: "GET", headers: apiHeaders });
    const data = await res.json();
    if (data.ok) return { configs: data.configs || [], accounts: data.accounts || [] };
    console.error("API hatası:", data.error);
    return { configs: [], accounts: [] };
  } catch (err) {
    console.error("API bağlantı hatası:", err.message);
    return { configs: [], accounts: [] };
  }
}

async function takeScreenshotBase64(page) {
  try {
    return await page.screenshot({ fullPage: true, encoding: "base64" });
  } catch { return null; }
}

async function isWaitingRoomPage(page) {
  return await page.evaluate(() => {
    const title = (document.title || "").toLowerCase();
    const body = (document.body?.innerText || "").toLowerCase();
    return (
      title.includes("waiting room") ||
      body.includes("şu anda sıradasınız") ||
      body.includes("tahmini bekleme süreniz") ||
      body.includes("this page will auto refresh") ||
      body.includes("bu sayfa otomatik olarak yenilenecektir")
    );
  });
}

async function waitForLoginFormAfterQueue(page) {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < CONFIG.QUEUE_MAX_WAIT_MS) {
    attempt += 1;
    const emailInput = await page.$('input[type="email"], input[name="email"], #email');
    if (emailInput) {
      console.log(`  [QUEUE] ✅ Login formu hazır (${attempt}. deneme).`);
      return { ok: true };
    }
    const waitingRoom = await isWaitingRoomPage(page);
    if (waitingRoom) {
      const waitedSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  [QUEUE] Sırada bekleniyor... ${waitedSec}s`);
      await solveTurnstile(page);
      // Agresif reload yapmıyoruz — VFS bunu tespit edip banlıyor
      // Sadece bekle, sayfa kendisi yenilenecek
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: CONFIG.QUEUE_POLL_MS + 5000 }).catch(() => {});
      await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
      continue;
    }
    await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
  }
  return { ok: false, reason: `Waiting room timeout (${Math.round(CONFIG.QUEUE_MAX_WAIT_MS / 1000)}s)` };
}

// ==================== OTP HANDLING ====================

async function readOtpFromEmail(accountId) {
  try {
    console.log("  [OTP] Email'den OTP okunuyor...");
    const res = await fetch(`${CONFIG.API_URL.replace("/bot-api", "/read-otp")}`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ account_id: accountId }),
    });
    const data = await res.json();
    if (data.ok && data.otp) {
      console.log(`  [OTP] ✅ OTP bulundu: ${data.otp}`);
      return data.otp;
    }
    console.log(`  [OTP] ❌ OTP bulunamadı: ${data.error || "Yeni email yok"}`);
    return null;
  } catch (err) {
    console.error("  [OTP] Email okuma hatası:", err.message);
    return null;
  }
}

async function handleOtpVerification(page, account) {
  // OTP sayfası kontrolü - email veya SMS ile gelen doğrulama kodu
  const hasOtp = await page.evaluate(() => {
    const body = (document.body?.innerText || "").toLowerCase();
    const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"]');
    const hasOtpInput = [...inputs].some(inp => {
      const name = (inp.name || "").toLowerCase();
      const placeholder = (inp.placeholder || "").toLowerCase();
      const id = (inp.id || "").toLowerCase();
      return name.includes("otp") || name.includes("code") || name.includes("verification") ||
             placeholder.includes("kod") || placeholder.includes("code") || placeholder.includes("doğrulama") ||
             id.includes("otp") || id.includes("code");
    });
    const hasOtpText = body.includes("doğrulama kodu") || body.includes("verification code") ||
                       body.includes("one-time") || body.includes("otp") ||
                       body.includes("tek kullanımlık") || body.includes("sms") ||
                       body.includes("e-posta") || body.includes("email");
    return hasOtpInput || (hasOtpText && inputs.length > 0 && inputs.length <= 6);
  });

  if (!hasOtp) return { ok: true, reason: "no_otp" };

  console.log("  [OTP] ⚠ Doğrulama kodu isteniyor!");
  const ss = await takeScreenshotBase64(page);

  // IMAP ile OTP okumayı dene
  const startTime = Date.now();
  const maxWait = CONFIG.OTP_WAIT_MS; // 2dk
  const pollInterval = CONFIG.OTP_POLL_MS; // 5sn
  
  while (Date.now() - startTime < maxWait) {
    const otp = await readOtpFromEmail(account.id);
    
    if (otp) {
      // OTP'yi sayfadaki input'a yaz
      const filled = await page.evaluate((code) => {
        // Tek büyük input
        const singleInput = document.querySelector('input[type="text"][name*="otp"], input[type="text"][name*="code"], input[type="number"], input[type="tel"]');
        if (singleInput) {
          singleInput.value = code;
          singleInput.dispatchEvent(new Event("input", { bubbles: true }));
          singleInput.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        // Birden fazla input (her hane ayrı)
        const inputs = document.querySelectorAll('input[type="text"], input[type="tel"]');
        const otpInputs = [...inputs].filter(inp => {
          const maxLen = inp.maxLength;
          return maxLen === 1 || maxLen === -1;
        });
        if (otpInputs.length >= 4 && otpInputs.length <= 8) {
          for (let i = 0; i < Math.min(code.length, otpInputs.length); i++) {
            otpInputs[i].value = code[i];
            otpInputs[i].dispatchEvent(new Event("input", { bubbles: true }));
            otpInputs[i].dispatchEvent(new Event("change", { bubbles: true }));
          }
          return true;
        }
        return false;
      }, otp);

      if (filled) {
        console.log("  [OTP] ✅ Kod girildi, gönderiliyor...");
        await delay(500, 1000);
        // Submit butonuna tıkla
        const submitted = await page.evaluate(() => {
          const btns = [...document.querySelectorAll("button")];
          const submitBtn = btns.find(b => {
            const txt = b.textContent.toLowerCase();
            return txt.includes("verify") || txt.includes("doğrula") || txt.includes("onayla") || 
                   txt.includes("submit") || txt.includes("gönder") || txt.includes("confirm");
          }) || document.querySelector('button[type="submit"]');
          if (submitBtn) { submitBtn.click(); return true; }
          return false;
        });
        if (submitted) {
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
          await delay(2000, 3000);
        }
        return { ok: true, reason: "otp_solved" };
      }
    }
    
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [OTP] Bekleniyor... ${elapsed}s / ${maxWait / 1000}s`);
    await delay(pollInterval, pollInterval + 1000);
  }

  console.log("  [OTP] ❌ OTP zaman aşımı - kod bulunamadı");
  return { ok: false, reason: "otp_required", screenshot: ss };
}

// ==================== CAPTCHA ====================

async function solveTurnstile(page) {
  if (!CONFIG.CAPTCHA_API_KEY || !Solver) {
    console.log("  [CAPTCHA] API key veya 2captcha modülü yok, atlıyorum.");
    return false;
  }
  const sitekey = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
    if (!iframe) return null;
    const container = iframe.closest("div[data-sitekey]") || document.querySelector("[data-sitekey]");
    if (container) return container.getAttribute("data-sitekey");
    const src = iframe.getAttribute("src") || "";
    const match = src.match(/[?&]k=([^&]+)/);
    return match ? match[1] : null;
  });
  if (!sitekey) {
    const altKey = await page.evaluate(() => {
      const el = document.querySelector(".cf-turnstile");
      return el ? el.getAttribute("data-sitekey") : null;
    });
    if (!altKey) {
      console.log("  [CAPTCHA] Turnstile bulunamadı.");
      return true;
    }
    return await _solve(page, altKey);
  }
  return await _solve(page, sitekey);
}

async function _solve(page, sitekey) {
  console.log(`  [CAPTCHA] Sitekey: ${sitekey.substring(0, 20)}...`);
  try {
    const solver = new (Solver.Solver || Solver)(CONFIG.CAPTCHA_API_KEY);
    const result = await solver.cloudflareTurnstile({ pageurl: page.url(), sitekey });
    const token = result.data;
    console.log("  [CAPTCHA] ✅ Çözüldü!");
    await page.evaluate((t) => {
      document.querySelectorAll(
        'input[name="cf-turnstile-response"], input[name="g-recaptcha-response"], [name*="turnstile"]'
      ).forEach((inp) => { inp.value = t; });
      if (typeof window.turnstileCallback === "function") window.turnstileCallback(t);
      if (typeof window.onTurnstileSuccess === "function") window.onTurnstileSuccess(t);
      if (window.turnstile) { try { window.turnstile.getResponse = () => t; } catch {} }
    }, token);
    await delay(1000, 2000);
    return true;
  } catch (err) {
    console.error("  [CAPTCHA] Hata:", err.message);
    return false;
  }
}

// ==================== MAIN CHECK ====================

async function checkAppointments(config, account) {
  const { id, country, city } = config;
  const ts = new Date().toLocaleTimeString("tr-TR");
  console.log(`\n[${ts}] Kontrol: ${country} ${city} | Hesap: ${account.email}`);

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

    // STEP 1: Giriş sayfası
    console.log("  [1/6] Giriş sayfası...");
    await page.goto(CONFIG.VFS_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(2000, 4000);

    // STEP 2: Cookie banner
    console.log("  [2/6] Cookie banner...");
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
        console.log("  [2/6] ✅ Cookie kabul edildi.");
        await delay(1000, 2000);
      }
    } catch (e) {}

    // STEP 3: CAPTCHA + Queue
    console.log("  [3/6] CAPTCHA + sıra kontrol...");
    await solveTurnstile(page);
    await delay(1000, 2000);
    const queueResult = await waitForLoginFormAfterQueue(page);
    if (!queueResult.ok) {
      const ss = await takeScreenshotBase64(page);
      await reportResult(id, "error", `${queueResult.reason} | Hesap: ${account.email}`, 0, ss);
      return { found: false, accountBanned: false };
    }

    // STEP 4: Login
    console.log("  [4/6] Giriş yapılıyor...");
    try {
      await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 20000 });
      await page.click('input[type="email"], input[name="email"], #email');
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await delay(100, 300);
      for (const ch of account.email) {
        await page.keyboard.type(ch, { delay: Math.random() * 100 + 30 });
      }
      await delay(500, 1000);
      await page.click('input[type="password"]');
      await delay(200, 400);
      for (const ch of account.password) {
        await page.keyboard.type(ch, { delay: Math.random() * 100 + 30 });
      }
      await delay(500, 1000);

      const submitBtn = await page.evaluateHandle(() => {
        const btns = [...document.querySelectorAll("button")];
        return btns.find((b) => {
          const txt = b.textContent.toLowerCase();
          return txt.includes("oturum") || txt.includes("sign in") || txt.includes("login") || txt.includes("giriş");
        }) || document.querySelector('button[type="submit"]') || null;
      });
      if (submitBtn && submitBtn.asElement()) {
        await submitBtn.asElement().click();
      } else {
        await page.click('button[type="submit"]');
      }
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
      await delay(3000, 5000);
    } catch (loginErr) {
      console.log("  [4/6] ⚠ Giriş formu hatası:", loginErr.message);
    }

    // STEP 5: OTP Doğrulama Kontrolü
    console.log("  [5/6] OTP kontrol...");
    const otpResult = await handleOtpVerification(page, account);
    if (!otpResult.ok && otpResult.reason === "otp_required") {
      console.log("  [5/6] ❌ OTP doğrulama gerekli - hesap beklemeye alınıyor");
      await reportResult(id, "error", `OTP doğrulama gerekli | Hesap: ${account.email} | Manuel müdahale gerekli`, 0, otpResult.screenshot);
      await updateAccountStatus(account.id, "cooldown", (account.fail_count || 0) + 1);
      return { found: false, accountBanned: false, otpRequired: true };
    }

    // Login doğrulama
    const pageCheck = await page.evaluate(() => {
      const body = (document.body?.innerText || "").toLowerCase();
      const url = window.location.href.toLowerCase();
      return {
        title: document.title,
        url: window.location.href,
        isNotFound: url.includes("page-not-found") || url.includes("404"),
        isSessionExpired: body.includes("oturum süresi doldu") || body.includes("session expired"),
        isBanned: body.includes("engellenmiş") || body.includes("blocked") || body.includes("banned"),
        isWaitingRoom: (document.title || "").toLowerCase().includes("waiting room"),
        isLoginPage: url.includes("/login"),
        isDashboard: url.includes("/dashboard") || url.includes("/appointment"),
        hasLoginForm: !!document.querySelector('input[type="email"], input[name="email"], #email'),
        bodySnippet: (document.body?.innerText || "").substring(0, 300),
      };
    });

    const isBanned = pageCheck.isBanned;
    const isError = pageCheck.isNotFound || pageCheck.isSessionExpired || isBanned || pageCheck.isWaitingRoom;
    const isLoginFailed = pageCheck.isLoginPage || pageCheck.hasLoginForm;

    if (isError || (isLoginFailed && !pageCheck.isDashboard)) {
      let errorType = "Bilinmeyen hata";
      if (isBanned) errorType = "❌ Hesap engellenmiş!";
      else if (pageCheck.isNotFound) errorType = "❌ Sayfa bulunamadı (404)";
      else if (pageCheck.isSessionExpired) errorType = "❌ Oturum süresi dolmuş";
      else if (pageCheck.isWaitingRoom) errorType = "❌ Hala waiting room'da";
      else if (isLoginFailed) errorType = "❌ Giriş başarısız";

      console.log(`  [5/6] ${errorType} | Hesap: ${account.email}`);

      const ss = await takeScreenshotBase64(page);
      await reportResult(id, "error", `${errorType} | Hesap: ${account.email}`, 0, ss);

      if (isBanned) {
        await updateAccountStatus(account.id, "banned");
        return { found: false, accountBanned: true };
      }

      // Giriş başarısız - fail count artır
      const newFailCount = (account.fail_count || 0) + 1;
      if (newFailCount >= 3) {
        console.log(`  [ACCOUNT] ${account.email} - 3 başarısız giriş, beklemeye alınıyor`);
        await updateAccountStatus(account.id, "cooldown", newFailCount);
      } else {
        await updateAccountStatus(account.id, "active", newFailCount);
      }
      return { found: false, accountBanned: false };
    }

    console.log("  [5/6] ✅ Giriş başarılı!");
    // Başarılı giriş - fail count sıfırla
    await updateAccountStatus(account.id, "active", 0);

    // STEP 6: Randevu kontrol
    console.log("  [6/6] Randevu kontrol...");
    await delay(2000, 3000);
    try {
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
        await delay(3000, 5000);
        await solveTurnstile(page);
        await delay(2000, 3000);
      }
    } catch (navErr) {}

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
      await reportResult(id, "found", `Randevu müsait! Hesap: ${account.email}`, 1, ss);
      return { found: true, accountBanned: false };
    } else {
      console.log("  ❌ Randevu yok.");
      const msg = noAppointment ? "Müsait randevu yok." : "Dashboard yüklendi, randevu yok.";
      await reportResult(id, "checking", `${msg} | Hesap: ${account.email}`, 0, ss);
      return { found: false, accountBanned: false };
    }
  } catch (err) {
    console.error("  [!] Genel hata:", err.message);
    await reportResult(id, "error", `Bot hatası: ${err.message} | Hesap: ${account.email}`);
    return { found: false, accountBanned: false };
  } finally {
    if (browser) await browser.close();
  }
}

// ==================== MAIN LOOP ====================

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  VFS Randevu Takip Botu v5");
  console.log("  Çoklu Hesap + OTP Desteği");
  console.log("═══════════════════════════════════════════");

  if (CONFIG.CAPTCHA_API_KEY) {
    console.log("✅ CAPTCHA çözücü aktif");
  } else {
    console.log("⚠ CAPTCHA_API_KEY yok, Turnstile çözülemeyecek!");
  }

  while (true) {
    try {
      const { configs, accounts } = await fetchActiveConfigs();

      if (accounts.length === 0) {
        console.log("\n❌ Kullanılabilir VFS hesabı yok! Dashboard'dan hesap ekleyin.");
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }

      if (configs.length === 0) {
        console.log("\n⏸ Aktif görev yok. 60s sonra tekrar...");
        await new Promise((r) => setTimeout(r, 60000));
        continue;
      }

      console.log(`\n📊 ${accounts.length} aktif hesap, ${configs.length} aktif görev`);

      for (const config of configs) {
        // Hesap seç — en uzun süredir kullanılmamış olanı tercih et
        const now = Date.now();
        const availableAccounts = accounts.filter(acc => {
          const lastUsed = accountLastUsed.get(acc.id) || 0;
          return (now - lastUsed) >= CONFIG.MIN_ACCOUNT_GAP_MS;
        });

        if (availableAccounts.length === 0) {
          // Tüm hesaplar yakın zamanda kullanılmış, en eski olanı bul ve bekle
          const oldestUsed = accounts.reduce((oldest, acc) => {
            const t = accountLastUsed.get(acc.id) || 0;
            return t < (accountLastUsed.get(oldest.id) || 0) ? acc : oldest;
          }, accounts[0]);
          const lastUsed = accountLastUsed.get(oldestUsed.id) || 0;
          const waitMs = Math.max(0, CONFIG.MIN_ACCOUNT_GAP_MS - (now - lastUsed));
          console.log(`\n⏳ Tüm hesaplar yakın zamanda kullanıldı. ${Math.round(waitMs / 1000)}s bekleniyor...`);
          await new Promise((r) => setTimeout(r, waitMs));
        }

        // Tekrar kontrol et
        const readyAccounts = accounts.filter(acc => {
          const lastUsed = accountLastUsed.get(acc.id) || 0;
          return (Date.now() - lastUsed) >= CONFIG.MIN_ACCOUNT_GAP_MS;
        });
        
        // En uzun süredir kullanılmamış hesabı seç
        const account = (readyAccounts.length > 0 ? readyAccounts : accounts).reduce((best, acc) => {
          const tBest = accountLastUsed.get(best.id) || 0;
          const tAcc = accountLastUsed.get(acc.id) || 0;
          return tAcc < tBest ? acc : best;
        }, (readyAccounts.length > 0 ? readyAccounts : accounts)[0]);

        accountLastUsed.set(account.id, Date.now());
        const result = await checkAppointments(config, account);

        if (result.found) {
          console.log("\n🎉 RANDEVU BULUNDU! Dashboard'u kontrol edin!");
          consecutiveErrors = 0;
        } else if (result.accountBanned) {
          console.log(`\n⛔ Hesap banlı: ${account.email}`);
          consecutiveErrors++;
        } else {
          // Başarılı kontrol (randevu yok ama hata da yok)
          const wasError = result.accountBanned === false && !result.otpRequired;
          if (wasError) consecutiveErrors = 0;
          else consecutiveErrors++;
        }

        // Exponential backoff hesapla
        const baseInterval = Math.max(config.check_interval * 1000, CONFIG.BASE_INTERVAL_MS);
        const backoffMultiplier = Math.min(Math.pow(1.5, consecutiveErrors), 5); // max 5x
        const interval = Math.min(baseInterval * backoffMultiplier, CONFIG.MAX_BACKOFF_MS);
        const jitter = Math.floor(Math.random() * 60000) + 15000; // 15-75sn rastgele
        const wait = Math.round(interval + jitter);
        
        console.log(`\n⏳ Sonraki: ${Math.round(wait / 1000)}s (backoff: x${backoffMultiplier.toFixed(1)}, errors: ${consecutiveErrors})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    } catch (err) {
      console.error("Ana döngü hatası:", err.message);
      consecutiveErrors++;
      const wait = Math.min(30000 * Math.pow(2, consecutiveErrors), CONFIG.MAX_BACKOFF_MS);
      console.log(`⏳ Hata sonrası bekleme: ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

main();
