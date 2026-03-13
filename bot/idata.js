/**
 * iDATA İtalya Randevu Takip Botu v1.0
 * Kayıt otomasyonu + Görsel CAPTCHA çözme + Hesap yönetimi
 * puppeteer-real-browser + 2captcha image CAPTCHA
 */

require("dotenv").config();

// ==================== CONFIG ====================
const CONFIG = {
  API_URL: "https://ocrpzwrsyiprfuzsyivf.supabase.co/functions/v1/bot-api",
  API_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc",
  CAPTCHA_API_KEY: (process.env.CAPTCHA_API_KEY || process.env.TWOCAPTCHA_API_KEY || "").trim(),
  REGISTER_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/register",
  LOGIN_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/login",
  APPOINTMENT_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/dashboard/application/availability",
  CHECK_INTERVAL_MS: Number(process.env.IDATA_CHECK_INTERVAL_MS || 120000),
  OTP_WAIT_MS: Number(process.env.OTP_WAIT_MS || 120000),
  OTP_POLL_MS: Number(process.env.OTP_POLL_MS || 5000),
};

console.log("🇮🇹 iDATA İtalya Botu v1.0 başlatılıyor...");
console.log(`🔐 CAPTCHA API key: ${CONFIG.CAPTCHA_API_KEY ? `var (${CONFIG.CAPTCHA_API_KEY.length} karakter)` : "yok"}`);

// ==================== IP ROTATION ====================
const IP_LIST = (process.env.IP_LIST || "").split(",").map(s => s.trim()).filter(Boolean);
let currentIpIndex = -1;
const ipBannedUntil = new Map();
const IP_BAN_DURATION_MS = Number(process.env.IP_BAN_DURATION_MS || 1800000);

function getNextIp() {
  if (IP_LIST.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < IP_LIST.length; i++) {
    currentIpIndex = (currentIpIndex + 1) % IP_LIST.length;
    const ip = IP_LIST[currentIpIndex];
    if (now >= (ipBannedUntil.get(ip) || 0)) {
      console.log(`  [IP] 🔄 ${ip} (${currentIpIndex + 1}/${IP_LIST.length})`);
      return ip;
    }
  }
  // Tümü banlıysa en erken açılanı kullan
  const earliest = IP_LIST.reduce((a, b) => (ipBannedUntil.get(a) || 0) < (ipBannedUntil.get(b) || 0) ? a : b);
  ipBannedUntil.delete(earliest);
  currentIpIndex = IP_LIST.indexOf(earliest);
  return earliest;
}

function markIpBanned(ip) {
  if (!ip) return;
  ipBannedUntil.set(ip, Date.now() + IP_BAN_DURATION_MS);
  console.log(`  [IP] 🚫 ${ip} ${IP_BAN_DURATION_MS / 60000} dk banlı`);
}

// ==================== HELPERS ====================
function delay(min = 2000, max = 5000) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

// ==================== AUDIO ALARM ====================
const { exec } = require("child_process");
let alarmInterval = null;

function startAlarm() {
  if (alarmInterval) return; // zaten çalıyor
  console.log("\n🔔🔔🔔 ALARM: RANDEVU BULUNDU! 🔔🔔🔔");
  
  const playBeep = () => {
    // Linux'ta beep sesi çal (birden fazla yöntem dene)
    exec('echo -e "\\a"'); // Terminal bell
    exec('for i in 1 2 3; do echo -e "\\a"; sleep 0.3; done'); // Üçlü bip
    // aplay/paplay varsa wav çal
    exec('command -v paplay && paplay /usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga 2>/dev/null || command -v aplay && aplay /usr/share/sounds/alsa/Front_Center.wav 2>/dev/null || echo -e "\\a\\a\\a"');
    // Terminale büyük uyarı yaz
    console.log("\n" + "=".repeat(60));
    console.log("🚨🚨🚨  RANDEVU BULUNDU! HEMEN GİRİN!  🚨🚨🚨");
    console.log("=".repeat(60) + "\n");
  };
  
  playBeep(); // İlk çalma
  alarmInterval = setInterval(playBeep, 10000); // Her 10sn tekrarla
}

function stopAlarm() {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
];
const VIEWPORTS = [
  { width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1536, height: 864 },
];

function getRandomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// İnsan benzeri yazma
async function humanType(page, selector, text, options = {}) {
  const { minDelay = 120, maxDelay = 350 } = options;
  const element = typeof selector === "string" ? await page.$(selector) : selector;
  if (!element) return false;

  await element.click({ clickCount: 1 });
  await delay(400, 900);

  // Temizle
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await delay(200, 500);

  for (const ch of String(text)) {
    const keyDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    await page.keyboard.type(ch, { delay: keyDelay });
    if (Math.random() < 0.15) await delay(300, 800);
  }
  await delay(300, 700);
  return true;
}

async function humanMove(page) {
  try {
    const vp = page.viewport();
    const w = vp?.width || 1366;
    const h = vp?.height || 768;
    const x = Math.floor(Math.random() * w * 0.6 + w * 0.2);
    const y = Math.floor(Math.random() * h * 0.6 + h * 0.2);
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 15 + 5) });
    await delay(200, 500);
  } catch {}
}

async function humanScroll(page, amount = null) {
  try {
    const scrollAmount = amount || Math.floor(Math.random() * 400) + 200;
    await page.evaluate(a => window.scrollBy({ top: a, behavior: 'smooth' }), scrollAmount);
    await delay(500, 1500);
  } catch {}
}

async function readPageState(page) {
  return await page.evaluate(() => {
    const url = (window.location.href || "").toLowerCase();
    const body = (document.body?.innerText || "").toLowerCase();
    const title = (document.title || "").toLowerCase();

    const isCloudflare =
      url.includes("/cdn-cgi/challenge-platform") ||
      body.includes("verifying you are human") ||
      body.includes("performing security verification") ||
      body.includes("verify you are human") ||
      body.includes("cloudflare") ||
      body.includes("ray id") ||
      title.includes("just a moment") ||
      title.includes("attention required");

    const otpFieldExists = !!document.querySelector('input[name*="otp" i], input[id*="otp" i], input[autocomplete="one-time-code"]');
    const otpHint = body.includes("otp") || body.includes("tek kullanımlık") || body.includes("sms kod") || body.includes("email kod") || body.includes("doğrulama kod");

    return {
      url,
      body,
      isCloudflare,
      otpRequired: otpFieldExists || otpHint,
    };
  });
}

