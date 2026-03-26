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

function normalizeVfsProxyPort(port) {
  return Number(port) === 1000 ? 1000 : 1000;
}

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
      if (map.proxy_port) EVOMI_PROXY_PORT = normalizeVfsProxyPort(map.proxy_port);
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
// Ülke bazlı fallback bölge listeleri
const PROXY_REGIONS_BY_COUNTRY = {
  TR: ["ankara", "istanbul", "izmir", "bursa", "antalya", "adana", "konya"],
  PL: ["warsaw", "krakow", "wroclaw", "gdansk", "poznan", "lodz"],
  FR: ["paris", "lyon", "marseille", "toulouse", "nice", "bordeaux"],
  NL: ["amsterdam", "rotterdam", "the_hague", "utrecht", "eindhoven"],
  DK: ["copenhagen", "aarhus", "odense", "aalborg"],
  DE: ["berlin", "munich", "hamburg", "frankfurt", "cologne"],
  IT: ["rome", "milan", "naples", "turin", "florence"],
};
const PROXY_REGIONS_FALLBACK = PROXY_REGIONS_BY_COUNTRY.TR; // varsayılan
let currentRegionIndex = -1;
let DB_PROXY_REGION = ""; // Dashboard'dan seçilen sabit bölge
const PROXY_ISP_LIST = "vodafonenetdslm,turkcellinterne,vodafonenetadsl,superonlinebroa,turktelekom,turktelekomunik,vodafoneturkey,vodafonenetdslk";

// Tracking config ülkesinden proxy ülke kodunu al
const COUNTRY_TO_PROXY_CODE = {
  france: "FR", netherlands: "NL", denmark: "DK", poland: "PL",
  turkey: "TR", germany: "DE", italy: "IT",
};

function getProxyRegionsForCountry(proxyCountryCode) {
  return PROXY_REGIONS_BY_COUNTRY[proxyCountryCode] || PROXY_REGIONS_BY_COUNTRY.TR;
}

function getNextProxyRegion() {
  // Dashboard'dan bölge seçilmişse sabit kullan
  if (DB_PROXY_REGION) {
    console.log(`  [PROXY] 🏙 Dashboard bölgesi kullanılıyor: ${DB_PROXY_REGION}`);
    return DB_PROXY_REGION;
  }
  // Ülkeye göre bölge rotasyonu
  const regions = getProxyRegionsForCountry(EVOMI_PROXY_COUNTRY);
  currentRegionIndex = (currentRegionIndex + 1) % regions.length;
  const region = regions[currentRegionIndex];
  console.log(`  [PROXY] 🏙 Bölge rotasyonu: ${region} (${currentRegionIndex + 1}/${regions.length}) [${EVOMI_PROXY_COUNTRY}]`);
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
  // "just a moment" ve "ray id" Cloudflare challenge sayfası — engel değil, çözülmeli
  // Sadece gerçek engel durumlarını tespit et
  return lower.includes("access denied") || 
         lower.includes("403 forbidden") ||
         lower.includes("izin sorunları") ||
         lower.includes("izin sorunlari") ||
         lower.includes("yetki sorunu") ||
         (lower.includes("(403)") && lower.includes("izin")) ||
         (lower.includes("blocked") && !lower.includes("just a moment"));
}

// Cloudflare challenge sayfasında mı kontrol et
function isCloudflareChallenge(pageContent) {
  if (!pageContent) return false;
  const lower = pageContent.toLowerCase();
  return lower.includes("just a moment") ||
         lower.includes("ray id") ||
         lower.includes("checking your browser") ||
         lower.includes("verify you are human") ||
         lower.includes("enable javascript and cookies");
}

