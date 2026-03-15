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
  OTP_EMAIL_FROM: (process.env.IDATA_OTP_FROM || "").trim().toLowerCase(), // örn: no-reply@idata.com.tr
  REGISTER_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/register",
  LOGIN_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/login",
  APPOINTMENT_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/dashboard/application/availability",
  CHECK_INTERVAL_MS: Number(process.env.IDATA_CHECK_INTERVAL_MS || 10000),
  OTP_WAIT_MS: Number(process.env.OTP_WAIT_MS || 120000),
  OTP_POLL_MS: Number(process.env.OTP_POLL_MS || 5000),
};

// ==================== CAPTCHA PROVIDER ====================
let CAPTCHA_PROVIDER = (process.env.CAPTCHA_PROVIDER || "auto").toLowerCase();
let CAPSOLVER_API_KEY = (process.env.CAPSOLVER_API_KEY || "").trim();

console.log("🇮🇹 iDATA İtalya Botu v1.0 başlatılıyor...");
console.log(`🔐 CAPTCHA Provider: ${CAPTCHA_PROVIDER}`);
console.log(`🔐 2captcha API key: ${CONFIG.CAPTCHA_API_KEY ? `var (${CONFIG.CAPTCHA_API_KEY.length} karakter)` : "yok"}`);
if (CAPSOLVER_API_KEY) console.log(`🔐 Capsolver API key: var (${CAPSOLVER_API_KEY.length} karakter)`);

// Proxy açık/kapalı (dashboard'dan kontrol edilir)
let PROXY_ENABLED = true;
// ==================== PROXY CONFIG ====================
const PROXY_MODE = (process.env.PROXY_MODE || "residential").toLowerCase();
let EVOMI_PROXY_HOST = process.env.EVOMI_PROXY_HOST || "rp.evomi.com";
let EVOMI_PROXY_PORT = Number(process.env.EVOMI_PROXY_PORT || 1000);
let EVOMI_PROXY_USER = process.env.EVOMI_PROXY_USER || "";
let EVOMI_PROXY_PASS = process.env.EVOMI_PROXY_PASS || "";
let EVOMI_PROXY_COUNTRY = process.env.EVOMI_PROXY_COUNTRY || "TR";
let EVOMI_PROXY_REGION = process.env.EVOMI_PROXY_REGION || "";
let residentialSessionId = 0;

// DB'den proxy ayarlarını yükle (dashboard'dan değiştirilebilir)
async function loadProxySettingsFromDB() {
  try {
    const fetch = (await import("node-fetch")).default;
    const res = await fetch(
      "https://ocrpzwrsyiprfuzsyivf.supabase.co/rest/v1/bot_settings?select=key,value",
      {
        headers: {
          apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc",
          "Content-Type": "application/json",
        },
      }
    );
    const settings = await res.json();
    if (Array.isArray(settings)) {
      const map = Object.fromEntries(settings.map(s => [s.key, s.value]));
      if (map.proxy_enabled !== undefined) {
        const rawProxyEnabled = map.proxy_enabled;
        const normalized = String(rawProxyEnabled).trim().toLowerCase();
        PROXY_ENABLED = !(rawProxyEnabled === false || normalized === "false" || normalized === "0");
      }
      if (map.proxy_country) EVOMI_PROXY_COUNTRY = map.proxy_country;
      if (map.proxy_host) EVOMI_PROXY_HOST = map.proxy_host;
      if (map.proxy_port) EVOMI_PROXY_PORT = Number(map.proxy_port);
      // iDATA uses its own country/region settings, fallback to shared ones
      if (map.idata_proxy_country) { EVOMI_PROXY_COUNTRY = map.idata_proxy_country; } else if (map.proxy_country) { EVOMI_PROXY_COUNTRY = map.proxy_country; }
      if (map.idata_proxy_region !== undefined) { EVOMI_PROXY_REGION = map.idata_proxy_region; DB_PROXY_REGION = map.idata_proxy_region; } else if (map.proxy_region !== undefined) { EVOMI_PROXY_REGION = map.proxy_region; DB_PROXY_REGION = map.proxy_region; }
      if (map.proxy_user) EVOMI_PROXY_USER = map.proxy_user;
      if (map.proxy_pass) EVOMI_PROXY_PASS = map.proxy_pass;
      if (map.captcha_provider) CAPTCHA_PROVIDER = map.captcha_provider.toLowerCase();
      if (map.capsolver_api_key) CAPSOLVER_API_KEY = map.capsolver_api_key;
      if (map.captcha_api_key) CONFIG.CAPTCHA_API_KEY = map.captcha_api_key;
      console.log(`  [DB] ✅ Ayarlar DB'den: proxy_enabled=${PROXY_ENABLED} proxy=${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT} ülke=${EVOMI_PROXY_COUNTRY} bölge=${EVOMI_PROXY_REGION || 'yok'} captcha=${CAPTCHA_PROVIDER}`);
    }
  } catch (e) {
    console.warn(`  [DB] ⚠️ DB proxy ayarı okunamadı: ${e.message}`);
  }
}

if (PROXY_MODE === "residential") {
  console.log(`🌐 Proxy: RESIDENTIAL (${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT})`);
} else {
  console.log(`🌐 Proxy: DATACENTER (microsocks SOCKS5)`);
}

// ==================== IP ROTATION ====================
const IP_LIST = (process.env.IP_LIST || "").split(",").map(s => s.trim()).filter(Boolean);
let currentIpIndex = -1;
const ipBannedUntil = new Map();
const IP_BAN_DURATION_MS = Number(process.env.IP_BAN_DURATION_MS || 1800000);

// ==================== PROXY REGION ROTATION ====================
const PROXY_REGIONS_FALLBACK = ["ankara", "adana", "konya", "istanbul", "izmir", "bursa", "antalya"];
let currentRegionIndex = -1;
let DB_PROXY_REGION = ""; // Dashboard'dan seçilen sabit bölge
const PROXY_ISP_LIST = "vodafonenetdslm,turkcellinterne,vodafonenetadsl,superonlinebroa,turktelekom,turktelekomunik,vodafoneturkey,vodafonenetdslk";

function getNextProxyRegion() {
  if (DB_PROXY_REGION) {
    console.log(`  [PROXY] 🏙 Dashboard bölgesi kullanılıyor: ${DB_PROXY_REGION}`);
    return DB_PROXY_REGION;
  }
  currentRegionIndex = (currentRegionIndex + 1) % PROXY_REGIONS_FALLBACK.length;
  const region = PROXY_REGIONS_FALLBACK[currentRegionIndex];
  console.log(`  [PROXY] 🏙 Bölge rotasyonu: ${region} (${currentRegionIndex + 1}/${PROXY_REGIONS_FALLBACK.length})`);
  return region;
}

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

function getProxyLabel(ip) {
  if (PROXY_MODE === "residential" && EVOMI_PROXY_USER) {
    return `residential (${EVOMI_PROXY_REGION || EVOMI_PROXY_COUNTRY})`;
  }
  return ip || "doğrudan";
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
  { width: 1920, height: 1080 },
];

function getRandomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function normalizeTypedValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()\-]/g, "");
}

function isTypedValueMatch(expected, actual) {
  const expectedRaw = String(expected ?? "").trim();
  const actualRaw = String(actual ?? "").trim();

  if (!expectedRaw) return actualRaw.length === 0;
  if (actualRaw === expectedRaw) return true;

  const expectedNorm = normalizeTypedValue(expectedRaw);
  const actualNorm = normalizeTypedValue(actualRaw);

  if (actualNorm === expectedNorm) return true;

  // Telefon gibi alanlarda maske/prefix olabilir
  if (/^\d+$/.test(expectedNorm) && actualNorm.endsWith(expectedNorm)) return true;

  return false;
}

async function getInputValue(page, element) {
  return await page.evaluate((el) => {
    if (!el) return "";
    if ("value" in el) return el.value || "";
    return el.textContent || "";
  }, element);
}

// İnsan benzeri yazma (yavaş + doğrulamalı)
async function humanType(page, selector, text, options = {}) {
  const {
    minDelay = 170,
    maxDelay = 420,
    retries = 3,
    verify = true,
  } = options;

  const valueToType = String(text ?? "");
  const element = typeof selector === "string" ? await page.$(selector) : selector;
  if (!element) return false;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await element.click({ clickCount: 1 });
      await delay(200, 450);

      // Temizle (hem klavye hem DOM)
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await page.evaluate((el) => {
        if (el && "value" in el) {
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, element).catch(() => {});
      await delay(120, 260);

      for (const ch of valueToType) {
        const keyDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        await element.type(ch, { delay: keyDelay });
        if (Math.random() < 0.2) await delay(120, 320);
      }

      await delay(220, 500);

      if (!verify) return true;

      const currentValue = await getInputValue(page, element);
      if (isTypedValueMatch(valueToType, currentValue)) return true;

      console.log(`  [TYPE] ⚠ Alan doğrulama başarısız (deneme ${attempt}/${retries}): beklenen="${valueToType}" okunan="${currentValue}"`);
      await delay(250, 500);
    } catch (err) {
      console.log(`  [TYPE] ⚠ Yazma denemesi başarısız (${attempt}/${retries}): ${err.message}`);
      await delay(250, 500);
    }
  }

  return false;
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
    // "doğrulama kod" hariç tut: CAPTCHA alanının placeholder'ı ile karışmaması için
    // sadece "doğrulama kodu gönderildi" veya "tek kullanımlık" gibi OTP-spesifik ifadeleri ara
    const otpHint = body.includes("otp") || body.includes("tek kullanımlık") || body.includes("sms kod") || body.includes("email kod") || 
                    body.includes("doğrulama kodu gönderildi") || body.includes("mailinize") && body.includes("kod gönder") ||
                    body.includes("doğrulama kodunu giriniz");

    return {
      url,
      body,
      isCloudflare,
      otpRequired: otpFieldExists || otpHint,
    };
  });
}