async function waitCloudflareBypass(page, context = "sayfa", timeoutMs = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const state = await readPageState(page);
    if (!state.isCloudflare) return { ok: true, state };
    await delay(1500, 2500);
  }

  console.log(`  [CF] ❌ ${context}: Cloudflare doğrulaması aşılamadı`);
  const screenshot = await takeScreenshotBase64(page);
  return { ok: false, reason: "cloudflare_queue", screenshot };
}

// ==================== API ====================
const apiHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${CONFIG.API_KEY}`,
  apikey: CONFIG.API_KEY,
};

async function apiPost(payload, context = "api") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST", headers: apiHeaders,
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${context}: HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function apiGet(context = "api") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "GET", headers: apiHeaders, signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${context}: HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function takeScreenshotBase64(page) {
  try { return await page.screenshot({ fullPage: true, encoding: "base64" }); } catch { return null; }
}

async function reportLog(configId, status, message = "", screenshotBase64 = null) {
  if (!configId) return;
  try {
    const body = { config_id: configId, status, message, slots_available: 0 };
    if (screenshotBase64) body.screenshot_base64 = screenshotBase64;
    await apiPost(body, `idata_log:${status}`);
  } catch (err) {
    console.error("  [API] Log hatası:", err.message);
  }
}

// iDATA loglarını idata_tracking_logs tablosuna yaz
async function idataLog(status, message = "", screenshotBase64 = null) {
  try {
    const body = { action: "idata_log", status, message };
    if (screenshotBase64) body.screenshot_base64 = screenshotBase64;
    await apiPost(body, `idata_log:${status}`);
  } catch (err) {
    console.error("  [API] iDATA Log hatası:", err.message);
  }
}

// iDATA config'i kontrol et (is_active)
async function isIdataActive() {
  try {
    const res = await fetch(CONFIG.API_URL + "/idata", {
      method: "GET", headers: apiHeaders,
    });
    const data = await res.json();
    return data?.config?.is_active === true;
  } catch (err) {
    console.error("  [API] Config kontrol hatası:", err.message);
    return false;
  }
}

// ==================== 2CAPTCHA IMAGE SOLVER ====================
async function solveImageCaptcha(page) {
  if (!CONFIG.CAPTCHA_API_KEY) {
    console.log("  [CAPTCHA] ⚠ API key yok, CAPTCHA çözülemez!");
    return null;
  }

  try {
    // Captcha resmini bul
    const captchaImgBase64 = await page.evaluate(() => {
      // "Doğrulama kodu" etiketinden sonraki resmi bul
      const imgs = Array.from(document.querySelectorAll("img"));
      const captchaImg = imgs.find(img => {
        const src = img.src || "";
        const alt = (img.alt || "").toLowerCase();
        const parent = img.closest("div, fieldset, section");
        const parentText = (parent?.innerText || "").toLowerCase();
        return src.includes("captcha") || src.includes("dogrulama") ||
               src.includes("/code") || src.includes("/image") ||
               alt.includes("captcha") || alt.includes("doğrulama") ||
               parentText.includes("doğrulama kodu") ||
               (img.width > 60 && img.width < 300 && img.height > 20 && img.height < 100);
      });
      if (!captchaImg) return null;

      // Canvas ile base64'e çevir
      const canvas = document.createElement("canvas");
      canvas.width = captchaImg.naturalWidth || captchaImg.width;
      canvas.height = captchaImg.naturalHeight || captchaImg.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(captchaImg, 0, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    });

    if (!captchaImgBase64) {
      console.log("  [CAPTCHA] Captcha resmi bulunamadı!");
      return null;
    }

    console.log("  [CAPTCHA] 📸 Captcha resmi bulundu, 2captcha'ya gönderiliyor...");

    // 2captcha API — createTask
    const createRes = await fetch("https://api.2captcha.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: CONFIG.CAPTCHA_API_KEY,
        task: {
          type: "ImageToTextTask",
          body: captchaImgBase64,
          case: false,
          minLength: 4,
          maxLength: 6,
        },
      }),
    });
    const createData = await createRes.json();
    if (createData.errorId !== 0) {
      console.log(`  [CAPTCHA] ❌ 2captcha hata: ${createData.errorDescription || createData.errorCode}`);
      return null;
    }

    const taskId = createData.taskId;
    console.log(`  [CAPTCHA] Task oluşturuldu: ${taskId}`);

    // Sonuç bekle
    for (let i = 0; i < 30; i++) {
      await delay(3000, 5000);
      const resultRes = await fetch("https://api.2captcha.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: CONFIG.CAPTCHA_API_KEY, taskId }),
      });
      const resultData = await resultRes.json();

      if (resultData.status === "ready") {
        const code = resultData.solution?.text;
        console.log(`  [CAPTCHA] ✅ Çözüldü: ${code}`);
        return code;
      }
      if (resultData.errorId !== 0) {
        console.log(`  [CAPTCHA] ❌ Sonuç hatası: ${resultData.errorDescription}`);
        return null;
      }
    }

    console.log("  [CAPTCHA] ❌ Zaman aşımı");
    return null;
  } catch (err) {
    console.error("  [CAPTCHA] Hata:", err.message);
    return null;
  }
}

// ==================== BROWSER LAUNCH ====================
async function launchBrowser(ip = null) {
  const { connect } = require("puppeteer-real-browser");

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-web-security",
    "--lang=tr-TR",
  ];

  if (ip) {
    const port = 10800 + IP_LIST.indexOf(ip);
    args.push(`--proxy-server=socks5://127.0.0.1:${port}`);
    console.log(`  [BROWSER] Proxy: socks5://127.0.0.1:${port} (${ip})`);
  }

  const ua = getRandomItem(USER_AGENTS);
  const vp = getRandomItem(VIEWPORTS);

  const { browser, page } = await connect({
    headless: false,
    args,
    turnstile: true, // iData Cloudflare Turnstile kullanıyor
    fingerprint: true,
    connectOption: { defaultViewport: vp },
  });

  await page.setUserAgent(ua);
  await page.setViewport(vp);

  // Cookie banner'ı kapat
  page.on("dialog", async (d) => { try { await d.accept(); } catch {} });

  return { browser, page };
}