// Cloudflare challenge'ın çözülmesini bekle
async function waitForCloudflareChallengeResolve(page, timeoutMs = 60000) {
  const startedAt = Date.now();
  let attempt = 0;
  
  while (Date.now() - startedAt < timeoutMs) {
    attempt++;
    const content = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    
    if (!isCloudflareChallenge(content) && content.trim().length > 200) {
      console.log(`  [CF] ✅ Cloudflare challenge geçildi (${attempt}. deneme, ${Math.round((Date.now() - startedAt) / 1000)}s)`);
      return true;
    }
    
    // puppeteer-real-browser'ın turnstile: true özelliği otomatik çözecek
    // Ek olarak manuel checkbox tıklama dene
    if (attempt % 3 === 0) {
      await tryClickTurnstileCheckbox(page).catch(() => {});
    }
    
    // Her 5 denemede bir sayfayı yenile (challenge takılmışsa)
    if (attempt % 10 === 0 && attempt < 30) {
      console.log(`  [CF] 🔄 Sayfa yenileniyor (${attempt}. deneme)...`);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await delay(3000, 5000);
    }
    
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (attempt % 5 === 0) {
      console.log(`  [CF] ⏳ Cloudflare challenge bekleniyor... ${elapsed}s`);
    }
    
    await delay(2000, 4000);
  }
  
  console.log(`  [CF] ❌ Cloudflare challenge timeout (${Math.round(timeoutMs / 1000)}s)`);
  return false;
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
  poland: "pol",
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
  BASE_INTERVAL_MS: Number(process.env.BASE_INTERVAL_MS || 20000),
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
// puppeteer-real-browser kendi stealth/fingerprint'ini yönetir
// Manuel override'lar CF tespitini tetikler — iDATA gibi temiz bırakıyoruz

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

  // Angular reactive form uyumluluğu: native setter + event dispatch
  await page.evaluate((selector, value) => {
    const el = typeof selector === 'string' ? document.querySelector(selector) : null;
    if (!el) return;
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value') 
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }, typeof target === "string" ? target : null, String(text));

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

// ========== SMS BİLDİRİM (Mutlucell) ==========
async function sendSmsNotification(message) {
  try {
    const fetch = (await import("node-fetch")).default;
    const smsUrl = "https://ocrpzwrsyiprfuzsyivf.supabase.co/functions/v1/send-sms";
    
    // GSM7 uyumlu Türkçe karakter dönüşümü
    const toGsm7 = (str) => str
      .replace(/ç/g, "c").replace(/Ç/g, "C")
      .replace(/ğ/g, "g").replace(/Ğ/g, "G")
      .replace(/ı/g, "i").replace(/İ/g, "I")
      .replace(/ö/g, "o").replace(/Ö/g, "O")
      .replace(/ş/g, "s").replace(/Ş/g, "S")
      .replace(/ü/g, "u").replace(/Ü/g, "U")
      .replace(/[^\x20-\x7E\n]/g, ""); // Emoji ve özel karakterleri temizle
    
    const smsBody = toGsm7(message);
    
    const res = await fetch(smsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CONFIG.API_KEY,
      },
      body: JSON.stringify({ message: smsBody }),
    });
    
    const data = await res.json();
    if (data.ok) {
      console.log(`  [SMS] ✅ Bildirim gönderildi: ${data.recipients?.join(", ") || "?"}`);
    } else {
      console.error(`  [SMS] ❌ Hata: ${data.error}`);
    }
  } catch (err) {
    console.error(`  [SMS] ❌ Gönderim hatası: ${err.message}`);
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

async function waitForLoginFormAfterQueue(page, loginUrl) {
  const startedAt = Date.now();
  let attempt = 0;
  let lastScreenshotAt = 0;
  let notFoundRecoveries = 0;

  while (Date.now() - startedAt < CONFIG.QUEUE_MAX_WAIT_MS) {
    attempt++;
    const emailInput = await page.$('input[type="email"], input[name="email"], #email');
    if (emailInput) {
      console.log(`  [QUEUE] ✅ Login formu hazır (${attempt}. deneme).`);
      return { ok: true };
    }

    const pageState = await page.evaluate(() => {
      const title = (document.title || "").toLowerCase();
      const body = (document.body?.innerText || "").toLowerCase();
      const url = (window.location.href || "").toLowerCase();
      return { title, body, url };
    }).catch(() => ({ title: "", body: "", url: "" }));

    const waitedSec = Math.round((Date.now() - startedAt) / 1000);

    const notFoundLike =
      pageState.url.includes("page-not-found") ||
      pageState.url.includes("/404") ||
      pageState.title.includes("bir şeyler ters gitti") ||
      pageState.title.includes("üzgünüm") ||
      pageState.body.includes("bir şeyler ters gitti") ||
      pageState.body.includes("sorry, something went wrong") ||
      pageState.body.includes("beklenmeyen hata") ||
      pageState.body.includes("Beklenmeyen hata") ||
      (pageState.body.includes("(500)") && pageState.body.includes("hata"));

    const sessionExpiredLike =
      pageState.body.includes("oturum süresi doldu") ||
      pageState.body.includes("oturum süresi dolmuş") ||
      pageState.body.includes("session expired") ||
      pageState.body.includes("oturumunuzun süresi") ||
      (pageState.body.includes("oturum") && pageState.body.includes("geçersiz"));

    // VFS 403 izin sorunları sayfası (tam sayfa hata)
    const isPermissionDeniedPage =
      pageState.body.includes("izin sorunları") ||
      pageState.body.includes("izin sorunlari") ||
      pageState.body.includes("yetki sorunu") ||
      (pageState.body.includes("(403)") && pageState.body.includes("izin"));

    // VFS API JSON hata yanıtları (403201, 403102 vb.)
    const isApiError =
      pageState.body.includes('"code"') && (
        pageState.body.includes("403201") ||
        pageState.body.includes("403102") ||
        pageState.body.includes("403") ||
        pageState.body.includes("401")
      ) && pageState.body.length < 500; // JSON yanıt genelde kısa olur

    if (notFoundLike || sessionExpiredLike || isApiError || isPermissionDeniedPage) {
      notFoundRecoveries += 1;
      const reason = isPermissionDeniedPage ? "İzin sorunları (403) sayfası" : "Not-found/session";
      console.log(`  [QUEUE] ⚠ ${reason} algılandı (${notFoundRecoveries}/3), login sayfasına dönülüyor...`);

      if (Date.now() - lastScreenshotAt > 15000) {
        await postQueueScreenshot(page, "QUEUE", waitedSec, "Not-found/session algılandı, login sayfasına dönülüyor");
        lastScreenshotAt = Date.now();
      }

      if (notFoundRecoveries > 3) {
        return { ok: false, reason: "Login sayfası yerine sürekli not-found/session sayfası açılıyor" };
      }

      if (loginUrl) {
        await rotateProxyAndGoto(page, loginUrl).catch(() => {});
        await delay(2500, 4500);
        await solveTurnstile(page);
        continue;
      }
    }

    const waitingRoom = await isWaitingRoomPage(page);
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
        await rotateProxyAndGoto(page, registerUrl);
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
// VFS OTP: Sadece manuel dashboard OTP (IMAP kaldırıldı)

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
    const inputs = document.querySelectorAll('input, textarea');
    const hasOtpInput = [...inputs].some(inp => {
      const type = (inp.getAttribute("type") || "text").toLowerCase();
      const name = (inp.name || "").toLowerCase();
      const placeholder = (inp.placeholder || "").toLowerCase();
      const id = (inp.id || "").toLowerCase();
      const ariaLabel = (inp.getAttribute("aria-label") || "").toLowerCase();
      const autocomplete = (inp.getAttribute("autocomplete") || "").toLowerCase();
      const inputMode = (inp.getAttribute("inputmode") || "").toLowerCase();
      const maxLength = Number(inp.getAttribute("maxlength") || inp.maxLength || 0);
      const label = (inp.closest('mat-form-field, .mat-mdc-form-field, .form-group, .ng-star-inserted, div')?.textContent || "").toLowerCase();
      if (type === "hidden" || type === "email") return false;
      return name.includes("otp") || name.includes("code") || name.includes("verification") ||
             placeholder.includes("kod") || placeholder.includes("code") || placeholder.includes("doğrulama") ||
             id.includes("otp") || id.includes("code") ||
             ariaLabel.includes("otp") || ariaLabel.includes("code") || ariaLabel.includes("doğrulama") ||
             label.includes("otp") || label.includes("tek seferlik") || label.includes("doğrulama") ||
             autocomplete === "one-time-code" || inputMode === "numeric" || [1, 4, 5, 6, 8].includes(maxLength);
    });
    const hasOtpText = body.includes("doğrulama kodu") || body.includes("verification code") ||
                       body.includes("one-time") || body.includes("otp") ||
                       body.includes("tek kullanımlık") || body.includes("tek seferlik") || body.includes("sms") ||
                       body.includes("enter the code") || body.includes("kodu girin");
    return hasOtpInput || (hasOtpText && inputs.length > 0 && inputs.length <= 6);
  });

  if (!hasOtp) return { ok: true, reason: "no_otp" };

  console.log("  [OTP] ⚠ Doğrulama kodu isteniyor!");
  const ss = await takeScreenshotBase64(page);
  // otp_requested_at üst akışta tek noktadan set edilir

  const startTime = Date.now();
  while (Date.now() - startTime < CONFIG.OTP_WAIT_MS) {
    // Sadece manuel OTP (dashboard'dan)
    let otp = null;
    const manualOtp = await readManualOtp(account.id);
    otp = manualOtp;
    if (otp) {
      const filled = await page.evaluate((code) => {
        const getFieldText = (el) => {
          if (!el) return "";
          return [
            el.name || "",
            el.id || "",
            el.placeholder || "",
            el.getAttribute("aria-label") || "",
            el.getAttribute("autocomplete") || "",
            el.getAttribute("inputmode") || "",
            el.closest('label, mat-form-field, .mat-mdc-form-field, .form-group, .otp-container, div')?.textContent || "",
          ].join(" ").toLowerCase();
        };
        const setValue = (el, value) => {
          if (!el) return;
          try {
            el.removeAttribute("readonly");
            el.readOnly = false;
            el.removeAttribute("disabled");
            el.disabled = false;
          } catch {}
          const proto = Object.getPrototypeOf(el);
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (descriptor?.set) descriptor.set.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event("focus", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value.slice(-1) || "0" }));
          el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: value.slice(-1) || "0" }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        };
        const inputs = [...document.querySelectorAll('input, textarea')].filter((inp) => {
          const type = (inp.getAttribute("type") || "text").toLowerCase();
          const text = getFieldText(inp);
          const maxLength = Number(inp.getAttribute("maxlength") || inp.maxLength || 0);
          if (type === "hidden" || type === "email") return false;
          if (type === "password" && !(text.includes("otp") || text.includes("code") || text.includes("doğrulama") || text.includes("verification") || inp.getAttribute("autocomplete") === "one-time-code")) {
            return false;
          }
          return text.includes("otp") || text.includes("code") || text.includes("doğrulama") || text.includes("verification") ||
            inp.getAttribute("autocomplete") === "one-time-code" || inp.getAttribute("inputmode") === "numeric" ||
            [1, 4, 5, 6, 8].includes(maxLength);
        });
        const otpInputs = inputs.filter(inp => Number(inp.getAttribute("maxlength") || inp.maxLength || 0) === 1);
        if (otpInputs.length >= 4 && otpInputs.length <= 8) {
          for (let i = 0; i < Math.min(code.length, otpInputs.length); i++) {
            setValue(otpInputs[i], code[i]);
          }
          return true;
        }
        const singleInput = inputs.find((inp) => {
          const maxLength = Number(inp.getAttribute("maxlength") || inp.maxLength || 0);
          return inp.getAttribute("autocomplete") === "one-time-code" || maxLength === 0 || maxLength >= code.length;
        });
        if (singleInput) {
          setValue(singleInput, code);
          return true;
        }
        const fallbackInputs = [...document.querySelectorAll('input, textarea')].filter((inp) => {
          const type = (inp.getAttribute("type") || "text").toLowerCase();
          if (["hidden", "email"].includes(type)) return false;
          const rect = inp.getBoundingClientRect();
          const style = window.getComputedStyle(inp);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        });
        if (fallbackInputs.length === 1) {
          setValue(fallbackInputs[0], code);
          return true;
        }
        return false;
      }, otp);
      if (filled) {
        console.log("  [OTP] ✅ Kod girildi, gönderiliyor...");
        await delay(500, 1000);
        const verifyClick = await clickOtpVerification(page);
        if (verifyClick.clicked) {
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
          await delay(2000, 3000);
        } else {
          await page.keyboard.press("Enter").catch(() => {});
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

// puppeteer-real-browser kendi fingerprint'ini yönetir — manuel override kaldırıldı

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
  // Evomi session değeri kısa alfanumerik olmalı (6-10 karakter)
  residentialSessionId = Math.random().toString(36).slice(2, 10);
  
  // VFS tarafında rotasyon listesi şehirlerden oluşuyor; Evomi'de bu _city- ile gönderilmeli
  const city = String(getNextProxyRegion() || "")
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/\.(province|city|region|state)$/i, "")
    .trim();
  EVOMI_PROXY_REGION = city;
  
  let pass = `${EVOMI_PROXY_PASS}_country-${EVOMI_PROXY_COUNTRY}`;
  pass += `_session-${residentialSessionId}`;
  if (city) pass += `_city-${city}`;
  
  console.log(`  [PROXY] 🏠 Residential proxy: ${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT} (ülke: ${EVOMI_PROXY_COUNTRY}, şehir: ${city || 'yok'}, session: ${residentialSessionId})`);
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

  // Sandbox flagleri sunucuda root olarak çalışmak için gerekli
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

// Her sayfa navigasyonunda farklı IP almak için yeni session ile authenticate
async function rotateProxyAndGoto(page, url, options = {}) {
  if (PROXY_ENABLED && PROXY_MODE === "residential" && EVOMI_PROXY_USER) {
    // Yeni session ID = yeni IP
    const newSessionId = Math.random().toString(36).slice(2, 10);
    const city = String(getNextProxyRegion() || "")
      .toLowerCase()
      .replace(/\s+/g, ".")
      .replace(/\.(province|city|region|state)$/i, "")
      .trim();
    EVOMI_PROXY_REGION = city;

    let pass = `${EVOMI_PROXY_PASS}_country-${EVOMI_PROXY_COUNTRY}`;
    pass += `_session-${newSessionId}`;
    if (city) pass += `_city-${city}`;

    await page.authenticate({ username: EVOMI_PROXY_USER, password: pass });
    console.log(`  [PROXY-ROTATE] 🔄 Yeni IP: session=${newSessionId}, şehir=${city || 'rastgele'}`);
  }
  const gotoOptions = { waitUntil: "domcontentloaded", timeout: 90000, ...options };
  return await page.goto(url, gotoOptions);
}

// ==================== VFS DOM AGENT HELPERS ====================

async function extractPageElements(page) {
  return await page.evaluate(function() {
    var results = [];
    var selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="option"], [role="tab"], [role="menuitem"], [role="switch"], [tabindex], label, [onclick], mat-select, mat-option, .mat-mdc-option';
    var els = document.querySelectorAll(selectors);
    var idx = 0;
    for (var i = 0; i < els.length && idx < 150; i++) {
      var el = els[i];
      var rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) continue;
      if (rect.top > window.innerHeight + 300 || rect.bottom < -200) continue;
      var style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.1) continue;

      var text = (el.textContent || "").trim().slice(0, 100);
      var isCookieBanner = false;
      var parent = el;
      for (var p = 0; p < 5 && parent; p++) {
        var cname = (parent.className || "").toString().toLowerCase();
        var pid = (parent.id || "").toLowerCase();
        if (/(cookie|consent|gdpr|privacy-banner|onetrust)/.test(cname + " " + pid)) { isCookieBanner = true; break; }
        parent = parent.parentElement;
      }

      results.push({
        index: idx,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        text: text,
        id: el.id || null,
        name: el.name || null,
        className: (el.className || "").toString().slice(0, 80),
        href: el.href || null,
        placeholder: el.placeholder || null,
        ariaLabel: el.getAttribute("aria-label") || null,
        value: (el.tagName === "SELECT" || el.type === "hidden") ? null : (el.value || null),
        checked: !!el.checked,
        role: el.getAttribute("role") || null,
        disabled: !!el.disabled,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        isInCookieBanner: isCookieBanner
      });
      idx++;
    }
    return results;
  }).catch(() => []);
}

async function extractPageText(page) {
  return await page.evaluate(function() {
    function getVisibleText(node) {
      if (!node) return "";
      if (node.nodeType === 3) return node.textContent || "";
      if (node.nodeType !== 1) return "";
      var tag = (node.tagName || "").toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "svg") return "";
      var style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return "";
      var text = "";
      for (var i = 0; i < node.childNodes.length; i++) {
        text += getVisibleText(node.childNodes[i]);
      }
      if (tag === "p" || tag === "div" || tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "li" || tag === "tr" || tag === "br") {
        text = "\n" + text;
      }
      return text;
    }
    var raw = getVisibleText(document.body);
    return raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
  }).catch(() => "");
}

var _vfsDomAgentPendingActions = [];

async function askVFSDomAgent(page, config, account, step, recentActions) {
  // Kuyrukta bekleyen aksiyon varsa direkt döndür
  if (_vfsDomAgentPendingActions.length > 0) {
    var queued = _vfsDomAgentPendingActions.shift();
    console.log("[VFS-DOM] Kuyruktan aksiyon: " + (queued.reason || queued.type));
    return { actions: [queued], status: "continue", message: "Kuyruk aksiyonu" };
  }

  var fetch2 = (await import("node-fetch")).default;
  var pageText = await extractPageText(page);
  var elements = await extractPageElements(page);
  var currentUrl = await page.url();

  var context = {
    account: { email: account.email, password: account.password },
    country: config.country,
    city: config.city,
    visa_category: config.visa_category || "",
    visa_subcategory: config.visa_subcategory || "",
    applicants: config.applicants || [],
    recentActions: (recentActions || []).slice(-5),
  };

  var maxRetries = 3;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var res = await fetch2(CONFIG.API_URL.replace("/bot-api", "/vfs-dom-agent"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + CONFIG.API_KEY,
        },
        body: JSON.stringify({
          elements: elements,
          pageText: pageText,
          pageUrl: currentUrl,
          step: step,
          context: context,
        }),
      });

      if (res.status === 429) {
        var waitSec = (attempt + 1) * 10;
        console.log("[VFS-DOM] Rate limit, " + waitSec + "s bekleniyor...");
        await logStep(config.id, "warning", "VFS DOM Agent rate limit, " + waitSec + "s bekleniyor");
        await new Promise(function(r) { setTimeout(r, waitSec * 1000); });
        continue;
      }
      if (res.status === 402) {
        throw new Error("AI kredisi bitti!");
      }
      if (!res.ok) {
        var errText = await res.text();
        throw new Error("VFS DOM Agent hata: " + res.status + " - " + errText.slice(0, 200));
      }

      var result = await res.json();

      // Düşünce sürecini logla
      if (result.thinking) {
        console.log("[VFS-DOM] 🧠 " + result.thinking.slice(0, 150));
        await logStep(config.id, "info", "🧠 VFS AI: " + result.thinking.slice(0, 120));
      }

      console.log("[VFS-DOM] status=" + result.status + " actions=" + (result.actions || []).length + " msg=" + (result.message || "").slice(0, 80));

      // Aksiyonları kuyruğa al (ilk harici)
      if (result.actions && result.actions.length > 1) {
        for (var qi = 1; qi < result.actions.length; qi++) {
          _vfsDomAgentPendingActions.push(result.actions[qi]);
        }
        console.log("[VFS-DOM] " + _vfsDomAgentPendingActions.length + " aksiyon kuyruğa alındı");
      }

      return result;
    } catch (err) {
      console.error("[VFS-DOM] Hata:", err.message);
      await logStep(config.id, "warning", "VFS DOM Agent hata: " + err.message);
      if (attempt < maxRetries - 1) { await new Promise(function(r) { setTimeout(r, 5000); }); continue; }
      return null;
    }
  }
  return null;
}

