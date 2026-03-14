/**
 * VFS Global Randevu Takip Botu v8.1
 * puppeteer-real-browser + Fingerprint + Kayıt Otomasyonu
 * IP Rotasyonu + Residential Proxy + Kayıt Otomasyonu
 */

require("dotenv").config();

// ==================== PROXY CONFIG ====================
// Proxy açık/kapalı (dashboard'dan kontrol edilir)
let PROXY_ENABLED = true;
// Proxy modu: "datacenter" (varsayılan, microsocks SOCKS5) veya "residential" (Evomi HTTP)
const PROXY_MODE = (process.env.PROXY_MODE || "residential").toLowerCase();
let EVOMI_PROXY_HOST = process.env.EVOMI_PROXY_HOST || "rp.evomi.com";
let EVOMI_PROXY_PORT = Number(process.env.EVOMI_PROXY_PORT || 1000);
let EVOMI_PROXY_USER = process.env.EVOMI_PROXY_USER || "";
let EVOMI_PROXY_PASS = process.env.EVOMI_PROXY_PASS || "";
let EVOMI_PROXY_COUNTRY = process.env.EVOMI_PROXY_COUNTRY || "TR";
let EVOMI_PROXY_REGION = process.env.EVOMI_PROXY_REGION || "";

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
      if (map.proxy_region !== undefined) { EVOMI_PROXY_REGION = map.proxy_region; DB_PROXY_REGION = map.proxy_region; }
      if (map.proxy_user) EVOMI_PROXY_USER = map.proxy_user;
      if (map.proxy_pass) EVOMI_PROXY_PASS = map.proxy_pass;
      if (map.captcha_provider) CAPTCHA_PROVIDER = map.captcha_provider.toLowerCase();
      if (map.capsolver_api_key) CAPSOLVER_API_KEY = map.capsolver_api_key;
      if (map.captcha_api_key) { CAPTCHA_API_KEY_2 = map.captcha_api_key; CONFIG.CAPTCHA_API_KEY = map.captcha_api_key; }
      if (map.ip_rotation_interval) IP_ROTATION_INTERVAL_MS = Number(map.ip_rotation_interval) * 60 * 1000;
      console.log(`  [DB] ✅ Ayarlar DB'den yüklendi: proxy_enabled=${PROXY_ENABLED} proxy=${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT} ülke=${EVOMI_PROXY_COUNTRY} bölge=${EVOMI_PROXY_REGION || 'yok'} captcha=${CAPTCHA_PROVIDER} ip_rot=${IP_ROTATION_INTERVAL_MS/60000}dk`);
    }
  } catch (e) {
    console.warn(`  [DB] ⚠️ DB'den proxy ayarı okunamadı, .env kullanılıyor: ${e.message}`);
  }
}

if (PROXY_MODE === "residential") {
  console.log(`🌐 Proxy modu: RESIDENTIAL (Evomi)`);
  console.log(`   Host: ${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`);
  console.log(`   Kullanıcı: ${EVOMI_PROXY_USER ? "var" : "yok"}`);
  console.log(`   Ülke: ${EVOMI_PROXY_COUNTRY}`);
} else {
  console.log(`🌐 Proxy modu: DATACENTER (microsocks SOCKS5)`);
}

// ==================== IP ROTATION ====================
const IP_LIST = (process.env.IP_LIST || "").split(",").map(s => s.trim()).filter(Boolean);
let currentIpIndex = -1;
let ipFailCounts = new Map();
const IP_MAX_FAILS = 3;
const IP_BAN_DURATION_MS = Number(process.env.IP_BAN_DURATION_MS || 1800000);
let ipBannedUntil = new Map();
let residentialSessionId = 0;
let IP_ROTATION_INTERVAL_MS = Number(process.env.IP_ROTATION_INTERVAL_MS || 0); // 0 = devre dışı
let lastIpRotationTime = Date.now();

// ==================== PROXY REGION ROTATION ====================
const PROXY_REGIONS_FALLBACK = ["ankara", "adana", "konya", "istanbul", "izmir", "bursa", "antalya"];
let currentRegionIndex = -1;
let DB_PROXY_REGION = ""; // Dashboard'dan seçilen sabit bölge
const PROXY_ISP_LIST = "vodafonenetdslm,turkcellinterne,vodafonenetadsl,superonlinebroa,turktelekom,turktelekomunik,vodafoneturkey,vodafonenetdslk";

function getNextProxyRegion() {
  // Dashboard'dan bölge seçilmişse sabit kullan
  if (DB_PROXY_REGION) {
    console.log(`  [PROXY] 🏙 Dashboard bölgesi kullanılıyor: ${DB_PROXY_REGION}`);
    return DB_PROXY_REGION;
  }
  // Bölge seçilmemişse fallback rotasyon
  currentRegionIndex = (currentRegionIndex + 1) % PROXY_REGIONS_FALLBACK.length;
  const region = PROXY_REGIONS_FALLBACK[currentRegionIndex];
  console.log(`  [PROXY] 🏙 Bölge rotasyonu: ${region} (${currentRegionIndex + 1}/${PROXY_REGIONS_FALLBACK.length})`);
  return region;
}

function getNextIp() {
  if (IP_LIST.length === 0) return null;
  
  const now = Date.now();
  let attempts = 0;
  
  while (attempts < IP_LIST.length) {
    currentIpIndex = (currentIpIndex + 1) % IP_LIST.length;
    const ip = IP_LIST[currentIpIndex];
    const bannedUntil = ipBannedUntil.get(ip) || 0;
    
    if (now >= bannedUntil) {
      console.log(`  [IP] 🔄 Sonraki IP: ${ip} (${currentIpIndex + 1}/${IP_LIST.length})`);
      return ip;
    }
    
    const remainSec = Math.round((bannedUntil - now) / 1000);
    console.log(`  [IP] ⏭ ${ip} banlı (${remainSec}s kaldı), atlıyorum...`);
    attempts++;
  }
  
  // Tüm IP'ler banlıysa en az banlı olanı seç
  const earliest = IP_LIST.reduce((best, ip) => {
    const t = ipBannedUntil.get(ip) || 0;
    const tBest = ipBannedUntil.get(best) || 0;
    return t < tBest ? ip : best;
  });
  console.log(`  [IP] ⚠ Tüm IP'ler banlı, en erken açılanı kullanıyorum: ${earliest}`);
  ipBannedUntil.delete(earliest);
  ipFailCounts.set(earliest, 0);
  currentIpIndex = IP_LIST.indexOf(earliest);
  return earliest;
}

function getCurrentIp() {
  if (IP_LIST.length === 0) return null;
  if (currentIpIndex < 0 || currentIpIndex >= IP_LIST.length) return null;
  return IP_LIST[currentIpIndex];
}

function markIpSuccess(ip) {
  if (!ip) return;
  ipFailCounts.set(ip, 0);
}

function markIpFail(ip) {
  if (!ip) return;
  const count = (ipFailCounts.get(ip) || 0) + 1;
  ipFailCounts.set(ip, count);
  console.log(`  [IP] ❌ ${ip} hata: ${count}/${IP_MAX_FAILS}`);
  
  if (count >= IP_MAX_FAILS) {
    ipBannedUntil.set(ip, Date.now() + IP_BAN_DURATION_MS);
    ipFailCounts.set(ip, 0);
    console.log(`  [IP] 🚫 ${ip} ${IP_BAN_DURATION_MS / 60000} dk boyunca banlı!`);
  }
}

function banIpImmediately(ip, reason = "") {
  if (!ip) return;
  ipBannedUntil.set(ip, Date.now() + IP_BAN_DURATION_MS);
  ipFailCounts.set(ip, 0);
  const reasonText = reason ? ` | Sebep: ${reason}` : "";
  console.log(`  [IP] 🚫 ${ip} anında banlandı (${IP_BAN_DURATION_MS / 60000} dk)${reasonText}`);
}

function isPageBlocked(pageContent) {
  if (!pageContent || pageContent.trim().length < 100) return true; // boş sayfa
  const lower = pageContent.toLowerCase();
  return lower.includes("access denied") || 
         lower.includes("blocked") ||
         lower.includes("403 forbidden") ||
         lower.includes("just a moment") ||
         lower.includes("ray id");
}

let Solver;
try {
  const mod = require("2captcha-ts");
  Solver = mod.Solver || mod.default?.Solver || mod;
} catch (e) {
  console.log("⚠ 2captcha-ts yüklü değil, HTTP fallback ile devam edilecek.");
}

// ==================== CAPTCHA PROVIDER ====================
// CAPTCHA_PROVIDER: "capsolver" | "2captcha" | "auto" (auto = capsolver önce, 2captcha fallback)
let CAPTCHA_PROVIDER = (process.env.CAPTCHA_PROVIDER || "auto").toLowerCase();
let CAPSOLVER_API_KEY = (process.env.CAPSOLVER_API_KEY || "").trim();
let CAPTCHA_API_KEY_2 = (process.env.CAPTCHA_API_KEY || process.env.TWOCAPTCHA_API_KEY || "").trim();

console.log(`🔐 CAPTCHA Provider: ${CAPTCHA_PROVIDER}`);
if (CAPSOLVER_API_KEY) console.log(`🔐 Capsolver API key: var (${CAPSOLVER_API_KEY.length} karakter)`);


// Ülke → VFS URL kodu eşlemesi
const COUNTRY_VFS_CODES = {
  france: "fra",
  netherlands: "nld",
  denmark: "dnk",
};

function getVfsLoginUrl(country) {
  const code = COUNTRY_VFS_CODES[country] || "fra";
  return `https://visa.vfsglobal.com/tur/tr/${code}/login`;
}

function getVfsRegisterUrl(country) {
  const code = COUNTRY_VFS_CODES[country] || "fra";
  return `https://visa.vfsglobal.com/tur/tr/${code}/register`;
}

const CONFIG = {
  API_URL: "https://ocrpzwrsyiprfuzsyivf.supabase.co/functions/v1/bot-api",
  API_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc",
  CAPTCHA_API_KEY: (process.env.CAPTCHA_API_KEY || process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY || "").trim(),
  QUEUE_MAX_WAIT_MS: Number(process.env.QUEUE_MAX_WAIT_MS || 360000),
  QUEUE_POLL_MS: Number(process.env.QUEUE_POLL_MS || 10000),
  COOLDOWN_HOURS: Number(process.env.COOLDOWN_HOURS || 2),
  OTP_WAIT_MS: Number(process.env.OTP_WAIT_MS || 120000),
  OTP_POLL_MS: Number(process.env.OTP_POLL_MS || 5000),
  MIN_ACCOUNT_GAP_MS: Number(process.env.MIN_ACCOUNT_GAP_MS || 600000),
  BASE_INTERVAL_MS: Number(process.env.BASE_INTERVAL_MS || 180000),
  MAX_BACKOFF_MS: Number(process.env.MAX_BACKOFF_MS || 900000),
};

const SUPABASE_REST_URL = "https://ocrpzwrsyiprfuzsyivf.supabase.co/rest/v1";
const restHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${CONFIG.API_KEY}`,
  apikey: CONFIG.API_KEY,
};

// CF blocked durumunu dashboard'a bildir (tracking_configs üzerinden)
async function vfsSignalCfBlocked(configId, ip) {
  try {
    await fetch(`${SUPABASE_REST_URL}/tracking_configs?id=eq.${configId}`, {
      method: "PATCH",
      headers: { ...restHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({
        cf_blocked_since: new Date().toISOString(),
        cf_blocked_ip: ip || "unknown",
        cf_retry_requested: false,
      }),
    });
    console.log("  [CF] 🚨 Dashboard'a VFS CF engeli bildirildi");
  } catch (err) {
    console.error("  [CF] VFS Signal hatası:", err.message);
  }
}

// CF retry isteği var mı kontrol et
async function vfsCheckCfRetryRequested(configId) {
  try {
    const res = await fetch(`${SUPABASE_REST_URL}/tracking_configs?id=eq.${configId}&select=cf_retry_requested`, {
      method: "GET",
      headers: restHeaders,
    });
    const data = await res.json();
    if (data?.[0]?.cf_retry_requested) {
      await fetch(`${SUPABASE_REST_URL}/tracking_configs?id=eq.${configId}`, {
        method: "PATCH",
        headers: { ...restHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({ cf_retry_requested: false, cf_blocked_since: null, cf_blocked_ip: null }),
      });
      return true;
    }
    return false;
  } catch { return false; }
}

// CF blocked durumunu temizle
async function vfsClearCfBlocked(configId) {
  try {
    await fetch(`${SUPABASE_REST_URL}/tracking_configs?id=eq.${configId}`, {
      method: "PATCH",
      headers: { ...restHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({ cf_blocked_since: null, cf_blocked_ip: null, cf_retry_requested: false }),
    });
  } catch {}
}

console.log(`🔐 CAPTCHA API key: ${CONFIG.CAPTCHA_API_KEY ? `var (${CONFIG.CAPTCHA_API_KEY.length} karakter)` : "yok"}`);

// ==================== FINGERPRINT ====================
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];
const VIEWPORTS = [
  { width: 1920, height: 1080 },
];
const TIMEZONES = ["Europe/Istanbul", "Europe/Berlin", "Europe/Paris", "Europe/London"];
const LANGUAGES = [
  ["tr-TR", "tr", "en-US", "en"], ["en-US", "en", "tr-TR", "tr"],
  ["fr-FR", "fr", "en-US", "en"], ["de-DE", "de", "en-US", "en"],
];
const PLATFORMS = ["Win32", "MacIntel", "Linux x86_64"];
const WEBGL_VENDORS = ["Google Inc. (NVIDIA)", "Google Inc. (Intel)", "Google Inc. (AMD)", "Intel Inc."];
const WEBGL_RENDERERS = [
  "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060, OpenGL 4.5)",
  "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)",
  "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)",
  "ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 640, OpenGL 4.1)",
];

function getRandomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateFingerprint() {
  return {
    userAgent: getRandomItem(USER_AGENTS),
    viewport: getRandomItem(VIEWPORTS),
    timezone: getRandomItem(TIMEZONES),
    languages: getRandomItem(LANGUAGES),
    platform: getRandomItem(PLATFORMS),
    webglVendor: getRandomItem(WEBGL_VENDORS),
    webglRenderer: getRandomItem(WEBGL_RENDERERS),
    deviceMemory: getRandomItem([4, 8, 16]),
    hardwareConcurrency: getRandomItem([4, 6, 8, 12, 16]),
    screenDepth: getRandomItem([24, 32]),
    maxTouchPoints: 0,
  };
}

// ==================== HELPERS ====================
const accountLastUsed = new Map();
let consecutiveErrors = 0;

function delay(min = 2000, max = 5000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

// İnsan benzeri scroll
async function humanScroll(page) {
  try {
    const scrollAmount = Math.floor(Math.random() * 300) + 100;
    const direction = Math.random() > 0.3 ? 1 : -1;
    await page.evaluate((amount) => window.scrollBy({ top: amount, behavior: 'smooth' }), scrollAmount * direction);
    await delay(800, 2000);
  } catch {}
}

// İnsan benzeri idle (okuyormuş gibi)
async function humanIdle(min = 2000, max = 6000) {
  const wait = Math.floor(Math.random() * (max - min) + min);
  await new Promise(r => setTimeout(r, wait));
}

async function humanMove(page) {
  try {
    const vp = page.viewport();
    const w = vp?.width || 1366;
    const h = vp?.height || 768;
    // Birden fazla hareket yap — gerçek kullanıcı gibi
    const moves = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < moves; i++) {
      const x = Math.floor(Math.random() * w * 0.6 + w * 0.2);
      const y = Math.floor(Math.random() * h * 0.6 + h * 0.2);
      await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 20 + 10) });
      await delay(300, 800);
    }
    // Bazen scroll da yap
    if (Math.random() > 0.5) await humanScroll(page);
  } catch {}
}

async function humanType(page, target, text, options = {}) {
  const { clearFirst = false, minDelay = 120, maxDelay = 350, pauseChance = 0.2, pauseMin = 400, pauseMax = 1500 } = options;
  if (!text && text !== 0) return false;
  const element = typeof target === "string" ? await page.$(target) : target;
  if (!element) return false;
  
  // Alana tıklamadan önce biraz bekle (düşünme süresi)
  await humanIdle(800, 2000);
  await element.click({ clickCount: 1 });
  await delay(400, 900);
  
  if (clearFirst) {
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await delay(300, 700);
  }
  
  for (const ch of String(text)) {
    const keyDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    await page.keyboard.type(ch, { delay: keyDelay });
    // Daha sık ve uzun duraklamalar
    if (Math.random() < pauseChance) await delay(pauseMin, pauseMax);
    // Bazen yanlış tuş bas ve düzelt (typo simülasyonu)
    if (Math.random() < 0.03 && text.length > 5) {
      const wrongKey = String.fromCharCode(97 + Math.floor(Math.random() * 26));
      await page.keyboard.type(wrongKey, { delay: keyDelay });
      await delay(300, 800);
      await page.keyboard.press("Backspace");
      await delay(200, 500);
    }
  }
  await delay(400, 1000);
  return true;
}

const apiHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${CONFIG.API_KEY}`,
  apikey: CONFIG.API_KEY,
};

const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 20000);
const API_RETRY_COUNT = Number(process.env.API_RETRY_COUNT || 2);
const API_RETRY_DELAY_MS = Number(process.env.API_RETRY_DELAY_MS || 1200);