// ==================== DROPDOWN HELPER ====================
async function selectDropdownOption(page, dropdownSelector, optionText) {
  try {
    // Standart <select> element
    const isSelect = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      return el?.tagName === "SELECT";
    }, dropdownSelector);

    if (isSelect) {
      // Option value'sını bul
      const value = await page.evaluate((sel, text) => {
        const select = document.querySelector(sel);
        if (!select) return null;
        const options = Array.from(select.options);
        const match = options.find(o =>
          o.text.toLowerCase().includes(text.toLowerCase()) ||
          o.value.toLowerCase().includes(text.toLowerCase())
        );
        return match?.value || null;
      }, dropdownSelector, optionText);

      if (value) {
        await page.select(dropdownSelector, value);
        await delay(500, 1000);
        return true;
      }
    }

    // Custom dropdown — tıkla ve seçenek seç
    const dropdown = await page.$(dropdownSelector);
    if (dropdown) {
      await dropdown.click();
      await delay(500, 1000);

      // Seçeneği bul ve tıkla
      const clicked = await page.evaluate(text => {
        const items = Array.from(document.querySelectorAll("li, option, div[role='option'], .dropdown-item, a.dropdown-item"));
        const match = items.find(el =>
          el.textContent.toLowerCase().includes(text.toLowerCase())
        );
        if (match) { match.click(); return true; }
        return false;
      }, optionText);

      if (clicked) {
        await delay(500, 1000);
        return true;
      }
    }

    console.log(`  [FORM] ⚠ Dropdown seçenemedi: ${dropdownSelector} → ${optionText}`);
    return false;
  } catch (err) {
    console.log(`  [FORM] Dropdown hatası: ${err.message}`);
    return false;
  }
}