async function waitCloudflareBypass(page, context = "sayfa", timeoutMs = 60000) {
  const start = Date.now();
  let lastLog = 0;

  while (Date.now() - start < timeoutMs) {
    const state = await readPageState(page);
    if (!state.isCloudflare) return { ok: true, state };
    
    // Her 10 saniyede bir log
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed - lastLog >= 10) {
      console.log(`  [CF] ⏳ ${context}: Cloudflare bekleniyor... (${elapsed}s)`);
      lastLog = elapsed;
    }
    
    // Turnstile checkbox'ı varsa tıklamayı dene
    try {
      const cfIframe = await page.$('iframe[src*="challenges.cloudflare.com"]');
      if (cfIframe) {
        const box = await cfIframe.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await delay(2000, 3000);
        }
      }
    } catch {}
    
    await delay(2000, 3000);
  }

  console.log(`  [CF] ❌ ${context}: Cloudflare doğrulaması aşılamadı (${timeoutMs/1000}s)`);
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

// CF blocked durumunu dashboard'a bildir
async function signalCfBlocked(ip) {
  try {
    await fetch(CONFIG.API_URL + "/idata", { method: "GET", headers: apiHeaders }); // config'i al
    // Doğrudan Supabase REST API ile güncelle
    const supabaseUrl = "https://ocrpzwrsyiprfuzsyivf.supabase.co";
    await fetch(`${supabaseUrl}/rest/v1/idata_config?id=not.is.null`, {
      method: "PATCH",
      headers: {
        ...apiHeaders,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        cf_blocked_since: new Date().toISOString(),
        cf_blocked_ip: ip || "unknown",
        cf_retry_requested: false,
      }),
    });
    console.log("  [CF] 🚨 Dashboard'a CF engeli bildirildi");
  } catch (err) {
    console.error("  [CF] Signal hatası:", err.message);
  }
}