const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchApiJson(init, context = "api") {
  let lastError;

  for (let attempt = 1; attempt <= API_RETRY_COUNT + 1; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await fetch(CONFIG.API_URL, { ...init, signal: controller.signal });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};

      if (!res.ok) {
        const msg = data?.error || raw || `HTTP ${res.status}`;
        throw new Error(`${context}: HTTP ${res.status} - ${String(msg).slice(0, 180)}`);
      }

      return data;
    } catch (err) {
      lastError = err;
      const isLast = attempt > API_RETRY_COUNT;
      if (isLast) break;

      const backoff = API_RETRY_DELAY_MS * attempt + Math.floor(Math.random() * 350);
      console.log(`  [API] ${context} deneme ${attempt} başarısız (${err.message}), ${backoff}ms sonra tekrar`);
      await waitMs(backoff);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function apiGet(context) {
  return fetchApiJson({ method: "GET", headers: apiHeaders }, context);
}

async function apiPost(payload, context) {
  return fetchApiJson(
    { method: "POST", headers: apiHeaders, body: JSON.stringify(payload) },
    context
  );
}

async function reportResult(configId, status, message = "", slotsAvailable = 0, screenshotBase64 = null) {
  try {
    const body = { config_id: configId, status, message, slots_available: slotsAvailable };
    if (screenshotBase64) body.screenshot_base64 = screenshotBase64;
    const data = await apiPost(body, `report_result:${status}`);
    console.log(`  [API] ${status}: ${data.message || data.error || "ok"}`);
  } catch (err) {
    console.error("  [API] Bildirim hatası:", err.message);
  }
}

// Dashboard'da adım adım görünecek hafif log fonksiyonu
async function logStep(configId, stepStatus, message = "") {
  if (!configId) return;
  try {
    await apiPost({ config_id: configId, status: stepStatus, message, slots_available: 0 }, `step:${stepStatus}`);
  } catch (err) {
    // Adım logları kritik değil, sessizce geç
  }
}

async function updateAccountStatus(accountId, status, failCount = null) {
  try {
    const body = { action: "update_account", account_id: accountId, status };
    if (status === "cooldown") body.banned_until = new Date(Date.now() + CONFIG.COOLDOWN_HOURS * 3600000).toISOString();
    if (failCount !== null) body.fail_count = failCount;
    await apiPost(body, `update_account:${status}`);
    console.log(`  [ACCOUNT] ${accountId.substring(0, 8)}... → ${status}`);
  } catch (err) {
    console.error("  [ACCOUNT] Güncelleme hatası:", err.message);
  }
}

async function fetchActiveConfigs() {
  try {
    const data = await apiGet("fetch_active_configs");
    if (data.ok) return { configs: data.configs || [], accounts: data.accounts || [] };
    console.error("API hatası:", data.error || "ok=false");
    return { configs: [], accounts: [] };
  } catch (err) {
    console.error("API bağlantı hatası:", err.message);
    return { configs: [], accounts: [] };
  }
}

async function takeScreenshotBase64(page) {
  try { return await page.screenshot({ fullPage: true, encoding: "base64" }); } catch { return null; }
}

async function isWaitingRoomPage(page) {
  return await page.evaluate(() => {
    const title = (document.title || "").toLowerCase();
    const body = (document.body?.innerText || "").toLowerCase();
    const url = (window.location.href || "").toLowerCase();

    const isNotFoundLike =
      url.includes("page-not-found") ||
      url.includes("/404") ||
      title.includes("bir şeyler ters gitti") ||
      title.includes("üzgünüm") ||
      body.includes("bir şeyler ters gitti") ||
      body.includes("sorry, something went wrong");

    if (isNotFoundLike) return false;

    return title.includes("waiting room") ||
      body.includes("şu anda sıradasınız") ||
      body.includes("tahmini bekleme süreniz") ||
      body.includes("this page will auto refresh") ||
      body.includes("bu sayfa otomatik olarak yenilenecektir");
  });
}

async function postQueueScreenshot(page, context, waitedSec, note = "Sıra bekleniyor") {
  try {
    const ss = await takeScreenshotBase64(page);
    if (!ss) return;
    const cfgData = await apiGet("queue_screenshot:get_configs");
    const configId = cfgData?.configs?.[0]?.id;
    if (!configId) return;
    const pageUrl = await page.url();
    const pageTitle = await page.evaluate(() => document.title).catch(() => "");
    await apiPost({
      config_id: configId,
      status: "checking",
      message: `[${context}] ${note} (${waitedSec}s) | URL: ${pageUrl.substring(0, 80)} | Başlık: ${pageTitle.substring(0, 60)}`,
      slots_available: 0,
      screenshot_base64: ss,
    }, "queue_screenshot:insert_log");
    console.log(`  [${context}] 📸 Screenshot gönderildi (${waitedSec}s) | ${note}`);
  } catch (e) {
    console.log(`  [${context}] Screenshot hatası: ${e.message}`);
  }
}

async function waitForLoginFormAfterQueue(page) {
  const startedAt = Date.now();
  let attempt = 0;
  let lastScreenshotAt = 0;
  while (Date.now() - startedAt < CONFIG.QUEUE_MAX_WAIT_MS) {
    attempt++;
    const emailInput = await page.$('input[type="email"], input[name="email"], #email');
    if (emailInput) {
      console.log(`  [QUEUE] ✅ Login formu hazır (${attempt}. deneme).`);
      return { ok: true };
    }
    const waitingRoom = await isWaitingRoomPage(page);
    const waitedSec = Math.round((Date.now() - startedAt) / 1000);
    if (waitingRoom) {
      console.log(`  [QUEUE] Sırada bekleniyor... ${waitedSec}s`);
      if (Date.now() - lastScreenshotAt > 30000) {
        await postQueueScreenshot(page, "QUEUE", waitedSec, "Sırada bekleniyor");
        lastScreenshotAt = Date.now();
      }
      await solveTurnstile(page);
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: CONFIG.QUEUE_POLL_MS + 5000 }).catch(() => {});
      await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
      continue;
    }

    if (attempt % 3 === 0 && Date.now() - lastScreenshotAt > 30000) {
      await postQueueScreenshot(page, "QUEUE", waitedSec, "Login formu henüz görünmedi");
      lastScreenshotAt = Date.now();
    }
    await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
  }
  return { ok: false, reason: `Waiting room timeout (${Math.round(CONFIG.QUEUE_MAX_WAIT_MS / 1000)}s)` };
}

async function waitForRegistrationFormAfterQueue(page, registerUrl) {
  const startedAt = Date.now();
  let attempt = 0;
  let lastScreenshotAt = 0;
  let notFoundRecoveries = 0;

  while (Date.now() - startedAt < CONFIG.QUEUE_MAX_WAIT_MS) {
    attempt++;

    const formState = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const emailCandidates = Array.from(document.querySelectorAll('input[type="email"], input[name="email"], input[formcontrolname*="email"], input[id*="email"]'));
      const passwordCandidates = Array.from(document.querySelectorAll('input[type="password"]'));

      const hasVisibleEmail = emailCandidates.some(isVisible);
      const visiblePasswordCount = passwordCandidates.filter(isVisible).length;
      const title = (document.title || "").toLowerCase();
      const body = (document.body?.innerText || "").toLowerCase();
      const url = (window.location.href || "").toLowerCase();

      return {
        hasVisibleEmail,
        visiblePasswordCount,
        title,
        body,
        url,
      };
    });

    if (formState.hasVisibleEmail && formState.visiblePasswordCount >= 2) {
      console.log(`  [REG] ✅ Kayıt formu hazır (${attempt}. deneme).`);
      return { ok: true };
    }

    const waitedSec = Math.round((Date.now() - startedAt) / 1000);

    const notFoundLike =
      formState.url.includes("page-not-found") ||
      formState.url.includes("/404") ||
      formState.title.includes("bir şeyler ters gitti") ||
      formState.title.includes("üzgünüm") ||
      formState.body.includes("bir şeyler ters gitti") ||
      formState.body.includes("sorry, something went wrong");

    if (notFoundLike) {
      notFoundRecoveries += 1;
      console.log(`  [REG] ⚠ Not-found sayfasına düştü (${notFoundRecoveries}/3), register sayfasına dönülüyor...`);
      if (Date.now() - lastScreenshotAt > 15000) {
        await postQueueScreenshot(page, "REG-QUEUE", waitedSec, "Not-found algılandı, register sayfasına dönülüyor");
        lastScreenshotAt = Date.now();
      }

      if (notFoundRecoveries > 3) {
        return { ok: false, reason: "Kayıt sayfası yerine sürekli not-found açılıyor" };
      }

      if (registerUrl) {
        await page.goto(registerUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
        await delay(2500, 4500);
        await solveTurnstile(page);
        continue;
      }
    }

    const waitingRoom = await isWaitingRoomPage(page);
    if (waitingRoom) {
      console.log(`  [REG] Sırada bekleniyor... ${waitedSec}s`);
      if (Date.now() - lastScreenshotAt > 30000) {
        await postQueueScreenshot(page, "REG-QUEUE", waitedSec, "Sırada bekleniyor");
        lastScreenshotAt = Date.now();
      }
      await solveTurnstile(page);
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: CONFIG.QUEUE_POLL_MS + 5000 }).catch(() => {});
      await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
      continue;
    }

    if (attempt % 3 === 0) {
      try {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const acceptBtn = btns.find((b) => {
            const txt = (b.textContent || "").toLowerCase();
            return txt.includes("accept all") || txt.includes("kabul") || txt.includes("tümünü kabul") || txt.includes("tüm tanımlama");
          }) || document.getElementById("onetrust-accept-btn-handler");
          if (acceptBtn) acceptBtn.click();
        });
      } catch {}

      if (Date.now() - lastScreenshotAt > 30000) {
        await postQueueScreenshot(page, "REG-QUEUE", waitedSec, "Form henüz görünmedi");
        lastScreenshotAt = Date.now();
      }
    }

    if (attempt % 6 === 0) {
      await solveTurnstile(page);
    }

    await delay(3500, 7000);
  }

  return { ok: false, reason: `Kayıt formu zaman aşımı (${Math.round(CONFIG.QUEUE_MAX_WAIT_MS / 1000)}s)` };
}

// ==================== OTP HANDLING ====================
async function readManualOtp(accountId) {
  try {
    const data = await apiPost({ action: "get_account_otp", account_id: accountId }, "get_account_otp");
    if (data.manual_otp) {
      console.log(`  [OTP] ✅ Manuel OTP bulundu: ${data.manual_otp}`);
      await apiPost({ action: "clear_account_otp", account_id: accountId }, "clear_account_otp");
      return data.manual_otp;
    }
    return null;
  } catch (err) {
    console.error("  [OTP] Manuel OTP okuma hatası:", err.message);
    return null;
  }
}

async function setOtpRequested(accountId) {
  try {
    await apiPost({ action: "set_otp_requested", account_id: accountId }, "set_otp_requested");
    console.log("  [OTP] 📱 SMS OTP bekleniyor - dashboard'dan girilebilir");
  } catch (err) {
    console.error("  [OTP] otp_requested_at hatası:", err.message);
  }
}

async function handleOtpVerification(page, account) {
  const hasOtp = await page.evaluate(() => {
    const body = (document.body?.innerText || "").toLowerCase();
    const url = window.location.href.toLowerCase();
    if (url.includes("/login") || url.includes("/sign-in")) return false;
    const hasEmailInput = !!document.querySelector('input[type="email"], input[name="email"]');
    const hasPasswordInput = !!document.querySelector('input[type="password"]');
    if (hasEmailInput && hasPasswordInput) return false;
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
                       body.includes("enter the code") || body.includes("kodu girin");
    return hasOtpInput || (hasOtpText && inputs.length > 0 && inputs.length <= 6);
  });

  if (!hasOtp) return { ok: true, reason: "no_otp" };

  console.log("  [OTP] ⚠ Doğrulama kodu isteniyor!");
  const ss = await takeScreenshotBase64(page);
  await setOtpRequested(account.id);

  const startTime = Date.now();
  while (Date.now() - startTime < CONFIG.OTP_WAIT_MS) {
    let otp = await readManualOtp(account.id);
    if (otp) {
      const filled = await page.evaluate((code) => {
        const singleInput = document.querySelector('input[type="text"][name*="otp"], input[type="text"][name*="code"], input[type="number"], input[type="tel"]');
        if (singleInput) {
          singleInput.value = code;
          singleInput.dispatchEvent(new Event("input", { bubbles: true }));
          singleInput.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        const inputs = document.querySelectorAll('input[type="text"], input[type="tel"]');
        const otpInputs = [...inputs].filter(inp => inp.maxLength === 1 || inp.maxLength === -1);
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
    console.log(`  [OTP] Bekleniyor... ${elapsed}s / ${CONFIG.OTP_WAIT_MS / 1000}s`);
    await delay(CONFIG.OTP_POLL_MS, CONFIG.OTP_POLL_MS + 1000);
  }
  console.log("  [OTP] ❌ OTP zaman aşımı");
  return { ok: false, reason: "otp_required", screenshot: ss };
}

// ==================== CAPTCHA ====================
async function readTurnstileToken(page) {
  return await page.evaluate(() => {
    const fields = Array.from(
      document.querySelectorAll(
        'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name*="turnstile"], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]'
      )
    );

    const fieldToken = fields
      .map((el) => String(el.value || "").trim())
      .find((v) => v.length > 20);

    if (fieldToken) return fieldToken;

    try {
      if (window.turnstile && typeof window.turnstile.getResponse === "function") {
        const response = window.turnstile.getResponse();
        if (typeof response === "string" && response.trim().length > 20) {
          return response.trim();
        }
      }
    } catch {}

    return "";
  });
}

async function waitForTurnstileToken(page, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const token = await readTurnstileToken(page);
    if (token) return token;
    await delay(350, 700);
  }
  return "";
}

async function waitForTurnstileWidget(page, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const hasWidget = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      const widget = document.querySelector('.cf-turnstile, [name*="turnstile"], [data-sitekey]');
      return !!iframe || !!widget;
    }).catch(() => false);

    if (hasWidget) return true;
    await delay(300, 600);
  }
  return false;
}

async function ensureLoginTurnstileToken(page, maxAttempts = 4) {
  await waitForTurnstileWidget(page, 10000);

  let token = await waitForTurnstileToken(page, 2000);
  if (token) return token;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`  [CAPTCHA] Login Turnstile deneme ${attempt}/${maxAttempts}`);

    const solved = await solveTurnstile(page);
    if (!solved) {
      await tryClickTurnstileCheckbox(page);
    }

    token = await waitForTurnstileToken(page, 8000);
    if (token) return token;

    await delay(900, 1800);
  }

  return "";
}

async function submitLoginForm(page) {
  return await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const submitBtn = btns.find((b) => {
      const txt = (b.textContent || "").toLowerCase();
      return txt.includes("oturum") || txt.includes("sign in") || txt.includes("login") || txt.includes("giriş");
    }) || document.querySelector('button[type="submit"]');

    const form = submitBtn?.closest("form") || document.querySelector("form");
    if (!submitBtn) {
      if (form && typeof form.requestSubmit === "function") {
        form.requestSubmit();
        return { clicked: true, forced: true, disabled: false };
      }
      return { clicked: false, forced: false, disabled: false };
    }

    const isDisabled =
      !!submitBtn.disabled ||
      submitBtn.hasAttribute("disabled") ||
      submitBtn.getAttribute("aria-disabled") === "true";

    if (isDisabled) {
      submitBtn.removeAttribute("disabled");
      submitBtn.setAttribute("aria-disabled", "false");
      submitBtn.disabled = false;
    }

    submitBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    submitBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    submitBtn.click();

    if (form) {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      if (typeof form.requestSubmit === "function") {
        try { form.requestSubmit(); } catch {}
      }
    }

    return { clicked: true, forced: isDisabled, disabled: isDisabled };
  });
}

async function getLoginCaptchaState(page) {
  return await page.evaluate(() => {
    const body = (document.body?.innerText || "").toLowerCase();
    const url = window.location.href.toLowerCase();
    const hasLoginForm = !!document.querySelector('input[type="email"], input[name="email"], #email');
    const hasTurnstileWidget = !!document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [name*="turnstile"]');

    const fields = Array.from(
      document.querySelectorAll(
        'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name*="turnstile"], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]'
      )
    );
    const hasCaptchaTokenFromField = fields.some((el) => String(el.value || "").trim().length > 20);

    let hasCaptchaTokenFromApi = false;
    try {
      if (window.turnstile && typeof window.turnstile.getResponse === "function") {
        const response = window.turnstile.getResponse();
        hasCaptchaTokenFromApi = typeof response === "string" && response.trim().length > 20;
      }
    } catch {}

    const hasCaptchaError =
      body.includes("verify you are human") ||
      body.includes("zorunlu alan boş bırakılamaz") ||
      body.includes("robot olmadığınızı") ||
      body.includes("captcha") ||
      body.includes("doğrulama");

    return {
      isLoginPage: url.includes("/login"),
      hasLoginForm,
      hasTurnstileWidget,
      hasCaptchaToken: hasCaptchaTokenFromField || hasCaptchaTokenFromApi,
      hasCaptchaError,
    };
  });
}

async function getTurnstileDiagnostics(page) {
  return await page.evaluate(() => {
    const body = (document.body?.innerText || "").toLowerCase();
    const title = (document.title || "").toLowerCase();
    const url = (window.location.href || "").toLowerCase();

    const tokenFields = Array.from(
      document.querySelectorAll(
        'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name*="turnstile"], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]'
      )
    );

    const tokenFieldLengths = tokenFields.map((el) => String(el.value || "").trim().length);
    const maxFieldTokenLength = tokenFieldLengths.length ? Math.max(...tokenFieldLengths) : 0;

    let apiTokenLength = 0;
    try {
      if (window.turnstile && typeof window.turnstile.getResponse === "function") {
        const response = window.turnstile.getResponse();
        apiTokenLength = typeof response === "string" ? response.trim().length : 0;
      }
    } catch {}

    const loginBtn =
      Array.from(document.querySelectorAll("button")).find((b) => {
        const txt = (b.textContent || "").toLowerCase();
        return txt.includes("oturum") || txt.includes("sign in") || txt.includes("login") || txt.includes("giriş");
      }) || document.querySelector('button[type="submit"]');

    const submitDisabled = !!loginBtn && (
      loginBtn.disabled ||
      loginBtn.hasAttribute("disabled") ||
      loginBtn.getAttribute("aria-disabled") === "true"
    );

    return {
      url,
      title,
      isLoginPage: url.includes("/login"),
      hasLoginForm: !!document.querySelector('input[type="email"], input[name="email"], #email'),
      widgetCount: document.querySelectorAll('.cf-turnstile, [name*="turnstile"], [data-sitekey]').length,
      iframeCount: document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').length,
      tokenFieldCount: tokenFields.length,
      maxFieldTokenLength,
      apiTokenLength,
      hasCaptchaHints:
        body.includes("verify you are human") ||
        body.includes("robot olmadığınızı") ||
        body.includes("captcha") ||
        body.includes("doğrulama"),
      hasWaitingRoomHints: title.includes("waiting room") || body.includes("şu anda sıradasınız"),
      submitDisabled,
    };
  });
}

function formatTurnstileDiagnostics(diag) {
  if (!diag) return "diag=yok";
  return [
    `url=${(diag.url || "").slice(0, 80)}`,
    `widget=${diag.widgetCount}`,
    `iframe=${diag.iframeCount}`,
    `fields=${diag.tokenFieldCount}`,
    `fieldTokenLen=${diag.maxFieldTokenLength}`,
    `apiTokenLen=${diag.apiTokenLength}`,
    `submitDisabled=${diag.submitDisabled ? 1 : 0}`,
    `captchaHint=${diag.hasCaptchaHints ? 1 : 0}`,
    `waitingHint=${diag.hasWaitingRoomHints ? 1 : 0}`,
  ].join(" | ");
}

async function tryClickTurnstileCheckbox(page) {
  const selectors = [
    'input[type="checkbox"]',
    '[role="checkbox"]',
    '.cb-i',
    '.ctp-checkbox-label',
    'label',
    '#challenge-stage',
  ];

  try {
    const frames = page.frames().filter((f) => f.url().includes("challenges.cloudflare.com"));

    for (const frame of frames) {
      for (const selector of selectors) {
        const target = await frame.$(selector);
        if (!target) continue;
        try {
          await target.click({ delay: Math.floor(Math.random() * 90) + 40 });
          await delay(1200, 2200);
          const token = await waitForTurnstileToken(page, 5000);
          if (token) {
            console.log("  [CAPTCHA] ✅ Turnstile checkbox tıklandı ve token alındı");
            return true;
          }
          console.log("  [CAPTCHA] ⚠ Turnstile tıklandı ama token gelmedi");
        } catch {}
      }
    }

    const iframeHandle = await page.$(
      'iframe[src*="challenges.cloudflare.com"], iframe[title*="Cloudflare" i], iframe[title*="Widget containing" i]'
    );
    if (iframeHandle) {
      const box = await iframeHandle.boundingBox();
      if (box) {
        const clickX = box.x + box.width / 2;
        const clickY = box.y + Math.min(box.height / 2, 24);
        await page.mouse.move(clickX, clickY, { steps: 8 });
        await delay(120, 260);
        await page.mouse.click(clickX, clickY, { delay: Math.floor(Math.random() * 90) + 30 });
        await delay(1500, 2600);
        const token = await waitForTurnstileToken(page, 6000);
        if (token) {
          console.log("  [CAPTCHA] ✅ Turnstile iframe merkez tıklandı ve token alındı");
          return true;
        }
        console.log("  [CAPTCHA] ⚠ Turnstile iframe tıklandı ama token gelmedi");
      }
    }
  } catch {}

  return false;
}