// ==================== LOGIN OTP WAIT ====================
async function waitForLoginOtp(accountId, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const data = await apiPost({ action: "idata_get_login_otp", account_id: accountId }, "get_login_otp");
      if (data?.manual_otp) {
        return data.manual_otp;
      }
    } catch (err) {
      console.log(`  [OTP] Poll hatası: ${err.message}`);
    }
    await delay(CONFIG.OTP_POLL_MS, CONFIG.OTP_POLL_MS + 1000);
  }
  return null;
}
async function registerAccount(page, account) {
  console.log(`\n📝 [iDATA] Kayıt başlıyor: ${account.email}`);

  try {
    await page.goto(CONFIG.REGISTER_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000, 5000);
    await humanMove(page);

    // Cookie banner varsa kapat
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      const accept = btns.find(b => {
        const t = (b.textContent || "").toLowerCase();
        return t.includes("anladım") || t.includes("kabul") || t.includes("accept") || t.includes("tamam");
      });
      if (accept) accept.click();
    }).catch(() => {});
    await delay(1000, 2000);

    // ===== KİŞİSEL BİLGİLER =====
    console.log("  [FORM] Kişisel bilgiler dolduruluyor...");

    // İsim
    await humanType(page, 'input[name*="name"]:not([name*="last"]):not([name*="sur"]):not([name*="soy"]), input[id*="name"]:not([id*="last"]):not([id*="sur"]):not([id*="soy"]), input[placeholder*="İsim"], input[placeholder*="isim"]', account.first_name);
    await humanMove(page);
    await delay(1000, 2000);

    // Soyisim
    await humanType(page, 'input[name*="last"], input[name*="sur"], input[name*="soy"], input[id*="last"], input[id*="sur"], input[id*="soy"], input[placeholder*="Soyisim"], input[placeholder*="soyisim"]', account.last_name);
    await delay(1000, 2000);

    // Doğum tarihi (gün/ay/yıl dropdown'ları)
    console.log("  [FORM] Doğum tarihi ayarlanıyor...");
    const birthDateSet = await page.evaluate((day, month, year) => {
      const selects = Array.from(document.querySelectorAll("select"));
      // Gün
      const daySelect = selects.find(s => {
        const opts = Array.from(s.options).map(o => o.value);
        return opts.includes("01") && opts.length >= 28 && opts.length <= 32;
      });
      // Ay
      const monthSelect = selects.find(s => {
        const opts = Array.from(s.options).map(o => o.value);
        return s !== daySelect && opts.length >= 12 && opts.length <= 14;
      });
      // Yıl
      const yearSelect = selects.find(s => {
        const opts = Array.from(s.options).map(o => o.value);
        return s !== daySelect && s !== monthSelect && opts.some(v => v.length === 4 && parseInt(v) > 1900);
      });

      if (daySelect) { daySelect.value = day; daySelect.dispatchEvent(new Event("change", { bubbles: true })); }
      if (monthSelect) { monthSelect.value = month; monthSelect.dispatchEvent(new Event("change", { bubbles: true })); }
      if (yearSelect) { yearSelect.value = year; yearSelect.dispatchEvent(new Event("change", { bubbles: true })); }

      return !!(daySelect && monthSelect && yearSelect);
    }, account.birth_day, account.birth_month, account.birth_year);
    console.log(`  [FORM] Doğum tarihi: ${birthDateSet ? "✅" : "⚠ Manuel deneniyor"}`);
    await delay(1000, 2000);

    // Pasaport No
    await humanType(page, 'input[name*="pasaport"], input[name*="passport"], input[id*="pasaport"], input[id*="passport"], input[placeholder*="Pasaport"]', account.passport_no);
    await delay(1000, 2000);

    // Telefon
    if (account.phone) {
      await humanType(page, 'input[name*="phone"], input[name*="tel"], input[id*="phone"], input[id*="tel"], input[placeholder*="5XX"], input[type="tel"]', account.phone);
      await delay(1000, 2000);
    }

    // Email
    await humanType(page, 'input[type="email"], input[name*="email"], input[id*="email"]', account.email);
    await delay(1000, 2000);

    // Şifre
    const passwordInputs = await page.$$('input[type="password"]');
    if (passwordInputs.length >= 2) {
      await humanType(page, passwordInputs[0], account.password);
      await delay(1000, 2000);
      await humanType(page, passwordInputs[1], account.password);
      await delay(1000, 2000);
    }

    await humanScroll(page, 400);
    await humanMove(page);

    // ===== BAŞVURU BİLGİLERİ =====
    console.log("  [FORM] Başvuru bilgileri dolduruluyor...");

    if (account.residence_city) {
      await selectDropdownOption(page, 'select[name*="city"], select[name*="sehir"], select[id*="city"]', account.residence_city);
    }
    if (account.idata_office) {
      await selectDropdownOption(page, 'select[name*="office"], select[name*="ofis"], select[id*="office"]', account.idata_office);
    }
    if (account.travel_purpose) {
      await selectDropdownOption(page, 'select[name*="purpose"], select[name*="amac"], select[id*="purpose"]', account.travel_purpose);
    }

    await humanScroll(page, 400);
    await delay(1000, 2000);

    // ===== FATURA BİLGİLERİ =====
    console.log("  [FORM] Fatura bilgileri dolduruluyor...");

    // Bireysel radio seç
    await page.evaluate(() => {
      const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
      const bireysel = radios.find(r => {
        const label = r.closest("label")?.textContent || "";
        return label.toLowerCase().includes("bireysel");
      }) || radios[0];
      if (bireysel) { bireysel.click(); bireysel.dispatchEvent(new Event("change", { bubbles: true })); }
    }).catch(() => {});
    await delay(500, 1000);

    if (account.invoice_city) {
      await selectDropdownOption(page, 'select[name*="fatura"], select[name*="invoice"]', account.invoice_city);
    }
    if (account.invoice_district) {
      // İlçe genellikle 2. dropdown
      const selects = await page.$$("select");
      if (selects.length > 1) {
        await delay(500, 1000);
        await selectDropdownOption(page, selects[selects.length - 1], account.invoice_district);
      }
    }
    if (account.invoice_address) {
      await humanType(page, 'input[name*="adres"], input[name*="address"], textarea[name*="adres"], textarea[name*="address"]', account.invoice_address);
    }

    await humanScroll(page, 500);
    await delay(1000, 2000);

    // ===== ONAY KUTULARI =====
    console.log("  [FORM] Onay kutuları işaretleniyor...");
    await page.evaluate(() => {
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      checkboxes.forEach(cb => {
        if (!cb.checked) {
          cb.click();
          cb.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }).catch(() => {});
    await delay(1000, 2000);

    // ===== GÖRSEL CAPTCHA =====
    console.log("  [CAPTCHA] Görsel CAPTCHA çözülüyor...");
    const captchaCode = await solveImageCaptcha(page);
    if (!captchaCode) {
      console.log("  [CAPTCHA] ❌ CAPTCHA çözülemedi!");
      return { success: false, reason: "captcha_failed" };
    }

    // Captcha input alanına yaz
    const captchaFilled = await humanType(page,
      'input[name*="captcha"], input[name*="dogrulama"], input[id*="captcha"], input[placeholder*="Doğrulama"], input[placeholder*="doğrulama"]',
      captchaCode
    );
    if (!captchaFilled) {
      // Fallback — "Doğrulama kodu" labelı yakınındaki input'u bul
      await page.evaluate(code => {
        const labels = Array.from(document.querySelectorAll("label, span, div, p"));
        const captchaLabel = labels.find(l => l.textContent.toLowerCase().includes("doğrulama kodu"));
        if (captchaLabel) {
          const container = captchaLabel.closest("div, fieldset, section");
          const input = container?.querySelector("input");
          if (input) {
            input.value = code;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }, captchaCode);
    }
    await delay(1000, 2000);

    // ===== KAYIT OL =====
    console.log("  [FORM] 'Kayıt Ol' butonuna tıklanıyor...");
    const submitted = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, input[type='submit']"));
      const submitBtn = btns.find(b => {
        const txt = (b.textContent || b.value || "").toLowerCase();
        return txt.includes("kayıt ol") || txt.includes("kayit ol") || txt.includes("üye ol") || txt.includes("register");
      }) || document.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
        return true;
      }
      return false;
    });

    if (!submitted) {
      console.log("  [FORM] ❌ Submit butonu bulunamadı!");
      const ss = await takeScreenshotBase64(page);
      return { success: false, reason: "submit_not_found", screenshot: ss };
    }

    console.log("  [FORM] ✅ Form gönderildi, sonuç bekleniyor...");
    await delay(5000, 8000);

    // Sonuç kontrol
    const result = await page.evaluate(() => {
      const body = (document.body?.innerText || "").toLowerCase();
      const url = window.location.href.toLowerCase();
      if (body.includes("başarı") || body.includes("kayıt") && body.includes("tamamlan") ||
          url.includes("login") || url.includes("success")) {
        return { success: true };
      }
      if (body.includes("hata") || body.includes("error") || body.includes("geçersiz") ||
          body.includes("doğrulama kodu yanlış") || body.includes("captcha")) {
        return { success: false, reason: body.substring(0, 200) };
      }
      return { success: null }; // Belirsiz
    });

    const ss = await takeScreenshotBase64(page);

    if (result.success === true) {
      console.log("  [REG] ✅ Kayıt başarılı!");
      return { success: true, screenshot: ss };
    } else if (result.success === false) {
      console.log(`  [REG] ❌ Kayıt başarısız: ${result.reason}`);
      return { success: false, reason: result.reason, screenshot: ss };
    } else {
      console.log("  [REG] ⚠ Sonuç belirsiz, screenshot alındı");
      return { success: null, reason: "uncertain", screenshot: ss };
    }

  } catch (err) {
    console.error(`  [REG] Hata: ${err.message}`);
    const ss = await takeScreenshotBase64(page).catch(() => null);
    return { success: false, reason: err.message, screenshot: ss };
  }
}