// CF retry isteği var mı kontrol et
async function checkCfRetryRequested() {
  try {
    const supabaseUrl = "https://ocrpzwrsyiprfuzsyivf.supabase.co";
    const res = await fetch(`${supabaseUrl}/rest/v1/idata_config?select=cf_retry_requested&limit=1`, {
      method: "GET",
      headers: apiHeaders,
    });
    const data = await res.json();
    if (data?.[0]?.cf_retry_requested) {
      // Temizle
      await fetch(`${supabaseUrl}/rest/v1/idata_config?id=not.is.null`, {
        method: "PATCH",
        headers: { ...apiHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({ cf_retry_requested: false, cf_blocked_since: null, cf_blocked_ip: null }),
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// CF blocked durumunu temizle
async function clearCfBlocked() {
  try {
    const supabaseUrl = "https://ocrpzwrsyiprfuzsyivf.supabase.co";
    await fetch(`${supabaseUrl}/rest/v1/idata_config?id=not.is.null`, {
      method: "PATCH",
      headers: { ...apiHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({ cf_blocked_since: null, cf_blocked_ip: null, cf_retry_requested: false }),
    });
  } catch {}
}


function normalizeCaptchaCode(raw) {
  // iDATA CAPTCHA sadece rakam içerir — harfleri rakama çevir
  let code = String(raw || "").trim().toUpperCase();
  // Benzer harf→rakam dönüşümleri
  const letterToDigit = { O: "0", D: "0", Q: "0", I: "1", L: "1", Z: "2", E: "3", A: "4", S: "5", G: "6", B: "8", g: "9" };
  code = code.replace(/[^0-9A-Za-z]/g, "");
  code = code.split("").map(ch => letterToDigit[ch] || letterToDigit[ch.toUpperCase()] || ch).join("");
  // Son olarak sadece rakamları tut
  code = code.replace(/[^0-9]/g, "");
  return code;
}

function isLikelyCaptchaCode(raw) {
  const code = normalizeCaptchaCode(raw);
  if (!code) return false;
  if (code.length < 4 || code.length > 6) return false;
  if (/^(.)\1{3,}$/.test(code)) return false;
  return true;
}

async function isCaptchaImageLoaded(page) {
  // CAPTCHA img/canvas elementinin gerçekten yüklenip yüklenmediğini kontrol et
  return await page.evaluate(() => {
    const keywordRegex = /(captcha|dogrulama|verification|security|securimage|validate)/i;

    // Parent container textContent kullanma — çok geniş, false positive yaratır
    // Sadece element kendi attr + parent class/id bazlı eşleştir
    const getAttrMeta = (el) => [
      el.getAttribute("src") || "", el.getAttribute("alt") || "",
      el.className || "", el.id || "",
      (el.parentElement?.className || ""), (el.parentElement?.id || ""),
    ].join(" ").toLowerCase();

    const images = Array.from(document.querySelectorAll("img"));
    const captchaImg = images.find((img) => {
      const meta = getAttrMeta(img);
      if (keywordRegex.test(meta)) return true;
      // Base64 data URI genelde captcha görseli
      const src = (img.getAttribute("src") || "");
      if (src.startsWith("data:image/") && img.naturalWidth >= 60 && img.naturalWidth <= 500) return true;
      return false;
    });

    const canvases = Array.from(document.querySelectorAll("canvas"));
    const captchaCanvas = canvases.find((cv) => {
      const meta = getAttrMeta(cv);
      const w = cv.width || cv.clientWidth || 0;
      const h = cv.height || cv.clientHeight || 0;
      return keywordRegex.test(meta) || (w >= 60 && w <= 500 && h >= 20 && h <= 220);
    });

    if (captchaCanvas) {
      const w = captchaCanvas.width || captchaCanvas.clientWidth || 0;
      const h = captchaCanvas.height || captchaCanvas.clientHeight || 0;
      const loaded = w > 10 && h > 10;
      return { found: true, loaded, naturalWidth: w, naturalHeight: h, complete: true, src: "canvas", reason: loaded ? "canvas_ready" : "canvas_empty" };
    }

    if (!captchaImg) return { found: false, loaded: false, reason: "no_captcha_element" };

    const loaded = captchaImg.complete && captchaImg.naturalWidth > 10 && captchaImg.naturalHeight > 10;
    const src = (captchaImg.getAttribute("src") || "").substring(0, 120);
    return {
      found: true,
      loaded,
      naturalWidth: captchaImg.naturalWidth,
      naturalHeight: captchaImg.naturalHeight,
      complete: captchaImg.complete,
      src,
      reason: loaded ? "ok" : "broken_or_loading",
    };
  });
}

async function waitForCaptchaImageLoad(page, maxWaitMs = 8000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const status = await isCaptchaImageLoaded(page);
    if (status.loaded) return status;
    await delay(600, 1000);
  }
  return await isCaptchaImageLoaded(page);
}

async function getCaptchaImageBase64(page) {
  const fetch = (await import("node-fetch")).default;

  // 1) CAPTCHA kaynağını bul (img veya canvas)
  const target = await page.evaluate(() => {
    const keywordRegex = /(captcha|dogrulama|verification|security|securimage|validate)/i;
    const denyRegex = /(logo|icon|brand|header|footer|svg|navbar|menu)/i;

    // Element attr meta — parentText yerine parent class/id kullan
    const getAttrMeta = (el) => [
      el.getAttribute("src") || "", el.getAttribute("alt") || "",
      el.className || "", el.id || "",
      (el.parentElement?.className || ""), (el.parentElement?.id || ""),
    ].join(" ").toLowerCase();

    const inputs = Array.from(document.querySelectorAll("input"));
    const captchaInputRects = inputs
      .filter((input) => {
        const meta = [
          input.name, input.id, input.placeholder,
          input.getAttribute("aria-label"),
        ].filter(Boolean).join(" ").toLowerCase();
        return /(captcha|dogrulama|verification|security)/i.test(meta) && input.type !== "hidden";
      })
      .map((input) => input.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    const scoreByDistance = (rect) => {
      if (!captchaInputRects.length) return 0;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const minDistance = Math.min(
        ...captchaInputRects.map((r) => {
          const ix = r.left + r.width / 2;
          const iy = r.top + r.height / 2;
          return Math.hypot(cx - ix, cy - iy);
        })
      );
      if (minDistance < 220) return 35;
      if (minDistance < 420) return 20;
      return -10;
    };

    const imgCandidates = Array.from(document.querySelectorAll("img")).map((img, index) => {
      const src = (img.getAttribute("src") || "").toLowerCase();
      const meta = getAttrMeta(img);
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width || img.width || 0;
      const height = img.naturalHeight || rect.height || img.height || 0;

      let score = 0;
      if (keywordRegex.test(meta)) score += 60;
      if (denyRegex.test(meta)) score -= 80;
      if (width >= 60 && width <= 500 && height >= 20 && height <= 220) score += 20;
      else score -= 15;
      if (src.includes("captcha") || src.includes("verify") || src.includes("dogrulama") || src.includes("securimage")) score += 30;
      if (src.startsWith("data:image/") && width >= 60 && height >= 20) score += 40; // base64 data URI genelde captcha
      if (src.startsWith("data:image/svg")) score -= 50;
      score += scoreByDistance(rect);

      return {
        kind: "img",
        index,
        score,
        src: img.getAttribute("src") || "",
        width,
        height,
      };
    });

    const canvasCandidates = Array.from(document.querySelectorAll("canvas")).map((cv, index) => {
      const meta = getAttrMeta(cv);
      const rect = cv.getBoundingClientRect();
      const width = cv.width || rect.width || cv.clientWidth || 0;
      const height = cv.height || rect.height || cv.clientHeight || 0;

      let score = 0;
      if (keywordRegex.test(meta)) score += 45;
      if (denyRegex.test(meta)) score -= 80;
      if (width >= 60 && width <= 500 && height >= 20 && height <= 220) score += 25;
      else score -= 15;
      score += scoreByDistance(rect);

      return {
        kind: "canvas",
        index,
        score,
        src: "canvas",
        width,
        height,
      };
    });

    const best = [...imgCandidates, ...canvasCandidates].sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 20) return null;
    return best;
  });

  if (!target) {
    return { base64: null, reason: "captcha_element_not_found" };
  }

  console.log(`  [CAPTCHA] Kaynak bulundu: kind=${target.kind} score=${target.score} w=${target.width} h=${target.height}`);

  // 2) Canvas doğrudan çözüm
  if (target.kind === "canvas") {
    const canvasResult = await page.evaluate((idx) => {
      try {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        const cv = canvases[idx];
        if (!cv) return { ok: false, reason: "canvas_not_found" };
        const w = cv.width || cv.clientWidth || 0;
        const h = cv.height || cv.clientHeight || 0;
        if (w < 10 || h < 10) return { ok: false, reason: "canvas_empty" };
        const dataUrl = cv.toDataURL("image/png");
        const b64 = dataUrl.split(",")[1] || "";
        if (b64.length < 100) return { ok: false, reason: "canvas_base64_empty" };
        return { ok: true, base64: b64 };
      } catch (e) {
        return { ok: false, reason: "canvas_tainted_or_error" };
      }
    }, target.index);

    if (canvasResult?.ok) {
      console.log(`  [CAPTCHA] ✅ Canvas elementinden base64 alındı (${canvasResult.base64.length} karakter)`);
      return { base64: canvasResult.base64, meta: target };
    }
    return { base64: null, reason: canvasResult?.reason || "canvas_extract_failed" };
  }

  // 3) IMG için önce in-page canvas drawImage dene
  const inPageBase64 = await page.evaluate((idx) => {
    try {
      const imgs = Array.from(document.querySelectorAll("img"));
      const img = imgs[idx];
      if (!img || !img.complete || img.naturalWidth < 10 || img.naturalHeight < 10) return null;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    } catch {
      return null;
    }
  }, target.index);

  if (inPageBase64 && inPageBase64.length > 100) {
    console.log(`  [CAPTCHA] ✅ IMG+Canvas ile base64 alındı (${inPageBase64.length} karakter)`);
    return { base64: inPageBase64, meta: target };
  }

  // 4) In-page başarısızsa HTTP fetch fallback
  try {
    let fullUrl = target.src || "";
    if (!fullUrl) return { base64: null, reason: "img_src_empty" };

    if (fullUrl.startsWith("/")) {
      const origin = new URL(await page.url()).origin;
      fullUrl = origin + fullUrl;
    } else if (!fullUrl.startsWith("http")) {
      const pageUrl = await page.url();
      const base = pageUrl.substring(0, pageUrl.lastIndexOf("/") + 1);
      fullUrl = base + fullUrl;
    }

    const cookies = await page.cookies();
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    console.log(`  [CAPTCHA] HTTP fetch ile indiriliyor: ${fullUrl.slice(0, 100)}`);
    const resp = await fetch(fullUrl, {
      headers: {
        Cookie: cookieStr,
        Referer: await page.url(),
        "User-Agent": await page.evaluate(() => navigator.userAgent),
      },
    });

    if (!resp.ok) return { base64: null, reason: `http_fetch_${resp.status}` };

    const buffer = await resp.buffer();
    const b64 = buffer.toString("base64");
    if (b64.length < 100) return { base64: null, reason: "http_fetch_empty" };

    console.log(`  [CAPTCHA] ✅ HTTP fetch ile base64 alındı (${b64.length} karakter)`);
    return { base64: b64, meta: target };
  } catch (err) {
    return { base64: null, reason: `http_fetch_error:${err.message}` };
  }
}

async function refreshCaptchaImage(page) {
  try {
    return await page.evaluate(() => {
      const keyword = /(captcha|doğrulama|dogrulama|verification|security|code|yenile|refresh)/i;

      const refreshCandidates = Array.from(document.querySelectorAll("button, a, span, i, svg, img"));
      const refreshEl = refreshCandidates.find((el) => {
        const meta = [
          el.textContent,
          el.getAttribute("title"),
          el.getAttribute("aria-label"),
          el.id,
          el.className,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return keyword.test(meta) && (meta.includes("yenile") || meta.includes("refresh") || meta.includes("captcha") || meta.includes("doğrulama") || meta.includes("dogrulama"));
      });

      if (refreshEl) {
        refreshEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      }

      const images = Array.from(document.querySelectorAll("img"));
      const img = images.find((candidate) => {
        const src = (candidate.getAttribute("src") || "").toLowerCase();
        const alt = (candidate.getAttribute("alt") || "").toLowerCase();
        const meta = `${src} ${alt} ${(candidate.className || "").toLowerCase()}`;
        return /(captcha|doğrulama|dogrulama|verify|code)/i.test(meta);
      });

      if (!img) return false;

      const currentSrc = img.getAttribute("src") || "";
      if (currentSrc) {
        const separator = currentSrc.includes("?") ? "&" : "?";
        img.setAttribute("src", `${currentSrc}${separator}r=${Date.now()}`);
      }
      img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    });
  } catch {
    return false;
  }
}

async function solveImageCaptcha(page, options = {}) {
  const { maxAttempts = 4 } = options;
  const fetch = (await import("node-fetch")).default;
  let pageReloaded = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`  [CAPTCHA] 🔁 Yeni deneme ${attempt}/${maxAttempts}...`);
        const refreshed = await refreshCaptchaImage(page);
        if (refreshed) {
          console.log("  [CAPTCHA] Resim yenileme butonu tıklandı, bekleniyor...");
          await delay(2500, 4000);
        } else {
          await delay(1200, 2000);
        }
      } else {
        await delay(1500, 2500);
      }

      // CAPTCHA görsel durumunu kontrol et (diagnostic)
      console.log("  [CAPTCHA] Görsel durumu kontrol ediliyor...");
      const loadStatus = await waitForCaptchaImageLoad(page, 5000);
      console.log(`  [CAPTCHA] Görsel durumu: found=${loadStatus.found} loaded=${loadStatus.loaded} w=${loadStatus.naturalWidth || 0} h=${loadStatus.naturalHeight || 0} reason=${loadStatus.reason}`);

      // Yüklenmemiş görünse bile akışı kesme; refresh uygula ve doğrudan base64 yakalamayı dene
      if (!loadStatus.loaded) {
        console.log(`  [CAPTCHA] ⚠ Görsel hazır görünmüyor (${loadStatus.reason}) - API için ham yakalama denenecek`);
        await idataLog("login_captcha", `CAPTCHA görsel hazır değil: ${loadStatus.reason} (deneme ${attempt}/${maxAttempts})`);

        const refreshed = await refreshCaptchaImage(page);
        if (refreshed) {
          console.log("  [CAPTCHA] 🔄 Resim yenileme tetiklendi");
          await delay(1800, 3000);
        } else {
          await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll("img"));
            images.forEach((img) => {
              const src = img.getAttribute("src") || "";
              if (/(captcha|doğrulama|dogrulama|verify|code)/i.test(src + (img.alt || "") + (img.className || ""))) {
                const sep = src.includes("?") ? "&" : "?";
                img.setAttribute("src", `${src}${sep}_t=${Date.now()}`);
              }
            });
          });
          await delay(1400, 2400);
        }
      }

      // Görsel yakalama
      const capture = await getCaptchaImageBase64(page);
      const captchaImgBase64 = capture?.base64;
      const captchaMeta = capture?.meta || {};

      // Detaylı debug logu
      await idataLog(
        "login_captcha_debug",
        `Deneme ${attempt}/${maxAttempts} | kind=${captchaMeta.kind || "?"} | score=${captchaMeta.score ?? "?"} | w=${captchaMeta.width || 0} h=${captchaMeta.height || 0} | src=${(captchaMeta.src || "").slice(0, 60)} | reason=${capture?.reason || "ok"} | b64=${captchaImgBase64 ? captchaImgBase64.length + " chars" : "null"}`
      );

      if (!captchaImgBase64) {
        console.log(`  [CAPTCHA] ⚠ Captcha base64 alınamadı (deneme ${attempt}/${maxAttempts}): ${capture?.reason || "unknown"}`);
        await idataLog("login_captcha", `CAPTCHA base64 alınamadı: ${capture?.reason || "unknown"} | kind=${captchaMeta.kind || "?"}`);
        await delay(1200, 2000);
        continue;
      }

      console.log(`  [CAPTCHA] 📸 Captcha resmi bulundu (kind=${captchaMeta.kind} score=${captchaMeta.score ?? "?"}), çözüm başlıyor...`);

      // Capsolver / 2captcha — paralel consensus
      const useCapsolver = !!CAPSOLVER_API_KEY && (CAPTCHA_PROVIDER === "capsolver" || CAPTCHA_PROVIDER === "auto");
      const use2captcha = !!CONFIG.CAPTCHA_API_KEY && (CAPTCHA_PROVIDER === "2captcha" || CAPTCHA_PROVIDER === "auto");

      await idataLog(
        "login_captcha",
        `CAPTCHA deneme ${attempt}/${maxAttempts} | kind=${captchaMeta.kind || "?"} | provider=${CAPTCHA_PROVIDER} | capsolver=${useCapsolver ? "on" : "off"} | 2captcha=${use2captcha ? "on" : "off"}`
      );

      if (!useCapsolver && !use2captcha) {
        console.log("  [CAPTCHA] ❌ Aktif çözücü yok (API key/provider kontrol edin)");
        await idataLog("error", "CAPTCHA çözücü aktif değil: capsolver/2captcha ayarlarını kontrol edin");
        continue;
      }

      // ===== PARALEL CONSENSUS =====
      const solverPromises = [];

      if (useCapsolver) {
        solverPromises.push((async () => {
          try {
            console.log("  [CAPTCHA] 🟢 Capsolver gönderiliyor...");
            const createRes = await fetch("https://api.capsolver.com/createTask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientKey: CAPSOLVER_API_KEY,
                task: { type: "ImageToTextTask", body: captchaImgBase64, numeric: 1, minLength: 4, maxLength: 6 },
              }),
            });
            const createData = JSON.parse(await createRes.text());
            if (!createRes.ok || createData.errorId !== 0 || !createData.taskId) {
              console.log(`  [CAPTCHA] ❌ Capsolver createTask hata: ${createData.errorDescription || createData.errorCode}`);
              return { provider: "capsolver", code: null };
            }
            for (let i = 0; i < 12; i++) {
              await delay(1500, 2500);
              const rr = await fetch("https://api.capsolver.com/getTaskResult", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, taskId: createData.taskId }),
              });
              const rd = JSON.parse(await rr.text());
              if (rd.status === "ready") {
                const code = normalizeCaptchaCode(rd.solution?.text);
                console.log(`  [CAPTCHA] 🟢 Capsolver sonuç: ${rd.solution?.text} → ${code}`);
                return { provider: "capsolver", code, raw: rd.solution?.text };
              }
              if (rd.status === "failed" || rd.errorId !== 0) break;
            }
            return { provider: "capsolver", code: null };
          } catch (err) {
            console.log(`  [CAPTCHA] Capsolver hata: ${err.message}`);
            return { provider: "capsolver", code: null };
          }
        })());
      }

      if (use2captcha) {
        solverPromises.push((async () => {
          try {
            console.log("  [CAPTCHA] 🔵 2captcha gönderiliyor...");
            const createRes = await fetch("https://api.2captcha.com/createTask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientKey: CONFIG.CAPTCHA_API_KEY,
                task: { type: "ImageToTextTask", body: captchaImgBase64, numeric: 1, minLength: 4, maxLength: 6 },
              }),
            });
            const createData = await createRes.json();
            if (createData.errorId !== 0) {
              console.log(`  [CAPTCHA] ❌ 2captcha hata: ${createData.errorDescription || createData.errorCode}`);
              return { provider: "2captcha", code: null };
            }
            for (let i = 0; i < 20; i++) {
              await delay(2500, 4000);
              const rr = await fetch("https://api.2captcha.com/getTaskResult", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientKey: CONFIG.CAPTCHA_API_KEY, taskId: createData.taskId }),
              });
              const rd = await rr.json();
              if (rd.status === "ready") {
                const code = normalizeCaptchaCode(rd.solution?.text);
                console.log(`  [CAPTCHA] 🔵 2captcha sonuç: ${rd.solution?.text} → ${code}`);
                return { provider: "2captcha", code, raw: rd.solution?.text };
              }
              if (rd.errorId !== 0) break;
            }
            return { provider: "2captcha", code: null };
          } catch (err) {
            console.log(`  [CAPTCHA] 2captcha hata: ${err.message}`);
            return { provider: "2captcha", code: null };
          }
        })());
      }

      const results = await Promise.all(solverPromises);
      const validResults = results.filter(r => r.code && isLikelyCaptchaCode(r.code));

      console.log(`  [CAPTCHA] 📊 Consensus: ${results.map(r => `${r.provider}=${r.code || "fail"}`).join(" | ")}`);

      if (validResults.length === 0) {
        console.log("  [CAPTCHA] ⚠ Hiçbir solver geçerli sonuç vermedi");
        await idataLog("login_captcha", `Consensus başarısız: ${results.map(r => `${r.provider}=${r.raw || "fail"}`).join(" | ")}`);
        continue;
      }

      // İki solver aynı sonucu verdiyse → yüksek güvenilirlik
      if (validResults.length >= 2 && validResults[0].code === validResults[1].code) {
        const code = validResults[0].code;
        console.log(`  [CAPTCHA] ✅✅ Consensus eşleşti: ${code} (${validResults.map(r => r.provider).join("+")})`);
        await idataLog("login_captcha", `Consensus başarılı (eşleşme): ${code}`);
        return code;
      }

      // Tek sonuç veya farklı sonuçlar → ilk geçerli olanı kullan
      const bestResult = validResults[0];
      const consensusNote = validResults.length >= 2
        ? `UYUMSUZ: ${validResults.map(r => `${r.provider}=${r.code}`).join(" vs ")} → ${bestResult.provider} seçildi`
        : `TEK: ${bestResult.provider}=${bestResult.code}`;
      console.log(`  [CAPTCHA] ✅ ${consensusNote}`);
      await idataLog("login_captcha", `Consensus: ${consensusNote}`);
      return bestResult.code;
    } catch (err) {
      console.error(`  [CAPTCHA] Hata (deneme ${attempt}/${maxAttempts}):`, err.message);
    }
  }

  console.log("  [CAPTCHA] ❌ Tüm denemeler başarısız");
  return null;
}