async function getTurnstileContext(page) {
  return await page.evaluate(() => {
    const readParam = (url, key) => {
      try {
        const u = new URL(url, location.href);
        return u.searchParams.get(key);
      } catch {
        return null;
      }
    };

    const widget =
      document.querySelector('.cf-turnstile, [data-sitekey], [name*="turnstile"]') ||
      document.querySelector('iframe[src*="challenges.cloudflare.com"]')?.closest("div");

    const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
    const iframeSrc = iframe?.getAttribute("src") || "";

    const sitekey =
      widget?.getAttribute?.("data-sitekey") ||
      document.querySelector('[data-sitekey]')?.getAttribute?.("data-sitekey") ||
      readParam(iframeSrc, "k") ||
      readParam(iframeSrc, "sitekey") ||
      readParam(iframeSrc, "siteKey") ||
      null;

    const action =
      widget?.getAttribute?.("data-action") ||
      readParam(iframeSrc, "action") ||
      readParam(iframeSrc, "sa") ||
      null;

    const cData =
      widget?.getAttribute?.("data-cdata") ||
      readParam(iframeSrc, "data") ||
      readParam(iframeSrc, "cData") ||
      null;

    const pageData = readParam(iframeSrc, "pagedata") || readParam(iframeSrc, "chlPageData") || null;

    const hasWidget =
      !!iframe ||
      !!document.querySelector('.cf-turnstile, [name*="turnstile"]') ||
      /verify you are human|robot olmadığınızı|doğrulayın|captcha|turnstile/i.test(document.body?.innerText || "");

    return { sitekey, action, cData, pageData, hasWidget };
  });
}

function parse2CaptchaResponse(raw) {
  const text = String(raw || "").trim();

  try {
    const json = JSON.parse(text);
    if (json.status === 1 && json.request) return { ok: true, value: json.request };
    return { ok: false, error: json.request || text || "unknown" };
  } catch {}

  if (text.startsWith("OK|")) return { ok: true, value: text.slice(3) };
  return { ok: false, error: text || "unknown" };
}

// ==================== CAPSOLVER TURNSTILE ====================
async function solveTurnstileWithCapsolver({ sitekey, pageurl, action, data, pagedata, userAgent }) {
  if (!CAPSOLVER_API_KEY) throw new Error("CAPSOLVER_API_KEY yok");

  const task = { type: "AntiTurnstileTaskProxyLess", websiteURL: pageurl, websiteKey: sitekey };
  if (action) task.metadata = { ...task.metadata, action };

  const createRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, task }),
  });
  const createData = await createRes.json();
  if (createData.errorId !== 0) throw new Error(`Capsolver createTask: ${createData.errorDescription || createData.errorCode}`);

  const taskId = createData.taskId;
  console.log(`  [CAPTCHA] Capsolver task: ${taskId}`);

  for (let attempt = 1; attempt <= 60; attempt++) {
    await delay(2000, 3500);
    const resultRes = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, taskId }),
    });
    const resultData = await resultRes.json();

    if (resultData.status === "ready") {
      const token = resultData.solution?.token;
      if (token) {
        console.log(`  [CAPTCHA] ✅ Capsolver çözüldü!`);
        return token;
      }
    }
    if (resultData.errorId !== 0) throw new Error(`Capsolver getTaskResult: ${resultData.errorDescription}`);
    if (resultData.status === "processing") continue;
  }
  throw new Error("Capsolver timeout");
}

// ==================== 2CAPTCHA TURNSTILE ====================
async function solveTurnstileWithHttp({ sitekey, pageurl, action, data, pagedata, userAgent }) {
  if (!CONFIG.CAPTCHA_API_KEY) throw new Error("CAPTCHA_API_KEY yok");

  const body = new URLSearchParams({
    key: CONFIG.CAPTCHA_API_KEY,
    method: "turnstile",
    sitekey,
    pageurl,
    json: "1",
  });

  if (action) body.set("action", action);
  if (data) body.set("data", data);
  if (pagedata) body.set("pagedata", pagedata);
  if (userAgent) body.set("userAgent", userAgent);

  const createRes = await fetch("https://2captcha.com/in.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const createRaw = await createRes.text();
  const createParsed = parse2CaptchaResponse(createRaw);
  if (!createParsed.ok) throw new Error(`2captcha in.php: ${createParsed.error}`);

  const captchaId = createParsed.value;

  for (let attempt = 1; attempt <= 24; attempt++) {
    await delay(4500, 6200);
    const pollUrl = `https://2captcha.com/res.php?${new URLSearchParams({
      key: CONFIG.CAPTCHA_API_KEY,
      action: "get",
      id: captchaId,
      json: "1",
    }).toString()}`;

    const pollRes = await fetch(pollUrl);
    const pollRaw = await pollRes.text();
    const pollParsed = parse2CaptchaResponse(pollRaw);

    if (pollParsed.ok) return pollParsed.value;
    if (/CAPCHA_NOT_READY/i.test(pollParsed.error || "")) continue;
    throw new Error(`2captcha res.php: ${pollParsed.error}`);
  }

  throw new Error("2captcha timeout");
}

// ==================== UNIFIED TURNSTILE SOLVER ====================
async function solveWithProvider(payload) {
  const useCapsolver = CAPSOLVER_API_KEY && (CAPTCHA_PROVIDER === "capsolver" || CAPTCHA_PROVIDER === "auto");
  const use2captcha = CONFIG.CAPTCHA_API_KEY && (CAPTCHA_PROVIDER === "2captcha" || CAPTCHA_PROVIDER === "auto");

  // Capsolver öncelikli (auto modda)
  if (useCapsolver) {
    try {
      return await solveTurnstileWithCapsolver(payload);
    } catch (err) {
      console.log(`  [CAPTCHA] Capsolver başarısız: ${err.message}`);
      if (CAPTCHA_PROVIDER === "capsolver") throw err; // sadece capsolver modda hata fırlat
    }
  }

  // 2captcha fallback
  if (use2captcha) {
    try {
      // SDK dene
      if (Solver) {
        try {
          const solver = new (Solver.Solver || Solver)(CONFIG.CAPTCHA_API_KEY);
          const result = await solver.cloudflareTurnstile(payload);
          const token = result?.data || result?.token || result?.request || result?.code || "";
          if (token) return token;
        } catch (sdkErr) {
          console.log(`  [CAPTCHA] 2captcha SDK başarısız: ${sdkErr.message}`);
        }
      }
      return await solveTurnstileWithHttp(payload);
    } catch (err) {
      console.log(`  [CAPTCHA] 2captcha başarısız: ${err.message}`);
      throw err;
    }
  }

  throw new Error("Hiçbir CAPTCHA provider yapılandırılmamış");
}

async function solveTurnstile(page) {
  const context = await getTurnstileContext(page);

  if (!context.hasWidget) {
    console.log("  [CAPTCHA] Turnstile bulunamadı.");
    return false;
  }

  const hasAnyCaptchaKey = CONFIG.CAPTCHA_API_KEY || CAPSOLVER_API_KEY;
  if (context.sitekey && hasAnyCaptchaKey) {
    const solved = await _solve(page, context);
    if (solved) return true;
  }

  if (!context.sitekey && hasAnyCaptchaKey) {
    console.log("  [CAPTCHA] Sitekey bulunamadı, iframe click fallback deneniyor...");
  } else if (!hasAnyCaptchaKey) {
    console.log("  [CAPTCHA] API key yok, yalnızca iframe click deneniyor...");
  }

  const clickedAndSolved = await tryClickTurnstileCheckbox(page);
  if (!clickedAndSolved) {
    console.log("  [CAPTCHA] Turnstile çözülemedi (token alınamadı).");
    return false;
  }

  const token = await waitForTurnstileToken(page, 9000);
  if (!token) {
    console.log("  [CAPTCHA] Turnstile token doğrulanamadı.");
    return false;
  }

  console.log("  [CAPTCHA] ✅ Token doğrulandı");
  return true;
}

async function _solve(page, context) {
  const { sitekey, action, cData, pageData } = context;
  if (!sitekey) return false;

  console.log(`  [CAPTCHA] Sitekey: ${sitekey.substring(0, 20)}...`);

  const pageurl = page.url();
  const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);
  const payload = { pageurl, sitekey };
  if (action) payload.action = action;
  if (cData) payload.data = cData;
  if (pageData) payload.pagedata = pageData;
  if (userAgent) payload.userAgent = userAgent;

  try {
    const token = await solveWithProvider(payload);

    if (!token) throw new Error("Token alınamadı");

    console.log("  [CAPTCHA] ✅ Çözüldü!");

    // Token'ı sayfaya enjekte et — Angular + Turnstile callback'leri dahil
    await page.evaluate((t) => {
      // 1) Tüm bilinen Turnstile input/textarea alanlarını doldur
      const selectors =
        'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name*="turnstile"], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]';
      let targets = Array.from(document.querySelectorAll(selectors));

      if (!targets.length) {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = "cf-turnstile-response";
        document.body.appendChild(hidden);
        targets = [hidden];
      }

      const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      const textareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

      for (const el of targets) {
        if (el.tagName === "TEXTAREA" && textareaSetter) textareaSetter.call(el, t);
        else if (inputSetter) inputSetter.call(el, t);
        else el.value = t;

        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        // Angular uyumluluğu
        el.dispatchEvent(new Event("ngModelChange", { bubbles: true }));
      }

      // 2) Turnstile global callback'leri tetikle
      if (typeof window.turnstileCallback === "function") window.turnstileCallback(t);
      if (typeof window.onTurnstileSuccess === "function") window.onTurnstileSuccess(t);
      
      // 3) Turnstile widget API'yi override et
      if (window.turnstile) {
        try {
          window.turnstile.getResponse = () => t;
          // Widget ID ile de callback tetikle
          if (typeof window.turnstile.execute === "function") {
            try { window.turnstile.execute(); } catch {}
          }
        } catch {}
      }

      // 4) cf-turnstile div'inin data-response attribute'unu da set et
      const cfDivs = document.querySelectorAll('.cf-turnstile, [data-sitekey]');
      for (const div of cfDivs) {
        div.setAttribute('data-response', t);
      }

      // 5) Tüm iframe'lerin parent container'ına token ekle
      const iframes = document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]');
      for (const iframe of iframes) {
        const container = iframe.closest('.cf-turnstile') || iframe.parentElement;
        if (container) {
          container.setAttribute('data-response', t);
          // Container altındaki hidden input'u da güncelle
          const hiddenInput = container.querySelector('input[type="hidden"]');
          if (hiddenInput) {
            if (inputSetter) inputSetter.call(hiddenInput, t);
            else hiddenInput.value = t;
            hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
            hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }

      // 6) Angular form validation tetikleme — submit butonunu aktif et
      try {
        const forms = document.querySelectorAll('form');
        for (const form of forms) {
          form.dispatchEvent(new Event('change', { bubbles: true }));
          form.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Angular zone tick
        if (window.ng && window.ng.getComponent) {
          const appRoot = document.querySelector('app-root') || document.querySelector('[ng-version]');
          if (appRoot) {
            const comp = window.ng.getComponent(appRoot);
            if (comp) {
              try { window.ng.applyChanges(comp); } catch {}
            }
          }
        }
      } catch {}
    }, token);

    await delay(1500, 3000);
    
    // Submit butonunun aktif olmasını bekle
    const btnActive = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const submitBtn = btns.find((b) => {
        const txt = (b.textContent || "").toLowerCase();
        return txt.includes("oturum") || txt.includes("sign in") || txt.includes("login") || 
               txt.includes("giriş") || txt.includes("devam") || txt.includes("continue");
      }) || document.querySelector('button[type="submit"]');
      if (submitBtn && (submitBtn.disabled || submitBtn.hasAttribute("disabled"))) {
        // Zorla aktif et
        submitBtn.disabled = false;
        submitBtn.removeAttribute("disabled");
        submitBtn.removeAttribute("aria-disabled");
        submitBtn.classList.remove("disabled");
        return "forced";
      }
      return submitBtn ? "active" : "not_found";
    });
    console.log(`  [CAPTCHA] Submit buton durumu: ${btnActive}`);

    const confirmedToken = await waitForTurnstileToken(page, 9000);
    return !!confirmedToken;
  } catch (err) {
    console.error("  [CAPTCHA] Hata:", err.message);
    return false;
  }
}

// ==================== APPLY FINGERPRINT ====================
async function applyFingerprint(page, fp) {
  try { await page.emulateTimezone(fp.timezone); } catch {}
  await page.setUserAgent(fp.userAgent);
  await page.setViewport(fp.viewport);
  await page.evaluateOnNewDocument((fp) => {
    // ===== ANTI-DETECTION: webdriver flag =====
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    // Chrome runtime mock (headless detection bypass)
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = { connect: () => {}, sendMessage: () => {}, id: "mhjfbmdgcfjbbpaeojofohoefgiehjai" };
    // Permissions API override
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === "notifications") {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery(parameters);
      };
    }
    // Plugin/MimeType mock (headless has 0 plugins)
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
        ];
        plugins.item = (i) => plugins[i];
        plugins.namedItem = (n) => plugins.find(p => p.name === n);
        plugins.refresh = () => {};
        return plugins;
      }
    });
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => {
        const mimes = [{ type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" }];
        mimes.item = (i) => mimes[i];
        mimes.namedItem = (n) => mimes.find(m => m.type === n);
        return mimes;
      }
    });

    Object.defineProperty(navigator, "platform", { get: () => fp.platform });
    Object.defineProperty(navigator, "languages", { get: () => fp.languages });
    Object.defineProperty(navigator, "language", { get: () => fp.languages[0] });
    Object.defineProperty(navigator, "deviceMemory", { get: () => fp.deviceMemory });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => fp.hardwareConcurrency });
    Object.defineProperty(screen, "colorDepth", { get: () => fp.screenDepth });
    Object.defineProperty(screen, "pixelDepth", { get: () => fp.screenDepth });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => fp.maxTouchPoints });
    const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return fp.webglVendor;
      if (param === 37446) return fp.webglRenderer;
      return getParameterOrig.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== "undefined") {
      const gp2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return fp.webglVendor;
        if (param === 37446) return fp.webglRenderer;
        return gp2.call(this, param);
      };
    }
    const toDataURLOrig = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      if (type === "image/png" || !type) {
        const ctx = this.getContext("2d");
        if (ctx) {
          const noise = Math.random() * 0.01;
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = Math.min(255, imageData.data[i] + Math.floor(noise * 255));
          }
          ctx.putImageData(imageData, 0, 0);
        }
      }
      return toDataURLOrig.call(this, type);
    };
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(channel) {
      const data = origGetChannelData.call(this, channel);
      if (data.length > 100) { for (let i = 0; i < Math.min(10, data.length); i++) data[i] += Math.random() * 0.0001; }
      return data;
    };
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, "effectiveType", { get: () => "4g" });
      Object.defineProperty(navigator.connection, "rtt", { get: () => Math.floor(Math.random() * 50 + 25) });
      Object.defineProperty(navigator.connection, "downlink", { get: () => Math.random() * 5 + 5 });
    }
    if (navigator.getBattery) {
      navigator.getBattery = () => Promise.resolve({
        charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
        addEventListener: () => {}, removeEventListener: () => {},
      });
    }
  }, fp);
  console.log(`  [FP] UA: ${fp.userAgent.substring(0, 50)}... | VP: ${fp.viewport.width}x${fp.viewport.height} | TZ: ${fp.timezone}`);
}

// ==================== BROWSER LAUNCH ====================
const path = require("path");
const fs = require("fs");
const os = require("os");

function createTempUserDataDir() {
  const dir = path.join(os.tmpdir(), `vfs-chrome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`  [BROWSER] 🧹 Temiz profil: ${dir}`);
  return dir;
}

function cleanupUserDataDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`  [BROWSER] 🗑 Profil temizlendi: ${dir}`);
    }
  } catch (e) {
    console.warn(`  [BROWSER] Profil temizleme hatası: ${e.message}`);
  }
}

function getResidentialProxyUrl() {
  let pass = `${EVOMI_PROXY_PASS}_country-${EVOMI_PROXY_COUNTRY}`;
  if (EVOMI_PROXY_REGION) pass += `_region-${EVOMI_PROXY_REGION}`;
  console.log(`  [PROXY] 🏠 Residential proxy: ${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT} (ülke: ${EVOMI_PROXY_COUNTRY}, bölge: ${EVOMI_PROXY_REGION || 'yok'})`);
  return {
    proxyUrl: `http://${EVOMI_PROXY_USER}:${pass}@${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`,
    user: EVOMI_PROXY_USER,
    pass,
    host: EVOMI_PROXY_HOST,
    port: EVOMI_PROXY_PORT,
  };
}