async function executeVfsDomAction(page, action, elements) {
  if (!action || action.type === "none") return;

  var targetElement = (action.elementIndex >= 0 && elements && action.elementIndex < elements.length)
    ? elements[action.elementIndex] : null;

  if (action.type === "wait") {
    await delay(2000, 4000);
    return;
  }

  if (action.type === "scroll") {
    await humanScroll(page);
    return;
  }

  if (action.type === "click" && targetElement) {
    var cx = targetElement.rect.x + Math.round(targetElement.rect.w / 2);
    var cy = targetElement.rect.y + Math.round(targetElement.rect.h / 2);
    try {
      await humanMove(page);
      await delay(200, 500);
      await page.mouse.click(cx, cy);
      console.log("[VFS-DOM] Tıklama: (" + cx + ", " + cy + ") = " + (targetElement.text || targetElement.tag).slice(0, 40));
      await delay(500, 1500);
    } catch (clickErr) {
      console.log("[VFS-DOM] Tıklama hatası, fallback deneniyor:", clickErr.message);
      // CSS selector fallback
      try {
        if (targetElement.id) {
          await page.click("#" + targetElement.id);
        } else if (targetElement.name) {
          await page.click(targetElement.tag + "[name='" + targetElement.name + "']");
        }
      } catch (fallbackErr) {
        console.log("[VFS-DOM] Fallback tıklama da başarısız:", fallbackErr.message);
      }
    }
    return;
  }

  if (action.type === "type" && targetElement) {
    var tx = targetElement.rect.x + Math.round(targetElement.rect.w / 2);
    var ty = targetElement.rect.y + Math.round(targetElement.rect.h / 2);
    var typeValue = action.value || "";
    try {
      // 1) Elemente tıkla ve focus ver
      await page.mouse.click(tx, ty);
      await delay(300, 600);

      // 2) Alanı temizle
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await delay(100, 200);
      await page.keyboard.press("Backspace");
      await delay(200, 400);

      // 3) Karakter karakter yaz (insan benzeri)
      for (var ci = 0; ci < typeValue.length; ci++) {
        var chDelay = 40 + Math.floor(Math.random() * 100);
        await page.keyboard.type(typeValue[ci], { delay: chDelay });
        if (Math.random() < 0.15) await delay(200, 600);
      }
      await delay(300, 600);

      // 4) Angular/React uyumluluğu: nativeInputValueSetter ile değeri zorla ayarla
      await page.evaluate(function(val, idx) {
        var els = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="option"], [role="tab"], [role="menuitem"], [role="switch"], [tabindex], label, [onclick], mat-select, mat-option, .mat-mdc-option');
        var visible = [];
        for (var i = 0; i < els.length; i++) {
          var rect = els[i].getBoundingClientRect();
          if (rect.width >= 5 && rect.height >= 5) visible.push(els[i]);
          if (visible.length > idx) break;
        }
        var el = visible[idx];
        if (!el) return;

        // nativeInputValueSetter ile Angular/React formlarına değer enjekte et
        var descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, val);
        } else {
          el.value = val;
        }

        // Tüm framework event'lerini tetikle
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));

        // Angular ngModel için ek: compositionend
        el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: val }));
      }, typeValue, action.elementIndex);

      console.log("[VFS-DOM] Yazma OK: " + typeValue.slice(0, 30) + " (idx=" + action.elementIndex + ")");
    } catch (typeErr) {
      console.log("[VFS-DOM] Yazma hatası:", typeErr.message);
      // Fallback: CSS selector ile humanType
      try {
        var selector = targetElement.id ? "#" + targetElement.id : (targetElement.name ? "input[name='" + targetElement.name + "']" : null);
        if (selector) {
          await humanType(page, selector, typeValue, { clearFirst: true, minDelay: 40, maxDelay: 140 });
        }
      } catch (fallbackErr) {
        console.log("[VFS-DOM] Fallback yazma da başarısız:", fallbackErr.message);
      }
    }
    return;
  }

  if (action.type === "select" && targetElement) {
    // Native select
    try {
      var selectSelector = targetElement.id ? "#" + targetElement.id : (targetElement.name ? "select[name='" + targetElement.name + "']" : null);
      if (selectSelector) {
        await page.select(selectSelector, action.value || "");
      }
    } catch (selErr) {
      console.log("[VFS-DOM] Select hatası:", selErr.message);
    }
    return;
  }
}