// ==================== BROWSER LAUNCH ====================
function getResidentialProxyUrl() {
  let pass = `${EVOMI_PROXY_PASS}_country-${EVOMI_PROXY_COUNTRY}`;
  if (EVOMI_PROXY_REGION) pass += `_region-${EVOMI_PROXY_REGION}`;
  console.log(`  [PROXY] 🏠 Residential: ${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT} (ülke: ${EVOMI_PROXY_COUNTRY}, bölge: ${EVOMI_PROXY_REGION || 'yok'})`);
  return { user: EVOMI_PROXY_USER, pass, host: EVOMI_PROXY_HOST, port: EVOMI_PROXY_PORT };
}

async function launchBrowser(ip = null) {
  const { connect } = require("puppeteer-real-browser");

  // VFS botuyla aynı minimal args — CF parmak izi tespitini azaltır
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1920,1080",
    "--start-maximized",
  ];

  let proxyConfig = undefined;

  if (!PROXY_ENABLED) {
    console.log(`  [BROWSER] 🔵 Proxy KAPALI — sunucu kendi IP'si ile çıkıyor`);
  } else if (PROXY_MODE === "residential" && EVOMI_PROXY_USER) {
    const rp = getResidentialProxyUrl();
    proxyConfig = {
      host: rp.host,
      port: rp.port,
      username: rp.user,
      password: rp.pass,
    };
    console.log(`  [BROWSER] 🏠 Residential proxy config: ${rp.host}:${rp.port}`);
  } else if (ip) {
    const port = 10800 + IP_LIST.indexOf(ip);
    args.push(`--proxy-server=socks5://127.0.0.1:${port}`);
    console.log(`  [BROWSER] Proxy: socks5://127.0.0.1:${port} (${ip})`);
  }


  const connectOptions = {
    headless: false,
    args,
    turnstile: true,
    disableXvfb: true,
  };
  if (proxyConfig) {
    connectOptions.proxy = proxyConfig;
  }

  const { browser, page } = await connect(connectOptions);
  await page.setViewport({ width: 1920, height: 1080 });
  
  const proxyInfo = PROXY_ENABLED 
    ? (PROXY_MODE === "residential" ? "(residential proxy)" : (ip ? `(IP: ${ip})` : "(proxy yok)"))
    : "(proxy kapalı)";
  console.log(`  [BROWSER] ✅ Tarayıcı başlatıldı ${proxyInfo}`);

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

// ==================== IMAP OTP READ (doğrudan Node.js) ====================
async function tryImapOtp(accountId) {
  try {
    const { ImapFlow } = require("imapflow");
    const fetch = (await import("node-fetch")).default;
    
    // Hesap bilgilerini al
    const res = await fetch(
      `https://ocrpzwrsyiprfuzsyivf.supabase.co/rest/v1/idata_accounts?id=eq.${accountId}&select=email,imap_host,imap_password`,
      {
        headers: {
          apikey: CONFIG.API_KEY,
          Authorization: `Bearer ${CONFIG.API_KEY}`,
        },
      }
    );
    const accounts = await res.json();
    if (!accounts?.length || !accounts[0].imap_password) return null;
    
    const account = accounts[0];
    const host = account.imap_host || "imap.gmail.com";
    console.log(`  [IMAP] ${account.email} → ${host} bağlanıyor...`);
    
    const client = new ImapFlow({
      host,
      port: 993,
      secure: true,
      auth: { user: account.email, pass: account.imap_password },
      logger: false,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    
    await client.connect();
    
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Son 1 gündeki okunmamış mailleri ara
      const since = new Date();
      since.setDate(since.getDate() - 1);
      
      const messages = await client.search({ seen: false, since }, { uid: true });
      if (!messages.length) {
        console.log(`  [IMAP] Okunmamış mail yok`);
        await lock.release();
        await client.logout();
        return null;
      }
      
      // Son 5 maili kontrol et
      const lastUids = messages.slice(-5).reverse();
      
      for (const uid of lastUids) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        const rawText = msg.source.toString();
        const lower = rawText.toLowerCase();
        
        // VFS/iDATA OTP maili mi?
        const isOtp = lower.includes("vfs") || lower.includes("idata") || 
                      lower.includes("doğrulama") || lower.includes("verification") ||
                      lower.includes("otp") || lower.includes("code");
        
        if (isOtp) {
          // OTP kodunu çıkar (4-8 haneli)
          const patterns = [
            /(?:code|kod|otp|doğrulama|verification)[:\s]*(\d{4,8})/i,
            /(\d{4,8})\s*(?:is your|doğrulama|verification|code|kod)/i,
            /\b(\d{6})\b/,
            /\b(\d{4})\b/,
          ];
          
          for (const pattern of patterns) {
            const match = rawText.match(pattern);
            if (match) {
              console.log(`  [IMAP] ✅ OTP bulundu: ${match[1]}`);
              await lock.release();
              await client.logout();
              return match[1];
            }
          }
        }
      }
      
      await lock.release();
    } catch (e) {
      lock.release();
      throw e;
    }
    
    await client.logout();
    return null;
  } catch (err) {
    console.log(`  [IMAP] Hata: ${err.message}`);
    return null;
  }
}