async function launchBrowser(proxyIp = null) {
  const { connect } = require("puppeteer-real-browser");
  console.log(`  [BROWSER] DISPLAY=${process.env.DISPLAY || "yok"}`);

  // Minimal args — sandbox flag'leri kaldırıldı (tespit riski)
  const args = [
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
    console.log(`  [BROWSER] 🏠 Residential proxy: ${rp.host}:${rp.port}`);
  } else if (proxyIp) {
    const proxyPort = 10800 + IP_LIST.indexOf(proxyIp);
    args.push(`--proxy-server=socks5://127.0.0.1:${proxyPort}`);
    console.log(`  [BROWSER] 🌐 Proxy: socks5://127.0.0.1:${proxyPort} (IP: ${proxyIp})`);
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
  
  const proxyInfo = PROXY_MODE === "residential" 
    ? "(residential proxy)" 
    : (proxyIp ? `(IP: ${proxyIp})` : "(proxy yok)");
  console.log(`  [BROWSER] ✅ Tarayıcı başlatıldı ${proxyInfo}`);
  return { browser, page };
}

// ==================== MAIN CHECK ====================
async function checkAppointments(config, account) {
  const { id, country, city } = config;
  const ts = new Date().toLocaleTimeString("tr-TR");
  // Her kontrolde sıradaki IP'yi kullan (datacenter) veya residential proxy
  const activeIp = (PROXY_MODE !== "residential" && IP_LIST.length > 0) ? getNextIp() : null;
  const countryLabels = { france: "Fransa", netherlands: "Hollanda", denmark: "Danimarka" };
  const countryLabel = countryLabels[country] || country;
  const proxyLabel = PROXY_MODE === "residential" ? "residential proxy" : (activeIp || "doğrudan");
  console.log(`\n[${ts}] Kontrol: ${countryLabel} ${city} | Hesap: ${account.email} | ${proxyLabel}`);
  await logStep(id, "bot_start", `Kontrol başlıyor | ${account.email} | Ülke: ${countryLabel} | ${proxyLabel}`);

  let browser;
  try {
    const fp = generateFingerprint();
    const { browser: br, page } = await launchBrowser(activeIp);
    browser = br;
    await applyFingerprint(page, fp);
    await humanMove(page);

    // Gerçek IP'yi kontrol et ve logla
    let realIp = "bilinmiyor";
    try {
      const ipPage = await browser.newPage();
      await ipPage.goto("https://ip.evomi.com/s", { waitUntil: "networkidle2", timeout: 10000 });
      realIp = (await ipPage.evaluate(() => document.body.innerText)).trim();
      await ipPage.close();
    } catch (e) { console.warn("  [IP] IP kontrolü başarısız:", e.message); }
    console.log(`  [IP] 🌐 Gerçek IP: ${realIp}`);
    await logStep(id, "ip_change", `Aktif IP: ${realIp} | Hesap: ${account.email} | Ülke: ${countryLabel}`);

    // STEP 1: Giriş sayfası
    console.log("  [1/6] Giriş sayfası...");
    await logStep(id, "login_navigate", "VFS giriş sayfası açılıyor...");
    const vfsLoginUrl = getVfsLoginUrl(country);
    console.log(`  [1/6] URL: ${vfsLoginUrl}`);
    await page.goto(vfsLoginUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await humanIdle(4000, 8000); // Sayfa yüklendikten sonra okuyormuş gibi bekle
    await humanMove(page);
    
    // IP engel kontrolü
    const pageContent = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    const pageHtml = await page.evaluate(() => document.documentElement?.outerHTML || "").catch(() => "");
    if (isPageBlocked(pageContent) || pageHtml.trim().length < 500) {
      console.log(`  [IP] 🚫 Sayfa yüklenemedi / engellendi! IP: ${activeIp}`);
      banIpImmediately(activeIp, "login_page_blocked_or_empty");
      const ss = await takeScreenshotBase64(page);
      await logStep(id, "network_error", `IP engellendi: ${activeIp || "doğrudan"}`);
      await reportResult(id, "error", `IP engellendi: ${activeIp || "doğrudan"} | Hesap: ${account.email}`, 0, ss);
      return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
    }
    markIpSuccess(activeIp);
    await humanScroll(page);
    await humanMove(page);

    // STEP 2: Cookie banner
    await logStep(id, "page_load", "Sayfa yüklendi, cookie banner kontrol ediliyor...");
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
        await delay(500, 1500);
        await cookieBtn.asElement().click();
        console.log("  [2/6] ✅ Cookie kabul edildi.");
        await delay(1000, 2000);
      }
    } catch (e) {}

    // STEP 3: CAPTCHA + Queue
    console.log("  [3/6] CAPTCHA + sıra kontrol...");
    await logStep(id, "login_captcha", "CAPTCHA çözülüyor ve sıra kontrol ediliyor...");
    await humanMove(page);
    await solveTurnstile(page);
    await delay(1000, 2000);
    const queueResult = await waitForLoginFormAfterQueue(page);
    if (!queueResult.ok) {
      banIpImmediately(activeIp, "queue_or_login_form_timeout");
      const ss = await takeScreenshotBase64(page);
      await reportResult(id, "error", `${queueResult.reason} | Hesap: ${account.email}`, 0, ss);
      return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
    }

    // STEP 4: Login
    console.log("  [4/6] Giriş yapılıyor...");
    await logStep(id, "login_form", `Giriş bilgileri dolduruluyor | ${account.email}`);
    try {
      await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 20000 });
      await humanMove(page);
      await delay(500, 1500);

      await humanType(page, 'input[type="email"], input[name="email"], #email', account.email, {
        clearFirst: true,
        minDelay: 40,
        maxDelay: 140,
      });

      await delay(400, 900);
      await humanType(page, 'input[type="password"]', account.password, {
        clearFirst: true,
        minDelay: 40,
        maxDelay: 140,
      });

      await delay(600, 1200);
      await humanMove(page);

      // Login ekranındaki Turnstile çözümü (kuyruktan ayrı doğrulama gerekiyor)
      let token = await ensureLoginTurnstileToken(page, 4);
      const initialDiag = await getTurnstileDiagnostics(page);
      const initialDiagText = formatTurnstileDiagnostics(initialDiag);

      if (token) {
        console.log(`  [4/6] ✅ Login Turnstile token alındı | ${initialDiagText}`);
      } else {
        console.log(`  [4/6] ❌ Login Turnstile token alınamadı | ${initialDiagText}`);
        await logStep(id, "login_captcha_debug", `İlk token alınamadı | ${account.email} | ${initialDiagText}`);
        banIpImmediately(activeIp, "login_turnstile_token_missing_initial");
        const ss = await takeScreenshotBase64(page);
        await reportResult(id, "error", `❌ Turnstile token alınamadı (ilk deneme) | Hesap: ${account.email} | IP: ${activeIp || "doğrudan"}`, 0, ss);
        return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
      }

      let submitAttempt = await submitLoginForm(page);

      if (!submitAttempt.clicked) {
        console.log("  [4/6] ⚠ Submit butonu bulunamadı, Enter ile denenecek");
        await page.keyboard.press("Enter");
      } else if (submitAttempt.disabled) {
        console.log("  [4/6] ⚠ Submit disabled geldi, force submit denendi");
      }

      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
      await delay(3000, 5000);

      // İlk submit sonrası captcha validasyon hatasında tekrar çöz + submit dene
      for (let captchaRetry = 1; captchaRetry <= 3; captchaRetry++) {
        const loginCaptchaState = await getLoginCaptchaState(page);
        if (
          loginCaptchaState.isLoginPage &&
          loginCaptchaState.hasLoginForm &&
          loginCaptchaState.hasTurnstileWidget &&
          (!loginCaptchaState.hasCaptchaToken || loginCaptchaState.hasCaptchaError)
        ) {
          const retryPreDiag = await getTurnstileDiagnostics(page);
          const retryPreDiagText = formatTurnstileDiagnostics(retryPreDiag);
          console.log(`  [4/6] 🔁 CAPTCHA retry ${captchaRetry}/3... | ${retryPreDiagText}`);
          await logStep(id, "login_captcha_retry", `CAPTCHA tekrar çözülüyor (${captchaRetry}/3) | ${account.email}`);
          await logStep(id, "login_captcha_debug", `Retry ${captchaRetry} öncesi | ${account.email} | ${retryPreDiagText}`);

          // Sayfayı yenile ve formu tekrar doldur
          if (captchaRetry >= 2) {
            console.log("  [4/6] 🔄 Sayfa yenileniyor (temiz CAPTCHA için)...");
            await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
            await humanIdle(3000, 5000);
            // Cookie banner kapat
            try {
              const cookieBtn = await page.$('#onetrust-accept-btn-handler');
              if (cookieBtn) { await cookieBtn.click(); await delay(1000, 2000); }
            } catch {}
            // Formu tekrar doldur
            await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 15000 }).catch(() => {});
            await humanType(page, 'input[type="email"], input[name="email"], #email', account.email, { clearFirst: true, minDelay: 40, maxDelay: 140 });
            await delay(400, 900);
            await humanType(page, 'input[type="password"]', account.password, { clearFirst: true, minDelay: 40, maxDelay: 140 });
            await delay(600, 1200);
          }

          token = await ensureLoginTurnstileToken(page, 4);
          const retryPostDiag = await getTurnstileDiagnostics(page);
          const retryPostDiagText = formatTurnstileDiagnostics(retryPostDiag);

          if (token) {
            console.log(`  [4/6] ✅ Retry ${captchaRetry} Turnstile token alındı | ${retryPostDiagText}`);
            await logStep(id, "login_captcha_debug", `Retry ${captchaRetry} token alındı | ${account.email} | ${retryPostDiagText}`);
            submitAttempt = await submitLoginForm(page);
            if (!submitAttempt.clicked) {
              await page.keyboard.press("Enter");
            }
            await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
            await delay(2500, 4000);
          } else {
            console.log(`  [4/6] ❌ Retry ${captchaRetry} token alınamadı | ${retryPostDiagText}`);
            await logStep(id, "login_captcha_debug", `Retry ${captchaRetry} token yok | ${account.email} | ${retryPostDiagText}`);
            banIpImmediately(activeIp, `login_turnstile_token_missing_retry_${captchaRetry}`);
            const ss = await takeScreenshotBase64(page);
            await reportResult(id, "error", `❌ Turnstile token alınamadı (retry ${captchaRetry}) | Hesap: ${account.email} | IP: ${activeIp || "doğrudan"}`, 0, ss);
            return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
          }
        } else {
          break; // Token var veya login sayfasından çıkmış
        }
      }
    } catch (loginErr) {
      console.log("  [4/6] ⚠ Giriş formu hatası:", loginErr.message);
    }

    // STEP 5: OTP
    console.log("  [5/6] OTP kontrol...");
    await logStep(id, "login_otp", "OTP doğrulama kontrol ediliyor...");
    const otpResult = await handleOtpVerification(page, account);
    if (!otpResult.ok && otpResult.reason === "otp_required") {
      console.log("  [5/6] ❌ OTP doğrulama gerekli");
      await logStep(id, "login_fail", `OTP doğrulama gerekli | ${account.email}`);
      await reportResult(id, "error", `OTP doğrulama gerekli | Hesap: ${account.email}`, 0, otpResult.screenshot);
      await updateAccountStatus(account.id, "cooldown", (account.fail_count || 0) + 1);
      return { found: false, accountBanned: false, otpRequired: true, hadError: true };
    }

    // Login doğrulama
    const pageCheck = await page.evaluate(() => {
      const body = (document.body?.innerText || "").toLowerCase();
      const url = window.location.href.toLowerCase();
      const loginBtn = Array.from(document.querySelectorAll("button")).find((b) => {
        const txt = (b.textContent || "").toLowerCase();
        return txt.includes("oturum") || txt.includes("sign in") || txt.includes("login") || txt.includes("giriş");
      }) || document.querySelector('button[type="submit"]');

      const fields = Array.from(
        document.querySelectorAll(
          'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name*="turnstile"], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]'
        )
      );
      const hasCaptchaTokenFromField = fields.some((el) => String(el.value || "").trim().length > 20);

      let hasCaptchaTokenFromApi = false;
      try {
        if (window.turnstile && typeof window.turnstile.getResponse === "function") {
          const response = window.turnstile.getResponse();
          hasCaptchaTokenFromApi = typeof response === "string" && response.trim().length > 20;
        }
      } catch {}

      return {
        url,
        isNotFound: url.includes("page-not-found") || url.includes("404"),
        isSessionExpired: body.includes("oturum süresi doldu") || body.includes("oturum süresi dolmuş") || body.includes("session expired") || body.includes("oturumunuzun süresi") || (body.includes("oturum") && body.includes("geçersiz")),
        isBanned: body.includes("engellenmiş") || body.includes("blocked") || body.includes("banned"),
        isWaitingRoom: (document.title || "").toLowerCase().includes("waiting room"),
        isLoginPage: url.includes("/login"),
        isDashboard: url.includes("/dashboard") || url.includes("/appointment"),
        hasLoginForm: !!document.querySelector('input[type="email"], input[name="email"], #email'),
        hasTurnstileWidget: !!document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [name*="turnstile"]'),
        hasCaptchaToken: hasCaptchaTokenFromField || hasCaptchaTokenFromApi,
        hasCaptchaError:
          body.includes("verify you are human") ||
          body.includes("zorunlu alan boş bırakılamaz") ||
          body.includes("robot olmadığınızı") ||
          body.includes("captcha") ||
          body.includes("doğrulama"),
        loginSubmitDisabled: !!loginBtn && (loginBtn.disabled || loginBtn.hasAttribute("disabled") || loginBtn.getAttribute("aria-disabled") === "true"),
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
      else if (pageCheck.hasTurnstileWidget && !pageCheck.hasCaptchaToken && pageCheck.hasCaptchaError) errorType = "❌ Turnstile doğrulanmadı (captcha token yok)";
      else if (pageCheck.hasTurnstileWidget && pageCheck.loginSubmitDisabled) errorType = "❌ Turnstile doğrulanmadı (submit pasif)";
      else if (isLoginFailed) errorType = "❌ Giriş başarısız";

      // Session expired veya Turnstile hatalarında IP'yi anında banla — sıradaki IP + temiz profil ile yeniden başlasın
      if (pageCheck.isSessionExpired || errorType.includes("Turnstile") || pageCheck.isWaitingRoom) {
        banIpImmediately(activeIp, "post_login_session_or_turnstile_error");
      }

      const finalDiag = await getTurnstileDiagnostics(page).catch(() => null);
      const finalDiagText = formatTurnstileDiagnostics(finalDiag);
      await logStep(id, "login_captcha_debug", `Login sonrası kontrol | ${account.email} | ${finalDiagText}`);

      console.log(`  [5/6] ${errorType} | Hesap: ${account.email} | ${finalDiagText}`);
      const ss = await takeScreenshotBase64(page);
      await reportResult(id, "error", `${errorType} | Hesap: ${account.email}`, 0, ss);
      if (isBanned) { await updateAccountStatus(account.id, "banned"); return { found: false, accountBanned: true, hadError: true }; }
      
      // Session/Turnstile/waiting-room durumunda hemen sonraki IP ile devam et
      if (pageCheck.isSessionExpired || errorType.includes("Turnstile") || pageCheck.isWaitingRoom) {
        return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
      }
      
      const newFailCount = (account.fail_count || 0) + 1;
      if (newFailCount >= 3) { await updateAccountStatus(account.id, "cooldown", newFailCount); }
      else { await updateAccountStatus(account.id, "active", newFailCount); }
      return { found: false, accountBanned: false, hadError: true };
    }

    console.log("  [5/6] ✅ Giriş başarılı!");
    await logStep(id, "login_success", `Giriş başarılı! | ${account.email}`);
    await updateAccountStatus(account.id, "active", 0);

    // STEP 6: Randevu kontrol + otomatik alma
    console.log("  [6/6] Randevu kontrol + booking...");
    await logStep(id, "search_start", "Dashboard yüklendi, randevu aranıyor...");
    await delay(2000, 4000);
    await humanMove(page);

    // 6a: "New Booking" / "Start New Booking" butonuna tıkla
    try {
      await logStep(id, "appt_navigate", "Randevu sayfasına yönlendiriliyor...");
      const bookBtn = await page.evaluateHandle(() => {
        const links = [...document.querySelectorAll("a, button")];
        return links.find((el) => {
          const txt = (el.textContent || "").toLowerCase();
          return txt.includes("new booking") || txt.includes("yeni başvuru") || txt.includes("start new") || txt.includes("randevu") || txt.includes("book appointment");
        }) || null;
      });
      if (bookBtn && bookBtn.asElement()) {
        await delay(500, 1500);
        await bookBtn.asElement().click();
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
        await delay(3000, 5000);
        await solveTurnstile(page);
        await delay(2000, 3000);
      }
    } catch (navErr) {
      console.log("  [6/6] ⚠ Booking navigasyon hatası:", navErr.message);
    }

    // 6b: Kategori ve alt kategori seçimi
    const visaCat = config.visa_category || "";
    const visaSubCat = config.visa_subcategory || "";
    if (visaCat) {
      await logStep(id, "appt_category", `Kategori seçiliyor: ${visaCat} ${visaSubCat ? "/ " + visaSubCat : ""}`);
      await delay(1000, 2000);
      
      // Kategori dropdown'ı bul ve seç
      const catSelected = await page.evaluate((category) => {
        // Angular mat-select veya standart select
        const selects = Array.from(document.querySelectorAll('select, mat-select, [role="listbox"]'));
        for (const sel of selects) {
          if (sel.tagName === 'SELECT') {
            const options = Array.from(sel.querySelectorAll('option'));
            const match = options.find(opt => {
              const txt = (opt.textContent || "").toLowerCase();
              return txt.includes(category.toLowerCase());
            });
            if (match) {
              sel.value = match.value;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
              sel.dispatchEvent(new Event("input", { bubbles: true }));
              return { ok: true, method: "select", value: match.textContent };
            }
          }
        }
        
        // Angular mat-select: tıkla ve option seç
        const matSelects = Array.from(document.querySelectorAll('mat-select, .mat-mdc-select, [formcontrolname]'));
        for (const ms of matSelects) {
          const label = ms.closest('.mat-mdc-form-field, mat-form-field, .form-group')?.querySelector('label, mat-label, .mat-mdc-floating-label');
          const labelText = (label?.textContent || "").toLowerCase();
          if (labelText.includes("categor") || labelText.includes("kategori") || labelText.includes("visa type") || labelText.includes("vize")) {
            ms.click();
            return { ok: false, method: "mat-select-clicked", detail: labelText };
          }
        }
        return { ok: false, method: "not_found" };
      }, visaCat);
      
      console.log(`  [6/6] Kategori seçim sonucu:`, JSON.stringify(catSelected));
      
      if (catSelected && !catSelected.ok && catSelected.method === "mat-select-clicked") {
        // Angular mat-select açıldı, option'ı seç
        await delay(800, 1500);
        await page.evaluate((category) => {
          const options = Array.from(document.querySelectorAll('mat-option, .mat-mdc-option, [role="option"]'));
          const match = options.find(opt => {
            const txt = (opt.textContent || "").toLowerCase();
            return txt.includes(category.toLowerCase());
          });
          if (match) match.click();
        }, visaCat);
        await delay(1000, 2000);
      }
      
      // Alt kategori seçimi
      if (visaSubCat) {
        await delay(1500, 3000);
        const subSelected = await page.evaluate((subCategory) => {
          const selects = Array.from(document.querySelectorAll('select'));
          for (const sel of selects) {
            const options = Array.from(sel.querySelectorAll('option'));
            const match = options.find(opt => {
              const txt = (opt.textContent || "").toLowerCase();
              return txt.includes(subCategory.toLowerCase());
            });
            if (match) {
              sel.value = match.value;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
              sel.dispatchEvent(new Event("input", { bubbles: true }));
              return { ok: true };
            }
          }
          // Angular mat-select for subcategory
          const matSelects = Array.from(document.querySelectorAll('mat-select, .mat-mdc-select'));
          for (const ms of matSelects) {
            const label = ms.closest('.mat-mdc-form-field, mat-form-field, .form-group')?.querySelector('label, mat-label');
            const labelText = (label?.textContent || "").toLowerCase();
            if (labelText.includes("sub") || labelText.includes("alt")) {
              ms.click();
              return { ok: false, method: "mat-select-clicked" };
            }
          }
          return { ok: false };
        }, visaSubCat);
        
        if (subSelected && !subSelected.ok && subSelected.method === "mat-select-clicked") {
          await delay(800, 1500);
          await page.evaluate((sub) => {
            const options = Array.from(document.querySelectorAll('mat-option, .mat-mdc-option, [role="option"]'));
            const match = options.find(opt => (opt.textContent || "").toLowerCase().includes(sub.toLowerCase()));
            if (match) match.click();
          }, visaSubCat);
          await delay(1000, 2000);
        }
      }
    }

    // 6c: Merkez (şehir) seçimi
    if (city) {
      await logStep(id, "appt_centre", `Merkez seçiliyor: ${city}`);
      await delay(1000, 2000);
      await page.evaluate((cityName) => {
        const selects = Array.from(document.querySelectorAll('select'));
        for (const sel of selects) {
          const options = Array.from(sel.querySelectorAll('option'));
          const match = options.find(opt => {
            const txt = (opt.textContent || "").toLowerCase();
            return txt.includes(cityName.toLowerCase());
          });
          if (match) {
            sel.value = match.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            sel.dispatchEvent(new Event("input", { bubbles: true }));
            return;
          }
        }
        // Angular mat-select
        const matSelects = Array.from(document.querySelectorAll('mat-select, .mat-mdc-select'));
        for (const ms of matSelects) {
          const label = ms.closest('.mat-mdc-form-field, mat-form-field, .form-group')?.querySelector('label, mat-label');
          const labelText = (label?.textContent || "").toLowerCase();
          if (labelText.includes("centre") || labelText.includes("merkez") || labelText.includes("location") || labelText.includes("office")) {
            ms.click();
          }
        }
      }, city);
      await delay(800, 1500);
      // Angular option seçimi
      await page.evaluate((cityName) => {
        const options = Array.from(document.querySelectorAll('mat-option, .mat-mdc-option, [role="option"]'));
        const match = options.find(opt => (opt.textContent || "").toLowerCase().includes(cityName.toLowerCase()));
        if (match) match.click();
      }, city);
      await delay(1500, 3000);
    }

    // 6d: Continue / Devam butonuna tıkla
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      const continueBtn = btns.find(b => {
        const txt = (b.textContent || "").toLowerCase();
        return txt.includes("continue") || txt.includes("devam") || txt.includes("search") || txt.includes("ara") || txt.includes("submit") || txt.includes("gönder");
      });
      if (continueBtn) continueBtn.click();
    });
    await delay(3000, 6000);
    await solveTurnstile(page);
    await delay(2000, 4000);

    // 6e: Takvim / slot kontrol
    await logStep(id, "appt_calendar", "Müsait tarihler kontrol ediliyor...");
    const bodyText = await page.evaluate(() => document.body.innerText);
    const lowerText = bodyText.toLowerCase();
    const noAppointmentPhrases = ["no appointment", "no available", "currently no date", "randevu bulunmamaktadır", "müsait randevu yok", "no open schedule", "fully booked", "no slot", "appointment is not available", "no dates available", "no timeslot available"];
    const appointmentFoundPhrases = ["select date", "available slot", "tarih seçin", "available appointment", "open slot", "choose a date", "select a time", "appointment available", "lütfen bir tarih seçin"];
    const noAppointment = noAppointmentPhrases.some((p) => lowerText.includes(p));
    const hasAppointment = appointmentFoundPhrases.some((p) => lowerText.includes(p));
    const ss = await takeScreenshotBase64(page);

    if (hasAppointment && !noAppointment) {
      console.log("  ✅ RANDEVU BULUNDU! Otomatik alma başlıyor...");
      await logStep(id, "found", `🎉 RANDEVU BULUNDU! | ${account.email}`);
      await reportResult(id, "found", `Randevu müsait! Hesap: ${account.email}`, 1, ss);

      // ========== OTOMATİK RANDEVU ALMA ==========
      try {
        // 6f: İlk müsait tarihi seç
        await logStep(id, "appt_date", "İlk müsait tarih seçiliyor...");
        const dateSelected = await page.evaluate(() => {
          // Takvimde aktif/seçilebilir günleri bul
          const availableDays = Array.from(document.querySelectorAll(
            '.mat-calendar-body-cell:not(.mat-calendar-body-disabled), ' +
            '.available-date, ' +
            'td.day:not(.disabled), ' +
            '.datepicker-day:not(.disabled), ' +
            'button.day:not([disabled]), ' +
            '[class*="available"]:not([class*="unavailable"]), ' +
            '.calendar-day.active, ' +
            '.slot-available'
          ));
          
          if (availableDays.length > 0) {
            availableDays[0].click();
            return { ok: true, count: availableDays.length, text: (availableDays[0].textContent || "").trim() };
          }
          
          // Fallback: Takvim hücrelerinde renk/class bazlı seçim
          const allCells = Array.from(document.querySelectorAll('td, .calendar-cell, button'));
          const greenCell = allCells.find(cell => {
            const style = window.getComputedStyle(cell);
            const bg = style.backgroundColor;
            const cls = cell.className || "";
            return (bg.includes("rgb(76, 175, 80)") || bg.includes("rgb(0, 128, 0)") || cls.includes("available") || cls.includes("open")) && !cls.includes("disabled");
          });
          if (greenCell) {
            greenCell.click();
            return { ok: true, method: "color", text: (greenCell.textContent || "").trim() };
          }
          
          return { ok: false };
        });
        
        console.log(`  [6/6] Tarih seçim sonucu:`, JSON.stringify(dateSelected));
        
        if (dateSelected.ok) {
          await delay(2000, 4000);
          
          // 6g: Saat dilimi seç
          await logStep(id, "appt_time", "Saat dilimi seçiliyor...");
          const timeSelected = await page.evaluate(() => {
            // Saat slotlarını bul
            const timeSlots = Array.from(document.querySelectorAll(
              '.time-slot:not(.disabled), ' +
              '[class*="timeslot"]:not([class*="disabled"]), ' +
              'input[type="radio"][name*="time"], ' +
              'mat-radio-button, ' +
              '.slot-time, ' +
              'button[class*="time"]:not([disabled])'
            ));
            
            if (timeSlots.length > 0) {
              timeSlots[0].click();
              return { ok: true, count: timeSlots.length, text: (timeSlots[0].textContent || "").trim() };
            }
            
            // Fallback: Select dropdown for time
            const selects = Array.from(document.querySelectorAll('select'));
            for (const sel of selects) {
              const label = sel.closest('.form-group, .mat-mdc-form-field')?.querySelector('label');
              const labelText = (label?.textContent || "").toLowerCase();
              if (labelText.includes("time") || labelText.includes("saat") || labelText.includes("slot")) {
                const options = Array.from(sel.querySelectorAll('option'));
                const available = options.find(opt => opt.value && !opt.disabled && opt.value !== "");
                if (available) {
                  sel.value = available.value;
                  sel.dispatchEvent(new Event("change", { bubbles: true }));
                  return { ok: true, method: "select", text: available.textContent };
                }
              }
            }
            
            return { ok: false };
          });
          
          console.log(`  [6/6] Saat seçim sonucu:`, JSON.stringify(timeSelected));
          await delay(1500, 3000);
          
          // 6h: Başvuran bilgilerini doldur
          const applicants = config.applicants || [];
          if (applicants.length > 0) {
            await logStep(id, "appt_fill", `${applicants.length} kişi bilgileri dolduruluyor...`);
            
            for (let i = 0; i < applicants.length; i++) {
              const app = applicants[i];
              await delay(500, 1000);
              
              // İsim alanları
              if (app.first_name) {
                await page.evaluate((name, index) => {
                  const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
                  const firstNameInput = inputs.find(inp => {
                    const n = (inp.name || inp.id || inp.placeholder || "").toLowerCase();
                    return n.includes("first") || n.includes("name") || n.includes("ad");
                  });
                  if (firstNameInput) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                    if (setter) setter.call(firstNameInput, name);
                    else firstNameInput.value = name;
                    firstNameInput.dispatchEvent(new Event("input", { bubbles: true }));
                    firstNameInput.dispatchEvent(new Event("change", { bubbles: true }));
                  }
                }, app.first_name, i);
              }
              
              if (app.last_name) {
                await page.evaluate((name) => {
                  const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
                  const lastNameInput = inputs.find(inp => {
                    const n = (inp.name || inp.id || inp.placeholder || "").toLowerCase();
                    return n.includes("last") || n.includes("surname") || n.includes("soyad");
                  });
                  if (lastNameInput) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                    if (setter) setter.call(lastNameInput, name);
                    else lastNameInput.value = name;
                    lastNameInput.dispatchEvent(new Event("input", { bubbles: true }));
                    lastNameInput.dispatchEvent(new Event("change", { bubbles: true }));
                  }
                }, app.last_name);
              }
            }
            await delay(1000, 2000);
          }
          
          // 6i: Continue / Submit butonuna tıkla
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            const submitBtn = btns.find(b => {
              const txt = (b.textContent || "").toLowerCase();
              return txt.includes("continue") || txt.includes("devam") || txt.includes("submit") || txt.includes("confirm") || txt.includes("onayla") || txt.includes("book") || txt.includes("reserve");
            });
            if (submitBtn) {
              if (submitBtn.disabled) {
                submitBtn.disabled = false;
                submitBtn.removeAttribute("disabled");
              }
              submitBtn.click();
            }
          });
          await delay(3000, 6000);
          await solveTurnstile(page);
          await delay(2000, 4000);
          
          // 6j: Onay sayfası — son onay butonu
          const confirmResult = await page.evaluate(() => {
            const body = (document.body?.innerText || "").toLowerCase();
            const btns = Array.from(document.querySelectorAll("button"));
            const confirmBtn = btns.find(b => {
              const txt = (b.textContent || "").toLowerCase();
              return txt.includes("confirm") || txt.includes("onayla") || txt.includes("complete") || txt.includes("tamamla") || txt.includes("pay") || txt.includes("book now");
            });
            if (confirmBtn) {
              if (confirmBtn.disabled) {
                confirmBtn.disabled = false;
                confirmBtn.removeAttribute("disabled");
              }
              confirmBtn.click();
              return { clicked: true, text: confirmBtn.textContent };
            }
            const isAlreadyConfirmed = body.includes("confirmed") || body.includes("onaylandı") || body.includes("booked") || body.includes("appointment has been") || body.includes("randevunuz");
            return { clicked: false, confirmed: isAlreadyConfirmed };
          });
          
          console.log(`  [6/6] Onay sonucu:`, JSON.stringify(confirmResult));
          await delay(3000, 6000);
          
          // 6k: Sonuç kontrol
          const finalSs = await takeScreenshotBase64(page);
          const finalBody = await page.evaluate(() => (document.body?.innerText || "").toLowerCase());
          const bookingSuccess = finalBody.includes("confirmed") || finalBody.includes("onaylandı") || 
                                 finalBody.includes("booked") || finalBody.includes("appointment has been") ||
                                 finalBody.includes("randevunuz alındı") || finalBody.includes("başarılı") ||
                                 finalBody.includes("reference number") || finalBody.includes("referans numarası");
          
          if (bookingSuccess) {
            console.log("  🎉✅ RANDEVU BAŞARIYLA ALINDI!");
            await logStep(id, "appt_confirm", `✅ RANDEVU ALINDI! | ${account.email}`);
            await reportResult(id, "found", `✅ RANDEVU ALINDI! | Hesap: ${account.email}`, 1, finalSs);
          } else {
            console.log("  ⚠ Randevu bulundu ama otomatik alma sonucu belirsiz");
            await logStep(id, "appt_fail", `Randevu bulundu ama otomatik alma başarısız olabilir | ${account.email}`);
            await reportResult(id, "found", `🎉 Randevu bulundu! Otomatik alma sonucu belirsiz | Hesap: ${account.email}`, 1, finalSs);
          }
        } else {
          console.log("  ⚠ Tarih seçilemedi, sadece bildirim gönderildi");
          await logStep(id, "appt_fail", `Tarih seçilemedi — manuel müdahale gerekebilir | ${account.email}`);
        }
      } catch (bookErr) {
        console.error("  [BOOKING] Otomatik alma hatası:", bookErr.message);
        await logStep(id, "appt_fail", `Booking hatası: ${bookErr.message} | ${account.email}`);
        const errSs = await takeScreenshotBase64(page);
        await reportResult(id, "found", `🎉 Randevu bulundu ama otomatik alma başarısız: ${bookErr.message} | Hesap: ${account.email}`, 1, errSs);
      }

      return { found: true, accountBanned: false, hadError: false };
    } else {
      console.log("  ❌ Randevu yok.");
      await logStep(id, "no_slots", `Müsait randevu yok | ${account.email}`);
      const msg = noAppointment ? "Müsait randevu yok." : "Dashboard yüklendi, randevu yok.";
      await reportResult(id, "checking", `${msg} | Hesap: ${account.email}`, 0, ss);
      return { found: false, accountBanned: false, hadError: false };
    }
  } catch (err) {
    console.error("  [!] Genel hata:", err.message);
    await reportResult(id, "error", `Bot hatası: ${err.message} | Hesap: ${account.email}`);
    return { found: false, accountBanned: false, hadError: true };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// ==================== REGISTRATION ====================
async function fetchPendingRegistrations() {
  try {
    const data = await apiPost({ action: "get_pending_registrations" }, "get_pending_registrations");
    return data.ok ? (data.accounts || []) : [];
  } catch (err) {
    console.error("  [REG] Kayıt listesi hatası:", err.message);
    return [];
  }
}

async function setRegistrationOtpNeeded(accountId, otpType) {
  try {
    await apiPost(
      { action: "set_registration_otp_needed", account_id: accountId, otp_type: otpType },
      "set_registration_otp_needed"
    );
    console.log(`  [REG] 📱 ${otpType.toUpperCase()} doğrulama kodu bekleniyor`);
  } catch (err) {
    console.error("  [REG] OTP istek hatası:", err.message);
  }
}

async function getRegistrationOtp(accountId) {
  try {
    const data = await apiPost({ action: "get_registration_otp", account_id: accountId }, "get_registration_otp");
    return data.registration_otp || null;
  } catch (err) {
    console.error("  [REG] OTP okuma hatası:", err.message);
    return null;
  }
}

async function completeRegistration(accountId, success) {
  try {
    await apiPost({ action: "complete_registration", account_id: accountId, success }, "complete_registration");
    console.log(`  [REG] Kayıt ${success ? "✅ başarılı" : "❌ başarısız"}`);
  } catch (err) {
    console.error("  [REG] Kayıt sonuç hatası:", err.message);
  }
}

async function waitForRegistrationOtp(accountId, otpType, timeoutMs = 180000) {
  await setRegistrationOtpNeeded(accountId, otpType);
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const otp = await getRegistrationOtp(accountId);
    if (otp) { console.log(`  [REG] ✅ ${otpType} OTP alındı`); return otp; }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [REG] ${otpType} OTP bekleniyor... ${elapsed}s/${Math.round(timeoutMs / 1000)}s`);
    await delay(5000, 6000);
  }
  console.log(`  [REG] ❌ ${otpType} OTP zaman aşımı`);
  return null;
}

async function signalCaptchaWaiting(accountId) {
  try {
    await supabase.from("vfs_accounts").update({
      captcha_waiting_at: new Date().toISOString(),
      captcha_manual_approved: false,
    }).eq("id", accountId);
    console.log("  [REG] 🛑 CAPTCHA bekleme sinyali gönderildi — dashboard'dan onay bekleniyor");
  } catch (e) {
    console.warn("  [REG] captcha_waiting_at set hatası:", e.message);
  }
}

async function clearCaptchaWaiting(accountId) {
  try {
    await supabase.from("vfs_accounts").update({
      captcha_waiting_at: null,
      captcha_manual_approved: false,
    }).eq("id", accountId);
  } catch (e) {}
}

async function waitForCaptchaManualApproval(accountId, timeoutMs = 120000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const { data } = await supabase
      .from("vfs_accounts")
      .select("captcha_manual_approved")
      .eq("id", accountId)
      .single();
    if (data?.captcha_manual_approved) {
      console.log("  [REG] ✅ Dashboard'dan manuel devralma onayı alındı!");
      return true;
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [REG] Manuel onay bekleniyor... ${elapsed}s/${Math.round(timeoutMs / 1000)}s`);
    await delay(4000, 5000);
  }
  console.log("  [REG] ❌ Manuel onay zaman aşımı");
  return false;
}