// ==================== MAIN CHECK (DOM AGENT) ====================
async function checkAppointments(config, account) {
  const { id, country, city } = config;
  const ts = new Date().toLocaleTimeString("tr-TR");
  const activeIp = (PROXY_MODE !== "residential" && IP_LIST.length > 0) ? getNextIp() : null;
  const countryLabels = { france: "Fransa", netherlands: "Hollanda", denmark: "Danimarka", poland: "Polonya" };
  const countryLabel = countryLabels[country] || country;
  const proxyLabel = PROXY_MODE === "residential" ? "residential proxy" : (activeIp || "doğrudan");
  console.log(`\n[${ts}] Kontrol: ${countryLabel} ${city} | Hesap: ${account.email} | ${proxyLabel}`);
  await logStep(id, "bot_start", `Kontrol başlıyor | ${account.email} | Ülke: ${countryLabel} | ${proxyLabel}`);

  let browser;
  _vfsDomAgentPendingActions = []; // Kuyruğu temizle

  try {
    const { browser: br, page } = await launchBrowser(activeIp);
    browser = br;
    await humanMove(page);

    const realIp = PROXY_MODE === "residential"
      ? `${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`
      : (activeIp || "doğrudan");
    console.log(`  [IP] 🌐 Aktif çıkış: ${realIp}`);
    await logStep(id, "ip_change", `Aktif çıkış: ${realIp} | Hesap: ${account.email} | Ülke: ${countryLabel}`);

    // STEP 1: Giriş sayfası + CF Challenge
    console.log("  [1] Giriş sayfası açılıyor...");
    await logStep(id, "login_navigate", "VFS giriş sayfası açılıyor...");
    const vfsLoginUrl = getVfsLoginUrl(country);
    await rotateProxyAndGoto(page, vfsLoginUrl);
    await humanIdle(3000, 5000);

    // Cloudflare challenge kontrolü
    let pageContent = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (isCloudflareChallenge(pageContent)) {
      console.log("  [1] ⏳ Cloudflare challenge algılandı...");
      await logStep(id, "login_captcha", "Cloudflare challenge algılandı, otomatik çözülüyor...");
      const cfResolved = await waitForCloudflareChallengeResolve(page, 60000);
      if (!cfResolved) {
        banIpImmediately(activeIp, "cloudflare_challenge_timeout");
        const ss = await takeScreenshotBase64(page);
        await logStep(id, "cloudflare", `CF challenge aşılamadı | IP: ${activeIp || realIp}`);
        await reportResult(id, "error", `Cloudflare challenge aşılamadı | ${account.email}`, 0, ss);
        return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
      }
      pageContent = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    }

    // IP engel kontrolü
    const pageHtml = await page.evaluate(() => document.documentElement?.outerHTML || "").catch(() => "");
    if (isPageBlocked(pageContent) || pageHtml.trim().length < 500) {
      banIpImmediately(activeIp, "login_page_blocked_or_empty");
      const ss = await takeScreenshotBase64(page);
      await logStep(id, "network_error", `IP engellendi: ${activeIp || "doğrudan"}`);
      await reportResult(id, "error", `IP engellendi | ${account.email}`, 0, ss);
      return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
    }
    markIpSuccess(activeIp);

    // STEP 2: DOM Agent Loop — Tam otonom VFS navigasyonu
    console.log("  [2] 🤖 VFS DOM Agent başlıyor...");
    await logStep(id, "search_start", "🤖 VFS DOM Agent tam otonom mod başladı");

    const MAX_STEPS = 80;
    const STEP_TIMEOUT_MS = 30000; // 30s per step max
    var recentActions = [];
    var appointmentResult = null;

    for (var step = 1; step <= MAX_STEPS; step++) {
      // Turnstile çöz (her adımda kontrol)
      await solveTurnstile(page);
      await delay(500, 1000);

      // Screenshot talebi kontrolü
      try {
        const configCheck = await fetch(`${SUPABASE_REST_URL}/tracking_configs?id=eq.${id}&select=screenshot_requested,is_active`, {
          method: "GET", headers: restHeaders,
        }).then(r => r.json());
        if (configCheck?.[0]?.screenshot_requested) {
          const ss = await takeScreenshotBase64(page);
          await reportResult(id, "info", `📸 Manuel screenshot (adım ${step})`, 0, ss);
          await fetch(`${SUPABASE_REST_URL}/tracking_configs?id=eq.${id}`, {
            method: "PATCH", headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ screenshot_requested: false }),
          });
        }
        // Bot durdurulmuşsa çık
        if (configCheck?.[0] && !configCheck[0].is_active) {
          console.log("  [DOM] Bot durduruldu, çıkılıyor...");
          await logStep(id, "info", "Bot dashboard'dan durduruldu");
          return { found: false, accountBanned: false, hadError: false };
        }
      } catch {}

      console.log(`\n  [Adım ${step}/${MAX_STEPS}]`);
      await logStep(id, "info", `Adım ${step}: Sayfa analiz ediliyor...`);

      // DOM Agent'a sor
      var agentResult = await askVFSDomAgent(page, config, account, step, recentActions);
      if (!agentResult) {
        console.log("  [DOM] Agent cevap vermedi, scroll deneniyor...");
        await humanScroll(page);
        await delay(2000, 4000);
        continue;
      }

      // Status'a göre karar ver
      var status = agentResult.status;
      var message = agentResult.message || "";

      // 429002 yetkisiz etkinlik kontrolü — sayfa içeriğinden doğrudan tespit
      if (status === "continue" || !status) {
        var currentText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
        var currentUrl = await page.url().catch ? page.url() : "";
        if (currentText.includes("429002") || currentText.includes("429001") || currentText.toLowerCase().includes("yetkisiz etkinlik") || currentText.toLowerCase().includes("unauthorized activity") || currentText.toLowerCase().includes("erişim kısıtlandı") || currentText.toLowerCase().includes("erişimi geçici olarak kısıtladık")) {
          console.log("  ⛔ Hesap kısıtlama hatası (429001/429002) algılandı!");
          status = "account_banned";
        }
        // Beklenmeyen hata (500) veya page-not-found → tarayıcı kapat, yeni IP ile tekrar başla
        if (
          currentText.toLowerCase().includes("beklenmeyen hata") ||
          (currentText.includes("(500)") && currentText.toLowerCase().includes("hata")) ||
          currentUrl.includes("page-not-found") ||
          currentText.toLowerCase().includes("sorry, something went wrong") ||
          currentText.toLowerCase().includes("unexpected error")
        ) {
          console.log("  💥 Sayfa hatası (500/page-not-found) algılandı! Tarayıcı kapatılıp yeni IP ile tekrar başlanacak.");
          const ss = await takeScreenshotBase64(page);
          await logStep(id, "error", `💥 Sayfa hatası algılandı — yeni IP ile yeniden başlanıyor | ${account.email}`);
          await reportResult(id, "error", `Sayfa hatası (500) — yeni IP ile tekrar deneniyor | ${account.email}`, 0, ss);
          return { found: false, accountBanned: false, ipBlocked: false, hadError: true, pageError: true };
        }
      }

      if (status === "appointment_found") {
        const applicantName = (config.applicants && config.applicants.length > 0)
          ? `${config.applicants[0].first_name || ""} ${config.applicants[0].last_name || ""}`.trim() || account.email
          : account.email;
        const dates = (agentResult.availableDates || []).join(", ") || "tarih bilgisi yok";
        console.log(`  ✅ RANDEVU BULUNDU! Tarihler: ${dates}`);
        const ss = await takeScreenshotBase64(page);
        await logStep(id, "found", `🎉 RANDEVU BULUNDU! | ${applicantName} | Tarihler: ${dates}`);
        await reportResult(id, "found", `Randevu müsait! ${applicantName} | Tarihler: ${dates}`, (agentResult.availableDates || []).length || 1, ss);
        await sendSmsNotification(`VFS RANDEVU BULUNDU! ${applicantName} | Ulke: ${countryLabel} | Sehir: ${city} | Tarihler: ${dates}`);

        // Otomatik randevu alma — DOM Agent devam etsin
        appointmentResult = { found: true };
        // Agent'ın booking aksiyonlarını yürüt
        if (agentResult.actions && agentResult.actions.length > 0) {
          var elements = await extractPageElements(page);
          for (var ai = 0; ai < agentResult.actions.length; ai++) {
            await executeVfsDomAction(page, agentResult.actions[ai], elements);
            await delay(1000, 2000);
          }
        }

        // Booking onayı için birkaç adım daha devam et
        for (var bookStep = 0; bookStep < 15; bookStep++) {
          await solveTurnstile(page);
          await delay(1000, 2000);
          var bookResult = await askVFSDomAgent(page, config, account, step + bookStep + 1, recentActions);
          if (!bookResult) break;

          if (bookResult.status === "booking_confirmed") {
            const finalSs = await takeScreenshotBase64(page);
            console.log("  🎉✅ RANDEVU BAŞARIYLA ALINDI!");
            await logStep(id, "appt_confirm", `✅ RANDEVU ALINDI! | ${applicantName}`);
            await reportResult(id, "found", `✅ RANDEVU ALINDI! | ${applicantName}`, 1, finalSs);
            await sendSmsNotification(`VFS RANDEVU ALINDI! ${applicantName} | Otomatik rezervasyon basarili!`);
            break;
          }

          if (bookResult.status === "no_appointment" || bookResult.status === "error") break;

          // Aksiyonları yürüt
          if (bookResult.actions && bookResult.actions.length > 0) {
            var bookElements = await extractPageElements(page);
            for (var bi = 0; bi < bookResult.actions.length; bi++) {
              await executeVfsDomAction(page, bookResult.actions[bi], bookElements);
              await delay(500, 1500);
            }
            recentActions.push("Booking adım " + (bookStep + 1) + ": " + (bookResult.actions[0].reason || ""));
          }
        }

        return { found: true, accountBanned: false, hadError: false };
      }

      if (status === "no_appointment") {
        const applicantName = (config.applicants && config.applicants.length > 0)
          ? `${config.applicants[0].first_name || ""} ${config.applicants[0].last_name || ""}`.trim() || account.email
          : account.email;
        console.log("  ❌ Randevu yok.");
        const ss = await takeScreenshotBase64(page);
        await logStep(id, "no_slots", `Müsait randevu yok | ${applicantName}`);
        await reportResult(id, "checking", `Müsait randevu yok | ${applicantName}`, 0, ss);
        return { found: false, accountBanned: false, hadError: false };
      }

      if (status === "account_banned") {
        console.log("  ⛔ Hesap engellenmiş!");
        const ss = await takeScreenshotBase64(page);
        await logStep(id, "login_fail", `❌ Hesap engellenmiş | ${account.email}`);
        await reportResult(id, "error", `❌ Hesap engellenmiş | ${account.email}`, 0, ss);
        await updateAccountStatus(account.id, "banned");
        return { found: false, accountBanned: true, hadError: true };
      }

      if (status === "session_expired") {
        console.log("  ⏰ Oturum süresi doldu");
        const ss = await takeScreenshotBase64(page);
        const cooldownSec = 30 + Math.floor(Math.random() * 30);
        await logStep(id, "session_expired", `⏰ Oturum süresi doldu | ${account.email} | ${cooldownSec}s bekleniyor`);
        await reportResult(id, "session_expired", `Oturum süresi doldu | ${account.email}`, 0, ss);
        return { found: false, accountBanned: false, ipBlocked: false, hadError: false, sessionExpired: true, sessionCooldownMs: cooldownSec * 1000 };
      }

      if (status === "ip_blocked") {
        console.log("  🚫 IP engellendi");
        banIpImmediately(activeIp, "dom_agent_detected_ip_block");
        const ss = await takeScreenshotBase64(page);
        await logStep(id, "network_error", `IP engellendi (DOM Agent) | ${account.email}`);
        await reportResult(id, "error", `IP engellendi | ${account.email}`, 0, ss);
        return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
      }

      if (status === "otp_required") {
        console.log("  📩 OTP gerekiyor — manuel OTP bekleniyor");
        const ss = await takeScreenshotBase64(page);
        await logStep(id, "login_otp", `⏸ OTP ekranı — manuel OTP bekleniyor | ${account.email}`);
        await reportResult(id, "otp_waiting", `OTP ekranı geldi, manuel OTP bekleniyor | ${account.email}`, 0, ss);

        await setOtpRequested(account.id);

        var otpWaitStart = Date.now();
        var OTP_WAIT_TIMEOUT = 5 * 60 * 1000;
        var otpValue = null;
        var otpPageClosed = false;

        while (Date.now() - otpWaitStart < OTP_WAIT_TIMEOUT) {
          await delay(4000, 5000);

          try {
            var otpPageState = await page.evaluate(() => {
              var text = (document.body?.innerText || "").toLowerCase();
              var url = window.location.href.toLowerCase();
              return {
                hasPageError:
                  text.includes("beklenmeyen hata") ||
                  (text.includes("(500)") && text.includes("hata")) ||
                  url.includes("page-not-found") ||
                  text.includes("sorry, something went wrong") ||
                  text.includes("bir şeyler ters gitti"),
                hasOtpText:
                  text.includes("doğrulama kodu") ||
                  text.includes("verification code") ||
                  text.includes("tek kullanımlık") ||
                  text.includes("tek seferlik") ||
                  text.includes("otp"),
                hasTableValidation:
                  text.includes("mandatory") ||
                  text.includes("required") ||
                  text.includes("zorunlu") ||
                  text.includes("geçersiz") ||
                  text.includes("invalid") ||
                  text.includes("lütfen") ||
                  text.includes("başvuru sahibi") ||
                  text.includes("kaydet"),
              };
            });

            if (otpPageState.hasPageError) {
              console.log("  💥 OTP beklerken sayfa hatası algılandı — yeni IP ile yeniden başlanacak");
              var errSs = await takeScreenshotBase64(page);
              await logStep(id, "error", `💥 Sayfa hatası (OTP bekleme) — yeniden başlanıyor | ${account.email}`);
              await reportResult(id, "error", `Sayfa hatası — yeni IP ile tekrar deneniyor | ${account.email}`, 0, errSs);
              return { found: false, accountBanned: false, ipBlocked: false, hadError: true, pageError: true };
            }

            if (otpPageState.hasTableValidation && !otpPageState.hasOtpText) {
              console.log("  ℹ Form/tablo doğrulama mesajı algılandı — sayfa açık tutuluyor, kapanmayacak");
              await logStep(id, "wait_manual", `Form doğrulama / tablo mesajı algılandı — sayfa açık tutuluyor | ${account.email}`);
            }
          } catch (stateErr) {
            console.log("  [OTP] Sayfa durum kontrolü atlandı:", stateErr.message);
          }

          try {
            otpValue = await readManualOtp(account.id);
            if (otpValue) {
              console.log("  ✅ OTP alındı: " + otpValue + " (Manuel)");
              break;
            }
          } catch (e) {
            console.log("  [OTP] Manuel kontrol hatası:", e.message);
          }

          var elapsed = Math.round((Date.now() - otpWaitStart) / 1000);
          if (elapsed % 20 === 0) {
            console.log("  ⏳ OTP bekleniyor... (" + elapsed + "s)");
          }

          try {
            await page.evaluate(() => true);
          } catch {
            otpPageClosed = true;
            break;
          }
        }

        if (otpPageClosed) {
          console.log("  ⚠ OTP beklerken sayfa kapandı — hata sayılmadan yeniden denenecek");
          await logStep(id, "warning", `OTP beklerken sayfa kapandı | ${account.email}`);
          return { found: false, accountBanned: false, hadError: false, otpPageClosed: true };
        }

        if (!otpValue) {
          console.log("  ❌ OTP zaman aşımı (5 dakika) — sayfa açık kalacak, manuel beklemeye geçiliyor");
          await logStep(id, "login_otp", `OTP zaman aşımı — manuel beklemeye geçildi | ${account.email}`);
          await reportResult(id, "otp_waiting", `OTP zaman aşımı — sayfa açık, manuel müdahale bekleniyor | ${account.email}`, 0, ss);
          
          // Manuel bekleme moduna geç — 10 dakika daha bekle, sayfa AÇIK KALSIN
          var otpManualWaitStart = Date.now();
          var OTP_MANUAL_WAIT_TIMEOUT = 10 * 60 * 1000;
          while (Date.now() - otpManualWaitStart < OTP_MANUAL_WAIT_TIMEOUT) {
            await delay(10000, 12000);
            
            // Manuel OTP girildi mi kontrol et
            try {
              const lateOtp = await readManualOtp(account.id);
              if (lateOtp) {
                console.log("  ✅ Geç OTP alındı (manuel bekleme): " + lateOtp);
                otpValue = lateOtp;
                break;
              }
            } catch {}
            
            // Ekran görüntüsü (her dakika)
            var otpManualElapsed = Math.round((Date.now() - otpManualWaitStart) / 1000);
            if (otpManualElapsed % 60 === 0) {
              try {
                var mss = await takeScreenshotBase64(page);
                await logStep(id, "wait_manual", `⏸ OTP manuel bekleniyor... (${otpManualElapsed}s) | ${account.email}`);
                if (mss) await reportResult(id, "otp_waiting", `OTP bekleniyor (${Math.round(otpManualElapsed/60)}dk) | ${account.email}`, 0, mss);
              } catch {}
            }
            
            // Sayfa hala açık mı?
            try { await page.evaluate(() => true); } catch { break; }
          }
          
          // Geç OTP geldiyse doldur ve devam et
          if (otpValue) {
            try {
              var lateOtpFilled = await page.evaluate(function(code) {
                var inputs = Array.from(document.querySelectorAll("input, textarea"));
                var isVisible = function(el) {
                  if (!el) return false;
                  var rect = el.getBoundingClientRect();
                  var style = window.getComputedStyle(el);
                  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
                };
                var setValue = function(el, value) {
                  if (!el) return;
                  try {
                    el.removeAttribute("readonly");
                    el.readOnly = false;
                    el.removeAttribute("disabled");
                    el.disabled = false;
                  } catch {}
                  var proto = Object.getPrototypeOf(el);
                  var descriptor = Object.getOwnPropertyDescriptor(proto, "value")
                    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
                    || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
                  if (descriptor && descriptor.set) descriptor.set.call(el, value);
                  else el.value = value;
                  el.dispatchEvent(new Event("focus", { bubbles: true }));
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value.slice(-1) || "0" }));
                  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: value.slice(-1) || "0" }));
                  el.dispatchEvent(new Event("blur", { bubbles: true }));
                };
                var otpHints = ["otp", "code", "doğrulama", "verification", "tek kullanımlık"];
                var candidates = inputs.filter(function(inp) {
                  if (!isVisible(inp)) return false;
                  var type = (inp.getAttribute("type") || "text").toLowerCase();
                  var parentText = (inp.closest("mat-form-field, .form-group, .otp-container, label, div")?.textContent || "").toLowerCase();
                  var haystack = [inp.name || "", inp.id || "", inp.placeholder || "", parentText].join(" ").toLowerCase();
                  if (type === "hidden" || type === "email") return false;
                  if (type === "password" && !(haystack.includes("otp") || haystack.includes("code") || haystack.includes("doğrulama") || haystack.includes("verification") || inp.autocomplete === "one-time-code")) {
                    return false;
                  }
                  return otpHints.some(function(k) { return haystack.includes(k); }) || inp.inputMode === "numeric" || inp.maxLength === 6;
                });
                var singleInput = candidates[0];
                if (!singleInput) {
                  var fallbackInputs = inputs.filter(function(inp) {
                    var type = (inp.getAttribute("type") || "text").toLowerCase();
                    return type !== "hidden" && type !== "email";
                  });
                  if (fallbackInputs.length === 1) singleInput = fallbackInputs[0];
                }
                if (!singleInput) return false;
                singleInput.focus();
                setValue(singleInput, code);
                return true;
              }, otpValue);
              
              if (lateOtpFilled) {
                await delay(500, 1000);
                var lateVerify = await clickOtpVerification(page);
                if (lateVerify.clicked) console.log("  ✅ Geç OTP doğrula tıklandı");
                else await page.keyboard.press("Enter").catch(() => {});
                await logStep(id, "login_otp", `Geç OTP girildi ve doğrulandı | ${account.email}`);
                recentActions.push("Geç OTP girildi ve doğrulandı");
                await delay(2000, 3000);
                continue;
              }
            } catch (lateErr) {
              console.log("  [OTP] Geç OTP yazma hatası:", lateErr.message);
            }
          }
          
          return { found: false, accountBanned: false, hadError: false, otpRequired: true, otpTimeout: true, manualWait: true };
        }

        try {
          var otpFilled = await page.evaluate(function(code) {
            var inputs = Array.from(document.querySelectorAll("input, textarea"));
            var isVisible = function(el) {
              if (!el) return false;
              var rect = el.getBoundingClientRect();
              var style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            };
            var setValue = function(el, value) {
              if (!el) return;
              try {
                el.removeAttribute("readonly");
                el.readOnly = false;
                el.removeAttribute("disabled");
                el.disabled = false;
              } catch {}
              var proto = Object.getPrototypeOf(el);
              var descriptor = Object.getOwnPropertyDescriptor(proto, "value")
                || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
                || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
              if (descriptor && descriptor.set) descriptor.set.call(el, value);
              else el.value = value;
              el.dispatchEvent(new Event("focus", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value.slice(-1) || "0" }));
              el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: value.slice(-1) || "0" }));
              el.dispatchEvent(new Event("blur", { bubbles: true }));
            };

            var otpHints = ["otp", "code", "doğrulama", "verification", "tek kullanımlık", "one-time", "seferlik"];
            var candidates = inputs.filter(function(inp) {
              if (!isVisible(inp)) return false;
              var type = (inp.getAttribute("type") || "text").toLowerCase();
              if (!["text", "number", "tel", "password"].includes(type) && type !== "") return false;
              if (["email", "hidden"].includes(type)) return false;
              var parentText = (inp.closest("mat-form-field, .form-group, .otp-container, label, div")?.textContent || "").toLowerCase();
              var haystack = [inp.name || "", inp.id || "", inp.placeholder || "", inp.autocomplete || "", inp.inputMode || "", parentText]
                .join(" ")
                .toLowerCase();
              if (type === "password" && !(haystack.includes("otp") || haystack.includes("code") || haystack.includes("doğrulama") || haystack.includes("verification") || inp.autocomplete === "one-time-code")) return false;
              return otpHints.some(function(k) { return haystack.includes(k); })
                || inp.autocomplete === "one-time-code"
                || inp.inputMode === "numeric"
                || inp.maxLength === 1
                || inp.maxLength === 4
                || inp.maxLength === 5
                || inp.maxLength === 6
                || inp.maxLength === 8
                || inp.maxLength === code.length;
            });

            var segmented = candidates.filter(function(inp) { return inp.maxLength === 1; });
            if (segmented.length >= 4) {
              for (var i = 0; i < Math.min(segmented.length, code.length); i++) {
                segmented[i].focus();
                setValue(segmented[i], code[i]);
              }
              return true;
            }

            var singleInput = candidates.find(function(inp) {
              return inp.maxLength <= 0 || inp.maxLength >= code.length || inp.autocomplete === "one-time-code";
            });

            if (!singleInput) {
              var fallbackInputs = inputs.filter(function(inp) {
                var type = (inp.getAttribute("type") || "text").toLowerCase();
                return type !== "hidden" && type !== "email";
              });
              if (fallbackInputs.length === 1) singleInput = fallbackInputs[0];
            }

            if (!singleInput) return false;
            singleInput.focus();
            setValue(singleInput, code);
            return true;
          }, otpValue);

          if (otpFilled) {
            await delay(500, 1000);
            var verifyClick = await clickOtpVerification(page);
            if (verifyClick.clicked) {
              console.log("  ✅ Doğrula butonuna tıklandı (" + verifyClick.reason + ")");
            } else {
              await page.keyboard.press("Enter").catch(function() {});
              console.log("  ⚠ OTP doğrulama Enter fallback ile denendi (" + verifyClick.reason + ")");
            }
          } else {
            console.log("  ❌ OTP alanı bulunamadı veya alan framework tarafından kilitli — sayfa açık kalacak, tekrar denenecek");
            await logStep(id, "warning", `OTP kodu alındı ama OTP alanı eşleşmedi/kilitli — tekrar denenecek | ${account.email}`);
            recentActions.push("OTP alanı eşleşmedi veya kilitli, tekrar denenecek");
            await delay(3000, 5000);
            continue;
          }
        } catch (otpErr) {
          console.error("  [OTP] Yazma hatası:", otpErr.message);
          await logStep(id, "warning", `OTP yazma hatası — sayfa açık, tekrar denenecek | ${account.email}`);
          recentActions.push("OTP yazma hatası: " + otpErr.message);
          await delay(3000, 5000);
          continue;
        }

        await logStep(id, "login_otp", `OTP girildi ve doğrulandı | ${account.email}`);
        recentActions.push("OTP girildi ve doğrulandı");
        // OTP sonrası sayfa yönlendirmesi için daha uzun bekle
        console.log("  ⏳ OTP sonrası sayfa yüklenmesi bekleniyor (5-8s)...");
        await delay(5000, 8000);
        // Sayfa hala açık mı kontrol et
        try {
          await page.evaluate(() => document.readyState);
          console.log("  ✅ Sayfa hala açık, devam ediliyor");
        } catch (navErr) {
          console.log("  ⚠ OTP sonrası sayfa navigasyonu — 5s daha bekleniyor");
          await delay(5000, 7000);
        }
        continue;
      }

      if (status === "captcha_needed") {
        console.log("  🔐 CAPTCHA çözülüyor...");
        await solveTurnstile(page);
        await delay(3000, 5000);
        recentActions.push("Turnstile CAPTCHA çözüldü");
        continue;
      }

      if (status === "wait_manual") {
        console.log("  ⏸ Manuel kontrol gerekiyor — sayfa açık kalacak, bekleniyor...");
        const ss = await takeScreenshotBase64(page);
        await logStep(id, "wait_manual", `⏸ Manuel kontrol bekleniyor | ${account.email} | ${agentResult.message || "Form tamamlandı"}`);
        await reportResult(id, "otp_waiting", `Manuel kontrol bekleniyor — ${agentResult.message || "Form dolduruldu, onay bekleniyor"} | ${account.email}`, 0, ss);
        
        // 10 dakika boyunca bekle, sayfa AÇIK KALSIN
        var manualWaitStart = Date.now();
        var MANUAL_WAIT_TIMEOUT = 10 * 60 * 1000;
        
        while (Date.now() - manualWaitStart < MANUAL_WAIT_TIMEOUT) {
          await delay(10000, 12000);
          
          // Sayfa hatası kontrolü (500, page-not-found, vb.)
          try {
            var pageErrorCheck = await page.evaluate(() => {
              var text = (document.body?.innerText || "").toLowerCase();
              var url = window.location.href.toLowerCase();
              return text.includes("beklenmeyen hata") || 
                     (text.includes("(500)") && text.includes("hata")) ||
                     url.includes("page-not-found") ||
                     text.includes("sorry, something went wrong") ||
                     text.includes("bir şeyler ters gitti");
            });
            if (pageErrorCheck) {
              console.log("  💥 Manuel bekleme sırasında sayfa hatası algılandı — yeni IP ile tekrar başlanacak");
              var errSs = await takeScreenshotBase64(page);
              await logStep(id, "error", `💥 Sayfa hatası (manuel bekleme) — yeniden başlanıyor | ${account.email}`);
              await reportResult(id, "error", `Sayfa hatası (500) — yeni IP ile tekrar deneniyor | ${account.email}`, 0, errSs);
              return { found: false, accountBanned: false, ipBlocked: false, hadError: true, pageError: true };
            }
          } catch {}
          
          var elapsed2 = Math.round((Date.now() - manualWaitStart) / 1000);
          if (elapsed2 % 60 === 0) {
            var wss = await takeScreenshotBase64(page);
            await logStep(id, "wait_manual", `⏸ Manuel bekleniyor... (${elapsed2}s) | ${account.email}`);
            if (wss) await reportResult(id, "otp_waiting", `Manuel bekleniyor (${Math.round(elapsed2/60)}dk) | ${account.email}`, 0, wss);
          }
          
          // Sayfa kapanmış mı kontrol et
          try { await page.evaluate(() => true); } catch { break; }
        }
        
        console.log("  ⏸ Manuel bekleme sona erdi");
        return { found: false, accountBanned: false, hadError: false, manualWait: true };
      }

      // Devam eden durum — aksiyonları yürüt
      if (agentResult.actions && agentResult.actions.length > 0) {
        var currentElements = await extractPageElements(page);
        var firstAction = agentResult.actions[0];
        await executeVfsDomAction(page, firstAction, currentElements);
        recentActions.push("Adım " + step + ": " + (firstAction.reason || firstAction.type));
        if (recentActions.length > 10) recentActions = recentActions.slice(-10);
      }

      // Navigasyon bekleme
      await delay(1500, 3000);

      // Sayfa değişti mi kontrol et
      var newPageContent = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      if (isCloudflareChallenge(newPageContent)) {
        console.log("  [DOM] CF challenge tespit edildi, çözülüyor...");
        await logStep(id, "login_captcha", "CF challenge algılandı (adım " + step + ")");
        var cfOk = await waitForCloudflareChallengeResolve(page, 60000);
        if (!cfOk) {
          banIpImmediately(activeIp, "cf_challenge_mid_flow");
          return { found: false, accountBanned: false, ipBlocked: true, hadError: true };
        }
      }
    }

    // Max step'e ulaşıldı
    console.log("  ⚠ Maksimum adım sayısına ulaşıldı (" + MAX_STEPS + ")");
    const ss = await takeScreenshotBase64(page);
    await logStep(id, "warning", `Maksimum adım aşıldı (${MAX_STEPS}) | ${account.email}`);
    await reportResult(id, "error", `Maksimum adım aşıldı | ${account.email}`, 0, ss);
    return { found: false, accountBanned: false, hadError: true };

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
      // mat-select kontrol
      const matSelects = Array.from(document.querySelectorAll('mat-select .mat-mdc-select-value, mat-select .mat-select-value, .mat-mdc-select-min-line'));
      for (const ms of matSelects) {
        const txt = (ms.textContent || '').trim();
        if (txt.includes('90') || txt.includes('Turkey') || txt.includes('Türkiye')) return 'mat-already:' + txt;
      }
      return null;
    });
    if (alreadySelected) { console.log(`  [REG] ✅ Dial code zaten 90 (${alreadySelected})`); return true; }
  } catch {}

  for (let attempt = 1; attempt <= 8; attempt++) {
    console.log(`  [REG] Dial code seçme denemesi ${attempt}/8...`);

    // 1. Dropdown'u fiziksel tıkla ile aç
    const triggerInfo = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };

      // "Arama Kodu" label'ını bul ve yakınındaki dropdown trigger'ı tıkla
      const allLabels = Array.from(document.querySelectorAll('label, span, div, p, mat-label'));
      const dialLabel = allLabels.find(el => {
        const t = (el.textContent || '').toLowerCase().trim();
        return isVisible(el) && (t.includes('arama kodu') || t.includes('dial code') || t.includes('country code') || t === 'arama kodu *');
      });

      if (dialLabel) {
        const scope = dialLabel.closest('mat-form-field, .mat-mdc-form-field, .form-group, .row, .col') || dialLabel.parentElement?.parentElement || dialLabel.parentElement;
        if (scope) {
          // mat-select trigger
          const matSelect = scope.querySelector('mat-select, [role="combobox"], .mat-mdc-select, .mat-select');
          if (matSelect && isVisible(matSelect)) {
            const rect = matSelect.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, type: 'mat-select' };
          }
          // mat-select-trigger
          const trigger = scope.querySelector('.mat-mdc-select-trigger, .mat-select-trigger');
          if (trigger && isVisible(trigger)) {
            const rect = trigger.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, type: 'trigger' };
          }
          // Native select
          const sel = scope.querySelector('select');
          if (sel && isVisible(sel)) {
            return { native: true, selectIndex: Array.from(document.querySelectorAll('select')).indexOf(sel) };
          }
        }
      }

      // Fallback: tüm mat-select'leri bul, phone ile ilişkili olanı seç
      const matSelects = Array.from(document.querySelectorAll('mat-select, [role="combobox"]')).filter(isVisible);
      for (const ms of matSelects) {
        const parent = ms.closest('mat-form-field, .mat-mdc-form-field');
        const parentText = (parent?.textContent || ms.getAttribute('aria-label') || '').toLowerCase();
        if (parentText.includes('arama') || parentText.includes('dial') || parentText.includes('code') || parentText.includes('country')) {
          const rect = ms.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, type: 'fallback-mat' };
        }
      }

      return null;
    });

    if (triggerInfo && triggerInfo.native) {
      // Native select — doğrudan value set et
      const ok = await page.evaluate((idx) => {
        const sel = document.querySelectorAll('select')[idx];
        if (!sel) return false;
        const opts = Array.from(sel.options || []);
        const turkeyIdx = opts.findIndex(o => {
          const t = `${o.textContent || ''} ${o.value || ''}`.toLowerCase();
          return /turkey|türkiye|turkiye|\(90\)|\+90|(^|\D)90(\D|$)/i.test(t);
        });
        if (turkeyIdx === -1) return false;
        sel.selectedIndex = turkeyIdx;
        sel.value = opts[turkeyIdx].value;
        opts[turkeyIdx].selected = true;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) { setter.call(sel, opts[turkeyIdx].value); sel.dispatchEvent(new Event('change', { bubbles: true })); }
        return true;
      }, triggerInfo.selectIndex);
      if (ok) { console.log('  [REG] ✅ Dial code native select ile seçildi'); return true; }
    }

    if (triggerInfo && triggerInfo.x) {
      // Fiziksel tıkla ile dropdown aç
      await page.mouse.click(triggerInfo.x, triggerInfo.y);
      console.log(`  [REG] Dropdown trigger tıklandı (${triggerInfo.type}) @ ${Math.round(triggerInfo.x)},${Math.round(triggerInfo.y)}`);
      await delay(800, 1500);

      // 2. Açılan panelde Turkey'i bul ve tıkla
      const selected = await page.evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const isTurkey = (txt) => /turkey|türkiye|turkiye|\(90\)|\+90/i.test(String(txt || ''));

        // mat-option veya role="option" ara
        const options = Array.from(document.querySelectorAll('mat-option, .mat-mdc-option, .mat-option, [role="option"], .ng-option, li.option')).filter(isVisible);
        const turkeyOpt = options.find(o => isTurkey(o.textContent || ''));
        if (turkeyOpt) {
          turkeyOpt.scrollIntoView({ block: 'center' });
          turkeyOpt.click();
          return { ok: true, text: (turkeyOpt.textContent || '').trim().substring(0, 60) };
        }

        // Overlay panel scroll
        const panels = Array.from(document.querySelectorAll('.cdk-overlay-pane, .mat-mdc-select-panel, .mat-select-panel, [role="listbox"]')).filter(isVisible);
        for (const panel of panels) {
          const allOpts = Array.from(panel.querySelectorAll('mat-option, [role="option"]'));
          const tOpt = allOpts.find(o => isTurkey(o.textContent || ''));
          if (tOpt) {
            tOpt.scrollIntoView({ block: 'center' });
            tOpt.click();
            return { ok: true, text: (tOpt.textContent || '').trim().substring(0, 60) };
          }
        }

        return { ok: false, optionCount: options.length };
      });

      if (selected.ok) {
        console.log(`  [REG] ✅ Dial code seçildi: ${selected.text}`);
        await delay(300, 600);
        return true;
      }

      console.log(`  [REG] Turkey bulunamadı, ${selected.optionCount || 0} option görüldü`);

      // Panel açıksa scroll ile Turkey'i aramayı dene
      if (selected.optionCount > 0) {
        // Keyboard ile "tur" yaz — arama destekleniyorsa
        await page.keyboard.type('tur', { delay: 100 });
        await delay(500, 800);

        const afterType = await page.evaluate(() => {
          const options = Array.from(document.querySelectorAll('mat-option, [role="option"]')).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const isTurkey = (txt) => /turkey|türkiye|turkiye|\(90\)|\+90/i.test(String(txt || ''));
          const tOpt = options.find(o => isTurkey(o.textContent || ''));
          if (tOpt) { tOpt.click(); return true; }
          return false;
        });
        if (afterType) { console.log('  [REG] ✅ Dial code type+click ile seçildi'); return true; }
      }

      // Paneli kapat (Escape)
      await page.keyboard.press('Escape');
      await delay(300, 500);
    }

    if (!triggerInfo) {
      console.log('  [REG] Dial code trigger bulunamadı, sayfa scroll...');
      await page.evaluate(() => window.scrollBy(0, 200));
    }
    await delay(500, 1000);
  }

  console.log("  [REG] ⚠ Dial code seçilemedi, devam ediliyor (90 varsayılan olabilir)");
  return false;
}