// ==================== LOGIN OTP WAIT ====================
async function waitForLoginOtp(accountId, timeoutMs = 180000, hasImap = false) {
  const start = Date.now();
  let imapAttempts = 0;
  let imapPromise = null; // background IMAP fetch
  
  while (Date.now() - start < timeoutMs) {
    // 1) IMAP: arka planda çalıştır, sonucu beklemeden manual'ı da kontrol et
    if (hasImap && imapAttempts < 20 && !imapPromise) {
      imapAttempts++;
      console.log(`  [OTP] IMAP ile otomatik okuma deneniyor (${imapAttempts})...`);
      imapPromise = tryImapOtp(accountId).then(otp => {
        imapPromise = null;
        return otp;
      }).catch(() => { imapPromise = null; return null; });
    }
    
    // Check if IMAP resolved
    if (imapPromise) {
      const raceResult = await Promise.race([imapPromise, new Promise(r => setTimeout(() => r("__timeout__"), 500))]);
      if (raceResult && raceResult !== "__timeout__") {
        console.log(`  [OTP] ✅ IMAP'ten OTP alındı: ${raceResult}`);
        await idataLog("login_otp", `📧 IMAP'ten OTP alındı otomatik: ${raceResult}`);
        return raceResult;
      }
    }

    // 2) Manuel OTP kontrolü (dashboard'dan) — her zaman kontrol et
    try {
      const data = await apiPost({ action: "idata_get_login_otp", account_id: accountId }, "get_login_otp");
      if (data?.manual_otp) {
        console.log(`  [OTP] ✅ Manuel OTP alındı: ${data.manual_otp}`);
        return data.manual_otp;
      }
    } catch (err) {
      console.log(`  [OTP] Poll hatası: ${err.message}`);
    }
    await delay(3000, 4000);
  }
  return null;
}