// ==================== LOGIN ====================
async function loginToIdata(page, account) {
  console.log(`\n🔑 [iDATA] Giriş: ${account.email}`);

  try {
    await page.goto(CONFIG.LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000, 5000);

    const cfAtLoginOpen = await waitCloudflareBypass(page, "login açılışı", 35000);
    if (!cfAtLoginOpen.ok) {
      return { success: false, reason: cfAtLoginOpen.reason, screenshot: cfAtLoginOpen.screenshot };
    }

    await humanMove(page);

    // Cookie banner
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      const accept = btns.find(b => (b.textContent || "").toLowerCase().includes("anladım"));
      if (accept) accept.click();
    }).catch(() => {});
    await delay(1000, 2000);

    // Üyelik numarası — login formunda ilk text input
    if (account.membership_number) {
      console.log(`  [LOGIN] Üyelik no giriliyor: ${account.membership_number}`);
      const memberInput = await page.$('input[type="text"]:not([type="email"]):not([type="password"])');
      if (memberInput) {
        await humanType(page, memberInput, account.membership_number);
        await delay(500, 1000);
      }
    }

    // Email
    await humanType(page, 'input[type="email"], input[name*="email"], input[id*="email"]', account.email);
    await delay(1000, 2000);

    // Şifre
    await humanType(page, 'input[type="password"]', account.password);
    await delay(1000, 2000);

    // CAPTCHA
    const captchaCode = await solveImageCaptcha(page);
    if (captchaCode) {
      // CAPTCHA input — genellikle label'ı "Doğrulama" olan veya son text input
      const captchaFilled = await page.evaluate((code) => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
        // Captcha input'u bul — label'da "doğrulama" veya "captcha" geçen
        const captchaInput = inputs.find(inp => {
          const parent = inp.closest("div, fieldset, section, .form-group");
          const parentText = (parent?.innerText || "").toLowerCase();
          const placeholder = (inp.placeholder || "").toLowerCase();
          return parentText.includes("doğrulama") || parentText.includes("captcha") || 
                 placeholder.includes("doğrulama") || placeholder.includes("captcha") ||
                 placeholder.includes("kod");
        });
        if (captchaInput) {
          captchaInput.focus();
          captchaInput.value = code;
          captchaInput.dispatchEvent(new Event("input", { bubbles: true }));
          captchaInput.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      }, captchaCode);
      
      if (!captchaFilled) {
        // Fallback — eski yöntem
        await humanType(page, 'input[name*="captcha"], input[placeholder*="Doğrulama"]', captchaCode);
      }
      await delay(500, 1000);
    }

    // Giriş butonu
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, input[type='submit']"));
      const loginBtn = btns.find(b => {
        const txt = (b.textContent || b.value || "").toLowerCase();
        return txt.includes("giriş") || txt.includes("login") || txt.includes("oturum");
      }) || document.querySelector('button[type="submit"]');
      if (loginBtn) loginBtn.click();
    });

    await delay(5000, 8000);

    // OTP popup kontrolü — "Mailinize doğrulama kodu gönderildi" mesajı
    const otpNeeded = await page.evaluate(() => {
      const body = (document.body?.innerText || "").toLowerCase();
      return body.includes("doğrulama kodu gönderildi") || 
             body.includes("mailinize") && body.includes("kod") ||
             body.includes("e-posta") && body.includes("doğrulama");
    });

    if (otpNeeded) {
      console.log("  [LOGIN] 📧 Mail doğrulama kodu gerekiyor!");
      
      // "Tamam" butonuna tıkla (popup'ı kapat)
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a"));
        const okBtn = btns.find(b => {
          const txt = (b.textContent || "").trim().toLowerCase();
          return txt === "tamam" || txt === "ok" || txt === "onay";
        });
        if (okBtn) okBtn.click();
      });
      await delay(1000, 2000);

      // Bot API'ye OTP isteği bildir
      await apiPost({ action: "idata_set_login_otp_requested", account_id: account.id }, "set_login_otp");
      await idataLog("login_otp", `📧 Giriş OTP bekleniyor | Hesap: ${account.email}`);

      // Dashboard'dan OTP'yi bekle (max 3 dakika)
      console.log("  [LOGIN] ⏳ Dashboard'dan OTP bekleniyor (max 180s)...");
      const otpCode = await waitForLoginOtp(account.id, 180000);
      
      if (!otpCode) {
        console.log("  [LOGIN] ❌ OTP zaman aşımı");
        await idataLog("login_fail", `OTP zaman aşımı | Hesap: ${account.email}`);
        return { success: false, reason: "otp_timeout" };
      }

      console.log(`  [LOGIN] ✅ OTP alındı: ${otpCode}`);
      
      // OTP kodunu gir
      const otpInput = await page.$('input[type="text"], input[name*="otp"], input[name*="code"], input[id*="otp"], input[id*="code"]');
      if (otpInput) {
        await humanType(page, otpInput, otpCode);
        await delay(500, 1000);
      } else {
        // Sayfadaki tek/son text input'a gir
        await page.evaluate((code) => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
          const last = inputs[inputs.length - 1];
          if (last) {
            last.focus();
            last.value = code;
            last.dispatchEvent(new Event("input", { bubbles: true }));
            last.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, otpCode);
      }
      await delay(1000, 2000);

      // Doğrula/Giriş butonuna tıkla
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, input[type='submit']"));
        const verifyBtn = btns.find(b => {
          const txt = (b.textContent || b.value || "").toLowerCase();
          return txt.includes("doğrula") || txt.includes("onayla") || txt.includes("giriş") || txt.includes("verify");
        }) || document.querySelector('button[type="submit"]');
        if (verifyBtn) verifyBtn.click();
      });
      await delay(5000, 8000);

      // OTP'yi temizle
      await apiPost({ action: "idata_clear_login_otp", account_id: account.id }, "clear_login_otp");
    }

    const state = await readPageState(page);
    const stillLogin = state.url.includes("/membership/login") || state.body.includes("giriş yap");
    const inMemberArea = state.url.includes("/membership") && !state.url.includes("/membership/login");
    const onAppointment = state.url.includes("appointment") || state.url.includes("randevu");
    const hasLogout = state.body.includes("çıkış") || state.body.includes("logout");
    const loggedIn = !state.isCloudflare && !stillLogin && (onAppointment || inMemberArea || hasLogout);

    if (state.isCloudflare) {
      console.log("  [LOGIN] ❌ Cloudflare doğrulamasında takıldı");
      const ss = await takeScreenshotBase64(page);
      return { success: false, reason: "cloudflare_queue", screenshot: ss };
    }

    if (state.otpRequired) {
      console.log("  [LOGIN] ⚠ OTP doğrulaması bekleniyor");
      const ss = await takeScreenshotBase64(page);
      return { success: false, reason: "otp_required", screenshot: ss };
    }

    if (loggedIn) {
      console.log("  [LOGIN] ✅ Giriş başarılı!");
      return { success: true };
    }

    console.log("  [LOGIN] ❌ Giriş başarısız");
    const ss = await takeScreenshotBase64(page);
    return { success: false, reason: "login_failed", screenshot: ss };

  } catch (err) {
    console.error(`  [LOGIN] Hata: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

// ==================== APPOINTMENT CHECK ====================
async function checkAppointments(page, account) {
  console.log("  [CHECK] Randevu kontrol ediliyor...");

  try {
    // Randevu sayfasına git
    await page.goto(CONFIG.APPOINTMENT_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await delay(3000, 5000);

    // Cloudflare kontrolü
    const cfCheck = await waitCloudflareBypass(page, "randevu sayfası", 20000);
    if (!cfCheck.ok) {
      return { found: false, reason: "cloudflare", screenshot: cfCheck.screenshot };
    }

    // Giriş sayfasına yönlendirildiyse oturum düşmüş demektir
    const currentUrl = await page.url();
    if (currentUrl.includes("/membership/login") || currentUrl.includes("/login")) {
      console.log("  [CHECK] ❌ Oturum düşmüş, login sayfasına yönlendirildi");
      return { found: false, reason: "session_expired" };
    }

    // Sayfanın yüklendiğinden emin ol
    await delay(2000, 3000);

    // Ekran görüntüsünü şimdiden alalım (debug amaçlı)
    const preScreenshot = await takeScreenshotBase64(page);

    // Sayfada form var mı kontrol et
    const pageState = await page.evaluate(() => {
      const body = (document.body?.innerText || "");
      const lower = body.toLowerCase();
      const selects = document.querySelectorAll("select");
      const textInputs = document.querySelectorAll('input[type="text"]');
      return {
        hasSelects: selects.length,
        hasTextInputs: textInputs.length,
        bodyPreview: body.substring(0, 500),
        bodyLower: lower.substring(0, 1000),
        url: window.location.href,
      };
    });

    console.log(`  [CHECK] Sayfa: ${pageState.url} | ${pageState.hasSelects} select, ${pageState.hasTextInputs} input`);

    // 1) Üyelik numarasını gir ve Ekle butonuna tıkla
    if (account.membership_number) {
      console.log(`  [CHECK] Üyelik no giriliyor: ${account.membership_number}`);
      
      const memberInput = await page.$('input[type="text"]');
      if (memberInput) {
        await humanType(page, memberInput, account.membership_number);
        await delay(500, 1000);

        // "Ekle" butonuna tıkla
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"));
          const addBtn = btns.find(b => {
            const txt = (b.textContent || b.value || "").trim().toLowerCase();
            return txt === "ekle" || txt.includes("ekle");
          });
          if (addBtn) addBtn.click();
        });
        await delay(3000, 5000);
      } else {
        console.log("  [CHECK] ⚠ Üyelik numarası input'u bulunamadı");
      }
    }

    // 2) Şehir seçimi
    if (account.residence_city) {
      console.log(`  [CHECK] Şehir seçiliyor: ${account.residence_city}`);
      await page.evaluate((city) => {
        const selects = Array.from(document.querySelectorAll("select"));
        for (const sel of selects) {
          const opts = Array.from(sel.options);
          const match = opts.find(o => o.text.trim().toLowerCase() === city.toLowerCase());
          if (match) {
            sel.value = match.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }, account.residence_city);
      await delay(2000, 3000);
    }

    // 3) Ofis seçimi
    if (account.idata_office) {
      console.log(`  [CHECK] Ofis seçiliyor: ${account.idata_office}`);
      await page.evaluate((office) => {
        const selects = Array.from(document.querySelectorAll("select"));
        for (const sel of selects) {
          const opts = Array.from(sel.options);
          const match = opts.find(o => o.text.trim().toLowerCase().includes(office.toLowerCase()));
          if (match) {
            sel.value = match.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }, account.idata_office);
      await delay(2000, 3000);
    }

    // 4) Gidiş amacı seçimi
    if (account.travel_purpose) {
      console.log(`  [CHECK] Gidiş amacı seçiliyor: ${account.travel_purpose}`);
      await page.evaluate((purpose) => {
        const selects = Array.from(document.querySelectorAll("select"));
        for (const sel of selects) {
          const opts = Array.from(sel.options);
          const match = opts.find(o => o.text.trim().toLowerCase().includes(purpose.toLowerCase()));
          if (match) {
            sel.value = match.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }, account.travel_purpose);
      await delay(2000, 3000);
    }

    // 5) Hizmet tipi (STANDART)
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      for (const sel of selects) {
        const opts = Array.from(sel.options);
        const match = opts.find(o => o.text.trim().toUpperCase() === "STANDART");
        if (match) {
          sel.value = match.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        }
      }
    });
    await delay(3000, 5000);

    // 6) Sonucu kontrol et — ÇOK SIKI TESPİT
    const result = await page.evaluate(() => {
      const body = (document.body?.innerText || "");
      const lower = body.toLowerCase();

      // === KESİN RANDEVU YOK ===
      if (lower.includes("uygun randevu tarihi bulunmamaktadır") || 
          lower.includes("randevu tarihi bulunmamaktadır") ||
          lower.includes("uygun randevu bulunmamaktadır") ||
          lower.includes("no available appointment")) {
        const dateMatch = body.match(/(\d{2}\.\d{2}\.\d{4})/g);
        return { 
          found: false, 
          status: "no_appointment",
          text: "Uygun randevu tarihi bulunmamaktadır",
          openUntil: dateMatch ? dateMatch[dateMatch.length - 1] : null 
        };
      }

      // === KESİN RANDEVU VAR === (çok spesifik kontroller)
      // Sadece gerçek tarih seçim arayüzü görünüyorsa "found" de
      const hasDatePicker = !!document.querySelector('input[type="date"], .datepicker-days, .flatpickr-calendar');
      const hasAvailableSlots = lower.includes("müsait randevu tarihleri") || 
                                  lower.includes("aşağıdaki tarihlerden") ||
                                  lower.includes("randevu tarihini seçiniz");
      
      if (hasDatePicker || hasAvailableSlots) {
        return { found: true, status: "appointment_available", text: body.substring(0, 500) };
      }

      // === FORM HENÜZ DOLDURULMADI / SONUÇ BELİRSİZ ===
      // Form hala görünüyorsa ve sonuç mesajı yoksa → randevu yok say
      const selects = document.querySelectorAll("select");
      if (selects.length >= 2) {
        // Form görünüyor, henüz sonuç yok veya seçim yapılmadı
        return { found: false, status: "form_visible", text: "Form görünüyor, sonuç belirsiz: " + body.substring(0, 300) };
      }

      // Sayfa boş veya beklenmeyen durum
      return { found: false, status: "unknown", text: body.substring(0, 300) };
    });

    const ss = await takeScreenshotBase64(page);

    if (result.found) {
      console.log("  [CHECK] 🎉 RANDEVU BULUNDU!");
      return { found: true, screenshot: ss, message: result.text };
    }

    const extraInfo = result.openUntil ? ` | Açık tarih: ${result.openUntil}` : "";
    console.log(`  [CHECK] ❌ Randevu yok (${result.status})${extraInfo}`);
    return { found: false, screenshot: ss, message: `[${result.status}] ${result.text}${extraInfo}` };

  } catch (err) {
    console.error(`  [CHECK] Hata: ${err.message}`);
    return { found: false, error: err.message };
  }
}

// ==================== PENDING REGISTRATIONS ====================
async function processPendingRegistrations() {
  try {
    const data = await apiPost({ action: "get_idata_pending_registrations" }, "get_idata_pending");
    const accounts = data.accounts || [];
    if (accounts.length === 0) return;

    console.log(`\n📋 ${accounts.length} iDATA kayıt talebi var`);

    for (const acc of accounts) {
      const ip = getNextIp();
      let browser, page;
      try {
        ({ browser, page } = await launchBrowser(ip));
        const result = await registerAccount(page, acc);

        if (result.success) {
          await apiPost({ action: "complete_idata_registration", account_id: acc.id, success: true }, "complete_reg");
          console.log(`  ✅ ${acc.email} kayıt tamamlandı`);
        } else {
          // CAPTCHA hatası ise retry'a bırak, diğer hatalar failed
          const isCaptchaError = result.reason === "captcha_failed";
          if (!isCaptchaError) {
            await apiPost({ action: "complete_idata_registration", account_id: acc.id, success: false }, "complete_reg");
          }
          console.log(`  ❌ ${acc.email} kayıt başarısız: ${result.reason}`);
        }

        if (result.screenshot) {
          await reportLog(null, "idata_registration", `${acc.email}: ${result.success ? "Başarılı" : result.reason}`, result.screenshot);
        }
      } catch (err) {
        console.error(`  Kayıt hatası (${acc.email}):`, err.message);
        if (ip) markIpBanned(ip);
      } finally {
        try { if (browser) await browser.close(); } catch {}
      }

      await delay(10000, 20000);
    }
  } catch (err) {
    console.error("  Pending registrations hatası:", err.message);
  }
}

// ==================== SCRAPE CITY→OFFICE MAPPINGS ====================
async function scrapeCityOffices() {
  console.log("\n📍 [SCRAPE] Şehir→Ofis eşleşmeleri çekiliyor...");
  const ip = getNextIp();
  let browser, page;
  try {
    ({ browser, page } = await launchBrowser(ip));
    await page.goto(CONFIG.REGISTER_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000, 5000);

    const cfAtRegisterOpen = await waitCloudflareBypass(page, "kayıt sayfası", 35000);
    if (!cfAtRegisterOpen.ok) {
      if (ip) markIpBanned(ip);
      return false;
    }

    // Cookie banner kapat
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      const accept = btns.find(b => (b.textContent || "").toLowerCase().includes("anladım") || (b.textContent || "").toLowerCase().includes("kabul"));
      if (accept) accept.click();
    }).catch(() => {});
    await delay(1000, 2000);

    // İkametgah şehri select'ini bul
    const citySelect = await page.$('select[name*="city"], select[name*="sehir"], select[id*="city"], select[id*="residence"]');
    if (!citySelect) {
      const allSelects = await page.$$("select");
      console.log(`  [SCRAPE] ${allSelects.length} select bulundu, şehir select'i aranıyor...`);
    }

    // Tüm şehirleri al
    const cities = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const citySelect = selects.find(s => {
        const opts = Array.from(s.options).map(o => o.text.toLowerCase());
        return opts.some(t => t.includes("istanbul") || t.includes("ankara") || t.includes("izmir"));
      });
      if (!citySelect) return [];
      return Array.from(citySelect.options)
        .filter(o => o.value && o.value !== "" && !o.text.toLowerCase().includes("seçiniz"))
        .map(o => ({ value: o.value, text: o.text.trim() }));
    });

    if (cities.length === 0) {
      console.log("  [SCRAPE] ❌ Şehir listesi bulunamadı");
      const state = await readPageState(page);
      if (state.isCloudflare && ip) markIpBanned(ip);
      return false;
    }

    console.log(`  [SCRAPE] ${cities.length} şehir bulundu`);
    const allMappings = [];

    for (const city of cities) {
      try {
        await page.evaluate((cityVal) => {
          const selects = Array.from(document.querySelectorAll("select"));
          const citySelect = selects.find(s => {
            const opts = Array.from(s.options).map(o => o.text.toLowerCase());
            return opts.some(t => t.includes("istanbul") || t.includes("ankara"));
          });
          if (citySelect) {
            citySelect.value = cityVal;
            citySelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, city.value);

        await delay(1500, 3000);

        const offices = await page.evaluate(() => {
          const selects = Array.from(document.querySelectorAll("select"));
          const officeSelect = selects.find(s => {
            const opts = Array.from(s.options).map(o => o.text.toLowerCase());
            return opts.some(t => t.includes("ofis"));
          });
          if (!officeSelect) return [];
          return Array.from(officeSelect.options)
            .filter(o => o.value && o.value !== "" && !o.text.toLowerCase().includes("seçiniz"))
            .map(o => ({ value: o.value, text: o.text.trim() }));
        });

        if (offices.length > 0) {
          console.log(`  [SCRAPE] ${city.text}: ${offices.map(o => o.text).join(", ")}`);
          for (const office of offices) {
            allMappings.push({ city: city.text, office_name: office.text, office_value: office.value });
          }
        }
      } catch (err) {
        console.log(`  [SCRAPE] ${city.text} hata: ${err.message}`);
      }
    }

    if (allMappings.length > 0) {
      await apiPost({ action: "sync_idata_city_offices", mappings: allMappings }, "sync_offices");
      console.log(`  [SCRAPE] ✅ ${allMappings.length} şehir-ofis eşleşmesi kaydedildi`);
      return true;
    }

    return false;
  } catch (err) {
    console.error("  [SCRAPE] Hata:", err.message);
    if (ip) markIpBanned(ip);
    return false;
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}

// ==================== MAIN LOOP ====================
async function mainLoop() {
  console.log("\n🔄 iDATA Ana döngü başlıyor...");
  await idataLog("bot_start", "iDATA botu başlatıldı");

  let scrapeCounter = 0;
  let cityOfficesScraped = false;

  while (true) {
    try {
      // Config kontrolü — dashboard'dan aktif mi?
      const active = await isIdataActive();
      if (!active) {
        console.log("  ⏸ Bot pasif, bekleniyor...");
        await delay(10000, 15000);
        continue;
      }

      // İlk başta şehir-ofis eşleşmelerini çek
      if (!cityOfficesScraped) {
        await idataLog("info", "Şehir-ofis eşleşmeleri çekiliyor...");
        cityOfficesScraped = await scrapeCityOffices();
      }

      // 1. Bekleyen kayıtları işle
      const pendingData = await apiPost({ action: "get_idata_pending_registrations" }, "check_pending");
      const pendingCount = pendingData?.accounts?.length || 0;
      if (pendingCount > 0) {
        await idataLog("reg_start", `${pendingCount} kayıt talebi işleniyor`);
        await processPendingRegistrations();
      }

      // 2. Aktif hesaplarla randevu kontrol
      const idataData = await fetch(CONFIG.API_URL + "/idata", { method: "GET", headers: apiHeaders }).then(r => r.json()).catch(() => null);
      const accounts = idataData?.accounts || [];
      
      if (accounts.length > 0) {
        const account = accounts[0]; // En az kullanılan hesap
        const ip = getNextIp();
        let browser, page;
        try {
          await idataLog("login_start", `Giriş: ${account.email} | IP: ${ip || "doğrudan"}`);
          ({ browser, page } = await launchBrowser(ip));
          
          const loginResult = await loginToIdata(page, account);
          if (loginResult.success) {
            await idataLog("login_success", `Giriş başarılı: ${account.email}`);
            
            // Randevu kontrol
            await idataLog("appt_check", `Randevu kontrol ediliyor | Hesap: ${account.email}`);
            const apptResult = await checkAppointments(page, account);
            
            if (apptResult.found) {
              await idataLog("appt_found", `🎉 RANDEVU BULUNDU! | Hesap: ${account.email}`, apptResult.screenshot);
              startAlarm(); // 🔔 Sesli alarm başlat
              
              // Randevu bulunduğunda hızlı döngüye geç (her 15sn kontrol)
              console.log("  ⚡ Randevu bulundu! Hızlı kontrol moduna geçildi.");
              while (true) {
                await delay(15000, 20000);
                const recheck = await checkAppointments(page, account);
                if (recheck.found) {
                  await idataLog("appt_found", `🎉 RANDEVU HALA MEVCUT! | Hesap: ${account.email}`, recheck.screenshot);
                } else {
                  await idataLog("appt_none", `Randevu kapandı | ${recheck.message || ""} | Hesap: ${account.email}`, recheck.screenshot);
                  stopAlarm();
                  break;
                }
              }
            } else {
              stopAlarm(); // Alarm varsa kapat
              await idataLog("appt_none", `Randevu yok | ${apptResult.message || ""} | Hesap: ${account.email}`, apptResult.screenshot);
            }
          } else {
            const reason = loginResult.reason ? ` | Sebep: ${loginResult.reason}` : "";
            await idataLog("login_fail", `Giriş başarısız: ${account.email}${reason}`, loginResult.screenshot);
            if (ip && ["cloudflare_queue", "cloudflare_challenge"].includes(loginResult.reason)) {
              markIpBanned(ip);
            }
          }
        } catch (err) {
          await idataLog("error", `Hata: ${err.message} | IP: ${ip || "doğrudan"}`);
          if (ip) markIpBanned(ip);
        } finally {
          try { if (browser) await browser.close(); } catch {}
        }
      } else {
        await idataLog("info", "Aktif hesap yok, bekleniyor");
      }

      // 3. Her 50 döngüde bir şehir-ofis eşleşmelerini güncelle
      scrapeCounter++;
      if (scrapeCounter >= 50) {
        await scrapeCityOffices();
        scrapeCounter = 0;
      }

      const waitSec = CONFIG.CHECK_INTERVAL_MS / 1000;
      await idataLog("bot_idle", `${waitSec}s bekleniyor...`);
      console.log(`  ⏰ ${waitSec}s bekleniyor...`);
      await delay(CONFIG.CHECK_INTERVAL_MS, CONFIG.CHECK_INTERVAL_MS + 10000);

    } catch (err) {
      console.error("  Ana döngü hatası:", err.message);
      await idataLog("error", `Ana döngü hatası: ${err.message}`);
      await delay(30000, 60000);
    }
  }
}

// ==================== START ====================
mainLoop().catch(err => {
  console.error("💥 iDATA botu çöktü:", err);
  process.exit(1);
});