async function tickAllCheckboxes(page) {
  console.log("  [REG] Onay checkbox'ları işaretleniyor (fiziksel toggle)...");

  // 1. Checkbox'ları bul
  const checkboxInfo = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const keywords = /(gizlilik|privacy|kvkk|koşul|terms|condition|consent|onay|veri transfer|data transfer|kabul|aydınlatma)/i;
    const skipText = /(cookie|tanımlama bilgisi|onetrust|preferences|allow all|accept all)/i;

    const emailInput = Array.from(document.querySelectorAll('input[type="email"], input[name="email"], input[formcontrolname*="email"]')).find(isVisible);
    const form = emailInput?.closest("form");
    const scope = form || emailInput?.closest("main") || document.querySelector("main") || document.body;

    const results = [];

    // input[type="checkbox"]
    const inputCbs = Array.from(scope.querySelectorAll('input[type="checkbox"]')).filter(isVisible);
    for (const cb of inputCbs) {
      const host = cb.closest('label, mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, .mdc-form-field, .form-check, .checkbox-container') || cb.parentElement;
      const meta = `${cb.name || ""} ${cb.id || ""} ${cb.getAttribute("aria-label") || ""} ${host?.textContent || ""}`.toLowerCase();
      if (skipText.test(meta)) continue;

      const shouldCheck = cb.required || cb.getAttribute("aria-required") === "true" || keywords.test(meta);
      // Tüm checkbox'ları al — shouldCheck olsun olmasın fallback için
      const clickEl = host || cb;
      const rect = clickEl.getBoundingClientRect();
      results.push({
        type: "input",
        priority: shouldCheck,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        meta: meta.substring(0, 80),
      });
    }

    // mat-checkbox / role="checkbox"
    const roleBoxes = Array.from(scope.querySelectorAll('mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, [role="checkbox"]')).filter(isVisible);
    for (const box of roleBoxes) {
      const input = box.querySelector('input[type="checkbox"]');
      if (input && inputCbs.includes(input)) continue;

      const text = `${box.textContent || ""} ${box.getAttribute("aria-label") || ""}`.toLowerCase();
      if (skipText.test(text)) continue;

      const ariaRequired = box.getAttribute("aria-required") === "true" || input?.required;
      const hasKeyword = keywords.test(text);

      const rect = box.getBoundingClientRect();
      results.push({
        type: "role",
        priority: ariaRequired || hasKeyword,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        meta: text.substring(0, 80),
      });
    }

    return { checkboxes: results, total: results.length };
  });

  console.log(`  [REG] ${checkboxInfo.total} checkbox bulundu`);

  // 2. Önce priority olanları, sonra diğerlerini fiziksel tıklama ile toggle et
  const priorityCbs = checkboxInfo.checkboxes.filter(c => c.priority);
  const otherCbs = checkboxInfo.checkboxes.filter(c => !c.priority);
  const allCbs = [...priorityCbs, ...otherCbs];

  const emitFormEvents = async () => {
    await page.evaluate(() => {
      const formEl = document.querySelector("form");
      if (formEl) {
        formEl.dispatchEvent(new Event("input", { bubbles: true }));
        formEl.dispatchEvent(new Event("change", { bubbles: true }));
        formEl.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    });
  };

  const getCheckboxStateAtPoint = async (x, y) => {
    return await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { found: false, checked: false };

      const input = el.closest('input[type="checkbox"]') || el.querySelector?.('input[type="checkbox"]');
      if (input) {
        return { found: true, checked: !!input.checked };
      }

      const roleBox = el.closest('mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, [role="checkbox"]');
      if (roleBox) {
        const roleInput = roleBox.querySelector('input[type="checkbox"]');
        if (roleInput) return { found: true, checked: !!roleInput.checked };
        const ariaChecked = roleBox.getAttribute("aria-checked") === "true";
        const classChecked = roleBox.classList.contains("mat-checkbox-checked") ||
          roleBox.classList.contains("mat-mdc-checkbox-checked") ||
          roleBox.classList.contains("mdc-checkbox--selected") ||
          roleBox.classList.contains("mdc-checkbox--checked");
        return { found: true, checked: ariaChecked || classChecked };
      }

      return { found: false, checked: false };
    }, { x, y });
  };

  const pulseCheckbox = async (x, y) => {
    // Strateji: Tam 2 tıklama, 1sn aralıkla (pasif→aktif döngüsü Angular'ı tetikler)
    // Gerekirse 2 tur yaparak final state = checked olmasını garanti et

    const doDoubleClick = async () => {
      await page.mouse.click(x, y);
      await delay(1000, 1200);
      await page.mouse.click(x, y);
      await delay(1000, 1200);
    };

    let state = await getCheckboxStateAtPoint(x, y);

    if (!state.found) {
      // Element bulunamadı, yine de 2 kez tıkla
      await doDoubleClick();
      return;
    }

    // 1. tur: 2 tıklama (toggle toggle → başlangıç durumuna döner)
    await doDoubleClick();
    state = await getCheckboxStateAtPoint(x, y);

    if (!state.checked) {
      // Checked değilse bir tık daha at (tek sayı = toggle)
      await page.mouse.click(x, y);
      await delay(1000, 1200);
      state = await getCheckboxStateAtPoint(x, y);

      // Hala checked değilse 2. tam tur dene
      if (!state.checked) {
        await doDoubleClick();
        state = await getCheckboxStateAtPoint(x, y);
        if (!state.checked) {
          await page.mouse.click(x, y);
          await delay(500, 800);
        }
      }
    }
  };

  const getSubmitStatus = async () => {
    return await page.evaluate(() => {
      const submitKeywords = ["devam", "continue", "register", "create", "kayıt", "oluştur", "sign up"];
      const btns = Array.from(document.querySelectorAll("button"));
      const submitBtn = btns.find(b => {
        const txt = (b.textContent || "").toLowerCase().trim();
        return submitKeywords.some(k => txt.includes(k));
      }) || document.querySelector('button[type="submit"]');

      const visibleInputs = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(cb => {
        const rect = cb.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      const roleBoxes = Array.from(document.querySelectorAll('mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, [role="checkbox"]')).filter(box => {
        const rect = box.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      const checkedInputCount = visibleInputs.filter(cb => cb.checked).length;
      const checkedRoleOnlyCount = roleBoxes.filter(box => {
        const input = box.querySelector('input[type="checkbox"]');
        if (input) return false;
        const ariaChecked = box.getAttribute("aria-checked") === "true";
        const classChecked = box.classList.contains("mat-checkbox-checked") ||
          box.classList.contains("mat-mdc-checkbox-checked") ||
          box.classList.contains("mdc-checkbox--selected") ||
          box.classList.contains("mdc-checkbox--checked");
        return ariaChecked || classChecked;
      }).length;

      return {
        submitDisabled: !!submitBtn?.disabled,
        submitText: (submitBtn?.textContent || "").trim().substring(0, 30),
        totalVisible: visibleInputs.length + roleBoxes.filter(box => !box.querySelector('input[type="checkbox"]')).length,
        checkedCount: checkedInputCount + checkedRoleOnlyCount,
      };
    });
  };

  let touched = 0;
  for (const cb of allCbs) {
    console.log(`  [REG] Checkbox pulse: ${cb.meta.substring(0, 40)}...`);
    await pulseCheckbox(cb.x, cb.y);

    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return;
      const input = el.closest('input[type="checkbox"]') || el.querySelector?.('input[type="checkbox"]');
      if (input) {
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
      }
      const matBox = el.closest('mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, [role="checkbox"]');
      if (matBox) {
        const inp = matBox.querySelector('input[type="checkbox"]');
        if (inp) {
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          inp.dispatchEvent(new Event("blur", { bubbles: true }));
        }
      }
    }, { x: cb.x, y: cb.y });

    touched++;
    await delay(400, 800);
  }

  await emitFormEvents();
  await delay(500, 1000);

  let submitStatus = await getSubmitStatus();
  console.log(`  [REG] Checkbox sonucu: touched=${touched}, checked=${submitStatus.checkedCount}/${submitStatus.totalVisible}, submitDisabled=${submitStatus.submitDisabled}, submitText="${submitStatus.submitText}"`);

  if (submitStatus.submitDisabled) {
    console.log("  [REG] ⚠ Submit hâlâ disabled, unchecked checkbox'lar tekrar pulse ediliyor...");
    const remaining = await page.evaluate(() => {
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const skipText = /(cookie|tanımlama bilgisi|onetrust|preferences|allow all|accept all)/i;
      const unchecked = [];

      document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (!isVisible(cb) || cb.checked) return;
        const host = cb.closest("label, div, mat-checkbox, .mat-checkbox, .mat-mdc-checkbox") || cb.parentElement;
        const meta = `${cb.name || ""} ${cb.id || ""} ${host?.textContent || ""}`.toLowerCase();
        if (skipText.test(meta)) return;
        const rect = (host || cb).getBoundingClientRect();
        unchecked.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      });

      document.querySelectorAll('mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, [role="checkbox"]').forEach(box => {
        if (!isVisible(box)) return;
        const input = box.querySelector('input[type="checkbox"]');
        if (input) return;
        const text = `${box.textContent || ""} ${box.getAttribute("aria-label") || ""}`.toLowerCase();
        if (skipText.test(text)) return;
        const ariaChecked = box.getAttribute("aria-checked") === "true";
        const classChecked = box.classList.contains("mat-checkbox-checked") || box.classList.contains("mat-mdc-checkbox-checked") || box.classList.contains("mdc-checkbox--selected") || box.classList.contains("mdc-checkbox--checked");
        if (ariaChecked || classChecked) return;
        const rect = box.getBoundingClientRect();
        unchecked.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      });

      return unchecked;
    });

    for (const pos of remaining) {
      await pulseCheckbox(pos.x, pos.y);
      await delay(400, 800);
    }

    await emitFormEvents();
    await delay(700, 1200);
    submitStatus = await getSubmitStatus();
    console.log(`  [REG] Fallback sonrası: checked=${submitStatus.checkedCount}/${submitStatus.totalVisible}, submitDisabled=${submitStatus.submitDisabled}, submitText="${submitStatus.submitText}"`);
  }

  return !submitStatus.submitDisabled;
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
      // 3 kez üst üste tıkla (Angular algılaması için)
      for (let clickRound = 0; clickRound < 3; clickRound++) {
        best.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        best.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        best.click();
      }

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
      const hasOtpInput = !![...document.querySelectorAll('input, textarea')].find((inp) => {
        const type = (inp.getAttribute('type') || 'text').toLowerCase();
        const haystack = [
          inp.getAttribute('autocomplete') || '',
          inp.getAttribute('name') || '',
          inp.getAttribute('id') || '',
          inp.getAttribute('placeholder') || '',
          inp.getAttribute('aria-label') || '',
          inp.closest('label, mat-form-field, .mat-mdc-form-field, .form-group, .otp-container, div')?.textContent || '',
        ].join(' ').toLowerCase();
        if (type === 'hidden' || type === 'email') return false;
        return haystack.includes('otp') || haystack.includes('verification') || haystack.includes('doğrulama') || haystack.includes('code') ||
          inp.getAttribute('autocomplete') === 'one-time-code' || ['1', '4', '5', '6', '8'].includes(inp.getAttribute('maxlength') || '');
      });

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
    const launched = await launchBrowser();
    browser = launched.browser;
    page = launched.page;
    await humanMove(page);

    const regUrl = getVfsRegisterUrl(regCountry);
    console.log(`  [REG 1/7] Kayıt sayfası: ${regUrl} (${regCountryLabel})`);
    await rotateProxyAndGoto(page, regUrl);
    await humanIdle(5000, 10000); // Sayfayı okuyormuş gibi bekle
    await humanMove(page);
    await humanScroll(page);

    // Cookie banner — önce yüklenmesini bekle
    console.log("  [REG 2/7] Cookie banner bekleniyor...");
    try {
      let cookieClicked = false;
      for (let attempt = 0; attempt < 8 && !cookieClicked; attempt++) {
        cookieClicked = await page.evaluate(() => {
          const onetrust = document.getElementById('onetrust-accept-btn-handler');
          if (onetrust && onetrust.offsetParent !== null) { onetrust.click(); return true; }
          const btns = [...document.querySelectorAll("button, a")];
          const match = btns.find(b => {
            const txt = (b.textContent || "").toLowerCase();
            return (txt.includes("accept all") || txt.includes("kabul") || txt.includes("tümünü kabul") || txt.includes("tüm tanımlama") || txt.includes("tüm çerezleri kabul")) && b.offsetParent !== null;
          });
          if (match) { match.click(); return true; }
          return false;
        });
        if (!cookieClicked) await delay(1000, 1000);
      }
      if (cookieClicked) {
        console.log("  [REG 2/7] ✅ Cookie kabul edildi");
        await delay(1000, 1500);
      } else {
        console.log("  [REG 2/7] ⚠ Cookie banner bulunamadı, devam ediliyor");
      }
    } catch (e) {
      console.log("  [REG 2/7] Cookie hatası:", e.message);
    }

    // CAPTCHA
    console.log("  [REG 3/7] CAPTCHA...");
    await logStep(regLogConfigId, "reg_captcha", `CAPTCHA çözülüyor | ${account.email}`);
    await humanMove(page);
    await solveTurnstile(page);
    await humanIdle(3000, 6000);

    // CF challenge sonrası cookie banner tekrar çıkabilir — yakala
    console.log("  [REG 3.5/7] CF sonrası cookie banner kontrol...");
    try {
      const cookieAfterCF = await page.evaluate(() => {
        const onetrust = document.getElementById('onetrust-accept-btn-handler');
        if (onetrust && onetrust.offsetParent !== null) { onetrust.click(); return true; }
        const btns = [...document.querySelectorAll("button, a")];
        const match = btns.find(b => {
          const txt = (b.textContent || "").toLowerCase();
          return (txt.includes("accept all") || txt.includes("kabul") || txt.includes("tümünü kabul") || txt.includes("tüm tanımlama") || txt.includes("tüm çerezleri kabul")) && b.offsetParent !== null;
        });
        if (match) { match.click(); return true; }
        return false;
      });
      if (cookieAfterCF) {
        console.log("  [REG 3.5/7] ✅ CF sonrası cookie banner kabul edildi");
        await delay(1000, 1500);
      }
    } catch {}

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
    await delay(1000, 2000); // Kısa form inceleme

    // ========== FORM DOLDURMA ==========
    console.log("  [REG 5/7] Form dolduruluyor...");
    await logStep(regLogConfigId, "reg_form", `Kayıt formu dolduruluyor | ${account.email}`);

    // Angular uyumlu input doldurma helper
    async function fillAngularInput(page, element, value) {
      await delay(200, 400);
      await element.click({ clickCount: 3 });
      await delay(100, 200);
      await page.keyboard.press("Backspace");
      await delay(100, 200);

      // Hızlı yazma — karakter başı 15-40ms
      for (const ch of String(value)) {
        await page.keyboard.type(ch, { delay: Math.floor(Math.random() * 25) + 15 });
      }
      await delay(100, 300);

      // Angular reactive form event dispatch
      await page.evaluate((el, val) => {
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
      }, element, value);

      // Doğrulama: değer gerçekten girilmiş mi?
      const actualValue = await page.evaluate(el => el.value, element);
      if (actualValue !== value) {
        console.log(`  [REG] ⚠ Değer uyumsuz, direkt set yapılıyor`);
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
    await delay(300, 600);

    // ŞİFRE + ONAY
    const passwordInputs = await page.$$('input[type="password"]');
    console.log(`  [REG] ${passwordInputs.length} şifre alanı bulundu`);
    if (passwordInputs.length < 2) throw new Error("Şifre alanları bulunamadı");
    for (let i = 0; i < passwordInputs.length; i++) {
      await fillAngularInput(page, passwordInputs[i], account.password);
      await delay(200, 400);
    }
    console.log("  [REG] ✅ Şifre girildi");
    await delay(300, 600);

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

    // SUBMIT ÖNCESİ: Tüm inputlarda Angular validasyonunu zorla tetikle
    await page.evaluate(() => {
      const inputs = document.querySelectorAll('input, select, textarea');
      inputs.forEach(el => {
        el.dispatchEvent(new Event('focus', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });
      // Angular form validation tetikle
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        form.dispatchEvent(new Event('input', { bubbles: true }));
        form.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await delay(500, 1000);

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
// ==================== MANUAL BROWSER ====================
async function checkManualBrowserRequest() {
  try {
    const data = await apiPost({ action: "check_manual_browser" }, "check_manual_browser");
    return data.ok && data.requested;
  } catch (err) {
    return false;
  }
}

async function openManualBrowser() {
  console.log("\n🖥 MANUEL TARAYICI AÇILIYOR (sayfa açık kalacak)...");
  await loadProxySettingsFromDB();
  
  const activeIp = (PROXY_MODE !== "residential" && IP_LIST.length > 0) ? getNextIp() : null;
  const proxyLabel = PROXY_MODE === "residential" ? "residential proxy" : (activeIp || "doğrudan IP");
  console.log(`  [MANUAL] Proxy: ${proxyLabel}`);
  
  try {
    const loginUrl = "https://visa.vfsglobal.com/tur/tr/fra/login";
    
    // Proxy/auth akışını geçmek için tarayıcıyı bot açar, sonra tamamen idle kalır.
    const { browser, page } = await launchBrowser(activeIp);
    const browserProcess = typeof browser.process === "function" ? browser.process() : null;
    
    console.log(`  [MANUAL] VFS giriş sayfası açılıyor: ${loginUrl}`);
    await rotateProxyAndGoto(page, loginUrl);
    
    // Cloudflare challenge varsa bekle
    let pageContent = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (isCloudflareChallenge(pageContent)) {
      console.log("  [MANUAL] ⏳ Cloudflare challenge bekleniyor...");
      await waitForCloudflareChallengeResolve(page, 60000);
    }
    
    console.log("  [MANUAL] ✅ Sayfa yüklendi. Tarayıcı açık bırakılıyor.");
    console.log("  [MANUAL] ✅ TAM KONTROL SİZDE! Bot yeni komut göndermeyecek.");
    console.log("  [MANUAL] ⏳ Siz pencereyi kapatana kadar bu oturum açık kalacak.\n");

    // Log to dashboard
    let logConfigId = null;
    try {
      const { configs } = await fetchActiveConfigs();
      if (configs.length > 0) logConfigId = configs[0].id;
    } catch {}
    if (logConfigId) {
      await logStep(logConfigId, "manual_browser", `Manuel tarayıcı açıldı ve açık bırakıldı | Proxy: ${proxyLabel}`);
    }

    // Chrome'u kullanıcı kapatana kadar bekle
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      try {
        browser.once("disconnected", finish);
      } catch {}

      if (browserProcess) {
        if (browserProcess.exitCode !== null) return finish();
        browserProcess.once("close", finish);
        browserProcess.once("exit", finish);
      }

      // browserProcess yoksa sadece browser.disconnected'a güven
      // Ayrıca her 5 saniyede browser hala bağlı mı kontrol et
      const checkInterval = setInterval(async () => {
        try {
          if (!browser.isConnected()) {
            clearInterval(checkInterval);
            finish();
          }
        } catch {
          clearInterval(checkInterval);
          finish();
        }
      }, 5000);
    });

    console.log("  [MANUAL] 🔚 Tarayıcı kapatıldı, bot normal çalışmaya dönüyor.\n");
  } catch (err) {
    console.error("  [MANUAL] Hata:", err.message);
  }
}

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
  console.log("✅ Manuel tarayıcı açma desteği aktif");

  while (true) {
    try {
      // DB'den güncel proxy ayarlarını yükle
      await loadProxySettingsFromDB();

      // Manuel tarayıcı isteği kontrol et
      const manualRequested = await checkManualBrowserRequest();
      if (manualRequested) {
        await openManualBrowser();
        continue; // Manuel tarayıcı kapatıldıktan sonra normal döngüye dön
      }

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
            const { browser: ssBrowser, page: ssPage } = await launchBrowser();
            await rotateProxyAndGoto(ssPage, getVfsLoginUrl(config.country), { timeout: 60000 });
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

        // Proxy ülkesini hedef ülkeye otomatik eşle
        const targetProxyCode = COUNTRY_TO_PROXY_CODE[config.country] || null;
        if (targetProxyCode && targetProxyCode !== EVOMI_PROXY_COUNTRY && PROXY_MODE === "residential") {
          console.log(`  [PROXY] 🌍 Proxy ülkesi hedefle eşleniyor: ${EVOMI_PROXY_COUNTRY} → ${targetProxyCode} (hedef: ${config.country})`);
          await logStep(config.id, "ip_change", `Proxy ülkesi değişti: ${EVOMI_PROXY_COUNTRY} → ${targetProxyCode} (hedef: ${config.country})`);
          EVOMI_PROXY_COUNTRY = targetProxyCode;
          currentRegionIndex = -1; // Bölge rotasyonunu sıfırla
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

        // === GÜVENLİ RECOVERY: Oturum süresi doldu ===
        // IP banlamadan, hata sayacı artırmadan, sadece bekle ve tekrar dene
        if (result.sessionExpired) {
          const cooldownMs = result.sessionCooldownMs || 30000;
          console.log(`\n⏰ [SESSION] Oturum süresi doldu — ${Math.round(cooldownMs / 1000)}s soğuma bekleniyor...`);
          await logStep(config.id, "session_cooldown", `⏰ Soğuma bekleniyor: ${Math.round(cooldownMs / 1000)}s | Hesap: ${account.email} | IP korunuyor, hata sayacı artmıyor`);
          await new Promise((r) => setTimeout(r, cooldownMs));
          // consecutiveErrors artmıyor — bu bir engel/hata değil
          continue;
        }

        // IP engellendiyse — CF otomatik recovery mekanizması
        if (result.ipBlocked) {
          consecutiveErrors++;
          const ip = getCurrentIp();
          
          // Dashboard'dan manuel retry isteği gelmiş mi kontrol et
          const retryRequested = await vfsCheckCfRetryRequested(config.id);
          if (retryRequested) {
            console.log("  ✅ [CF] Dashboard'dan retry isteği alındı!");
            await logStep(config.id, "cf_retry", "Dashboard'dan retry isteği alındı, yeni IP ile deneniyor");
            ipBannedUntil.clear();
            ipFailCounts.clear();
            consecutiveErrors = 0;
            continue;
          }

           // Her 3 ardışık CF engelde otomatik recovery: tüm ban listesini temizle, yeni bölge/session dene
          if (consecutiveErrors % 3 === 0) {
            const cycle = consecutiveErrors / 3;
            console.log(`\n  🔄 [CF] Otomatik recovery (döngü ${cycle}) — IP ban listesi temizleniyor, yeni bölge deneniyor`);
            await logStep(config.id, "cf_auto_retry", `🔄 Otomatik CF recovery (${consecutiveErrors}x engel, döngü ${cycle}) — yeni bölge/IP ile devam`);
            ipBannedUntil.clear();
            ipFailCounts.clear();
            residentialSessionId += 10; // Tamamen yeni session bloğu
            
            // Proxy ayarlarını DB'den tazele
            await loadProxySettingsFromDB();
            
            // Kademeli soğuma süresi: 3→120s, 6→180s, 9→240s, 12+→300s
            let cfCooldownMs;
            if (consecutiveErrors >= 12) {
              cfCooldownMs = 300000; // 5 dakika
              await logStep(config.id, "cloudflare", `🚫 Ardışık CF engeli (${consecutiveErrors}x) | 5dk soğuma bekleniyor`);
              await vfsSignalCfBlocked(config.id, ip);
            } else if (consecutiveErrors >= 9) {
              cfCooldownMs = 240000; // 4 dakika
              await logStep(config.id, "cloudflare", `🚫 Ardışık CF engeli (${consecutiveErrors}x) | 4dk soğuma bekleniyor`);
              await vfsSignalCfBlocked(config.id, ip);
            } else if (consecutiveErrors >= 6) {
              cfCooldownMs = 180000; // 3 dakika
              await logStep(config.id, "cloudflare", `⚠️ CF engeli devam ediyor (${consecutiveErrors}x) | 3dk soğuma`);
            } else {
              cfCooldownMs = 120000; // 2 dakika
            }
            
            console.log(`  [CF] ⏳ ${Math.round(cfCooldownMs / 1000)}s soğuma bekleniyor...`);
            await new Promise((r) => setTimeout(r, cfCooldownMs));
            continue;
          }
          
          console.log(`\n🔄 IP engellendi (${consecutiveErrors}/3), 30s sonra sıradaki IP ile deneniyor...`);
          await logStep(config.id, "ip_change", `CF engeli ${consecutiveErrors}/3 | IP: ${ip || "?"}`);
          await new Promise((r) => setTimeout(r, 30000)); // 10s→30s
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
          // Sayfa hatası → hemen IP değiştir ve tekrar dene (bekleme yok)
          if (PROXY_MODE === "residential") {
            residentialSessionId++;
            EVOMI_PROXY_REGION = getNextProxyRegion();
            console.log(`\n🔄 Sayfa hatası → yeni IP ile hemen tekrar deneniyor (session=${residentialSessionId})`);
            await logStep(config.id, "ip_change", `Sayfa hatası → yeni IP ile yeniden deneniyor | ${account.email}`);
          }
          if (result.accountBanned) {
            console.log(`\n⛔ Hesap banlı: ${account.email} → sıradaki hesaba geçiliyor`);
          } else if (result.otpRequired) {
            console.log(`\n📩 OTP gerekiyor: ${account.email}`);
          }
          await new Promise((r) => setTimeout(r, 5000)); // 5s kısa bekleme
          continue; // Normal interval'i atla, hemen tekrar dene
        } else {
          consecutiveErrors = 0;
        }

        // Her döngüde güncel check_interval'i DB'den oku
        let currentInterval = config.check_interval;
        try {
          const freshData = await apiGet("check_config_active");
          const activeConfig = (freshData.configs || []).find(c => c.id === config.id);
          if (activeConfig && activeConfig.check_interval) {
            currentInterval = activeConfig.check_interval;
            config.check_interval = currentInterval;
          }
        } catch {}

        const baseInterval = currentInterval * 1000;
        const backoffMultiplier = consecutiveErrors > 0 ? Math.min(Math.pow(1.3, consecutiveErrors), 3) : 1;
        const interval = Math.min(baseInterval * backoffMultiplier, CONFIG.MAX_BACKOFF_MS);
        const jitter = Math.floor(Math.random() * Math.min(baseInterval * 0.1, 3000));
        const wait = Math.round(interval + jitter);
        console.log(`\n⏳ Sonraki: ${Math.round(wait / 1000)}s (interval: ${currentInterval}s, backoff: x${backoffMultiplier.toFixed(1)}, errors: ${consecutiveErrors})`);
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