// ==================== AUTH SUBMIT HELPER ====================
async function clickAuthSubmitButton(page, phase = "login") {
  const phaseText = String(phase || "").toLowerCase();

  const result = await page.evaluate((phaseText) => {
    const normalize = (value) => String(value || "").trim().toLowerCase().normalize("NFC");

    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return rect.width > 8 && rect.height > 8 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
    };

    const isOtpPhase = /otp|doğrula|dogrula|verify|mailconfirm/.test(phaseText);
    const isLoginPhase = /login|giris|ilk_giris|son_retry|captcha_retry/.test(phaseText);

    const getMeta = (el) => normalize([
      el.textContent || "",
      el.getAttribute("value") || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("name") || "",
      el.id || "",
      el.className || "",
      el.getAttribute("type") || "",
    ].join(" "));

    const otpInput = Array.from(document.querySelectorAll("input")).find((inp) => {
      const meta = getMeta(inp);
      return /otp|mail.?confirm|verification|e-?posta.*kod|do[gğ]rulama.*kodu/.test(meta);
    });

    const candidates = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], input[type='image'], a, [role='button'], div[onclick], span[onclick]"))
      .filter(isVisible)
      .map((el) => {
        const meta = getMeta(el);
        let score = 0;

        if (/(kayıt ol|kayit ol|register|üye ol|uye ol|forgot|şifremi unuttum|sifremi unuttum|parolamı unuttum)/.test(meta)) score -= 140;

        if (/(giriş|giris|login|sign in|oturum aç|oturum ac)/.test(meta)) score += isLoginPhase ? 140 : 45;
        if (/(doğrula|dogrula|onayla|verify|do[gğ]rulama|submit|devam)/.test(meta)) score += isOtpPhase ? 130 : 70;

        if ((el.getAttribute("type") || "").toLowerCase() === "submit") score += 24;
        if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") score -= 50;

        const form = el.closest?.("form");
        if (form) score += 10;

        if (otpInput && form && otpInput.closest?.("form") === form) {
          score += isOtpPhase ? 85 : 25;
        }

        if (form) {
          const hasPassword = !!form.querySelector('input[type="password"]');
          const hasCaptcha = !!form.querySelector('input[name*="captcha" i], input[id*="captcha" i], input[name*="mailconfirm" i], input[id*="mailconfirm" i], input[placeholder*="doğrulama" i], input[placeholder*="captcha" i]');
          if (hasPassword) score += isLoginPhase ? 45 : 10;
          if (hasCaptcha) score += 20;
        }

        const rect = el.getBoundingClientRect();
        if (rect.top > window.innerHeight * 0.2 && rect.top < window.innerHeight * 0.95) score += 8;

        return { el, text: meta.slice(0, 60), score };
      })
      .sort((a, b) => b.score - a.score);

    const target = candidates[0]?.el || null;

    if (target) {
      target.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
      target.removeAttribute?.("disabled");
      target.removeAttribute?.("aria-disabled");
      target.classList?.remove?.("disabled");
      target.focus?.();

      const fireMouse = (type) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      const firePointer = (type) => {
        try {
          target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse" }));
        } catch {
          // PointerEvent her ortamda olmayabilir
        }
      };

      firePointer("pointerdown");
      fireMouse("mousedown");
      firePointer("pointerup");
      fireMouse("mouseup");
      fireMouse("click");
      try { target.click?.(); } catch {}

      return {
        found: true,
        tag: target.tagName,
        text: candidates[0]?.text || "",
        score: candidates[0]?.score ?? null,
      };
    }

    const forms = Array.from(document.querySelectorAll("form"));
    const bestForm = forms.find((form) => otpInput ? otpInput.closest("form") === form : form.querySelector('input[type="password"]')) || forms[0];
    if (bestForm) {
      if (typeof bestForm.requestSubmit === "function") bestForm.requestSubmit();
      else bestForm.submit?.();
      return { found: true, tag: "FORM", text: "form.submit", score: null };
    }

    return { found: false };
  }, phaseText);

  console.log(`  [LOGIN] Submit (${phase}):`, result);
  await idataLog("login_form", `Submit (${phase}): ${result?.found ? `${result.tag} \"${result.text}\"` : "BULUNAMADI"}`);
  return result;
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
    const captchaCode = await solveImageCaptcha(page, { maxAttempts: 3 });
    if (!captchaCode) {
      console.log("  [CAPTCHA] ❌ CAPTCHA çözülemedi! Sayfa 10 sn açık tutuluyor...");
      const failShot = await takeScreenshotBase64(page);
      await delay(9000, 12000);
      return { success: false, reason: "captcha_failed", screenshot: failShot };
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

    const cfAtLoginOpen = await waitCloudflareBypass(page, "login açılışı", 60000);
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

    // Form inputlarını görünür/editable filtreyle eşleştir (gizli input karışmasın)
    const allInputs = await page.$$("input");
    const textCandidates = [];
    const passwordCandidates = [];

    for (const input of allInputs) {
      const meta = await page.evaluate((el) => {
        const type = (el.type || "text").toLowerCase();
        const rect = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        const visible = rect.width > 8 && rect.height > 8 && st.display !== "none" && st.visibility !== "hidden";
        const editable = !el.disabled && !el.readOnly;
        const textLike = !["hidden", "submit", "button", "checkbox", "radio", "file"].includes(type);
        const norm = (value) => String(value || "").toLowerCase().normalize("NFC");
        const metaText = norm([
          el.name,
          el.id,
          el.placeholder,
          el.getAttribute("aria-label"),
          el.getAttribute("autocomplete"),
        ].filter(Boolean).join(" "));

        return {
          type,
          visible,
          editable,
          textLike,
          metaText,
          isCaptcha: /captcha|mailconfirm|do[gğ]rulama|verification/.test(metaText),
          isMembership: /üyelik|uyelik|membership|member/.test(metaText),
          isEmail: /e-?posta|email|mail/.test(metaText),
        };
      }, input);

      if (!meta.visible || !meta.editable) continue;
      if (meta.type === "password") {
        passwordCandidates.push({ el: input, meta });
        continue;
      }
      if (!meta.textLike) continue;
      textCandidates.push({ el: input, meta });
    }

    const nonCaptchaTextInputs = textCandidates.filter((item) => !item.meta.isCaptcha);
    let preDetectedCaptchaInput = textCandidates.find((item) => item.meta.isCaptcha)?.el || null;

    const membershipInput = nonCaptchaTextInputs.find((item) => item.meta.isMembership)?.el || null;
    const emailInput = nonCaptchaTextInputs.find((item) => item.meta.isEmail && item.el !== membershipInput)?.el || null;
    const primaryAuthInput = membershipInput || emailInput || nonCaptchaTextInputs[0]?.el || null;
    const secondaryAuthInput = nonCaptchaTextInputs.find((item) => item.el !== primaryAuthInput)?.el || null;

    console.log(`  [LOGIN] Görünür input: text=${textCandidates.length}, auth=${nonCaptchaTextInputs.length}, password=${passwordCandidates.length}`);
    await idataLog("login_form", `Input eşleştirme: auth=${nonCaptchaTextInputs.length}, pass=${passwordCandidates.length}, captcha=${preDetectedCaptchaInput ? "var" : "yok"}`);

    // 1) Üyelik/kimlik alanı
    if (account.membership_number && primaryAuthInput) {
      console.log(`  [LOGIN] Üyelik no giriliyor: ${account.membership_number}`);
      const typed = await humanType(page, primaryAuthInput, account.membership_number, { minDelay: 140, maxDelay: 300, retries: 3 });
      if (!typed) console.log("  [LOGIN] ⚠ Üyelik no tam yazılamadı");
      await delay(700, 1200);
    }

    // 2) E-posta alanı (ayrı input varsa oraya, yoksa gerektiğinde secondary'e)
    if (emailInput) {
      console.log(`  [LOGIN] E-Posta giriliyor: ${account.email}`);
      const typed = await humanType(page, emailInput, account.email, { minDelay: 130, maxDelay: 280, retries: 3 });
      if (!typed) console.log("  [LOGIN] ⚠ E-posta tam yazılamadı");
      await delay(700, 1200);
    } else if (!account.membership_number && primaryAuthInput) {
      console.log(`  [LOGIN] E-Posta (fallback) giriliyor: ${account.email}`);
      const typed = await humanType(page, primaryAuthInput, account.email, { minDelay: 130, maxDelay: 280, retries: 3 });
      if (!typed) console.log("  [LOGIN] ⚠ E-posta fallback tam yazılamadı");
      await delay(700, 1200);
    } else if (account.membership_number && secondaryAuthInput) {
      console.log(`  [LOGIN] E-Posta (secondary) giriliyor: ${account.email}`);
      const typed = await humanType(page, secondaryAuthInput, account.email, { minDelay: 130, maxDelay: 280, retries: 3 });
      if (!typed) console.log("  [LOGIN] ⚠ E-posta secondary tam yazılamadı");
      await delay(700, 1200);
    }

    // 3) Şifre
    if (passwordCandidates[0]?.el) {
      console.log(`  [LOGIN] Şifre giriliyor`);
      const typed = await humanType(page, passwordCandidates[0].el, account.password, { minDelay: 120, maxDelay: 260, retries: 3 });
      if (!typed) console.log("  [LOGIN] ⚠ Şifre tam yazılamadı");
      await delay(1000, 1800);
    }

    // 4) CAPTCHA çöz ve son text input'a gir
    const captchaCode = await solveImageCaptcha(page, { maxAttempts: 3 });
    if (!captchaCode) {
      console.log("  [LOGIN] ❌ CAPTCHA çözülemedi, giriş denenmeyecek (10 sn bekleme)");
      const failShot = await takeScreenshotBase64(page);
      await delay(9000, 12000);
      return { success: false, reason: "captcha_failed", screenshot: failShot };
    }

    // CAPTCHA input — önce pre-detect edilen alanı dene, olmazsa DOM'da yeniden ara
    let captchaInput = preDetectedCaptchaInput;
    let captchaTyped = false;

    if (captchaInput) {
      const inputInfo = await page.evaluate(el => ({
        placeholder: el?.placeholder || '',
        name: el?.name || '',
        id: el?.id || '',
      }), captchaInput).catch(() => null);

      if (inputInfo) {
        console.log(`  [LOGIN] CAPTCHA kodu giriliyor (pre-detect): ${captchaCode} → input(placeholder="${inputInfo.placeholder}" name="${inputInfo.name}" id="${inputInfo.id}")`);
        await idataLog("login_captcha", `CAPTCHA input hedef (pre): placeholder="${inputInfo.placeholder}" name="${inputInfo.name}" id="${inputInfo.id}"`);
        captchaTyped = await humanType(page, captchaInput, captchaCode, { minDelay: 140, maxDelay: 300, retries: 2 });
      }
    }

    if (!captchaTyped) captchaInput = await page.evaluateHandle(() => {
      // Tüm görünür text-like input'ları topla (type attribute olmayan input'lar dahil)
      const allInputs = Array.from(document.querySelectorAll('input')).filter(inp => {
        const t = (inp.type || 'text').toLowerCase();
        if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(t)) return false;
        if (inp.readOnly || inp.disabled) return false;
        const rect = inp.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      // 1) Placeholder ile bul — normalize ederek karşılaştır
      const placeholderMatch = allInputs.find(inp => {
        const ph = (inp.placeholder || '').toLowerCase().normalize('NFC');
        return /do[gğ]rulama|verification|captcha/i.test(ph);
      });
      if (placeholderMatch) return placeholderMatch;

      // 2) Name/id ile bul
      const attrMatch = allInputs.find(inp => {
        const meta = ((inp.name || '') + ' ' + (inp.id || '')).toLowerCase();
        return /captcha|dogrulama|verification/.test(meta);
      });
      if (attrMatch) return attrMatch;

      // 3) CAPTCHA görseli (img/canvas) bul, Y ekseninde hemen altındaki boş input'u seç
      const captchaEl = Array.from(document.querySelectorAll('img, canvas')).find(el => {
        const rect = el.getBoundingClientRect();
        // Mantıklı boyut — çok küçük ikonları atla
        if (rect.width < 60 || rect.height < 25) return false;
        const meta = [
          el.getAttribute('src') || '', el.getAttribute('alt') || '',
          el.className || '', el.id || ''
        ].join(' ').toLowerCase();
        // Captcha benzeri kaynak veya form ortasında duran resim/canvas
        if (/captcha|dogrulama|verification|security|validat/i.test(meta)) return true;
        // Formdaki tek bağımsız resim/canvas (login form avatar/icon değil)
        if (el.tagName === 'CANVAS') return true;
        if (el.tagName === 'IMG' && /base64|captcha|securimage|validate/i.test(el.src || '')) return true;
        return false;
      });

      if (captchaEl) {
        const captchaRect = captchaEl.getBoundingClientRect();
        // CAPTCHA'nın altındaki en yakın boş input
        const below = allInputs
          .filter(inp => {
            const r = inp.getBoundingClientRect();
            return r.top >= captchaRect.bottom - 10; // biraz tolerans
          })
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const emptyBelow = below.find(inp => !inp.value.trim());
        if (emptyBelow) return emptyBelow;
        if (below.length) return below[0];
      }

      // 4) Son fallback: sayfadaki son boş input
      const emptyInput = [...allInputs].reverse().find(inp => !inp.value.trim());
      return emptyInput || null;
    });

    if (!captchaTyped && captchaInput && captchaInput.asElement()) {
      captchaInput = captchaInput.asElement();
      const inputInfo = await page.evaluate(el => ({
        placeholder: el.placeholder || '',
        name: el.name || '',
        id: el.id || '',
        value: el.value || ''
      }), captchaInput);
      console.log(`  [LOGIN] CAPTCHA kodu giriliyor: ${captchaCode} → input(placeholder="${inputInfo.placeholder}" name="${inputInfo.name}" id="${inputInfo.id}")`);
      await idataLog("login_captcha", `CAPTCHA input hedef: placeholder="${inputInfo.placeholder}" name="${inputInfo.name}" id="${inputInfo.id}"`);
      captchaTyped = await humanType(page, captchaInput, captchaCode, { minDelay: 140, maxDelay: 300, retries: 2 });
    }

    if (!captchaTyped) {
      console.log(`  [LOGIN] ⚠ CAPTCHA input fallback (evaluate) kullanılıyor`);
      await page.evaluate((code) => {
        // Placeholder "Doğrulama" ile bul
        const byPlaceholder = document.querySelector('input[placeholder*="oğrulama" i], input[placeholder*="Dogrulama" i], input[placeholder*="captcha" i]');
        const byAttr = document.querySelector('input[name*="captcha" i], input[id*="captcha" i]');
        const allInputs = Array.from(document.querySelectorAll('input[type="text"]:not([readonly])'));
        const emptyInput = allInputs.reverse().find(inp => !inp.value.trim());
        const target = byPlaceholder || byAttr || emptyInput || allInputs[0];
        if (target) {
          target.focus();
          target.value = '';
          for (const ch of code) {
            target.value += ch;
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, captchaCode);
    }
    await delay(900, 1400);

    // Giriş butonuna tıkla
    const loginClicked = await clickAuthSubmitButton(page, "ilk_giris");
    if (!loginClicked?.found) {
      const ss = await takeScreenshotBase64(page);
      await idataLog("login_fail", `Giriş butonu bulunamadı!`, ss);
      return { success: false, reason: "submit_not_found", screenshot: ss };
    }

    await delay(3000, 5000);

    // CAPTCHA hatalı uyarısı kontrolü — yanlış kod girildiğinde sayfa uyarı veriyor
    const captchaError = await page.evaluate(() => {
      const body = (document.body?.innerText || "").toLowerCase();
      const alerts = document.querySelectorAll('.alert, .swal2-popup, .swal2-container, [role="alert"], .notification, .toast, .error-message');
      const alertText = Array.from(alerts).map(a => (a.textContent || "").toLowerCase()).join(" ");
      const allText = body + " " + alertText;
      return /do[gğ]rulama.*hatal[ıi]|captcha.*wrong|captcha.*hatal|kod.*hatal|yanlış.*kod|geçersiz.*kod|invalid.*captcha|incorrect.*code|hatalı.*giriş/i.test(allText);
    });

    if (captchaError) {
      console.log("  [LOGIN] ⚠ CAPTCHA kodu hatalı! Uyarı kapatılıp tekrar denenecek...");
      await idataLog("login_captcha", `CAPTCHA kodu hatalı — tekrar çözülecek`);

      // Uyarı popup'ını kapat (Tamam/OK butonu)
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a, .swal2-confirm, [role='button']"));
        const okBtn = btns.find(b => {
          const txt = (b.textContent || "").trim().toLowerCase();
          return txt === "tamam" || txt === "ok" || txt === "kapat" || txt === "anladım";
        });
        if (okBtn) okBtn.click();
      });
      await delay(1500, 2500);

      // CAPTCHA input'unu temizle
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input')).filter(inp => {
          const t = (inp.type || 'text').toLowerCase();
          return !['hidden','submit','button','checkbox','radio','file','password'].includes(t) && !inp.readOnly && !inp.disabled;
        });
        // Placeholder veya pozisyon bazlı CAPTCHA input'unu bul
        const captchaInp = inputs.find(inp => /do[gğ]rulama|captcha|verification|kod/i.test(inp.placeholder || ''));
        const target = captchaInp || inputs[inputs.length - 1];
        if (target) {
          target.focus();
          target.value = '';
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await delay(500, 1000);

      // CAPTCHA'yı tekrar çöz
      const retryCaptchaCode = await solveImageCaptcha(page, { maxAttempts: 3 });
      if (retryCaptchaCode) {
        // Tekrar gir
        const retryTyped = await page.evaluate((code) => {
          const inputs = Array.from(document.querySelectorAll('input')).filter(inp => {
            const t = (inp.type || 'text').toLowerCase();
            return !['hidden','submit','button','checkbox','radio','file','password'].includes(t) && !inp.readOnly && !inp.disabled;
          });
          const captchaInp = inputs.find(inp => /do[gğ]rulama|captcha|verification|kod/i.test(inp.placeholder || ''));
          const target = captchaInp || inputs[inputs.length - 1];
          if (target) {
            target.focus();
            target.value = '';
            for (const ch of code) {
              target.value += ch;
              target.dispatchEvent(new Event("input", { bubbles: true }));
            }
            target.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          return false;
        }, retryCaptchaCode);

        if (retryTyped) {
          await delay(800, 1200);
          // Tekrar Giriş'e tıkla
          const retrySubmit = await clickAuthSubmitButton(page, "captcha_retry_giris");
          await idataLog("login_captcha", `CAPTCHA tekrar çözüldü: ${retryCaptchaCode} — submit=${retrySubmit?.found ? "ok" : "fail"}`);
          await delay(3000, 5000);
        }
      } else {
        await idataLog("login_fail", `CAPTCHA tekrar çözülemedi`);
        const ss = await takeScreenshotBase64(page);
        return { success: false, reason: "captcha_retry_failed", screenshot: ss };
      }
    }

    // Giriş sonrası sayfa durumunu logla
    const postLoginShot = await takeScreenshotBase64(page);
    const postLoginState = await page.evaluate(() => {
      const body = (document.body?.innerText || "").toLowerCase();
      const url = (window.location.href || "").toLowerCase();
      return { body: body.slice(0, 500), url };
    });
    console.log(`  [LOGIN] Giriş sonrası URL: ${postLoginState.url}`);
    await idataLog("login_post_click", `Giriş butonuna tıklandı | URL: ${postLoginState.url}`, postLoginShot);

    // OTP kontrolü — metin, modal VEYA "E-Posta Doğrulama Kodu" input varlığı
    const otpDetection = await page.evaluate(() => {
      const body = (document.body?.innerText || "").toLowerCase();
      
      // 1) Metin bazlı tespit
      const textMatch = body.includes("doğrulama kodu gönderildi") || 
             body.includes("doğrulama kodunu giriniz") ||
             body.includes("doğrulama kodu") && (body.includes("mail") || body.includes("e-posta") || body.includes("gönder")) ||
             body.includes("mailinize") && body.includes("kod") ||
             body.includes("e-posta") && body.includes("doğrulama") ||
             body.includes("tek kullanımlık") ||
             body.includes("otp") ||
             body.includes("sms kod");
      
      // 2) "E-Posta Doğrulama Kodu" placeholder'lı input var mı?
      const otpInput = Array.from(document.querySelectorAll('input')).find(inp => {
        const ph = (inp.placeholder || '').toLowerCase().normalize("NFC");
        return /e-?posta.*do[gğ]rulama|mail.*do[gğ]rulama|mail.*verification|e-?mail.*code|e-?posta.*kod/i.test(ph);
      });
      
      // 3) Modal/popup
      const hasModal = document.querySelector('.modal.show, .swal2-container, [role="dialog"], .swal2-popup, .swal2-modal');
      
      return {
        byText: textMatch,
        byInput: !!otpInput,
        byModal: !!hasModal,
        inputPlaceholder: otpInput?.placeholder || null
      };
    });

    const otpNeeded = otpDetection.byText || otpDetection.byInput;
    const otpByNewInput = !otpNeeded && otpDetection.byModal;

    if (otpNeeded || otpByNewInput) {
      const detectMethod = otpDetection.byInput ? `input(${otpDetection.inputPlaceholder})` : otpDetection.byText ? 'text' : 'modal';
      console.log(`  [LOGIN] 📧 Mail doğrulama kodu gerekiyor! (tespit: ${detectMethod})`);
      
      // "Tamam" / "OK" butonuna tıkla (popup'ı kapat — eğer varsa)
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a, .swal2-confirm"));
        const okBtn = btns.find(b => {
          const txt = (b.textContent || "").trim().toLowerCase();
          return txt === "tamam" || txt === "ok" || txt === "onay" || txt === "devam";
        });
        if (okBtn) okBtn.click();
      });
      await delay(1500, 3000);

      // Popup kapandıktan sonra screenshot
      const afterPopupShot = await takeScreenshotBase64(page);
      await idataLog("login_otp_screen", `OTP ekranı açıldı — popup kapatıldı`, afterPopupShot);

      // Bot API'ye OTP isteği bildir
      await apiPost({ action: "idata_set_login_otp_requested", account_id: account.id }, "set_login_otp");
      await idataLog("login_otp", `📧 Giriş OTP bekleniyor | Hesap: ${account.email}`);

      // Dashboard'dan OTP'yi bekle (max 3 dakika) — IMAP varsa otomatik dene
      const hasImap = !!(account.imap_password);
      console.log(`  [LOGIN] ⏳ OTP bekleniyor (max 180s) | IMAP: ${hasImap ? 'aktif' : 'yok'}...`);
      const otpCode = await waitForLoginOtp(account.id, 180000, hasImap);
      
      if (!otpCode) {
        console.log("  [LOGIN] ❌ OTP zaman aşımı");
        const timeoutShot = await takeScreenshotBase64(page);
        await idataLog("login_fail", `OTP zaman aşımı | Hesap: ${account.email}`, timeoutShot);
        return { success: false, reason: "otp_timeout" };
      }

      console.log(`  [LOGIN] ✅ OTP alındı: ${otpCode}`);
      
      // OTP kodunu gir — "E-Posta Doğrulama Kodu" alanını hedefle (CAPTCHA input'unu atla)
      const otpTyped = await page.evaluate((code) => {
        const inputs = Array.from(document.querySelectorAll('input')).filter(inp => {
          const t = (inp.type || 'text').toLowerCase();
          if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'password'].includes(t)) return false;
          if (inp.readOnly || inp.disabled) return false;
          const rect = inp.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        
        // 1) "E-Posta Doğrulama" veya "mail" içeren placeholder (en spesifik)
        let target = inputs.find(inp => {
          const ph = (inp.placeholder || '').toLowerCase().normalize("NFC");
          return /e-?posta.*do[gğ]rulama|mail.*do[gğ]rulama|mail.*verification|e-?mail.*code|e-?posta.*kod/i.test(ph);
        });
        
        // 2) OTP spesifik placeholder/attr (CAPTCHA "Doğrulama Kodu"'nu hariç tut)
        if (!target) {
          target = inputs.find(inp => {
            const ph = (inp.placeholder || '').toLowerCase().normalize("NFC");
            const meta = ((inp.name || '') + ' ' + (inp.id || '')).toLowerCase();
            // "Doğrulama Kodu" tek başına ise CAPTCHA olabilir — atla
            if (/^do[gğ]rulama\s*kodu$/i.test(ph.trim())) return false;
            return /otp|verification|one.time|tek.kullanımlık/i.test(ph) || /otp|verification|one.time/i.test(meta);
          });
        }
        
        // 3) Son boş input (en alttaki — CAPTCHA dolu olacağından atlanır)
        if (!target) target = [...inputs].reverse().find(inp => !inp.value.trim());
        
        if (target) {
          target.focus();
          target.value = '';
          target.dispatchEvent(new Event("input", { bubbles: true }));
          for (const ch of code) {
            target.value += ch;
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
          target.dispatchEvent(new Event("change", { bubbles: true }));
          target.dispatchEvent(new Event("blur", { bubbles: true }));
          return { success: true, placeholder: target.placeholder || '', name: target.name || '', id: target.id || '' };
        }
        return { success: false };
      }, otpCode);

      if (otpTyped?.success) {
        console.log(`  [LOGIN] OTP girdi: placeholder="${otpTyped.placeholder}" name="${otpTyped.name}" id="${otpTyped.id}"`);
        await idataLog("login_otp", `OTP girildi → placeholder="${otpTyped.placeholder}" name="${otpTyped.name}"`);
      } else {
        console.log("  [LOGIN] ⚠ OTP input bulunamadı!");
        await idataLog("login_fail", `OTP input bulunamadı!`);
      }

      await delay(1000, 2000);

      // Doğrula/Giriş butonuna tıkla
      const otpSubmit = await clickAuthSubmitButton(page, "otp_submit");
      if (!otpSubmit?.found) {
        const ss = await takeScreenshotBase64(page);
        await idataLog("login_fail", `OTP sonrası submit bulunamadı`, ss);
        return { success: false, reason: "otp_submit_not_found", screenshot: ss };
      }
      await delay(5000, 8000);

      // OTP'yi temizle
      await apiPost({ action: "idata_clear_login_otp", account_id: account.id }, "clear_login_otp");
    }

    // Son durum kontrolü
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

    // OTP ekranı hâlâ görünüyorsa — tekrar OTP flow'a gir (ikinci deneme)
    if (state.otpRequired && !otpNeeded && !otpByNewInput) {
      console.log("  [LOGIN] ⚠ OTP ekranı tespit edildi (geç algılama) — OTP bekleniyor");
      const otpShot = await takeScreenshotBase64(page);
      await idataLog("login_otp_screen", `OTP ekranı (geç algılama)`, otpShot);
      
      await apiPost({ action: "idata_set_login_otp_requested", account_id: account.id }, "set_login_otp");
      await idataLog("login_otp", `📧 Giriş OTP bekleniyor (geç) | Hesap: ${account.email}`);
      
      const otpCode2 = await waitForLoginOtp(account.id, 180000, !!(account.imap_password));
      if (otpCode2) {
        console.log(`  [LOGIN] ✅ OTP alındı (geç): ${otpCode2}`);
        await page.evaluate((code) => {
          const inputs = Array.from(document.querySelectorAll('input')).filter(inp => {
            const t = (inp.type || 'text').toLowerCase();
            return !['hidden','submit','button','checkbox','radio','file','password'].includes(t) && !inp.readOnly && !inp.disabled;
          });
          const target = [...inputs].reverse().find(inp => !inp.value.trim()) || inputs[inputs.length - 1];
          if (target) { target.focus(); target.value = code; target.dispatchEvent(new Event("input",{bubbles:true})); target.dispatchEvent(new Event("change",{bubbles:true})); }
        }, otpCode2);
        await delay(1000, 2000);
        const otpSubmit2 = await clickAuthSubmitButton(page, "otp_submit_gec");
        if (!otpSubmit2?.found) {
          const ss = await takeScreenshotBase64(page);
          await idataLog("login_fail", `OTP(geç) sonrası submit bulunamadı`, ss);
          return { success: false, reason: "otp_submit_not_found", screenshot: ss };
        }
        await delay(5000, 8000);
        await apiPost({ action: "idata_clear_login_otp", account_id: account.id }, "clear_login_otp");
        
        // Final kontrol
        const finalState = await readPageState(page);
        const finalLoggedIn = !finalState.isCloudflare && !finalState.url.includes("/membership/login") && 
                              (finalState.url.includes("/membership") || finalState.body.includes("çıkış"));
        if (finalLoggedIn) {
          console.log("  [LOGIN] ✅ Giriş başarılı (OTP ile)!");
          return { success: true };
        }
      }
      const ss = await takeScreenshotBase64(page);
      return { success: false, reason: "otp_failed", screenshot: ss };
    }

    if (loggedIn) {
      console.log("  [LOGIN] ✅ Giriş başarılı!");
      return { success: true };
    }

    // Hâlâ login sayfasındaysa submit bir kez daha zorla (bazı akışlarda ilk tıklama düşüyor)
    if (stillLogin) {
      await idataLog("login_form", "Hâlâ login ekranında — submit retry tetiklendi");
      const retrySubmit = await clickAuthSubmitButton(page, "son_retry");
      if (retrySubmit?.found) {
        await delay(4000, 7000);
        const retryState = await readPageState(page);
        const retryStillLogin = retryState.url.includes("/membership/login") || retryState.body.includes("giriş yap");
        const retryLoggedIn = !retryState.isCloudflare && !retryStillLogin &&
          ((retryState.url.includes("/membership") && !retryState.url.includes("/membership/login")) || retryState.body.includes("çıkış") || retryState.body.includes("logout"));
        if (retryLoggedIn) {
          console.log("  [LOGIN] ✅ Giriş başarılı (submit retry)!");
          return { success: true };
        }
      }
    }

    console.log("  [LOGIN] ❌ Giriş başarısız");
    const ss = await takeScreenshotBase64(page);
    await delay(9000, 12000); // hemen kapanmasın, ekranda kontrol için kısa bekleme
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

        // Uyarı popup'ı varsa kapat ("Tamam" butonuna tıkla)
        for (let popupTry = 0; popupTry < 3; popupTry++) {
          const dismissed = await page.evaluate(() => {
            // Modal/popup içindeki "Tamam", "OK", "Kapat" butonlarını ara
            const allBtns = Array.from(document.querySelectorAll("button, a, input[type='button']"));
            for (const btn of allBtns) {
              const txt = (btn.textContent || btn.value || "").trim().toLowerCase();
              if (txt === "tamam" || txt === "ok" || txt === "kapat") {
                // Görünür mü kontrol et
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  btn.click();
                  return true;
                }
              }
            }
            return false;
          });
          if (dismissed) {
            console.log("  [CHECK] ⚠ Uyarı popup'ı kapatıldı (Tamam)");
            await delay(1500, 2500);
          } else {
            break;
          }
        }
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


  while (true) {
    try {
      // DB'den güncel proxy ayarlarını yükle
      await loadProxySettingsFromDB();

      // Config kontrolü — dashboard'dan aktif mi?
      const active = await isIdataActive();
      if (!active) {
        console.log("  ⏸ Bot pasif, bekleniyor...");
        await delay(10000, 15000);
        continue;
      }

      // Otomatik şehir-ofis scrape kapatıldı:
      // Register sayfasına SADECE kayıt talebi (pending) varsa girilecek.

      // 1. Bekleyen kayıtları işle
      const pendingData = await apiPost({ action: "get_idata_pending_registrations" }, "check_pending");
      const pendingCount = pendingData?.accounts?.length || 0;
      if (pendingCount > 0) {
        await idataLog("reg_start", `${pendingCount} kayıt talebi işleniyor`);
        await processPendingRegistrations();
      }

      // 2. Aktif hesaplarla randevu kontrol — HER SEFERİNDE FARKLI IP
      // Cloudflare'da takılırsa farklı IP ile 3 kez dene, 3'ünde de CF çıkarsa dashboard'a bildir
      const idataData = await fetch(CONFIG.API_URL + "/idata", { method: "GET", headers: apiHeaders }).then(r => r.json()).catch(() => null);
      const accounts = idataData?.accounts || [];
      
      if (accounts.length > 0) {
        const account = accounts[0];
        let success = false;
        let allCfBlocked = true;
        
        for (let attempt = 1; attempt <= 3 && !success; attempt++) {
          const ip = getNextIp();
          // Residential modda her denemede bölge rotasyonu yap
          if (PROXY_MODE === "residential") {
            residentialSessionId++;
            EVOMI_PROXY_REGION = getNextProxyRegion();
          }
          let browser, page;
          try {
            const proxyLabel = getProxyLabel(ip);
            console.log(`\n🔄 IP Rotasyonu: ${proxyLabel} | Bölge: ${EVOMI_PROXY_REGION || 'yok'} (deneme ${attempt}/3)`);
            await idataLog("login_start", `Giriş: ${account.email} | IP: ${proxyLabel} | Bölge: ${EVOMI_PROXY_REGION || 'yok'} | Deneme: ${attempt}/3`);
            ({ browser, page } = await launchBrowser(ip));
            
            const loginResult = await loginToIdata(page, account);
            if (loginResult.success) {
              allCfBlocked = false;
              await clearCfBlocked(); // CF engeli kalktı
              await idataLog("login_success", `Giriş başarılı: ${account.email}`);
              
              // Randevu kontrol
              await idataLog("appt_check", `Randevu kontrol ediliyor | Hesap: ${account.email}`);
              const apptResult = await checkAppointments(page, account);
              
              if (apptResult.reason === "cloudflare") {
                console.log(`  [CF] Randevu sayfasında Cloudflare! IP değiştiriliyor...`);
                await idataLog("cloudflare", `Randevu sayfasında CF engeli | IP: ${ip} | Deneme: ${attempt}`, apptResult.screenshot);
                if (ip) markIpBanned(ip);
                allCfBlocked = true;
                try { await browser.close(); } catch {}
                continue;
              }
              
              if (apptResult.found) {
                await idataLog("appt_found", `🎉 RANDEVU BULUNDU! | Hesap: ${account.email}`, apptResult.screenshot);
                startAlarm();
                
                console.log("  ⚡ Randevu bulundu! Hızlı kontrol moduna geçildi.");
                let fastCheckCount = 0;
                while (fastCheckCount < 20) {
                  await delay(15000, 20000);
                  fastCheckCount++;
                  const recheck = await checkAppointments(page, account);
                  if (recheck.found) {
                    await idataLog("appt_found", `🎉 RANDEVU HALA MEVCUT! (${fastCheckCount}) | Hesap: ${account.email}`, recheck.screenshot);
                  } else {
                    await idataLog("appt_none", `Randevu kapandı | ${recheck.message || ""} | Hesap: ${account.email}`, recheck.screenshot);
                    stopAlarm();
                    break;
                  }
                }
                if (fastCheckCount >= 20) stopAlarm();
              } else {
                stopAlarm();
                await idataLog("appt_none", `Randevu yok | ${apptResult.message || ""} | Hesap: ${account.email}`, apptResult.screenshot);
              }
              success = true;
            } else {
              const reason = loginResult.reason ? ` | Sebep: ${loginResult.reason}` : "";
              await idataLog("login_fail", `Giriş başarısız: ${account.email}${reason}`, loginResult.screenshot);

              if (ip && ["cloudflare_queue", "cloudflare_challenge"].includes(loginResult.reason)) {
                markIpBanned(ip);
                continue; // CF engeli — sonraki IP
              }

              if (["captcha_failed", "captcha_invalid", "login_failed", "otp_failed", "otp_submit_not_found", "submit_not_found"].includes(loginResult.reason)) {
                allCfBlocked = false;
                console.log(`  [LOGIN] 🔁 ${loginResult.reason} sebebiyle yeniden denenecek (${attempt}/3)`);
                if (attempt < 3) continue;
              }

              allCfBlocked = false;
              success = true; // CF dışı ve retry kapsamı dışı hata
            }
          } catch (err) {
            await idataLog("error", `Hata: ${err.message} | IP: ${getProxyLabel(ip)} | Deneme: ${attempt}`);
            if (ip) markIpBanned(ip);
          } finally {
            try { if (browser) await browser.close(); } catch {}
          }
        }

        // 3 denemede de CF engeli — dashboard'a bildir ve bekle
        if (allCfBlocked && !success) {
          const lastIp = IP_LIST[currentIpIndex] || "unknown";
          await signalCfBlocked(lastIp);
          await idataLog("cloudflare", `🚫 Tüm IP'ler Cloudflare tarafından engellendi! Dashboard'dan retry bekleniyor...`);
          console.log("\n  🚫 [CF] Tüm IP'ler engelli! Dashboard'dan retry bekleniyor...");
          
          // Dashboard'dan "Yeni IP ile Dene" butonuna basılana kadar bekle
          while (true) {
            const retryRequested = await checkCfRetryRequested();
            if (retryRequested) {
              console.log("  ✅ [CF] Dashboard'dan retry isteği alındı! Devam ediliyor...");
              await idataLog("cf_retry", "Dashboard'dan retry isteği alındı, yeni IP ile tekrar deneniyor");
              // Tüm IP ban'larını sıfırla
              ipBannedUntil.clear();
              break;
            }
            // Bot aktif mi kontrol et
            const active = await isIdataActive();
            if (!active) {
              console.log("  ⏸ Bot pasif duruma alındı");
              await clearCfBlocked();
              break;
            }
            await delay(5000, 8000);
          }
          continue; // Ana döngüyü baştan başlat (bekleme süresini atla)
        }
      } else {
        await idataLog("info", "Aktif hesap yok, bekleniyor");
      }


      const waitSec = CONFIG.CHECK_INTERVAL_MS / 1000;
      await idataLog("bot_idle", `${waitSec}s bekleniyor...`);
      console.log(`  ⏰ ${waitSec}s bekleniyor...`);
      await delay(CONFIG.CHECK_INTERVAL_MS, CONFIG.CHECK_INTERVAL_MS + 5000);

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