function normalizePhoneNumber(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  let mobileNumber = digits;
  if (mobileNumber.startsWith("90") && mobileNumber.length > 10) mobileNumber = mobileNumber.slice(2);
  if (mobileNumber.startsWith("0")) mobileNumber = mobileNumber.slice(1);
  if (mobileNumber.length > 10) mobileNumber = mobileNumber.slice(-10);
  return { dialCode: "90", mobileNumber };
}

async function selectTurkeyDialCode(page) {
  // Önce zaten 90 seçili mi kontrol et
  try {
    const alreadySelected = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const s of selects) {
        const selected = s.options[s.selectedIndex];
        if (selected) {
          const txt = (selected.textContent || '').trim();
          const val = (selected.value || '').trim();
          if (txt.includes('90') || val === '90' || val === '+90') return 'already:' + txt;
        }
      }
      return null;
    });
    if (alreadySelected) { console.log(`  [REG] ✅ Dial code zaten 90 (${alreadySelected})`); return true; }
  } catch {}

  for (let attempt = 1; attempt <= 6; attempt++) {
    const result = await page.evaluate((attemptNo) => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const isTurkey = (txt) => /turkey|türkiye|turkiye|\(90\)|\+90|(^|\D)90(\D|$)/i.test(String(txt || "").toLowerCase());

      // Custom dropdown option
      const visibleOptions = Array.from(document.querySelectorAll('[role="option"], mat-option, .mat-mdc-option, .mat-option, .ng-option, li[role="option"]')).filter(isVisible);
      const turkeyOption = visibleOptions.find((opt) => isTurkey(opt.textContent || ""));
      if (turkeyOption) { turkeyOption.click(); return { ok: true, method: "custom-option", detail: (turkeyOption.textContent || "").trim() }; }

      // Trigger açma
      const labels = Array.from(document.querySelectorAll("label, span, div, p")).filter((el) => {
        const t = (el.textContent || "").toLowerCase();
        return t.includes("arama kodu") || t.includes("dial code") || t.includes("country code");
      });
      for (const label of labels) {
        const scope = label.closest("mat-form-field, .mat-mdc-form-field, .form-group, .row, .col, div") || label.parentElement;
        if (!scope) continue;
        const trigger = scope.querySelector('mat-select, [role="combobox"], .mat-mdc-select-trigger, .mat-select-trigger, .ng-select-container, [aria-haspopup="listbox"]');
        if (trigger && isVisible(trigger)) { trigger.click(); return { ok: false, method: "custom-open", detail: "trigger-click" }; }
      }

      // Native select
      const selects = Array.from(document.querySelectorAll("select")).filter(isVisible);
      for (const sel of selects) {
        const opts = Array.from(sel.options || []);
        const idx = opts.findIndex((o) => isTurkey(`${o.textContent || ""} ${o.value || ""}`));
        if (idx === -1) continue;
        const opt = opts[idx];
        sel.selectedIndex = idx;
        sel.value = opt.value;
        opt.selected = true;
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (nativeSetter) { nativeSetter.call(sel, opt.value); sel.dispatchEvent(new Event("change", { bubbles: true })); }
        return { ok: true, method: "native-select", detail: (opt.textContent || opt.value || "").trim() };
      }

      return { ok: false, method: "none", detail: `attempt-${attemptNo}` };
    }, attempt);

    if (result.ok) {
      console.log(`  [REG] ✅ Dial code seçildi (${result.method}: ${result.detail})`);
      await delay(350, 900);
      return true;
    }

    if (attempt === 1 || attempt === 3) await humanMove(page);
    await delay(300, 800);
  }

  console.log("  [REG] ⚠ Dial code seçilemedi, devam ediliyor (90 varsayılan olabilir)");
  return false;
}

async function tickAllCheckboxes(page) {
  console.log("  [REG] Onay checkbox'ları işaretleniyor...");

  const result = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const keywords = /(gizlilik|privacy|kvkk|koşul|terms|condition|consent|onay|veri transfer|data transfer|kabul|aydınlatma)/i;
    const skipText = /(cookie|tanımlama bilgisi|onetrust|preferences|allow all|accept all)/i;
    const submitKeywords = ["devam", "continue", "register", "create", "kayıt", "oluştur", "sign up"];

    const emailInput = Array.from(document.querySelectorAll('input[type="email"], input[name="email"], input[formcontrolname*="email"]')).find(isVisible);
    const form = emailInput?.closest("form");
    const scope = form || emailInput?.closest("main") || document.querySelector("main") || document.body;

    const emitCheckboxEvents = (cb) => {
      if (!cb) return;
      cb.dispatchEvent(new Event("input", { bubbles: true }));
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      cb.dispatchEvent(new Event("blur", { bubbles: true }));
    };

    const clickTarget = (el) => {
      if (!el) return;
      try {
        el.scrollIntoView({ block: "center", inline: "nearest" });
      } catch {}
      try {
        el.click();
      } catch {}
    };

    const readRoleChecked = (box) => {
      if (!box) return false;
      if (box.getAttribute("aria-checked") === "true") return true;
      if (box.classList.contains("mat-checkbox-checked") || box.classList.contains("mat-mdc-checkbox-checked")) return true;
      if (box.classList.contains("mdc-checkbox--selected") || box.classList.contains("mdc-checkbox--checked")) return true;
      return false;
    };

    const findSubmit = () =>
      Array.from(scope.querySelectorAll("button")).find((b) => {
        const txt = (b.textContent || "").toLowerCase().trim();
        return submitKeywords.some((k) => txt.includes(k));
      }) || scope.querySelector('button[type="submit"]');

    let considered = 0;
    let checked = 0;
    let touched = 0;
    let matTouched = 0;
    let roleTouched = 0;
    let fallbackTouched = 0;

    const inputCheckboxes = Array.from(scope.querySelectorAll('input[type="checkbox"]')).filter((cb) => isVisible(cb));

    for (const cb of inputCheckboxes) {
      const host = cb.closest('label, mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, .mdc-form-field, .form-check, .checkbox-container') || cb.parentElement;
      const meta = `${cb.name || ""} ${cb.id || ""} ${cb.getAttribute("aria-label") || ""} ${host?.textContent || ""}`.toLowerCase();
      if (skipText.test(meta)) continue;

      const shouldCheck = cb.required || cb.getAttribute("aria-required") === "true" || keywords.test(meta);
      if (!shouldCheck) continue;

      considered++;

      if (!cb.checked) {
        clickTarget(host || cb);
        if (!cb.checked) {
          const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
          if (checkedSetter) checkedSetter.call(cb, true);
          else cb.checked = true;
        }
        touched++;
      }

      emitCheckboxEvents(cb);
      if (cb.checked) checked++;
    }

    // Angular / MDC role checkbox desteği
    const roleBoxes = Array.from(scope.querySelectorAll('mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, [role="checkbox"]')).filter((box) => isVisible(box));

    for (const box of roleBoxes) {
      const input = box.querySelector('input[type="checkbox"]');
      if (input && inputCheckboxes.includes(input)) continue;

      const text = `${box.textContent || ""} ${box.getAttribute("aria-label") || ""}`.toLowerCase();
      if (skipText.test(text)) continue;

      const ariaRequired = box.getAttribute("aria-required") === "true" || input?.required;
      const hasKeyword = keywords.test(text);
      if (!ariaRequired && !hasKeyword) continue;

      considered++;

      const wasChecked = input ? !!input.checked : readRoleChecked(box);
      if (!wasChecked) {
        clickTarget(box);
        if (input) emitCheckboxEvents(input);
        roleTouched++;
      }

      const nowChecked = input ? !!input.checked : readRoleChecked(box);
      if (nowChecked) checked++;
      if (!input && nowChecked) matTouched++;
    }

    const formEl = emailInput?.closest("form");
    if (formEl) {
      formEl.dispatchEvent(new Event("input", { bubbles: true }));
      formEl.dispatchEvent(new Event("change", { bubbles: true }));
    }

    let submitBtn = findSubmit();

    // Fallback: submit hâlâ disabled ise kalan görünür checkbox'ları da dene
    if (submitBtn?.disabled) {
      for (const cb of inputCheckboxes) {
        const hostText = (cb.closest("label, div, span")?.textContent || "").toLowerCase();
        if (skipText.test(hostText)) continue;
        if (cb.checked) continue;

        clickTarget(cb.closest('label, .form-check, .mdc-form-field') || cb);
        if (!cb.checked) {
          const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
          if (checkedSetter) checkedSetter.call(cb, true);
          else cb.checked = true;
        }
        emitCheckboxEvents(cb);
        fallbackTouched++;
      }

      for (const box of roleBoxes) {
        const input = box.querySelector('input[type="checkbox"]');
        if (input && inputCheckboxes.includes(input)) continue;

        const text = `${box.textContent || ""} ${box.getAttribute("aria-label") || ""}`.toLowerCase();
        if (skipText.test(text)) continue;

        const isChecked = input ? !!input.checked : readRoleChecked(box);
        if (isChecked) continue;

        clickTarget(box);
        if (input) emitCheckboxEvents(input);
        fallbackTouched++;
      }

      submitBtn = findSubmit();
    }

    return {
      considered,
      checked,
      touched,
      matTouched,
      roleTouched,
      fallbackTouched,
      submitDisabled: !!submitBtn?.disabled,
      visibleCheckboxCount: inputCheckboxes.length + roleBoxes.length,
    };
  });

  console.log(
    `  [REG] Checkbox sonucu: considered=${result.considered}, checked=${result.checked}, touched=${result.touched}, mat=${result.matTouched}, role=${result.roleTouched}, fallback=${result.fallbackTouched}, submitDisabled=${result.submitDisabled}`
  );
  return !result.submitDisabled;
}

async function getRegistrationFormDiagnostics(page) {
  return await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const submitKeywords = ["devam", "continue", "register", "create", "kayıt", "oluştur", "sign up"];
    const buttons = Array.from(document.querySelectorAll("button"));
    const submitBtn = buttons.find((b) => {
      const txt = (b.textContent || "").toLowerCase().trim();
      return submitKeywords.some((k) => txt.includes(k));
    }) || document.querySelector('button[type="submit"]');

    const visibleInputs = Array.from(document.querySelectorAll("input, select, textarea")).filter(isVisible);
    const invalidFields = visibleInputs
      .filter((el) => {
        const requiredEmpty =
          (el.required || el.getAttribute("aria-required") === "true") &&
          ((el.type === "checkbox" && !el.checked) || (el.type !== "checkbox" && String(el.value || "").trim() === ""));
        const htmlInvalid = typeof el.checkValidity === "function" ? !el.checkValidity() : false;
        const classInvalid = /ng-invalid|mat-mdc-form-field-invalid|mat-form-field-invalid/i.test(el.className || "");
        const ariaInvalid = el.getAttribute("aria-invalid") === "true";
        return requiredEmpty || htmlInvalid || classInvalid || ariaInvalid;
      })
      .slice(0, 8)
      .map((el) => ({
        type: el.type || el.tagName.toLowerCase(),
        name: el.name || "",
        id: el.id || "",
        placeholder: (el.placeholder || "").slice(0, 40),
        required: !!el.required || el.getAttribute("aria-required") === "true",
        valueLength: String(el.value || "").length,
        checked: typeof el.checked === "boolean" ? el.checked : undefined,
        className: (el.className || "").slice(0, 80),
      }));

    const validationHints = Array.from(document.querySelectorAll("small, .error, .invalid-feedback, mat-error, .mat-error, .text-danger"))
      .map((el) => (el.textContent || "").trim())
      .filter((t) => t)
      .slice(0, 5);

    const captchaHints = Array.from(document.querySelectorAll("div, span, p, small"))
      .map((el) => (el.textContent || "").trim())
      .filter((t) => /captcha|turnstile|robot|doğrulama|verification/i.test(t))
      .slice(0, 3);

    const hasTurnstileWidget =
      !!document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [name*="turnstile"]');

    const hasCaptchaTokenFromField = Array.from(
      document.querySelectorAll('input[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name="g-recaptcha-response"], textarea[name="cf-turnstile-response"], input[name="g-recaptcha-response"]')
    ).some((el) => String(el.value || "").trim().length > 20);

    let hasCaptchaTokenFromApi = false;
    try {
      if (window.turnstile && typeof window.turnstile.getResponse === "function") {
        const response = window.turnstile.getResponse();
        hasCaptchaTokenFromApi = typeof response === "string" && response.trim().length > 20;
      }
    } catch {}

    const hasCaptchaToken = hasCaptchaTokenFromField || hasCaptchaTokenFromApi;

    return {
      submitDisabled: !!submitBtn?.disabled,
      submitText: (submitBtn?.textContent || "").trim().slice(0, 30),
      invalidFields,
      validationHints,
      hasTurnstileWidget,
      hasCaptchaToken,
      captchaHints,
    };
  });
}

async function tryForceRegistrationSubmit(page, options = {}) {
  const { forceEnableDisabled = true } = options;

  return await page.evaluate((forceEnableDisabled) => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const submitKeywords = ["devam et", "devam", "continue", "register", "create", "kayıt", "oluştur", "sign up", "next"];
    const skipKeywords = ["cookie", "accept", "reject", "allow all", "filter", "cancel", "clear", "geri", "back"];

    const hasRegisterFields = (root) => {
      if (!root) return false;
      const hasEmail = !!root.querySelector('input[type="email"], input[name*="email" i]');
      const hasPassword = root.querySelectorAll('input[type="password"]').length >= 1;
      return hasEmail && hasPassword;
    };

    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
    let best = null;
    let bestScore = -999;

    for (const btn of allButtons) {
      const text = ((btn.textContent || btn.value || "").trim().toLowerCase());
      let score = 0;

      if (!isVisible(btn)) score -= 120;
      if (submitKeywords.some((k) => text.includes(k))) score += 80;
      if (skipKeywords.some((k) => text.includes(k))) score -= 120;
      if ((btn.type || "").toLowerCase() === "submit") score += 60;

      const form = btn.closest("form");
      if (hasRegisterFields(form)) score += 70;
      if (!form && hasRegisterFields(document)) score += 20;

      if (btn.disabled) score -= 10;

      if (score > bestScore) {
        bestScore = score;
        best = btn;
      }
    }

    if (!best || bestScore < 30) {
      return { clicked: false, forced: false, reason: "no_submit_button" };
    }

    const wasDisabled = !!best.disabled || best.getAttribute("aria-disabled") === "true";
    if (wasDisabled && !forceEnableDisabled) {
      return { clicked: false, forced: false, reason: "disabled_button" };
    }

    if (wasDisabled && forceEnableDisabled) {
      best.disabled = false;
      best.removeAttribute("disabled");
      best.setAttribute("aria-disabled", "false");
    }

    const form = best.closest("form") || document.querySelector("form");

    try {
      best.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      best.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      best.click();

      if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        if (typeof form.requestSubmit === "function") {
          try { form.requestSubmit(best); } catch {}
        }
      }
    } catch {
      return { clicked: false, forced: wasDisabled, reason: "submit_click_failed" };
    }

    return {
      clicked: true,
      forced: wasDisabled,
      reason: wasDisabled ? "force_enabled" : "normal_click",
      buttonText: (best.textContent || best.value || "").trim().slice(0, 40),
    };
  }, forceEnableDisabled);
}

async function clickOtpVerification(page) {
  return await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const verifyKeywords = ["verify", "doğrula", "onayla", "confirm", "gönder", "submit", "continue", "devam"];
    const skipKeywords = ["cookie", "accept", "reject", "allow all", "filter", "cancel", "clear", "geri", "back"];
    const otpInputs = document.querySelectorAll('input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[maxlength="1"], input[maxlength="6"]');

    const candidates = Array.from(document.querySelectorAll('button, input[type="submit"]'));
    let best = null;
    let bestScore = -999;

    for (const btn of candidates) {
      const text = ((btn.textContent || btn.value || "").trim().toLowerCase());
      let score = 0;

      if (!isVisible(btn)) score -= 120;
      if (verifyKeywords.some((k) => text.includes(k))) score += 80;
      if (skipKeywords.some((k) => text.includes(k))) score -= 120;
      if ((btn.type || "").toLowerCase() === "submit") score += 40;
      if (otpInputs.length > 0 && btn.closest("form")) score += 35;

      if (score > bestScore) {
        bestScore = score;
        best = btn;
      }
    }

    if (!best || bestScore < 25) {
      return { clicked: false, forced: false, reason: "no_verify_button" };
    }

    const wasDisabled = !!best.disabled || best.getAttribute("aria-disabled") === "true";
    if (wasDisabled) {
      best.disabled = false;
      best.removeAttribute("disabled");
      best.setAttribute("aria-disabled", "false");
    }

    const form = best.closest("form") || document.querySelector("form");

    try {
      best.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      best.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      best.click();

      if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        if (typeof form.requestSubmit === "function") {
          try { form.requestSubmit(best); } catch {}
        }
      }
    } catch {
      return { clicked: false, forced: wasDisabled, reason: "verify_click_failed" };
    }

    return {
      clicked: true,
      forced: wasDisabled,
      reason: wasDisabled ? "force_enabled" : "normal_click",
      buttonText: (best.textContent || best.value || "").trim().slice(0, 40),
    };
  });
}

async function waitForOtpScreenAfterSubmit(page, timeoutMs = 45000) {
  const startedAt = Date.now();
  let retriedCaptchaOnce = false;
  let retriedSubmitOnce = false;

  while (Date.now() - startedAt < timeoutMs) {
    const state = await page.evaluate(() => {
      const text = (document.body?.innerText || "").toLowerCase();
      const title = (document.title || "").toLowerCase();

      const hasOtpText = /otp|verification code|doğrulama kodu|one time|sms code|email code|kodu girin|code sent/.test(text);
      const hasOtpInput = !!document.querySelector(
        'input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[maxlength="1"], input[maxlength="6"]'
      );

      const hasRegisterForm =
        !!document.querySelector('input[type="email"], input[name*="email" i]') &&
        !!document.querySelector('input[type="password"]');

      const submitBtn =
        [...document.querySelectorAll("button")].find((b) => {
          const txt = (b.textContent || "").toLowerCase().trim();
          return ["devam et", "devam", "continue", "register", "create", "kayıt", "oluştur", "sign up"].some((k) => txt.includes(k));
        }) || document.querySelector('button[type="submit"]');

      const hasTurnstileWidget = !!document.querySelector(
        'iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [name*="turnstile"]'
      );

      const hasTokenField = Array.from(
        document.querySelectorAll(
          'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name*="turnstile"], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]'
        )
      ).some((el) => String(el.value || "").trim().length > 20);

      let hasTokenApi = false;
      try {
        if (window.turnstile && typeof window.turnstile.getResponse === "function") {
          const response = window.turnstile.getResponse();
          hasTokenApi = typeof response === "string" && response.trim().length > 20;
        }
      } catch {}

      const isWaitingRoom =
        title.includes("waiting room") ||
        text.includes("şu anda sıradasınız") ||
        text.includes("this page will auto refresh") ||
        text.includes("tahmini bekleme süreniz");

      return {
        hasOtpText,
        hasOtpInput,
        hasRegisterForm,
        submitDisabled: !!submitBtn?.disabled,
        hasTurnstileWidget,
        hasCaptchaToken: hasTokenField || hasTokenApi,
        isWaitingRoom,
      };
    });

    if (state.hasOtpText || state.hasOtpInput) {
      return { ok: true };
    }

    if (state.isWaitingRoom) {
      console.log("  [REG] ⏳ Submit sonrası waiting room algılandı, bekleniyor...");
      await solveTurnstile(page);
      await delay(2200, 3800);
      continue;
    }

    if (
      !retriedCaptchaOnce &&
      state.hasRegisterForm &&
      state.submitDisabled &&
      state.hasTurnstileWidget &&
      !state.hasCaptchaToken
    ) {
      retriedCaptchaOnce = true;
      console.log("  [REG] ⚠ Submit sonrası CAPTCHA token yok, yeniden çözüm deneniyor...");
      const solved = await solveTurnstile(page);
      await delay(1000, 1800);
      const token = await waitForTurnstileToken(page, 8000);

      if (solved && token) {
        const force = await tryForceRegistrationSubmit(page);
        console.log(`  [REG] Submit retry: clicked=${force.clicked}, forced=${force.forced}, reason=${force.reason}`);
      }

      await delay(1800, 3200);
      continue;
    }

    const elapsedMs = Date.now() - startedAt;
    if (!retriedSubmitOnce && state.hasRegisterForm && elapsedMs > 7000) {
      retriedSubmitOnce = true;
      console.log("  [REG] ⚠ OTP ekranı gelmedi, submit tekrar deneniyor...");

      let retry = await tryForceRegistrationSubmit(page, { forceEnableDisabled: false });
      if (!retry.clicked && state.submitDisabled) {
        retry = await tryForceRegistrationSubmit(page, { forceEnableDisabled: true });
      }

      console.log(`  [REG] Submit re-try: clicked=${retry.clicked}, forced=${retry.forced}, reason=${retry.reason}`);
      await delay(1800, 3200);
      continue;
    }

    await delay(900, 1600);
  }

  const pageTextPreview = await page
    .evaluate(() => (document.body?.innerText || "").substring(0, 300))
    .catch(() => "");

  return { ok: false, pageTextPreview };
}

async function postRegError(account, page, reason) {
  try {
    let screenshotBase64 = null;
    if (page) screenshotBase64 = await takeScreenshotBase64(page);

    const cfgData = await apiGet("post_reg_error:get_configs");
    const configId = cfgData?.configs?.[0]?.id;

    if (configId) {
      const body = {
        config_id: configId,
        status: "error",
        message: `[REG] ${reason} | Hesap: ${account.email}`,
        slots_available: 0,
      };
      if (screenshotBase64) body.screenshot_base64 = screenshotBase64;
      await apiPost(body, "post_reg_error:insert_log");
    }

    if (screenshotBase64) console.log("  [REG] 📸 Hata screenshot gönderildi");
  } catch (e) {
    console.error("  [REG] Hata rapor hatası:", e.message);
  }
}

async function registerVfsAccount(account) {
  const ts = new Date().toLocaleTimeString("tr-TR");
  console.log(`\n[${ts}] 📝 VFS Kayıt: ${account.email}`);
  
  // Dashboard'da göstermek için aktif config ID'yi ve ülkeyi al
  let regLogConfigId = null;
  let regCountry = "france";
  let regCountryLabel = "Fransa";
  try {
    const { configs } = await fetchActiveConfigs();
    if (configs.length > 0) {
      regLogConfigId = configs[0].id;
      if (configs[0].country) regCountry = configs[0].country;
    }
  } catch {}

  // Ülke label eşlemesi
  const countryLabels = { france: "Fransa", netherlands: "Hollanda", denmark: "Danimarka" };
  regCountryLabel = countryLabels[regCountry] || regCountry;

  await logStep(regLogConfigId, "reg_start", `Kayıt başlıyor | ${account.email} | Ülke: ${regCountryLabel}`);

  let browser;
  let page;
  try {
    const fp = generateFingerprint();
    const launched = await launchBrowser();
    browser = launched.browser;
    page = launched.page;
    await applyFingerprint(page, fp);
    await humanMove(page);

    const regUrl = getVfsRegisterUrl(regCountry);
    console.log(`  [REG 1/7] Kayıt sayfası: ${regUrl} (${regCountryLabel})`);
    await page.goto(regUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await humanIdle(5000, 10000); // Sayfayı okuyormuş gibi bekle
    await humanMove(page);
    await humanScroll(page);

    // Cookie banner
    console.log("  [REG 2/7] Cookie banner...");
    try {
      const cookieBtn = await page.evaluateHandle(() => {
        const btns = [...document.querySelectorAll("button")];
        return btns.find((b) => {
          const txt = b.textContent.toLowerCase();
          return txt.includes("accept all") || txt.includes("kabul") || txt.includes("tümünü kabul") || txt.includes("tüm tanımlama");
        }) || document.getElementById('onetrust-accept-btn-handler') || null;
      });
      if (cookieBtn && cookieBtn.asElement()) {
        await humanIdle(1500, 3500); // Cookie uyarısını okuyormuş gibi
        await cookieBtn.asElement().click();
        console.log("  [REG 2/7] ✅ Cookie kabul edildi");
        await delay(2000, 4000);
      }
    } catch (e) {}

    // CAPTCHA
    console.log("  [REG 3/7] CAPTCHA...");
    await logStep(regLogConfigId, "reg_captcha", `CAPTCHA çözülüyor | ${account.email}`);
    await humanMove(page);
    await solveTurnstile(page);
    await humanIdle(3000, 6000);

    // Form yüklenmesini bekle
    console.log("  [REG 4/7] Form bekleniyor...");
    const registrationFormResult = await waitForRegistrationFormAfterQueue(page, regUrl);
    if (!registrationFormResult.ok) {
      const snapshot = await takeScreenshotBase64(page);
      await logStep(regLogConfigId, "reg_fail", `Form yüklenemedi: ${registrationFormResult.reason} | ${account.email}`);
      await postRegError(account, page, registrationFormResult.reason);
      if (snapshot) console.log("  [REG] 📸 Form timeout screenshot alındı");
      throw new Error(registrationFormResult.reason);
    }
    await humanIdle(3000, 6000); // Formu inceliyormuş gibi
    await humanScroll(page);
    await humanMove(page);

    // ========== FORM DOLDURMA ==========
    console.log("  [REG 5/7] Form dolduruluyor...");
    await logStep(regLogConfigId, "reg_form", `Kayıt formu dolduruluyor | ${account.email}`);

    // Angular uyumlu input doldurma helper
    async function fillAngularInput(page, element, value) {
      await humanIdle(600, 1500); // Alana tıklamadan önce düşünme süresi
      await element.click({ clickCount: 3 });
      await delay(400, 800);
      await page.keyboard.press("Backspace");
      await delay(200, 500);

      // Daha yavaş ve insansı yazma
      for (const ch of String(value)) {
        await page.keyboard.type(ch, { delay: Math.floor(Math.random() * 200) + 80 });
        if (Math.random() < 0.15) await delay(300, 900);
        // Typo simülasyonu
        if (Math.random() < 0.04 && value.length > 5) {
          const wrongKey = String.fromCharCode(97 + Math.floor(Math.random() * 26));
          await page.keyboard.type(wrongKey, { delay: 100 });
          await delay(400, 1000);
          await page.keyboard.press("Backspace");
          await delay(200, 500);
        }
      }
      await delay(500, 1200);

      // Angular reactive form event dispatch
      await page.evaluate((el, val) => {
        // Native setter ile value ata (Angular change detection tetikler)
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));

        // Angular NgModel / FormControl
        const ngModelCtrl = el.__ngContext__ || el.ng;
        if (ngModelCtrl) {
          try {
            el.dispatchEvent(new Event('ngModelChange', { bubbles: true }));
          } catch {}
        }
      }, element, value);

      // Doğrulama: değer gerçekten girilmiş mi?
      const actualValue = await page.evaluate(el => el.value, element);
      if (actualValue !== value) {
        console.log(`  [REG] ⚠ Değer uyumsuz (beklenen: ${value.substring(0,10)}..., gerçek: ${actualValue.substring(0,10)}...), tekrar deneniyor`);
        await element.click({ clickCount: 3 });
        await delay(100, 200);
        await page.evaluate((el, val) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }, element, value);
      }

      const finalValue = await page.evaluate(el => el.value, element);
      return finalValue === value;
    }

    // EMAIL
    const emailInput = await page.$('input[type="email"], input[name="email"], input[formcontrolname*="email"]');
    if (!emailInput) throw new Error("Email alanı bulunamadı");
    const emailOk = await fillAngularInput(page, emailInput, account.email);
    console.log(`  [REG] ${emailOk ? "✅" : "⚠"} Email: ${account.email} (set: ${emailOk})`);
    await humanIdle(1500, 3500); // Email yazdıktan sonra düşünme
    await humanMove(page);
    await humanScroll(page);

    // ŞİFRE + ONAY
    const passwordInputs = await page.$$('input[type="password"]');
    console.log(`  [REG] ${passwordInputs.length} şifre alanı bulundu`);
    if (passwordInputs.length < 2) throw new Error("Şifre alanları bulunamadı");
    for (let i = 0; i < passwordInputs.length; i++) {
      await fillAngularInput(page, passwordInputs[i], account.password);
      await humanIdle(1000, 2500);
      if (i === 0) { await humanMove(page); await humanScroll(page); }
    }
    console.log("  [REG] ✅ Şifre girildi");
    await humanIdle(2000, 4000); // Şifre sonrası bekle

    // TELEFON
    let normalizedPhone = "";
    if (account.phone) {
      const { mobileNumber } = normalizePhoneNumber(account.phone);
      normalizedPhone = mobileNumber;
      console.log(`  [REG] Telefon: +90 ${mobileNumber}`);

      await selectTurkeyDialCode(page);
      await delay(500, 1000);

      // Telefon input bul - 3 aşamalı arama
      let phoneFound = false;

      // Aşama 1: "Ön ek olmadan" label'ına en yakın input
      try {
        const phoneByLabel = await page.evaluateHandle(() => {
          const allElements = Array.from(document.querySelectorAll('label, span, div, p, mat-label'));
          const phoneLabel = allElements.find(el => {
            const t = (el.textContent || '').toLowerCase().trim();
            return (t.includes('ön ek olmadan') || t.includes('without prefix') || t.includes('cep telefonu numarası')) && t.length < 80;
          });

          if (phoneLabel) {
            // Label'ın parent container'ında input bul
            const container = phoneLabel.closest('.mat-form-field, .form-group, .field-wrapper, td, div') || phoneLabel.parentElement;
            if (container) {
              const inp = container.querySelector('input:not([type="email"]):not([type="password"]):not([type="checkbox"])');
              if (inp) return inp;
            }
            // Yanındaki input'u bul (sibling veya yakın)
            const parent = phoneLabel.parentElement;
            if (parent) {
              const inp = parent.querySelector('input:not([type="email"]):not([type="password"]):not([type="checkbox"])');
              if (inp) return inp;
            }
          }
          return null;
        });

        if (phoneByLabel && phoneByLabel.asElement()) {
          await fillAngularInput(page, phoneByLabel.asElement(), mobileNumber);
          phoneFound = true;
          console.log(`  [REG] ✅ Telefon (label-based) girildi: ${mobileNumber}`);
        }
      } catch (e) {
        console.log("  [REG] Label-based telefon hatası:", e.message);
      }

      // Aşama 2: Scoring sistemi
      if (!phoneFound) {
        try {
          const mobileInput = await page.evaluateHandle(() => {
            const isVisible = (el) => {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            };
            const inputs = Array.from(document.querySelectorAll('input')).filter(inp => {
              const type = (inp.type || '').toLowerCase();
              return isVisible(inp) && !inp.disabled && !inp.readOnly &&
                type !== 'email' && type !== 'password' && type !== 'checkbox' && type !== 'hidden' && type !== 'submit';
            });

            // Email ve password input'larını hariç tut
            const emailEl = document.querySelector('input[type="email"], input[name="email"]');
            const passEls = Array.from(document.querySelectorAll('input[type="password"]'));
            const excluded = new Set([emailEl, ...passEls].filter(Boolean));

            const remaining = inputs.filter(inp => !excluded.has(inp));
            if (remaining.length === 1) return remaining[0]; // Tek kalan input telefon olmalı

            // Scoring
            for (const inp of remaining) {
              const meta = `${inp.name || ''} ${inp.id || ''} ${inp.placeholder || ''} ${inp.getAttribute('formcontrolname') || ''} ${inp.getAttribute('aria-label') || ''}`.toLowerCase();
              if (/mobile|phone|tel|gsm|cep|telefon/.test(meta)) return inp;
            }
            // Type=tel olan
            const telInput = remaining.find(inp => inp.type === 'tel');
            if (telInput) return telInput;

            return remaining[0] || null;
          });

          if (mobileInput && mobileInput.asElement()) {
            await fillAngularInput(page, mobileInput.asElement(), mobileNumber);
            phoneFound = true;
            console.log(`  [REG] ✅ Telefon (scoring) girildi: ${mobileNumber}`);
          }
        } catch (e) {
          console.log("  [REG] Scoring telefon hatası:", e.message);
        }
      }

      // Aşama 3: Dial code select'in yanındaki input
      if (!phoneFound) {
        try {
          const phoneByPosition = await page.evaluateHandle(() => {
            const selects = Array.from(document.querySelectorAll('select, mat-select, [role="combobox"]'));
            for (const sel of selects) {
              const selText = (sel.textContent || sel.value || '').trim();
              if (selText.includes('90') || selText.includes('Turkey')) {
                const row = sel.closest('.row, .form-group, tr, div');
                if (row) {
                  const inp = row.querySelector('input:not([type="email"]):not([type="password"]):not([type="checkbox"]):not([type="hidden"])');
                  if (inp) return inp;
                }
              }
            }
            return null;
          });

          if (phoneByPosition && phoneByPosition.asElement()) {
            await fillAngularInput(page, phoneByPosition.asElement(), mobileNumber);
            phoneFound = true;
            console.log(`  [REG] ✅ Telefon (position) girildi: ${mobileNumber}`);
          }
        } catch (e) {
          console.log("  [REG] Position telefon hatası:", e.message);
        }
      }

      if (!phoneFound) {
        console.log("  [REG] ⚠ Telefon alanı bulunamadı, debug bilgisi:");
        try {
          const debugInfo = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            return inputs.map(inp => ({
              type: inp.type, name: inp.name, id: inp.id,
              placeholder: (inp.placeholder || '').substring(0, 30),
              formcontrolname: inp.getAttribute('formcontrolname'),
              visible: inp.getBoundingClientRect().width > 0,
              value: (inp.value || '').substring(0, 10),
            }));
          });
          console.log("  [REG] Tüm inputlar:", JSON.stringify(debugInfo));
        } catch {}
      }
    }

    await humanMove(page);
    await humanIdle(2000, 5000); // Telefon sonrası düşünme

    // CHECKBOX'LAR
    console.log("  [REG 6/7] Onay kutuları...");
    await humanScroll(page); // Aşağı scroll — checkbox'ları görmek için
    await humanIdle(1500, 3000);
    await tickAllCheckboxes(page);
    await humanIdle(2000, 4000);

    // CAPTCHA — birden fazla deneme
    console.log("  [REG] CAPTCHA kontrol...");
    await logStep(regLogConfigId, "reg_captcha", `CAPTCHA çözülüyor | ${account.email} | Ülke: ${regCountryLabel}`);
    await humanMove(page);

    let regCaptchaToken = "";
    for (let captchaAttempt = 1; captchaAttempt <= 3; captchaAttempt++) {
      console.log(`  [REG] CAPTCHA deneme ${captchaAttempt}/3`);
      await solveTurnstile(page);
      await delay(2000, 4000);
      regCaptchaToken = await waitForTurnstileToken(page, 8000);
      if (regCaptchaToken) {
        console.log("  [REG] ✅ CAPTCHA token alındı");
        break;
      }
      // Token yoksa checkbox click dene
      await tryClickTurnstileCheckbox(page);
      await delay(1500, 3000);
      regCaptchaToken = await waitForTurnstileToken(page, 6000);
      if (regCaptchaToken) {
        console.log("  [REG] ✅ CAPTCHA token (checkbox) alındı");
        break;
      }
    }
    if (!regCaptchaToken) {
      console.log("  [REG] ⚠ CAPTCHA token alınamadı, devam ediliyor...");
    }
    await humanIdle(3000, 6000);

    // Screenshot gönder (submit öncesi)
    const preSubmitSS = await takeScreenshotBase64(page);
    if (preSubmitSS) {
      try {
        const cfgData = await apiGet("pre_submit:get_configs");
        const configId = cfgData?.configs?.[0]?.id;
        if (configId) {
          await apiPost(
            {
              config_id: configId,
              status: "checking",
              message: `[REG] Form dolduruldu, Devam Et tıklanacak | ${account.email} | Ülke: ${regCountryLabel}`,
              slots_available: 0,
              screenshot_base64: preSubmitSS,
            },
            "pre_submit:insert_log"
          );
        }
      } catch {}
    }

    // DEVAM ET BUTONU
    console.log("  [REG 7/7] Devam Et tıklanıyor...");
    let clickedSubmit = false;
    let submitError = null;
    let usedCaptchaManualFallback = false;

    const btnInfo = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.map(b => ({ text: (b.textContent || '').trim().substring(0, 30), disabled: b.disabled, type: b.type }));
    });
    console.log('  [REG] Butonlar:', JSON.stringify(btnInfo));

    try {
      const submitBtn = await page.evaluateHandle(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };

        const keywords = ["devam et", "devam", "continue", "register", "kayıt", "create", "oluştur", "sign up", "next"];
        const skipKeywords = ["cookie", "tanımlama", "allow all", "accept", "reject", "clear", "apply", "cancel", "filter", "geri", "back"];

        const hasRegisterFields = (root) => {
          if (!root) return false;
          const hasEmail = !!root.querySelector('input[type="email"], input[name*="email" i]');
          const hasPassword = root.querySelectorAll('input[type="password"]').length >= 1;
          return hasEmail && hasPassword;
        };

        const candidates = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        let best = null;
        let bestScore = -999;

        for (const btn of candidates) {
          const txt = (btn.textContent || btn.value || "").toLowerCase().trim();
          let score = 0;

          if (!isVisible(btn)) score -= 120;
          if (keywords.some((k) => txt.includes(k))) score += 80;
          if (skipKeywords.some((k) => txt.includes(k))) score -= 120;
          if ((btn.type || "").toLowerCase() === "submit") score += 60;

          const form = btn.closest("form");
          if (hasRegisterFields(form)) score += 70;

          if (score > bestScore) {
            bestScore = score;
            best = btn;
          }
        }

        return bestScore >= 30 ? best : null;
      });

      if (submitBtn && submitBtn.asElement()) {
        let isDisabled = await page.evaluate((b) => b.disabled, submitBtn.asElement());

        if (isDisabled) {
          console.log("  [REG] ⚠ Buton disabled, form validasyonu inceleniyor...");
          const beforeDiag = await getRegistrationFormDiagnostics(page);
          console.log("  [REG] Invalid alanlar (ilk):", JSON.stringify(beforeDiag.invalidFields));
          if (beforeDiag.validationHints?.length) {
            console.log("  [REG] Validasyon mesajları:", JSON.stringify(beforeDiag.validationHints));
          }
          if (beforeDiag.captchaHints?.length) {
            console.log("  [REG] CAPTCHA ipuçları:", JSON.stringify(beforeDiag.captchaHints));
          }

          const likelyCaptchaBlock =
            beforeDiag.invalidFields.length === 0 &&
            beforeDiag.hasTurnstileWidget &&
            !beforeDiag.hasCaptchaToken;

          await tickAllCheckboxes(page);
          await delay(900, 1800);

          if (normalizedPhone) {
            const phoneRefilled = await page.evaluate((phone) => {
              const isVisible = (el) => {
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
              };

              const candidates = Array.from(document.querySelectorAll('input[type="tel"], input[type="text"], input[type="number"]'))
                .filter((el) => isVisible(el) && !el.disabled && !el.readOnly)
                .filter((el) => {
                  const meta = `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.getAttribute("formcontrolname") || ""}`.toLowerCase();
                  return /mobile|phone|tel|gsm|cep|telefon|ön ek olmadan|without prefix/.test(meta);
                });

              const target = candidates.find((el) => {
                const empty = String(el.value || "").replace(/\D/g, "").length < 9;
                const invalid = el.getAttribute("aria-invalid") === "true" || /ng-invalid/i.test(el.className || "");
                return empty || invalid;
              }) || candidates[0] || null;

              if (!target) return false;

              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              if (setter) setter.call(target, phone);
              else target.value = phone;
              target.dispatchEvent(new Event("input", { bubbles: true }));
              target.dispatchEvent(new Event("change", { bubbles: true }));
              target.dispatchEvent(new Event("blur", { bubbles: true }));
              return true;
            }, normalizedPhone);

            if (phoneRefilled) {
              console.log(`  [REG] ✅ Telefon tekrar set edildi: ${normalizedPhone}`);
              await delay(400, 900);
            }
          }

          if (likelyCaptchaBlock) {
            console.log("  [REG] ⚠ Form alanları valid görünüyor, CAPTCHA yeniden deneniyor...");
            await solveTurnstile(page);
            await delay(2200, 4200);
          }

          await page.evaluate(() => {
            const form = document.querySelector("form");
            if (form) {
              form.dispatchEvent(new Event("input", { bubbles: true }));
              form.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });

          await delay(700, 1400);
          isDisabled = await page.evaluate((b) => b.disabled, submitBtn.asElement());

          if (isDisabled) {
            const afterDiag = await getRegistrationFormDiagnostics(page);
            console.log("  [REG] Invalid alanlar (son):", JSON.stringify(afterDiag.invalidFields));
            if (afterDiag.validationHints?.length) {
              console.log("  [REG] Validasyon mesajları (son):", JSON.stringify(afterDiag.validationHints));
            }
            if (afterDiag.captchaHints?.length) {
              console.log("  [REG] CAPTCHA ipuçları (son):", JSON.stringify(afterDiag.captchaHints));
            }

            if (afterDiag.hasTurnstileWidget && !afterDiag.hasCaptchaToken) {
              console.log("  [REG] ⚠ CAPTCHA token yok, son kez çözüm deneniyor...");
              const solvedAgain = await solveTurnstile(page);
              await delay(1200, 2200);
              let tokenAfterRetry = await waitForTurnstileToken(page, 8000);

              if (!solvedAgain || !tokenAfterRetry) {
                usedCaptchaManualFallback = true;
                await logStep(regLogConfigId, "reg_captcha", `CAPTCHA otomatik doğrulanamadı, dashboard'dan onay bekleniyor | ${account.email} | Ülke: ${regCountryLabel}`);
                console.log("  [REG] ⚠ CAPTCHA manuel/fallback moda geçiliyor...");

                // Checkbox fallback denemeleri
                for (let manualTry = 1; manualTry <= 3; manualTry++) {
                  await tryClickTurnstileCheckbox(page);
                  await delay(1500, 2800);
                  tokenAfterRetry = await waitForTurnstileToken(page, 6000);
                  if (tokenAfterRetry) {
                    console.log(`  [REG] ✅ Fallback deneme ${manualTry}/3 ile token alındı`);
                    break;
                  }
                }

                // Hala token yoksa dashboard'dan onay bekle
                if (!tokenAfterRetry) {
                  await signalCaptchaWaiting(account.id);
                  await logStep(regLogConfigId, "reg_captcha_wait", `CAPTCHA çözülemedi — dashboard'dan manuel onay bekleniyor | ${account.email}`);
                  const approved = await waitForCaptchaManualApproval(account.id, 120000);
                  if (approved) {
                    await logStep(regLogConfigId, "reg_captcha_approved", `Manuel onay alındı, zorla devam ediliyor | ${account.email}`);
                  } else {
                    await clearCaptchaWaiting(account.id);
                    throw new Error(`CAPTCHA manuel onay zaman aşımı | Ülke: ${regCountryLabel}`);
                  }
                }
              }
            }

            let forceResult = await tryForceRegistrationSubmit(page, { forceEnableDisabled: true });
            console.log(`  [REG] Force submit: clicked=${forceResult.clicked}, forced=${forceResult.forced}, reason=${forceResult.reason}`);

            if (!forceResult.clicked && usedCaptchaManualFallback) {
              console.log("  [REG] ⚠ Manuel/fallback sonrası ikinci zorunlu submit deneniyor...");
              await delay(900, 1700);
              forceResult = await tryForceRegistrationSubmit(page, { forceEnableDisabled: true });
              console.log(`  [REG] Force submit #2: clicked=${forceResult.clicked}, forced=${forceResult.forced}, reason=${forceResult.reason}`);
            }

            if (!forceResult.clicked) {
              await clearCaptchaWaiting(account.id);
              throw new Error(`Devam Et butonu pasif kaldı (form invalid/captcha) | Ülke: ${regCountryLabel}`);
            }

            await clearCaptchaWaiting(account.id);
            clickedSubmit = true;
            await delay(1200, 2400);
          }
        }

        if (!clickedSubmit) {
          let normalSubmit = await tryForceRegistrationSubmit(page, { forceEnableDisabled: false });
          if (!normalSubmit.clicked && normalSubmit.reason === "disabled_button") {
            normalSubmit = await tryForceRegistrationSubmit(page, { forceEnableDisabled: true });
          }

          if (normalSubmit.clicked) {
            clickedSubmit = true;
            console.log(`  [REG] ✅ Devam Et tıklandı (${normalSubmit.reason})`);
          }
        }
      }
    } catch (e) {
      submitError = e?.message || "Submit click hatası";
      console.log("  [REG] Submit click hatası:", submitError);
    }

    if (!clickedSubmit) {
      clickedSubmit = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const targetKeywords = ["devam", "continue", "register", "create", "kayıt", "sign up", "oluştur"];
        const skipKeywords = ["cookie", "tanımlama", "allow all", "accept", "reject", "clear", "apply", "cancel", "filter"];

        const target = btns.find((b) => {
          const txt = (b.textContent || "").toLowerCase().trim();
          if (!txt) return false;
          if (b.disabled) return false;
          if (skipKeywords.some((k) => txt.includes(k))) return false;
          return targetKeywords.some((k) => txt.includes(k));
        });

        if (target) {
          target.click();
          return true;
        }
        return false;
      });
    }
    if (!clickedSubmit) {
      if (submitError?.includes("pasif")) throw new Error(submitError);
      throw new Error("Submit butonu bulunamadı");
    }

    await delay(3000, 5000);

    // OTP DOĞRULAMA
    console.log("  [REG] OTP doğrulama kontrol...");
    await logStep(regLogConfigId, "reg_otp_wait", `Form gönderildi, OTP ekranı bekleniyor | ${account.email}`);
    const otpScreen = await waitForOtpScreenAfterSubmit(page, usedCaptchaManualFallback ? 120000 : 70000);

    if (!otpScreen.ok) {
      const pageText = otpScreen.pageTextPreview || await page.evaluate(() => (document.body?.innerText || '').substring(0, 300));
      console.log("  [REG] Sayfa durumu:", pageText.substring(0, 200));
      await logStep(regLogConfigId, "reg_fail", `OTP ekranı bulunamadı | ${account.email}`);
      await postRegError(account, page, "OTP ekranı bulunamadı (submit sonrası)");
      // completeRegistration çağırma — retry loop tekrar deneyecek
      return false;
    }

    const otpType = await page.evaluate(() => {
      const t = (document.body?.innerText || "").toLowerCase();
      return (t.includes("sms") || t.includes("mobile") || t.includes("telefon")) ? "sms" : "email";
    });
    console.log(`  [REG] 📱 ${otpType.toUpperCase()} OTP bekleniyor - dashboard'dan girin`);
    await logStep(regLogConfigId, "reg_otp_wait", `${otpType.toUpperCase()} OTP bekleniyor — dashboard'dan girin | ${account.email}`);

    const otp = await waitForRegistrationOtp(account.id, otpType, 180000);
    if (!otp) {
      await postRegError(account, page, `${otpType} OTP timeout (180s)`);
      // completeRegistration çağırma — retry loop tekrar deneyecek
      return false;
    }

    // OTP gir
    console.log(`  [REG] OTP giriliyor: ${otp}`);
    const segmented = await page.$$('input[maxlength="1"], input.otp-input');
    if (segmented.length > 1) {
      for (let i = 0; i < Math.min(segmented.length, otp.length); i++) {
        await segmented[i].type(otp[i], { delay: Math.floor(Math.random() * 50) + 30 });
        await delay(100, 200);
      }
    } else {
      const otpInput = await page.$('input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[maxlength="6"], input[type="tel"], input[type="text"]');
      if (otpInput) {
        await otpInput.click({ clickCount: 3 });
        await delay(200, 400);
        await humanType(page, otpInput, otp);
      }
    }

    await delay(700, 1200);
    const verifyClick = await clickOtpVerification(page);
    if (!verifyClick.clicked) {
      await page.keyboard.press("Enter").catch(() => {});
      console.log(`  [REG] OTP doğrulama fallback Enter (${verifyClick.reason})`);
    } else {
      console.log(`  [REG] OTP doğrulama tıklandı (${verifyClick.reason})`);
    }
    await delay(4000, 7000);

    // İkinci OTP kontrolü
    const pageText2 = await page.evaluate(() => (document.body?.innerText || "").toLowerCase());
    const secondOtpType = otpType === "sms" ? "email" : "sms";
    const needsSecondOtp = otpType === "email" ?
      (pageText2.includes("sms") || pageText2.includes("telefon") || pageText2.includes("mobile")) :
      (pageText2.includes("e-posta") || pageText2.includes("email"));

    if (needsSecondOtp) {
      console.log(`  [REG] İkinci doğrulama: ${secondOtpType}`);
      const otp2 = await waitForRegistrationOtp(account.id, secondOtpType, 180000);
      if (otp2) {
        await page.evaluate((code) => {
          const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"]');
          for (const inp of inputs) {
            const name = (inp.name || "").toLowerCase();
            const placeholder = (inp.placeholder || "").toLowerCase();
            if (name.includes("otp") || name.includes("code") || name.includes("sms") ||
                placeholder.includes("kod") || placeholder.includes("code")) {
              inp.value = code;
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              inp.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
          }
        }, otp2);
        await delay(500, 1000);
        const verifyClick2 = await clickOtpVerification(page);
        if (!verifyClick2.clicked) {
          await page.keyboard.press("Enter").catch(() => {});
          console.log(`  [REG] İkinci OTP doğrulama fallback Enter (${verifyClick2.reason})`);
        } else {
          console.log(`  [REG] İkinci OTP doğrulama tıklandı (${verifyClick2.reason})`);
        }
        await delay(4000, 7000);
      } else {
        await postRegError(account, page, `${secondOtpType} OTP timeout`);
        // completeRegistration çağırma — retry loop tekrar deneyecek
        return false;
      }
    }

    // Sonuç kontrol
    const finalText = await page.evaluate(() => (document.body?.innerText || "").toLowerCase());
    const finalUrl = await page.evaluate(() => window.location.href.toLowerCase());
    const success = finalUrl.includes("login") || finalUrl.includes("dashboard") ||
                    finalText.includes("başarılı") || finalText.includes("success") ||
                    finalText.includes("tamamlandı") || finalText.includes("completed") ||
                    finalText.includes("kayıt tamamlandı") || finalText.includes("registered");

    if (success) {
      console.log("  [REG] ✅ KAYIT BAŞARILI!");
      await logStep(regLogConfigId, "reg_complete", `Kayıt başarılı! | ${account.email}`);
    } else {
      console.log("  [REG] ⚠ Sonuç belirsiz");
      await logStep(regLogConfigId, "reg_fail", `Kayıt sonucu belirsiz | ${account.email}`);
      await postRegError(account, page, "OTP sonrası başarı sinyali bulunamadı");
    }
    await completeRegistration(account.id, success);
    if (!success) return false; // retry loop tekrar deneyecek
    return success;
  } catch (err) {
    console.error("  [REG] Genel hata:", err.message);
    await postRegError(account, page, err.message);
    // completeRegistration çağırma — retry loop tekrar deneyecek
    return false;
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// ==================== MAIN LOOP ====================
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  VFS Randevu Takip Botu v8.0");
  console.log("  Real Browser + Fingerprint + IP Rotasyonu");
  console.log("═══════════════════════════════════════════");

  if (IP_LIST.length > 0) {
    console.log(`✅ IP Rotasyonu aktif: ${IP_LIST.length} IP`);
    IP_LIST.forEach((ip, i) => console.log(`   ${i + 1}. ${ip} → socks5://127.0.0.1:${10800 + i}`));
  } else {
    console.log("⚠ IP_LIST boş — doğrudan bağlantı kullanılacak");
  }
  if (CONFIG.CAPTCHA_API_KEY) console.log("✅ CAPTCHA çözücü aktif");
  else console.log("⚠ CAPTCHA_API_KEY yok");
  console.log("✅ Fingerprint randomization aktif");
  console.log("✅ OTP false-positive düzeltmesi aktif");
  console.log("✅ Otomatik kayıt aktif");

  while (true) {
    try {
      // DB'den güncel proxy ayarlarını yükle
      await loadProxySettingsFromDB();

      // Bekleyen kayıtları kontrol et — başarısız olanları IP değiştirerek tekrar dene
      const pendingRegs = await fetchPendingRegistrations();
      if (pendingRegs.length > 0) {
        console.log(`\n📝 ${pendingRegs.length} bekleyen kayıt var`);
        
        // Log için aktif config ID al
        let mainRegLogConfigId = null;
        try {
          const { configs: cfgs } = await fetchActiveConfigs();
          if (cfgs.length > 0) mainRegLogConfigId = cfgs[0].id;
        } catch {}
        
        for (const reg of pendingRegs) {
          let regSuccess = false;
          let regAttempt = 0;
          const MAX_REG_ATTEMPTS = 10;
          
          while (!regSuccess && regAttempt < MAX_REG_ATTEMPTS) {
            regAttempt++;
            console.log(`\n  [REG] 🔄 Kayıt denemesi ${regAttempt}/${MAX_REG_ATTEMPTS} — ${reg.email}`);
            
            // İlk denemeden sonra IP değiştir
            if (regAttempt > 1) {
              const newIp = getNextIp();
              if (newIp) {
                console.log(`  [REG] 🌐 IP değiştirildi: ${newIp}`);
                await logStep(mainRegLogConfigId, "ip_change", `Kayıt retry IP değişimi: ${newIp} | Deneme ${regAttempt} | ${reg.email}`);
              }
              await delay(5000, 10000);
            }
            
            regSuccess = await registerVfsAccount(reg);
            
            if (!regSuccess) {
              console.log(`  [REG] ❌ Deneme ${regAttempt} başarısız, IP değiştirip tekrar deneniyor...`);
              await logStep(mainRegLogConfigId, "reg_fail", `Deneme ${regAttempt}/${MAX_REG_ATTEMPTS} başarısız — tekrar denenecek | ${reg.email}`);
              await delay(10000, 20000);
            }
          }
          
          if (!regSuccess) {
            console.log(`  [REG] ⛔ ${reg.email} — ${MAX_REG_ATTEMPTS} denemede başarısız`);
            await logStep(mainRegLogConfigId, "reg_fail", `${MAX_REG_ATTEMPTS} denemede başarısız, kayıt durduruluyor | ${reg.email}`);
            await completeRegistration(reg.id, false);
          }
          
          await delay(10000, 20000);
        }
      }

      const { configs, accounts } = await fetchActiveConfigs();

      if (accounts.length === 0) {
        console.log("\n❌ Kullanılabilir VFS hesabı yok!");
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      if (configs.length === 0) {
        console.log("\n⏸ Aktif görev yok. 30s sonra tekrar...");
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }

      console.log(`\n📊 ${accounts.length} aktif hesap, ${configs.length} aktif görev`);

      for (const config of configs) {
        // Her döngüde aktiflik kontrolü — dashboard'dan durdurulmuş olabilir
        
        // Config hala aktif mi kontrol et
        let stillActive = true;
        try {
          const freshData = await apiGet("check_config_active");
          const activeConfig = (freshData.configs || []).find(c => c.id === config.id);
          if (!activeConfig) {
            stillActive = false;
            console.log(`\n⏹ Görev durduruldu: ${config.id.substring(0, 8)}...`);
            await logStep(config.id, "bot_stop", "Takip dashboard'dan durduruldu");
          }
        } catch {}
        
        if (!stillActive) continue;

        // Screenshot talep kontrolü
        if (config.screenshot_requested) {
          console.log(`\n📸 Screenshot talebi algılandı (${config.id.substring(0, 8)}...)`);
          try {
            const fp = generateFingerprint();
            const { browser: ssBrowser, page: ssPage } = await launchBrowser();
            await applyFingerprint(ssPage, fp);
            await ssPage.goto(getVfsLoginUrl(config.country), { waitUntil: "domcontentloaded", timeout: 60000 });
            await delay(3000, 5000);
            const ss = await takeScreenshotBase64(ssPage);
            if (ss) {
              await reportResult(config.id, "checking", `📸 Manuel screenshot talebi | ${new Date().toLocaleTimeString("tr-TR")}`, 0, ss);
              console.log("  📸 ✅ Screenshot gönderildi");
            }
            await apiPost({ action: "clear_screenshot_requested", config_id: config.id }, "clear_screenshot_requested");
            try { await ssBrowser.close(); } catch {}
          } catch (ssErr) {
            console.error("  📸 Screenshot hatası:", ssErr.message);
            await apiPost({ action: "clear_screenshot_requested", config_id: config.id }, "clear_screenshot_requested").catch(() => {});
          }
        }

        // Zamanlı IP rotasyonu kontrolü
        const now = Date.now();
        if (IP_ROTATION_INTERVAL_MS > 0 && (now - lastIpRotationTime) >= IP_ROTATION_INTERVAL_MS) {
          console.log(`\n🔄 [IP-ROT] Zamanlı IP rotasyonu (${IP_ROTATION_INTERVAL_MS / 60000} dk doldu)`);
          await logStep(config.id, "ip_change", `⏰ Zamanlı IP rotasyonu (${IP_ROTATION_INTERVAL_MS / 60000} dk)`);
          if (PROXY_MODE === "residential") {
            residentialSessionId++;
            EVOMI_PROXY_REGION = getNextProxyRegion();
          } else {
            const newIp = getNextIp();
            if (newIp) banIpImmediately(getCurrentIp(), "scheduled_rotation");
          }
          lastIpRotationTime = now;
        }

        const availableAccounts = accounts.filter(acc => {
          const lastUsed = accountLastUsed.get(acc.id) || 0;
          return (now - lastUsed) >= CONFIG.MIN_ACCOUNT_GAP_MS;
        });

        if (availableAccounts.length === 0) {
          // Beklemek yerine en eski hesabı yeni IP ile hemen kullan
          const oldestUsed = accounts.reduce((oldest, acc) => {
            const t = accountLastUsed.get(acc.id) || 0;
            return t < (accountLastUsed.get(oldest.id) || 0) ? acc : oldest;
          }, accounts[0]);
          console.log(`\n🔄 Tüm hesaplar yakın zamanda kullanıldı — yeni IP ile devam ediliyor (${oldestUsed.email})`);
          await logStep(config.id, "ip_change", `Hesap gap dolmadı, yeni IP ile devam: ${oldestUsed.email}`);
        }

        const readyAccounts = accounts.filter(acc => {
          const lastUsed = accountLastUsed.get(acc.id) || 0;
          return (Date.now() - lastUsed) >= CONFIG.MIN_ACCOUNT_GAP_MS;
        });
        const account = (readyAccounts.length > 0 ? readyAccounts : accounts).reduce((best, acc) => {
          const tBest = accountLastUsed.get(best.id) || 0;
          const tAcc = accountLastUsed.get(acc.id) || 0;
          return tAcc < tBest ? acc : best;
        }, (readyAccounts.length > 0 ? readyAccounts : accounts)[0]);

        accountLastUsed.set(account.id, Date.now());
        await logStep(config.id, "account_switch", `Hesap: ${account.email} | IP: sıradaki proxy`);
        const result = await checkAppointments(config, account);

        // IP engellendiyse — CF retry mekanizması
        if (result.ipBlocked) {
          consecutiveErrors++;
          const ip = getCurrentIp();
          
          // 3 ardışık CF hatası → dashboard'a bildir ve bekle
          if (consecutiveErrors >= 3) {
            await logStep(config.id, "cloudflare", `🚫 Ardışık CF engeli (${consecutiveErrors}x) | IP: ${ip || "?"}`);
            await vfsSignalCfBlocked(config.id, ip);
            console.log(`\n  🚫 [CF] ${consecutiveErrors} ardışık engel! Dashboard'dan retry bekleniyor...`);
            
            while (true) {
              const retryRequested = await vfsCheckCfRetryRequested(config.id);
              if (retryRequested) {
                console.log("  ✅ [CF] Dashboard'dan retry isteği alındı!");
                await logStep(config.id, "cf_retry", "Dashboard'dan retry isteği alındı, yeni IP ile deneniyor");
                ipBannedUntil.clear();
                consecutiveErrors = 0;
                break;
              }
              // Config hala aktif mi?
              try {
                const freshData = await apiGet("cf_wait_check");
                const activeConfig = (freshData.configs || []).find(c => c.id === config.id);
                if (!activeConfig) {
                  await vfsClearCfBlocked(config.id);
                  break;
                }
              } catch {}
              await new Promise((r) => setTimeout(r, 5000));
            }
            continue;
          }
          
          console.log(`\n🔄 IP engellendi (${consecutiveErrors}/3), 10s sonra sıradaki IP ile deneniyor...`);
          await logStep(config.id, "ip_change", `CF engeli ${consecutiveErrors}/3 | IP: ${ip || "?"}`);
          await new Promise((r) => setTimeout(r, 10000));
          continue;
        }
        
        // Başarılı kontrol — CF durumunu temizle
        if (!result.hadError) {
          await vfsClearCfBlocked(config.id);
        }

        if (result.found) {
          console.log("\n🎉 RANDEVU BULUNDU!");
          consecutiveErrors = 0;
        } else if (result.hadError) {
          consecutiveErrors++;
          await logStep(config.id, "ip_change", `Hata alındı, sıradaki IP otomatik denenecek`);
          if (result.accountBanned) {
            console.log(`\n⛔ Hesap banlı: ${account.email}`);
          } else if (result.otpRequired) {
            console.log(`\n📩 OTP gerekiyor: ${account.email}`);
          }
        } else {
          consecutiveErrors = 0;
        }

        const baseInterval = Math.max(config.check_interval * 1000, CONFIG.BASE_INTERVAL_MS);
        const backoffMultiplier = Math.min(Math.pow(1.5, consecutiveErrors), 5);
        const interval = Math.min(baseInterval * backoffMultiplier, CONFIG.MAX_BACKOFF_MS);
        const jitter = Math.floor(Math.random() * 60000) + 15000;
        const wait = Math.round(interval + jitter);
        console.log(`\n⏳ Sonraki: ${Math.round(wait / 1000)}s (backoff: x${backoffMultiplier.toFixed(1)}, errors: ${consecutiveErrors})`);
        await logStep(config.id, "bot_idle", `Sonraki kontrol: ${Math.round(wait / 1000)}s | IP: ${getCurrentIp() || "doğrudan"}`);
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
