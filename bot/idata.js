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
  OTP_EMAIL_FROM: (process.env.IDATA_OTP_FROM || "verify@idata.com.tr").trim().toLowerCase(),
  REGISTER_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/register",
  LOGIN_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/login",
  APPOINTMENT_URL: "https://it-tr-appointment.idata.com.tr/tr/membership/dashboard/application/availability",
  CHECK_INTERVAL_MS: Number(process.env.IDATA_CHECK_INTERVAL_MS || 300000),
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
const PROXY_REGIONS_FALLBACK = {
  TR: ["ankara", "adana", "konya", "istanbul", "izmir", "bursa", "antalya"],
  IT: ["rome", "milan", "naples", "turin", "bologna", "florence", "venice"],
};
let evomiRegionsCache = []; // Evomi API'den çekilen bölgeler
let evomiRegionsLastFetch = 0;
let evomiRegionsCacheCountry = "";
let currentRegionIndex = -1;
let DB_PROXY_REGION = ""; // Dashboard'dan seçilen sabit bölge
const PROXY_ISP_LIST = "vodafonenetdslm,turkcellinterne,vodafonenetadsl,superonlinebroa,turktelekom,turktelekomunik,vodafoneturkey,vodafonenetdslk";

function getFallbackRegionsByCountry(countryCode = "TR") {
  const normalizedCountry = String(countryCode || "TR").toUpperCase();
  return PROXY_REGIONS_FALLBACK[normalizedCountry] || [];
}

async function fetchEvomiRegions() {
  const now = Date.now();
  const targetCountry = String(EVOMI_PROXY_COUNTRY || "TR").toUpperCase();

  if (
    evomiRegionsCache.length > 0 &&
    evomiRegionsCacheCountry === targetCountry &&
    now - evomiRegionsLastFetch < 600000
  ) {
    return evomiRegionsCache;
  }

  const fallbackRegions = getFallbackRegionsByCountry(targetCountry);

  try {
    const fetch = (await import("node-fetch")).default;
    const settingsRes = await fetch(
      "https://ocrpzwrsyiprfuzsyivf.supabase.co/rest/v1/bot_settings?select=key,value",
      {
        headers: {
          apikey: CONFIG.API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    const settings = await settingsRes.json();
    const map = Object.fromEntries((settings || []).map(s => [s.key, s.value]));
    const apiKey = map.evomi_api_key;

    if (!apiKey) {
      console.warn(`  [EVOMI] ⚠️ evomi_api_key bulunamadı, ${targetCountry} fallback bölgeleri kullanılacak`);
      return fallbackRegions;
    }

    const evomiRes = await fetch("https://api.evomi.com/public/settings", {
      headers: { "x-apikey": apiKey },
    });
    if (!evomiRes.ok) {
      console.warn(`  [EVOMI] ⚠️ API hatası [${evomiRes.status}], ${targetCountry} fallback bölgeleri kullanılacak`);
      return fallbackRegions;
    }
    const evomiData = await evomiRes.json();

    const host = map.proxy_host || EVOMI_PROXY_HOST || "";
    let product = "rpc";
    if (host.includes("rp.evomi") || host.includes("premium")) product = "rp";

    const productData = evomiData?.data?.[product];
    if (!productData) {
      console.warn(`  [EVOMI] ⚠️ Ürün verisi bulunamadı (${product}), ${targetCountry} fallback bölgeleri kullanılacak`);
      return fallbackRegions;
    }

    const allCities = productData.cities?.data || [];
    const countryCities = allCities
      .filter(c => String(c.countryCode || "").toUpperCase() === targetCountry)
      .map(c => {
        const raw = (c.city || c.name || "").toLowerCase().replace(/\s+/g, "");
        return raw.replace(/\.(province|city|region|state)$/i, "");
      })
      .filter(Boolean);

    if (countryCities.length > 0) {
      evomiRegionsCache = [...new Set(countryCities)];
      evomiRegionsLastFetch = now;
      evomiRegionsCacheCountry = targetCountry;
      console.log(`  [EVOMI] ✅ ${evomiRegionsCache.length} ${targetCountry} bölge bulundu: ${evomiRegionsCache.slice(0, 10).join(", ")}${evomiRegionsCache.length > 10 ? "..." : ""}`);
      return evomiRegionsCache;
    }

    console.warn(`  [EVOMI] ⚠️ ${targetCountry} şehir bulunamadı, fallback kullanılacak`);
    return fallbackRegions;
  } catch (e) {
    console.warn(`  [EVOMI] ⚠️ Bölge çekme hatası: ${e.message}, ${targetCountry} fallback kullanılacak`);
    return fallbackRegions;
  }
}

async function getNextProxyRegion() {
  if (DB_PROXY_REGION) {
    console.log(`  [PROXY] 🏙 Dashboard bölgesi kullanılıyor: ${DB_PROXY_REGION} ülke: ${EVOMI_PROXY_COUNTRY}`);
    return String(DB_PROXY_REGION).toLowerCase().replace(/\s+/g, "").replace(/\.(province|city|region|state)$/i, "");
  }

  const regions = await fetchEvomiRegions();
  if (!regions.length) {
    return "";
  }

  currentRegionIndex = (currentRegionIndex + 1) % regions.length;
  let region = regions[currentRegionIndex];
  if (region && typeof region === "object") {
    region = region.city || region.name || region.region || JSON.stringify(region);
  }
  region = String(region || "").toLowerCase().replace(/\s+/g, "").replace(/\.(province|city|region|state)$/i, "");
  console.log(`  [PROXY] 🏙 Bölge rotasyonu: ${region} (${currentRegionIndex + 1}/${regions.length}) ülke: ${EVOMI_PROXY_COUNTRY}`);
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

// Hesap adını döndür (email yerine ad soyad)
function getAccountName(account) {
  const name = `${account.first_name || ""} ${account.last_name || ""}`.trim();
  return name || account.email;
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

// Bezier curve ile insansı mouse hareketi
async function humanMouseMoveTo(page, targetX, targetY, options = {}) {
  try {
    const { jitter = true, speed = 'normal' } = options;
    // Mevcut mouse konumunu al (yoksa rastgele başla)
    const currentPos = await page.evaluate(() => {
      return { x: window.__mouseX || Math.random() * 500 + 100, y: window.__mouseY || Math.random() * 300 + 100 };
    });
    
    const startX = currentPos.x;
    const startY = currentPos.y;
    const dist = Math.sqrt((targetX - startX) ** 2 + (targetY - startY) ** 2);
    
    // Adım sayısı mesafeye göre (daha uzun = daha çok adım)
    const baseSteps = speed === 'fast' ? 12 : speed === 'slow' ? 35 : 20;
    const steps = Math.max(8, Math.floor(baseSteps + dist / 50 + Math.random() * 10));
    
    // Bezier kontrol noktaları (doğal eğri için)
    const cp1x = startX + (targetX - startX) * (0.2 + Math.random() * 0.3) + (Math.random() - 0.5) * 80;
    const cp1y = startY + (targetY - startY) * (0.1 + Math.random() * 0.2) + (Math.random() - 0.5) * 60;
    const cp2x = startX + (targetX - startX) * (0.6 + Math.random() * 0.2) + (Math.random() - 0.5) * 40;
    const cp2y = startY + (targetY - startY) * (0.7 + Math.random() * 0.2) + (Math.random() - 0.5) * 30;
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Ease-in-out: hedefe yaklaşırken yavaşla
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      
      // Cubic bezier
      const u = 1 - ease;
      let x = u*u*u*startX + 3*u*u*ease*cp1x + 3*u*ease*ease*cp2x + ease*ease*ease*targetX;
      let y = u*u*u*startY + 3*u*u*ease*cp1y + 3*u*ease*ease*cp2y + ease*ease*ease*targetY;
      
      // Küçük titreşim ekle (insan eli titremesi)
      if (jitter && i < steps) {
        x += (Math.random() - 0.5) * 3;
        y += (Math.random() - 0.5) * 2;
      }
      
      await page.mouse.move(Math.round(x), Math.round(y));
      
      // Değişken hız: başta hızlı, hedefe yakınken yavaş
      const baseDelay = speed === 'fast' ? 5 : speed === 'slow' ? 20 : 10;
      const slowdownFactor = t > 0.8 ? 2.5 : t > 0.6 ? 1.5 : 1;
      await new Promise(r => setTimeout(r, baseDelay * slowdownFactor + Math.random() * 8));
    }
    
    // Mouse konumunu kaydet
    await page.evaluate((x, y) => { window.__mouseX = x; window.__mouseY = y; }, targetX, targetY);
  } catch {}
}

async function humanMove(page) {
  try {
    const vp = page.viewport();
    const w = vp?.width || 1366;
    const h = vp?.height || 768;
    const x = Math.floor(Math.random() * w * 0.6 + w * 0.2);
    const y = Math.floor(Math.random() * h * 0.6 + h * 0.2);
    await humanMouseMoveTo(page, x, y);
    await delay(150, 400);
  } catch {}
}

// İnsan benzeri tıklama: mouse hareket et + küçük gecikme + tıkla
async function humanClick(page, x, y, options = {}) {
  const { preMovesNear = true } = options;
  
  // Hedefe yakın 2-3 rastgele nokta (göz gezdirme)
  if (preMovesNear) {
    const nearMoves = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < nearMoves; i++) {
      const rx = x + (Math.random() - 0.5) * 120;
      const ry = y + (Math.random() - 0.5) * 80;
      await humanMouseMoveTo(page, rx, ry, { speed: 'fast' });
      await delay(100 + Math.random() * 300, 200 + Math.random() * 400);
    }
  }
  
  // Hedef noktaya yavaşça yaklaş
  await humanMouseMoveTo(page, x, y, { speed: 'slow' });
  
  // Küçük gecikme (insanlar hemen tıklamaz)
  await delay(50 + Math.random() * 150, 100 + Math.random() * 200);
  
  // Mouse down + küçük bekleme + mouse up (gerçek tıklama süresi)
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 30 + Math.random() * 80)); // 30-110ms basılı tut
  await page.mouse.up();
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

// iDATA config'i kontrol et (is_active + check_interval)
let dynamicCheckInterval = CONFIG.CHECK_INTERVAL_MS;

async function isIdataActive() {
  try {
    const supabaseUrl = "https://ocrpzwrsyiprfuzsyivf.supabase.co";
    const res = await fetch(`${supabaseUrl}/rest/v1/idata_config?select=is_active,check_interval&limit=1`, {
      method: "GET",
      headers: apiHeaders,
    });
    const data = await res.json();
    if (data?.[0]) {
      const ci = data[0].check_interval;
      if (ci && ci > 0) {
        dynamicCheckInterval = ci * 1000; // DB'de saniye cinsinden
      }
      return data[0].is_active === true;
    }
    return false;
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

        // 3. denemede hâlâ yüklenmediyse sayfayı tamamen reload et
        if (attempt >= 3 && !pageReloaded) {
          console.log("  [CAPTCHA] 🔃 Görsel 2 denemedir yüklenmiyor, sayfa reload ediliyor...");
          await idataLog("login_captcha", "CAPTCHA broken — sayfa reload ediliyor");
          pageReloaded = true;
          await page.reload({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
          await delay(3000, 5000);
          continue; // Reload sonrası giriş sayfası yeniden yüklenecek, CAPTCHA da yenilenecek
        }

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

        // Refresh sonrası tekrar kontrol et, hâlâ yüklenmiyorsa bu denemeyi atla
        const recheck = await waitForCaptchaImageLoad(page, 3000);
        if (!recheck.loaded) {
          console.log("  [CAPTCHA] ⚠ Refresh sonrası hâlâ yüklenmedi, sonraki denemeye geçiliyor");
          continue;
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
  residentialSessionId++;
  let pass = `${EVOMI_PROXY_PASS}_country-${EVOMI_PROXY_COUNTRY}_session-idata${residentialSessionId}`;
  if (EVOMI_PROXY_REGION) {
    // Obje veya string olabilir, normalize et
    let cleanRegion = typeof EVOMI_PROXY_REGION === "object" 
      ? (EVOMI_PROXY_REGION.city || EVOMI_PROXY_REGION.name || "") 
      : String(EVOMI_PROXY_REGION);
    cleanRegion = cleanRegion.toLowerCase().replace(/\s+/g, "").replace(/\.(province|city|region|state)$/i, "").trim();
    if (cleanRegion) pass += `_region-${cleanRegion}`;
  }
  console.log(`  [PROXY] 🏠 Residential: ${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT} (ülke: ${EVOMI_PROXY_COUNTRY}, bölge: ${EVOMI_PROXY_REGION || 'yok'}, session: idata${residentialSessionId})`);
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

// ==================== IMAP OTP READ (son mail + gönderen filtresi) ====================
async function tryImapOtp(accountId) {
  try {
    const { ImapFlow } = require("imapflow");
    const fetch = (await import("node-fetch")).default;

    // Hesap bilgilerini al
    const res = await fetch(
      `https://ocrpzwrsyiprfuzsyivf.supabase.co/rest/v1/idata_accounts?id=eq.${accountId}&select=email,imap_host,imap_password,otp_requested_at`,
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
    const allowedFrom = (CONFIG.OTP_EMAIL_FROM || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

    const otpRequestedAt = account.otp_requested_at ? new Date(account.otp_requested_at) : null;
    const otpRequestedTs = otpRequestedAt && !Number.isNaN(otpRequestedAt.getTime())
      ? otpRequestedAt.getTime()
      : null;

    console.log(`  [IMAP] ${account.email} → ${host} bağlanıyor...`);
    if (allowedFrom.length) {
      console.log(`  [IMAP] Gönderen filtresi: ${allowedFrom.join(", ")}`);
    }
    if (otpRequestedTs) {
      console.log(`  [IMAP] OTP istek zamanı: ${new Date(otpRequestedTs).toISOString()}`);
    }

    const decodeQuotedPrintable = (text = "") =>
      text
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    const htmlToText = (text = "") =>
      text
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/(p|div|tr|td|h1|h2|h3|h4|h5|h6)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");

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

    // Taranacak klasörler: INBOX + Spam/Junk
    const foldersToCheck = ["INBOX", "[Gmail]/Spam", "Junk", "Spam"];

    for (const folder of foldersToCheck) {
      let lock;
      try {
        lock = await client.getMailboxLock(folder);
      } catch (e) {
        // Klasör yoksa atla (örn: Junk yoksa)
        continue;
      }

      try {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const sinceTs = otpRequestedTs
          ? Math.max(oneDayAgo, otpRequestedTs - 5 * 60 * 1000)
          : oneDayAgo;
        const since = new Date(sinceTs);

        const messages = await client.search({ since }, { uid: true });
        if (!messages.length) {
          console.log(`  [IMAP] ${folder}: Uygun zaman aralığında mail yok`);
          await lock.release();
          continue;
        }

        const lastUids = messages.slice(-20).reverse();

        for (const uid of lastUids) {
          const msg = await client.fetchOne(
            uid,
            { source: true, envelope: true, internalDate: true },
            { uid: true }
          );

          const fromList = (msg?.envelope?.from || [])
            .map((x) => (x?.address || "").toLowerCase())
            .filter(Boolean);
          const fromText = fromList.join(", ");
          const subject = msg?.envelope?.subject || "";
          const msgTs = msg?.internalDate ? new Date(msg.internalDate).getTime() : null;

          if (otpRequestedTs && msgTs && msgTs < otpRequestedTs - 15000) {
            console.log(`  [IMAP] ${folder} UID ${uid} atlandı (eski mail: ${new Date(msgTs).toISOString()})`);
            continue;
          }

          let senderMatched = true;
          if (allowedFrom.length > 0) {
            senderMatched = fromList.some((addr) =>
              allowedFrom.some((allowed) => addr.includes(allowed) || allowed.includes(addr))
            );
          }

          if (!senderMatched) {
            console.log(`  [IMAP] ${folder} UID ${uid} gönderen eşleşmedi | from: ${fromText || "?"} | subject: ${subject}`);
          }

          const rawText = (msg?.source ? msg.source.toString("utf8") : "").replace(/\r/g, "");
          const mainBlock = rawText
            .split(/\n(?:On .+ wrote:|-----Original Message-----|From:\s.+\nSent:\s.+)/i)[0]
            .slice(0, 12000);
          const normalizedText = htmlToText(decodeQuotedPrintable(mainBlock));

          const priorityPatterns = [
            /(?:lütfen aşağıdaki doğrulama kodunu kullanın|please use the following verification code|si prega di utilizzare il seguente codice di verifica)[\s\S]{0,240}?\b(\d{4})\b/i,
            /(?:doğrulama kodu|verification code|codice di verifica)[\s\S]{0,160}?\b(\d{4})\b/i,
          ];

          const strictPatterns = [
            /e-?posta doğrulama kodu[^\d]{0,40}(\d{4})/i,
            /doğrulama kodu[^\d]{0,40}(\d{4})/i,
            /verification code[^\d]{0,40}(\d{4})/i,
            /codice di verifica[^\d]{0,40}(\d{4})/i,
            /otp[^\d]{0,40}(\d{4})/i,
          ];

          let otp = null;

          for (const pattern of priorityPatterns) {
            const match = normalizedText.match(pattern);
            if (match?.[1] && match[1] !== "0000") { otp = match[1]; break; }
          }

          if (!otp) {
            for (const pattern of strictPatterns) {
              const match = normalizedText.match(pattern);
              if (match?.[1] && match[1] !== "0000") { otp = match[1]; break; }
            }
          }

          if (!otp) {
            const lineCodes = [...normalizedText.matchAll(/^\s*(\d{4})\s*$/gm)]
              .map((m) => m[1]).filter((x) => x !== "0000");
            if (lineCodes.length > 0) otp = lineCodes[lineCodes.length - 1];
          }

          if (!otp) {
            const allCodes = [...normalizedText.matchAll(/\b(\d{4})\b/g)]
              .map((m) => m[1]).filter((x) => x !== "0000");
            if (allCodes.length > 0) otp = allCodes[allCodes.length - 1];
          }

          if (otp) {
            console.log(`  [IMAP] ✅ OTP bulundu (${folder}): ${otp} | from: ${fromText || "?"} | subject: ${subject}`);
            await lock.release();
            await client.logout();
            return otp;
          }
        }

        await lock.release();
      } catch (e) {
        try { await lock.release(); } catch {}
        console.log(`  [IMAP] ${folder} tarama hatası: ${e.message}`);
      }
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
  let imapPromise = null;
  let imapResolvedOtp = null;

  while (Date.now() - start < timeoutMs) {
    // 1) IMAP: arka planda çalıştır, sonucu beklemeden manual'ı da kontrol et
    if (hasImap && imapAttempts < 20 && !imapPromise && !imapResolvedOtp) {
      imapAttempts++;
      console.log(`  [OTP] IMAP ile otomatik okuma deneniyor (${imapAttempts})...`);
      imapPromise = tryImapOtp(accountId)
        .then((otp) => {
          if (otp) imapResolvedOtp = otp;
          return otp;
        })
        .catch(() => null)
        .finally(() => {
          imapPromise = null;
        });
    }

    // IMAP sonucunu beklemeden kısa aralıklarla yokla
    if (imapPromise) {
      await Promise.race([imapPromise, new Promise((r) => setTimeout(r, 500))]);
    }

    if (imapResolvedOtp) {
      console.log(`  [OTP] ✅ IMAP'ten OTP alındı: ${imapResolvedOtp}`);
      await idataLog("login_otp", `📧 IMAP'ten OTP alındı otomatik: ${imapResolvedOtp}`);
      return imapResolvedOtp;
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
          isMembership: /üyelik|uyelik|membership|member|numara/.test(metaText),
          isEmail: /e-?posta|email/.test(metaText) && !/captcha|mailconfirm|do[gğ]rulama|verification/.test(metaText),
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
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

    // Detaylı input debug logu
    for (let i = 0; i < textCandidates.length; i++) {
      const m = textCandidates[i].meta;
      console.log(`  [LOGIN] Input[${i}]: name="${m.name}" id="${m.id}" ph="${m.placeholder}" meta="${m.metaText}" captcha=${m.isCaptcha} member=${m.isMembership} email=${m.isEmail}`);
    }
    for (let i = 0; i < passwordCandidates.length; i++) {
      const m = passwordCandidates[i].meta;
      console.log(`  [LOGIN] Pass[${i}]: name="${m.name}" id="${m.id}" ph="${m.placeholder}"`);
    }
    
    console.log(`  [LOGIN] Görünür input: text=${textCandidates.length}, auth=${nonCaptchaTextInputs.length}, password=${passwordCandidates.length}`);
    console.log(`  [LOGIN] Eşleşme: membership=${membershipInput ? "✅" : "❌"} email=${emailInput ? "✅" : "❌"} primary=${primaryAuthInput ? "✅" : "❌"} secondary=${secondaryAuthInput ? "✅" : "❌"} captcha=${preDetectedCaptchaInput ? "✅" : "❌"}`);
    await idataLog("login_form", `Input: text=${textCandidates.length} auth=${nonCaptchaTextInputs.length} pass=${passwordCandidates.length} | member=${membershipInput ? "var" : "yok"} email=${emailInput ? "var" : "yok"} captcha=${preDetectedCaptchaInput ? "var" : "yok"} | meta: ${textCandidates.map(t => `[${t.meta.name||t.meta.id||t.meta.placeholder||"?"}]`).join(",")}`);

    // Pozisyonel fallback: eğer hiçbir alan regex ile eşleşmediyse, sırayla doldur
    if (!membershipInput && !emailInput && nonCaptchaTextInputs.length >= 1) {
      console.log("  [LOGIN] ⚠ Regex eşleşmesi bulunamadı — pozisyonel fallback kullanılacak");
      await idataLog("login_form", "⚠ Regex eşleşmesi yok, pozisyonel fallback aktif");
    }

    // 1) Üyelik/kimlik alanı
    if (account.membership_number) {
      const target = membershipInput || nonCaptchaTextInputs[0]?.el || null;
      if (target) {
        console.log(`  [LOGIN] Üyelik no giriliyor: ${account.membership_number}`);
        const typed = await humanType(page, target, account.membership_number, { minDelay: 140, maxDelay: 300, retries: 3 });
        const val = await page.evaluate(el => el?.value || '', target).catch(() => '');
        console.log(`  [LOGIN] Üyelik no yazıldı mı: ${typed}, alandaki değer: "${val}"`);
        if (!typed || !val) {
          console.log("  [LOGIN] ⚠ Üyelik no yazılamadı — click + triple-clear + tekrar dene");
          await target.click({ clickCount: 3 }).catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
          await delay(500, 800);
          await humanType(page, target, account.membership_number, { minDelay: 140, maxDelay: 300, retries: 2 });
        }
        await delay(700, 1200);
      } else {
        console.log("  [LOGIN] ❌ Üyelik no alanı bulunamadı!");
        await idataLog("login_form", "❌ Üyelik no input bulunamadı");
      }
    }

    // 2) E-posta alanı
    {
      // Eğer üyelik no varsa e-posta ikinci alandır, yoksa birinci alan
      const target = emailInput 
        || (account.membership_number ? (secondaryAuthInput || nonCaptchaTextInputs[1]?.el) : (primaryAuthInput || nonCaptchaTextInputs[0]?.el))
        || null;
      if (target) {
        console.log(`  [LOGIN] E-Posta giriliyor: ${account.email}`);
        const typed = await humanType(page, target, account.email, { minDelay: 130, maxDelay: 280, retries: 3 });
        const val = await page.evaluate(el => el?.value || '', target).catch(() => '');
        console.log(`  [LOGIN] E-Posta yazıldı mı: ${typed}, alandaki değer: "${val}"`);
        if (!typed || !val) {
          console.log("  [LOGIN] ⚠ E-posta yazılamadı — click + triple-clear + tekrar dene");
          await target.click({ clickCount: 3 }).catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
          await delay(500, 800);
          await humanType(page, target, account.email, { minDelay: 130, maxDelay: 280, retries: 2 });
        }
        await delay(700, 1200);
      } else {
        console.log("  [LOGIN] ❌ E-Posta alanı bulunamadı!");
        await idataLog("login_form", "❌ E-Posta input bulunamadı");
      }
    }

    // 3) Şifre
    if (passwordCandidates[0]?.el) {
      console.log(`  [LOGIN] Şifre giriliyor`);
      const typed = await humanType(page, passwordCandidates[0].el, account.password, { minDelay: 120, maxDelay: 260, retries: 3 });
      const val = await page.evaluate(el => el?.value?.length || 0, passwordCandidates[0].el).catch(() => 0);
      console.log(`  [LOGIN] Şifre yazıldı mı: ${typed}, karakter sayısı: ${val}`);
      if (!typed || val === 0) {
        console.log("  [LOGIN] ⚠ Şifre yazılamadı — tekrar dene");
        await passwordCandidates[0].el.click({ clickCount: 3 }).catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await delay(500, 800);
        await humanType(page, passwordCandidates[0].el, account.password, { minDelay: 120, maxDelay: 260, retries: 2 });
      }
      await delay(1000, 1800);
    } else {
      console.log("  [LOGIN] ❌ Şifre alanı bulunamadı!");
      await idataLog("login_form", "❌ Şifre input bulunamadı");
    }

    // Tüm alanlar doldurulduktan sonra doğrulama screenshot'ı
    const preSubmitShot = await takeScreenshotBase64(page);
    await idataLog("login_form_filled", "Form alanları dolduruldu — CAPTCHA çözülecek", preSubmitShot);

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

    // 1) Üyelik numarası girişi atlandı — direkt form doldurulacak
    console.log("  [CHECK] Üyelik no atlanıyor, direkt randevu sorgulanıyor...");

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

    // 6) Sonucu kontrol et — yalnızca gerçek randevu tarihlerini kabul et
    const result = await page.evaluate(() => {
      const body = (document.body?.innerText || "");
      const lower = body.toLowerCase();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const parseDateValue = (raw) => {
        const value = String(raw || "").trim();
        if (!value) return null;

        let match = value.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
        if (match) {
          const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        match = value.match(/\b(\d{4})[./-](\d{2})[./-](\d{2})\b/);
        if (match) {
          const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        return null;
      };

      const isFutureOrToday = (raw) => {
        const parsed = parseDateValue(raw);
        return !!parsed && parsed >= today;
      };

      const normalizeDate = (raw) => {
        const parsed = parseDateValue(raw);
        if (!parsed) return null;
        const d = String(parsed.getDate()).padStart(2, "0");
        const m = String(parsed.getMonth() + 1).padStart(2, "0");
        const y = parsed.getFullYear();
        return `${d}.${m}.${y}`;
      };

      const extractDates = (text) => {
        const matches = String(text || "").match(/\b(?:\d{2}[./-]\d{2}[./-]\d{4}|\d{4}[./-]\d{2}[./-]\d{2})\b/g) || [];
        return Array.from(new Set(matches.map(normalizeDate).filter((date) => date && isFutureOrToday(date))));
      };

      const positiveAppointmentSignals = [
        "müsait randevu tarihleri",
        "aşağıdaki tarihlerden",
        "randevu tarihini seçiniz",
        "en yakın randevu tarihleri",
        "uygun tarih seçiniz",
        "available appointment"
      ];

      const negativeAppointmentSignals = [
        "uygun randevu tarihi bulunmamaktadır",
        "randevu tarihi bulunmamaktadır",
        "uygun randevu bulunmamaktadır",
        "no available appointment"
      ];

      const hasPositiveText = positiveAppointmentSignals.some((signal) => lower.includes(signal));
      const hasNegativeText = negativeAppointmentSignals.some((signal) => lower.includes(signal));

      const visibleElements = Array.from(document.querySelectorAll("body *")).filter((el) => {
        const text = (el.textContent || "").trim();
        if (!text) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      const scopedTexts = visibleElements
        .map((el) => (el.textContent || "").trim())
        .filter((text) => positiveAppointmentSignals.some((signal) => text.toLowerCase().includes(signal)));

      const scopedFutureDates = Array.from(new Set(scopedTexts.flatMap((text) => extractDates(text))));
      const bodyFutureDates = extractDates(body);

      const availableCalendarCells = Array.from(document.querySelectorAll("td, button, span, div"))
        .filter((el) => {
          const text = (el.textContent || "").trim();
          if (!/^\d{1,2}$/.test(text)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) return false;
          const cls = `${el.className || ""}`.toLowerCase();
          if (/(disabled|old|new|passive|off|other-month)/.test(cls)) return false;
          return /(available|active|selectable|free|slot|day|calendar|datepicker|flatpickr|ui-datepicker)/.test(cls);
        })
        .length;

      if (hasNegativeText) {
        const futureDates = scopedFutureDates.length > 0 ? scopedFutureDates : bodyFutureDates;
        return {
          found: false,
          status: "no_appointment",
          text: "Uygun randevu tarihi bulunmamaktadır",
          openUntil: futureDates.length > 0 ? futureDates.join(", ") : null
        };
      }

      const finalDates = scopedFutureDates.length > 0 ? scopedFutureDates : (hasPositiveText ? bodyFutureDates : []);
      const hasRealAppointment = hasPositiveText && (finalDates.length > 0 || availableCalendarCells > 0);

      if (hasRealAppointment) {
        return {
          found: true,
          status: "appointment_available",
          text: body.substring(0, 500),
          dates: finalDates,
          debug: `positiveText=${hasPositiveText} dates=${finalDates.length} cells=${availableCalendarCells}`
        };
      }

      // === FORM HENÜZ DOLDURULMADI / SONUÇ BELİRSİZ ===
      const selects = document.querySelectorAll("select");
      if (selects.length >= 2) {
        return { found: false, status: "form_visible", text: "Form görünüyor, sonuç belirsiz: " + body.substring(0, 300) };
      }

      return {
        found: false,
        status: "unknown",
        text: body.substring(0, 300),
        debug: `positiveText=${hasPositiveText} dates=${finalDates.length} cells=${availableCalendarCells}`
      };
    });

    const ss = await takeScreenshotBase64(page);

    if (result.found) {
      console.log("  [CHECK] 🎉 RANDEVU BULUNDU!");
      const datesStr = (result.dates && result.dates.length > 0) ? result.dates.join(", ") : "";
      return { found: true, screenshot: ss, message: result.text, dates: result.dates || [], datesStr };
    }

    const extraInfo = result.openUntil ? ` | Açık tarihler: ${result.openUntil}` : "";
    console.log(`  [CHECK] ❌ Randevu yok (${result.status})${extraInfo}`);
    return { found: false, screenshot: ss, message: `[${result.status}] ${result.text}${extraInfo}` };

  } catch (err) {
    console.error(`  [CHECK] Hata: ${err.message}`);
    return { found: false, error: err.message };
  }
}

// ==================== AUTO BOOKING ====================
async function bookEarliestAppointment(page, account) {
  try {
    console.log("  [BOOK] 🎯 Randevu alma akışı başlıyor...");

    // ===== STEP 1: İlk sayfada İLERİ butonuna tıkla (En yakın randevu tarihleri sayfası) =====
    console.log("  [BOOK] Step 1: İlk sayfada İLERİ butonuna tıklanıyor...");
    
    const step1Result = await page.evaluate(() => {
      const body = (document.body?.innerText || "");
      const hasDateSection = body.includes("En yakın randevu tarihleri");
      
      // Ekranda listelenen uygun tarihleri topla (geçmiş tarihleri filtrele)
      const allDateMatches = Array.from(new Set(body.match(/\b\d{2}[./-]\d{2}[./-]\d{4}\b/g) || []));
      const todayTs = new Date(); todayTs.setHours(0,0,0,0);
      const dateMatches = allDateMatches.filter(td => {
        const p = td.split(/[.\/-]/);
        if (p.length === 3) {
          const parsed = new Date(parseInt(p[2],10), parseInt(p[1],10)-1, parseInt(p[0],10));
          return parsed >= todayTs;
        }
        return true;
      });
      
      // İLERİ butonunu bul — genelde yeşil, sağ altta
      const candidates = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"]'));
      const ileriBtn = candidates.find(el => {
        const txt = (el.innerText || el.value || el.textContent || "").trim().toUpperCase();
        return txt === "İLERİ" || txt === "ILERI";
      });
      
      if (ileriBtn) {
        ileriBtn.click();
        return { clicked: true, text: (ileriBtn.innerText || ileriBtn.value || "").trim(), dates: dateMatches, hasDateSection };
      }
      
      // Fallback: btn-success class
      const greenBtn = document.querySelector('.btn-success, a.btn-success');
      if (greenBtn) {
        greenBtn.click();
        return { clicked: true, text: (greenBtn.innerText || "").trim(), method: "green_btn", dates: dateMatches, hasDateSection };
      }
      
      return { clicked: false, dates: dateMatches, hasDateSection };
    });

    console.log(`  [BOOK] Step 1 sonuç: ${JSON.stringify(step1Result)}`);

    const parseAnnouncedAppointmentDate = (raw) => {
      const m = String(raw || "").trim().match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
      if (!m) return null;
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      const timestamp = new Date(year, month - 1, day).getTime();
      if (Number.isNaN(timestamp)) return null;
      return {
        raw,
        day,
        month,
        year,
        timestamp,
        normalized: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    };

    const navigateVisibleCalendarToMonth = async ({
      targetMonth,
      targetYear,
      anchorX = null,
      anchorY = null,
      maxSteps = 24,
      label = "Takvim",
    }) => {
      if (!targetMonth || !targetYear) {
        return { done: true, clicked: false, reason: "target_missing" };
      }

      for (let navAttempt = 0; navAttempt < maxSteps; navAttempt++) {
        const navState = await page.evaluate(({ targetMonth, targetYear, anchorX, anchorY }) => {
          const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };

          const normalizeText = (value) => String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/ı/g, "i")
            .replace(/ğ/g, "g")
            .replace(/ş/g, "s")
            .replace(/ü/g, "u")
            .replace(/ö/g, "o")
            .replace(/ç/g, "c")
            .replace(/\s+/g, " ")
            .trim();

          const monthNames = {
            january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
            july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
            ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
            temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
          };

          const parseMonthYear = (text) => {
            const normalized = normalizeText(text);
            if (!normalized) return { month: null, year: null, headerText: "" };
            const yearMatch = normalized.match(/(20\d{2})/);
            let month = null;
            for (const [name, num] of Object.entries(monthNames)) {
              if (normalized.includes(name)) {
                month = num;
                break;
              }
            }
            return {
              month,
              year: yearMatch ? parseInt(yearMatch[1], 10) : null,
              headerText: String(text || "").trim(),
            };
          };

          const calendarSelector = ".datepicker, .datepicker-dropdown, .bootstrap-datetimepicker-widget, .datepicker-days, .flatpickr-calendar, .ui-datepicker, [class*='datepicker'], [class*='calendar'], .picker-open, table.table-condensed";
          const headerSelector = ".datepicker-switch, .picker-switch, .datepicker th.switch, .ui-datepicker-title, .month-year, caption, .datepicker-days .datepicker-switch, th";
          const hasAnchor = anchorX != null && anchorY != null;

          const findCalendarRoot = (startNode) => {
            let node = startNode;
            let best = null;
            let depth = 0;
            while (node && node !== document.body && depth < 8) {
              if (node.matches?.(calendarSelector) && isVisible(node)) {
                const rect = node.getBoundingClientRect();
                const dayCount = node.querySelectorAll?.("td").length || 0;
                if (rect.width >= 140 && rect.height >= 120 && dayCount >= 20) {
                  best = node;
                }
              }
              node = node.parentElement;
              depth += 1;
            }
            return best;
          };

          const getAnchorScore = (calRect, headerRect, zIndex) => {
            if (!hasAnchor) return -Math.round(calRect.y);
            const centerX = calRect.x + calRect.width / 2;
            const centerY = calRect.y + calRect.height / 2;
            const distance = Math.hypot(centerX - anchorX, centerY - anchorY);
            const anchorInsideX = anchorX >= calRect.x - 24 && anchorX <= calRect.x + calRect.width + 24;
            const calendarBelowInput = calRect.y >= anchorY - 90;
            const headerBelowInput = headerRect.y >= anchorY - 120;
            const verticalOffset = calRect.y - anchorY;
            return (
              (anchorInsideX ? 220 : -Math.min(220, Math.abs(centerX - anchorX))) +
              (calendarBelowInput ? 180 : -260) +
              (headerBelowInput ? 60 : -120) +
              (verticalOffset >= -40 && verticalOffset <= 420 ? 80 : -80) +
              Math.min(Math.max(zIndex, 0), 999) / 5 -
              Math.round(distance)
            );
          };

          const headerCandidates = Array.from(document.querySelectorAll(headerSelector))
            .map((node) => {
              if (!isVisible(node)) return null;
              const parsed = parseMonthYear(node.innerText || node.textContent || "");
              if (!parsed.month || !parsed.year) return null;

              const calendar = findCalendarRoot(node) || findCalendarRoot(node.parentElement) || node.closest(calendarSelector);
              if (!calendar || !isVisible(calendar)) return null;

              const rect = node.getBoundingClientRect();
              const calRect = calendar.getBoundingClientRect();
              const style = window.getComputedStyle(calendar);
              const zIndex = parseInt(style.zIndex || "0", 10) || 0;
              const centerX = calRect.x + calRect.width / 2;
              const centerY = calRect.y + calRect.height / 2;
              const distance = hasAnchor
                ? Math.hypot(centerX - anchorX, centerY - anchorY)
                : Math.hypot(centerX, centerY);
              const anchorScore = getAnchorScore(calRect, rect, zIndex);

              return {
                calendar,
                headerNode: node,
                ...parsed,
                anchorScore,
                distance,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                calendarRect: { x: calRect.x, y: calRect.y, width: calRect.width, height: calRect.height },
                zIndex,
              };
            })
            .filter(Boolean)
            .sort((a, b) => {
              if (hasAnchor) return b.anchorScore - a.anchorScore || a.distance - b.distance || b.zIndex - a.zIndex;
              return a.calendarRect.y - b.calendarRect.y;
            });

          if (!headerCandidates.length) {
            return { done: true, clicked: false, reason: "header_not_found" };
          }

          const chosen = headerCandidates[0];
          const deltaMonths = (targetYear - chosen.year) * 12 + (targetMonth - chosen.month);
          if (deltaMonths === 0) {
            return {
              done: true,
              clicked: false,
              reason: "aligned",
              headerText: chosen.headerText,
              currentMonth: chosen.month,
              currentYear: chosen.year,
              headerDistance: Math.round(chosen.distance || 0),
              anchorScore: Math.round(chosen.anchorScore || 0),
            };
          }

          const direction = deltaMonths > 0 ? "next" : "prev";
          const buttonSelector = direction === "next"
            ? ".next, th.next, button[aria-label='Next'], button[title*='Next'], button[aria-label*='Sonraki'], button[title*='Sonraki'], a.next"
            : ".prev, th.prev, button[aria-label='Previous'], button[title*='Prev'], button[aria-label*='Önceki'], button[title*='Önceki'], a.prev";

          const buttonScopes = [
            chosen.headerNode.closest("tr"),
            chosen.headerNode.parentElement,
            chosen.calendar,
          ].filter(Boolean);

          const scopedButtons = [];
          for (const scope of buttonScopes) {
            const found = Array.from(scope.querySelectorAll(buttonSelector)).filter(isVisible);
            for (const btn of found) {
              if (!scopedButtons.includes(btn)) scopedButtons.push(btn);
            }
          }

          const headerCenterX = chosen.rect.x + chosen.rect.width / 2;
          const headerCenterY = chosen.rect.y + chosen.rect.height / 2;
          const navButtons = scopedButtons
            .map((btn) => {
              const rect = btn.getBoundingClientRect();
              const cx = rect.x + rect.width / 2;
              const cy = rect.y + rect.height / 2;
              const distance = Math.hypot(cx - headerCenterX, cy - headerCenterY);
              return { btn, distance, x: cx, y: cy };
            })
            .sort((a, b) => a.distance - b.distance);

          const bestButton = navButtons[0] || null;
          if (!bestButton) {
            return {
              done: true,
              clicked: false,
              reason: `${direction}_button_not_found_scoped`,
              headerText: chosen.headerText,
              currentMonth: chosen.month,
              currentYear: chosen.year,
              headerDistance: Math.round(chosen.distance || 0),
              anchorScore: Math.round(chosen.anchorScore || 0),
            };
          }

          bestButton.btn.click();
          return {
            done: false,
            clicked: true,
            direction,
            headerText: chosen.headerText,
            currentMonth: chosen.month,
            currentYear: chosen.year,
            headerDistance: Math.round(chosen.distance || 0),
            buttonDistance: Math.round(bestButton.distance || 0),
            anchorScore: Math.round(chosen.anchorScore || 0),
            usedScopedButton: true,
            candidateSample: headerCandidates.slice(0, 3).map((c) => ({
              headerText: c.headerText,
              y: Math.round(c.calendarRect.y),
              score: Math.round(c.anchorScore || 0),
              distance: Math.round(c.distance || 0),
            })),
          };
        }, { targetMonth, targetYear, anchorX, anchorY });

        console.log(`  [BOOK] ${label} nav ${navAttempt + 1}: ${JSON.stringify(navState)}`);

        if (navState.done || !navState.clicked) {
          return navState;
        }

        await delay(500, 1000);
      }

      return { done: false, clicked: false, reason: "max_nav_reached" };
    };

    const announcedAppointmentDates = (step1Result.dates || [])
      .map(parseAnnouncedAppointmentDate)
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp);

    const announcedAppointmentDateKeys = announcedAppointmentDates.map((d) => d.normalized);
    const preferredAppointmentDate = announcedAppointmentDates[0] || null;
    if (preferredAppointmentDate) {
      console.log(`  [BOOK] En erken ilan edilen randevu tarihi hedeflenecek: ${preferredAppointmentDate.raw}`);
      console.log(`  [BOOK] Açık tarih whitelist: ${announcedAppointmentDateKeys.join(", ")}`);
    }
    
    if (!step1Result.clicked) {
      const ss = await takeScreenshotBase64(page);
      await idataLog("appt_error", `Step 1: İLERİ butonu bulunamadı | ${getAccountName(account)}`, ss);
      return { success: false, error: "İLERİ butonu bulunamadı (step1)" };
    }

    const ss1 = await takeScreenshotBase64(page);
    await idataLog("appt_step1_ileri", `✅ İLERİ tıklandı | Tarihler: ${(step1Result.dates || []).join(", ")} | Hedef: ${preferredAppointmentDate?.raw || "ilk yeşil"} | ${getAccountName(account)}`, ss1);
    
    await delay(3000, 5000);

    // Popup kontrolü (uyarı çıkabilir)
    await page.evaluate(() => {
      const closeButtons = document.querySelectorAll('.swal2-confirm, .swal2-close, .modal .btn, button');
      for (const btn of closeButtons) {
        const txt = (btn.innerText || "").trim().toUpperCase();
        if (txt === "TAMAM" || txt === "OK" || txt === "KAPAT" || txt === "EVET") {
          btn.click();
          break;
        }
      }
    });
    await delay(1500, 2500);

    // ===== STEP 1.5: Seyahat Başlangıç Tarihi alanını doldur =====
    console.log("  [BOOK] Step 1.5: Seyahat Başlangıç Tarihi alanı aranıyor...");
    
    // Hesaptaki travel_date'i kullan
    let travelDateStr = "";
    if (account.travel_date) {
      const ymd = account.travel_date.match(/(\d{4})-(\d{2})-(\d{2})/);
      const dmy = account.travel_date.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
      if (ymd) travelDateStr = `${ymd[3]}.${ymd[2]}.${ymd[1]}`; // DD.MM.YYYY
      else if (dmy) travelDateStr = `${dmy[1]}.${dmy[2]}.${dmy[3]}`;
      else travelDateStr = account.travel_date;
    } else {
      // Fallback: 30 gün sonra
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      travelDateStr = `${String(future.getDate()).padStart(2, "0")}.${String(future.getMonth() + 1).padStart(2, "0")}.${future.getFullYear()}`;
    }
    
    // "Seyahat Başlangıç Tarihi" veya "Gidiş Tarihi" alanını bul ve takvim ikonuna tıkla
    const travelDateIconClicked = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      
      // Seyahat/Gidiş tarihi alanını bul
      let targetInput = inputs.find(inp => {
        const ph = (inp.placeholder || "").toLowerCase();
        const name = (inp.name || inp.id || "").toLowerCase();
        return ph.includes("seyahat") || ph.includes("gidiş") || ph.includes("travel") ||
               name.includes("seyahat") || name.includes("travel") || name.includes("gidis");
      });
      
      // Fallback: label ile ara
      if (!targetInput) {
        const labels = Array.from(document.querySelectorAll("label"));
        for (const lbl of labels) {
          const txt = (lbl.innerText || "").toLowerCase();
          if (txt.includes("seyahat") || txt.includes("gidiş")) {
            const forId = lbl.getAttribute("for");
            if (forId) targetInput = document.getElementById(forId);
            if (!targetInput) targetInput = lbl.closest(".form-group, div")?.querySelector("input");
            if (targetInput) break;
          }
        }
      }
      
      if (targetInput) {
        const inputRect = targetInput.getBoundingClientRect();
        const inputX = inputRect.x + inputRect.width / 2;
        const inputY = inputRect.y + inputRect.height / 2;

        // Input-group içindeki takvim ikonunu bul
        const parent = targetInput.closest(".input-group, .form-group, div");
        if (parent) {
          const icons = parent.querySelectorAll(
            ".input-group-addon, .input-group-append, .input-group-text, " +
            "span.glyphicon-calendar, span.fa-calendar, i.fa-calendar, " +
            "i.glyphicon-calendar, span[class*='calendar'], i[class*='calendar'], " +
            "button[class*='calendar'], .datepickerbutton, img[src*='calendar']"
          );
          for (const icon of icons) {
            icon.click();
            return { clicked: true, method: "icon", tag: icon.tagName, inputX, inputY };
          }
          const addon = parent.querySelector(".input-group-addon, .input-group-btn, .input-group-append");
          if (addon) {
            addon.click();
            return { clicked: true, method: "addon", inputX, inputY };
          }
        }
        targetInput.click();
        targetInput.focus();
        return { clicked: true, method: "input_click", inputX, inputY };
      }
      
      return { clicked: false, inputX: null, inputY: null };
    });
    
    console.log(`  [BOOK] Seyahat tarihi ikonu: ${JSON.stringify(travelDateIconClicked)}`);
    
    if (travelDateIconClicked.clicked) {
      await delay(1500, 2500);
      
      // Takvim açıldıysa — hedef ay/yıla git ve günü seç
      let travelDay = null, travelMonth = null, travelYear = null;
      const tymd = travelDateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (tymd) { travelDay = parseInt(tymd[1]); travelMonth = parseInt(tymd[2]); travelYear = parseInt(tymd[3]); }
      
      if (travelMonth && travelYear) {
        await navigateVisibleCalendarToMonth({
          targetMonth: travelMonth,
          targetYear: travelYear,
          anchorX: travelDateIconClicked?.inputX ?? null,
          anchorY: travelDateIconClicked?.inputY ?? null,
          label: "Seyahat tarihi takvimi",
        });
      }
      
      // Hedef günü seç
      const travelDaySelected = await page.evaluate((dayNum) => {
        const tds = document.querySelectorAll("td.day, td");
        for (const td of tds) {
          const text = (td.innerText || td.textContent || "").trim();
          if (text === String(dayNum) && !td.classList.contains("disabled") && !td.classList.contains("old") && !td.classList.contains("new")) {
            td.click();
            return { selected: true, day: dayNum };
          }
        }
        return { selected: false };
      }, travelDay);
      
      console.log(`  [BOOK] Seyahat günü seçimi: ${JSON.stringify(travelDaySelected)}`);
      
      if (!travelDaySelected.selected) {
        // Manuel giriş fallback
        await page.evaluate((val) => {
          const inputs = Array.from(document.querySelectorAll("input"));
          const inp = inputs.find(i => {
            const ph = (i.placeholder || "").toLowerCase();
            const name = (i.name || i.id || "").toLowerCase();
            return ph.includes("seyahat") || ph.includes("gidiş") || name.includes("seyahat") || name.includes("travel");
          });
          if (inp) {
            inp.value = "";
            inp.focus();
            inp.value = val;
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            inp.dispatchEvent(new Event("blur", { bubbles: true }));
          }
        }, travelDateStr);
        console.log(`  [BOOK] Seyahat tarihi manuel girildi: ${travelDateStr}`);
      }
    } else {
      // İkon bulunamadıysa doğrudan input'a yaz
      await page.evaluate((val) => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const inp = inputs.find(i => {
          const ph = (i.placeholder || "").toLowerCase();
          const name = (i.name || i.id || "").toLowerCase();
          return ph.includes("seyahat") || ph.includes("gidiş") || name.includes("seyahat") || name.includes("travel");
        });
        if (inp) {
          inp.value = "";
          inp.focus();
          inp.value = val;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          inp.dispatchEvent(new Event("blur", { bubbles: true }));
        }
      }, travelDateStr);
      console.log(`  [BOOK] Seyahat tarihi doğrudan girildi: ${travelDateStr}`);
    }
    
    await delay(2000, 3000);
    const ssTravelDate = await takeScreenshotBase64(page);
    await idataLog("appt_travel_date", `🗓️ Seyahat Başlangıç Tarihi: ${travelDateStr} | ${getAccountName(account)}`, ssTravelDate);

    // ===== STEP 2: TARİH sayfası — "Randevu Tarihinizi Seçiniz" takvim ikonuna tıkla =====
    console.log("  [BOOK] Step 2: TARİH sayfası — 'Randevu Tarihinizi Seçiniz' takvim ikonu aranıyor...");

    // Randevu tarih inputunu puanla: seyahat alanını dışla, alt inputu (daha büyük Y) önceliklendir.
    const calIconProbe = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));

      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
      };

      const travelWords = ["seyahat", "gidiş", "gidis", "travel", "flight", "departure", "baslangic", "başlangıç"];
      const apptWords = ["randevu", "appointment", "slot", "tarih"];

      const hasWord = (txt, words) => words.some((w) => txt.includes(w));

      const getLabelText = (inp) => {
        const byFor = inp.id ? document.querySelector(`label[for='${inp.id}']`) : null;
        if (byFor) return (byFor.innerText || byFor.textContent || "").toLowerCase();
        const wrap = inp.closest(".form-group, .input-group, .row, .col-md-6, .col-sm-6, div");
        if (!wrap) return "";
        const lbl = wrap.querySelector("label");
        return lbl ? (lbl.innerText || lbl.textContent || "").toLowerCase() : "";
      };

      const dateCandidates = inputs
        .filter(isVisible)
        .map((inp) => {
          const ph = (inp.placeholder || "").toLowerCase();
          const nm = (inp.name || "").toLowerCase();
          const id = (inp.id || "").toLowerCase();
          const cls = (inp.className || "").toLowerCase();
          const label = getLabelText(inp);
          const blob = `${ph} ${nm} ${id} ${cls} ${label}`;
          const rect = inp.getBoundingClientRect();
          const val = (inp.value || "").trim();

          const isDateLike =
            cls.includes("calendarinput") ||
            cls.includes("flightdate") ||
            cls.includes("datepicker") ||
            ph.includes("tarih") ||
            nm.includes("date") ||
            nm.includes("tarih") ||
            id.includes("date") ||
            id.includes("tarih");

          if (!isDateLike) return null;

          const isTravel = hasWord(blob, travelWords);
          const isAppointmentHint = hasWord(blob, apptWords) && !isTravel;

          let score = 0;
          if (isAppointmentHint) score += 180;
          if (ph.includes("randevu")) score += 220;
          if (nm.includes("randevu") || id.includes("randevu")) score += 180;
          if (!val) score += 60;
          if (val) score -= 40;
          if (isTravel) score -= 300;
          // Kullanıcının dediği gibi alt inputu önceliklendir
          score += Math.floor(rect.y / 3);

          return {
            score,
            rect,
            input: inp,
            ph,
            nm,
            id,
            cls,
            label,
            val,
            isTravel,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || b.rect.y - a.rect.y);

      if (!dateCandidates.length) return { found: false, clicked: false };

      const chosen = dateCandidates[0];
      const targetInput = chosen.input;
      const inputRect = chosen.rect;
      const inputCenterX = inputRect.x + inputRect.width / 2;
      const inputCenterY = inputRect.y + inputRect.height / 2;

      let clickTarget = { x: inputCenterX, y: inputCenterY, kind: "input" };

      const parent = targetInput.closest(".input-group, .form-group, div");
      if (parent) {
        const icons = Array.from(parent.querySelectorAll(
          ".input-group-addon, .input-group-append, .input-group-text, " +
          "span.glyphicon-calendar, span.fa-calendar, i.fa-calendar, " +
          "i.glyphicon-calendar, span[class*='calendar'], i[class*='calendar'], " +
          "button[class*='calendar'], .datepickerbutton, img[src*='calendar']"
        )).filter(isVisible);

        if (icons.length > 0) {
          const scoredIcons = icons
            .map((icon) => {
              const r = icon.getBoundingClientRect();
              const cx = r.x + r.width / 2;
              const cy = r.y + r.height / 2;
              const dx = Math.abs(cx - (inputRect.x + inputRect.width));
              const dy = Math.abs(cy - inputCenterY);
              const score = (cx >= inputRect.x ? 90 : 0) - dx - dy * 2;
              return { icon, cx, cy, score };
            })
            .sort((a, b) => b.score - a.score);

          const best = scoredIcons[0];
          if (best) clickTarget = { x: best.cx, y: best.cy, kind: "icon" };
        }
      }

      window.__idataApptInputHint = {
        id: targetInput.id || "",
        name: targetInput.name || "",
        placeholder: targetInput.placeholder || "",
        y: inputRect.y,
      };

      return {
        found: true,
        clicked: false,
        selectedInput: {
          id: chosen.id,
          name: chosen.nm,
          placeholder: chosen.ph,
          label: chosen.label,
          value: chosen.val,
          y: Math.round(chosen.rect.y),
          score: chosen.score,
          isTravel: chosen.isTravel,
        },
        clickTarget,
        inputX: inputCenterX,
        inputY: inputCenterY,
      };
    });

    console.log(`  [BOOK] Takvim input adayı: ${JSON.stringify(calIconProbe.selectedInput || calIconProbe)}`);

    let calIconClicked = {
      clicked: false,
      inputX: calIconProbe?.inputX ?? null,
      inputY: calIconProbe?.inputY ?? null,
    };

    if (calIconProbe.found && calIconProbe.clickTarget) {
      try {
        await humanClick(page, calIconProbe.clickTarget.x, calIconProbe.clickTarget.y, { preMovesNear: true });
        calIconClicked = {
          clicked: true,
          method: `human_${calIconProbe.clickTarget.kind}`,
          inputX: calIconProbe.inputX,
          inputY: calIconProbe.inputY,
        };
      } catch (mouseErr) {
        console.log(`  [BOOK] Takvim ikonu humanClick hata: ${mouseErr.message}`);
      }
    }

    if (!calIconClicked.clicked && calIconProbe.found && calIconProbe.clickTarget) {
      const domFallback = await page.evaluate((target) => {
        const el = document.elementFromPoint(target.x, target.y);
        if (!el) return { clicked: false };

        el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: target.x, clientY: target.y }));
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: target.x, clientY: target.y }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: target.x, clientY: target.y }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: target.x, clientY: target.y }));
        if (typeof el.click === "function") el.click();

        return { clicked: true, tag: el.tagName, cls: (el.className || "").substring(0, 80) };
      }, calIconProbe.clickTarget);

      if (domFallback.clicked) {
        calIconClicked = {
          clicked: true,
          method: `dom_${calIconProbe.clickTarget.kind}`,
          tag: domFallback.tag,
          inputX: calIconProbe.inputX,
          inputY: calIconProbe.inputY,
        };
      }
    }

    console.log(`  [BOOK] Takvim ikonu: ${JSON.stringify(calIconClicked)}`);
    await page.evaluate((anchorX, anchorY) => {
      window.__idataApptAnchorX = anchorX;
      window.__idataApptAnchorY = anchorY;
    }, calIconClicked?.inputX ?? null, calIconClicked?.inputY ?? null).catch(() => {});
    await delay(2000, 3000);

    // ===== STEP 3: Takvimden sadece YEŞİL ve en erken günü seç =====
    // Öncelik: Step 1'de ekranda listelenen en erken randevu tarihi
    const targetAppointmentDate = preferredAppointmentDate || null;
    let targetDay = targetAppointmentDate?.day ?? null;
    let targetMonth = targetAppointmentDate?.month ?? null;
    let targetYear = targetAppointmentDate?.year ?? null;
    
    console.log(`  [BOOK] Step 3: Sadece yeşil gün seçilecek... hedef: ${targetDay ? `${targetDay}/${targetMonth}/${targetYear}` : "ilk yeşil gün"}`);
    
    // Kullanıcının isteği doğrultusunda randevu takviminde ay gezme kapatıldı.
    // Sadece ekranda şu an görünen yeşil hücreler hedeflenecek.

    // Yeşil günleri tespit et — sadece whitelist içindeki açık tarihlerden seç
    const dateInfo = await page.evaluate((targetNormalized, allowedDates, anchorX, anchorY) => {
      const calendarSelector = ".datepicker, .datepicker-dropdown, .bootstrap-datetimepicker-widget, .datepicker-days, .flatpickr-calendar, .ui-datepicker, [class*='datepicker'], [class*='calendar'], .picker-open, table.table-condensed";
      const calContainers = Array.from(document.querySelectorAll(calendarSelector));

      const allowedSet = new Set((allowedDates || []).filter(Boolean));
      const monthMap = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
        ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
      };

      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const normalizeText = (value) => String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/ş/g, "s")
        .replace(/ü/g, "u")
        .replace(/ö/g, "o")
        .replace(/ç/g, "c");

      const parseMonthYear = (text) => {
        const raw = normalizeText(text);
        if (!raw) return { month: null, year: null, headerText: "" };
        const yearMatch = raw.match(/(20\d{2})/);
        let month = null;
        for (const [name, num] of Object.entries(monthMap)) {
          if (raw.includes(normalizeText(name))) {
            month = num;
            break;
          }
        }
        return {
          month,
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          headerText: raw,
        };
      };

      const findCalendarRoot = (startNode) => {
        let node = startNode;
        let best = null;
        let depth = 0;
        while (node && node !== document.body && depth < 8) {
          if (node.matches?.(calendarSelector) && isVisible(node)) {
            const rect = node.getBoundingClientRect();
            const dayCount = node.querySelectorAll?.("td").length || 0;
            if (rect.width >= 140 && rect.height >= 120 && dayCount >= 20) {
              best = node;
            }
          }
          node = node.parentElement;
          depth += 1;
        }
        return best;
      };

      const pickCalendarHeader = (cal) => {
        const localHeaders = Array.from(cal.querySelectorAll(
          ".datepicker-switch, .picker-switch, .datepicker th.switch, .ui-datepicker-title, caption, th"
        ));
        for (const node of localHeaders) {
          const parsed = parseMonthYear(node.innerText || node.textContent || "");
          if (parsed.month && parsed.year) return parsed;
        }
        return { month: null, year: null, headerText: "" };
      };

      const dedupedCalendars = [];
      for (const cal of calContainers) {
        const root = findCalendarRoot(cal) || cal;
        if (!isVisible(root)) continue;
        if (!dedupedCalendars.includes(root)) dedupedCalendars.push(root);
      }

      const candidateCalendars = [];

      for (const cal of dedupedCalendars) {
        const style = window.getComputedStyle(cal);
        const calRect = cal.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (calRect.width < 140 || calRect.height < 120) continue;

        const { month: displayedMonth, year: displayedYear, headerText } = pickCalendarHeader(cal);
        const days = [];
        const tds = cal.querySelectorAll("td");
        for (const d of tds) {
          const text = (d.innerText || d.textContent || "").trim();
          if (!/^\d{1,2}$/.test(text)) continue;
          const childFlagEl = d.querySelector("a, span, div");
          const classBlob = `${d.className || ""} ${childFlagEl?.className || ""}`.toLowerCase();

          const hasDisabledClass =
            d.classList.contains("disabled") ||
            d.classList.contains("disabled-day") ||
            d.classList.contains("off") ||
            d.classList.contains("old") ||
            d.classList.contains("new") ||
            classBlob.includes("disabled-day") ||
            classBlob.includes("disabled");

          if (hasDisabledClass) continue;

          const dayNum = parseInt(text, 10);
          const tdBg = window.getComputedStyle(d).backgroundColor;
          const childBg = childFlagEl ? window.getComputedStyle(childFlagEl).backgroundColor : "";
          const bgColor = childBg && childBg !== "rgba(0, 0, 0, 0)" ? childBg : tdBg;

          const rgbMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          let isGreen = false, isRed = false, isYellow = false;

          if (rgbMatch) {
            const r = parseInt(rgbMatch[1], 10), g = parseInt(rgbMatch[2], 10), b = parseInt(rgbMatch[3], 10);
            isGreen = g > 100 && g > r * 1.2 && g > b * 1.2;
            isRed = r > 150 && r > g * 1.4 && r > b * 1.4;
            isYellow = r > 200 && g > 150 && b < 120;
          }

          if (d.classList.contains("enabled-day") || classBlob.includes("enabled-day")) isGreen = true;
          if (d.classList.contains("disabled-day") || classBlob.includes("disabled-day")) { isRed = true; isGreen = false; }
          if (d.classList.contains("bg-success") || d.classList.contains("success") || classBlob.includes("bg-success") || classBlob.includes("success")) isGreen = true;
          if (d.classList.contains("bg-danger") || d.classList.contains("danger") || classBlob.includes("bg-danger") || classBlob.includes("danger")) isRed = true;
          if (d.classList.contains("bg-warning") || d.classList.contains("warning") || d.classList.contains("today") || d.classList.contains("active") || classBlob.includes("bg-warning") || classBlob.includes("warning") || classBlob.includes("active")) isYellow = true;

          const innerLink = d.querySelector("a[href*='doPostBack'], a[href*='javascript'], a");
          const postbackHref = innerLink ? (innerLink.getAttribute("href") || "") : "";
          const onclickText = `${innerLink?.getAttribute("onclick") || ""} ${d.getAttribute("onclick") || ""}`;

          let postbackTarget = null, postbackArg = null;
          const hrefPb = postbackHref.match(/__doPostBack\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
          const onclickPb = onclickText.match(/__doPostBack\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
          const pbMatch = hrefPb || onclickPb;
          if (pbMatch) { postbackTarget = pbMatch[1]; postbackArg = pbMatch[2]; }

          const cellRect = d.getBoundingClientRect();
          const clickRect = cellRect.width > 8 && cellRect.height > 8
            ? cellRect
            : (innerLink ? innerLink.getBoundingClientRect() : cellRect);
          const normalizedDate = displayedMonth && displayedYear
            ? `${displayedYear}-${String(displayedMonth).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`
            : null;

          days.push({
            day: dayNum,
            isGreen,
            isRed,
            isYellow,
            bgColor,
            x: clickRect.x + clickRect.width / 2,
            y: clickRect.y + clickRect.height / 2,
            cellX: cellRect.x + cellRect.width / 2,
            cellY: cellRect.y + cellRect.height / 2,
            hasLink: !!innerLink,
            postbackTarget,
            postbackArg,
            linkHref: postbackHref.substring(0, 200),
            onclickText: onclickText.substring(0, 200),
            normalizedDate,
            matchesWhitelist: normalizedDate ? allowedSet.has(normalizedDate) : false,
          });
        }

        if (days.length < 20) continue;

        const calCenterX = calRect.x + calRect.width / 2;
        const calCenterY = calRect.y + calRect.height / 2;
        const distance = (anchorX != null && anchorY != null)
          ? Math.hypot(calCenterX - anchorX, calCenterY - anchorY)
          : 9999;
        const insideX = anchorX != null && anchorX >= calRect.x - 24 && anchorX <= calRect.x + calRect.width + 24;
        const belowAnchor = anchorY != null ? calRect.y >= anchorY - 90 : true;
        const zIndex = parseInt(style.zIndex || "0", 10) || 0;
        const score = (insideX ? 220 : -Math.min(220, Math.abs(calCenterX - (anchorX ?? calCenterX)))) + (belowAnchor ? 180 : -260) + Math.min(zIndex, 999) / 5 - Math.round(distance);

        candidateCalendars.push({ days, distance, width: calRect.width, height: calRect.height, headerText, score, y: calRect.y });
      }

      if (candidateCalendars.length === 0) {
        return { found: false, totalDays: 0, reason: "calendar_not_found" };
      }

      candidateCalendars.sort((a, b) => b.score - a.score || a.distance - b.distance || a.y - b.y);
      const selectedCalendar = candidateCalendars[0];
      const allDays = selectedCalendar.days;

      const strictGreenDays = allDays
        .filter((d) => d.isGreen && !d.isRed && !d.isYellow)
        .sort((a, b) => a.day - b.day);

      const whitelistedGreenDays = allowedSet.size > 0
        ? strictGreenDays.filter((d) => d.matchesWhitelist)
        : [];
      const selectableDays = whitelistedGreenDays.length > 0
        ? whitelistedGreenDays
        : strictGreenDays;

      if (selectableDays.length > 0) {
        let target = null;
        if (targetNormalized) target = selectableDays.find((d) => d.normalizedDate === targetNormalized);
        if (!target) target = selectableDays[0];

        return {
          found: true,
          day: target.day,
          normalizedDate: target.normalizedDate,
          isGreen: target.isGreen,
          x: target.x,
          y: target.y,
          cellX: target.cellX,
          cellY: target.cellY,
          totalDays: allDays.length,
          greenCount: selectableDays.length,
          bgColor: target.bgColor,
          hasLink: target.hasLink,
          postbackTarget: target.postbackTarget,
          postbackArg: target.postbackArg,
          linkHref: target.linkHref,
          calendarDistance: selectedCalendar.distance,
          calendarScore: Math.round(selectedCalendar.score || 0),
          matchedWhitelist: target.matchesWhitelist,
        };
      }

      return {
        found: false,
        totalDays: allDays.length,
        reason: allowedSet.size > 0 ? "no_whitelisted_green_days" : "no_green_days",
        visibleGreenDates: strictGreenDays.map((d) => d.normalizedDate).filter(Boolean).slice(0, 10),
        calendarScore: Math.round(selectedCalendar.score || 0),
      };
    }, targetAppointmentDate?.normalized ?? null, announcedAppointmentDateKeys, calIconClicked?.inputX ?? null, calIconClicked?.inputY ?? null);

    console.log(`  [BOOK] Tarih bilgisi: ${JSON.stringify(dateInfo)}`);
    
    let dateSelected = { selected: false, day: 0, greenCount: 0, bgColor: "" };
    
    if (dateInfo.found) {
      console.log(`  [BOOK] Tarih bilgisi: hasLink=${dateInfo.hasLink} postbackTarget=${dateInfo.postbackTarget} linkHref=${dateInfo.linkHref}`);

      const verifyDateSelection = async () => {
        return await page.evaluate((dayNum, targetNormalized, anchorX, anchorY) => {
          const calendarSelector = ".datepicker, .datepicker-dropdown, .bootstrap-datetimepicker-widget, .datepicker-days, .flatpickr-calendar, .ui-datepicker, [class*='datepicker'], [class*='calendar'], .picker-open, table.table-condensed";
          const normalizeDateValue = (val) => {
            const raw = String(val || "").trim();
            if (!raw) return null;

            let match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
            if (match) {
              return `${match[1]}-${String(parseInt(match[2], 10)).padStart(2, "0")}-${String(parseInt(match[3], 10)).padStart(2, "0")}`;
            }

            match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
            if (match) {
              const year = match[3].length === 2 ? `20${match[3]}` : match[3];
              return `${year}-${String(parseInt(match[2], 10)).padStart(2, "0")}-${String(parseInt(match[1], 10)).padStart(2, "0")}`;
            }

            return null;
          };

          const parsePickedDay = (val) => {
            const normalized = normalizeDateValue(val);
            if (normalized) return parseInt(normalized.slice(-2), 10);
            const dayMatch = String(val || "").match(/(\d{1,2})/);
            return dayMatch ? parseInt(dayMatch[1], 10) : NaN;
          };

          const isVisible = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
          };

          const findCalendarRoot = (startNode) => {
            let node = startNode;
            let best = null;
            let depth = 0;
            while (node && node !== document.body && depth < 8) {
              if (node.matches?.(calendarSelector) && isVisible(node)) {
                const rect = node.getBoundingClientRect();
                const dayCount = node.querySelectorAll?.("td").length || 0;
                if (rect.width >= 140 && rect.height >= 120 && dayCount >= 20) best = node;
              }
              node = node.parentElement;
              depth += 1;
            }
            return best;
          };

          const calendarRoots = Array.from(document.querySelectorAll(calendarSelector))
            .map((node) => findCalendarRoot(node) || node)
            .filter((node, idx, arr) => node && isVisible(node) && arr.indexOf(node) === idx);

          const scopedCalendar = calendarRoots
            .map((cal) => {
              const rect = cal.getBoundingClientRect();
              const centerX = rect.x + rect.width / 2;
              const centerY = rect.y + rect.height / 2;
              const distance = (anchorX != null && anchorY != null)
                ? Math.hypot(centerX - anchorX, centerY - anchorY)
                : 9999;
              const insideX = anchorX != null && anchorX >= rect.x - 24 && anchorX <= rect.x + rect.width + 24;
              const belowAnchor = anchorY != null ? rect.y >= anchorY - 90 : true;
              const score = (insideX ? 220 : -Math.min(220, Math.abs(centerX - (anchorX ?? centerX)))) + (belowAnchor ? 180 : -260) - Math.round(distance);
              return { cal, score, distance };
            })
            .sort((a, b) => b.score - a.score || a.distance - b.distance)[0]?.cal || null;

          if (scopedCalendar) {
            const tds = scopedCalendar.querySelectorAll("td");
            for (const d of tds) {
              const text = (d.innerText || d.textContent || "").trim();
              if (parseInt(text, 10) === dayNum) {
                const cls = (d.className || "").toLowerCase();
                const isActive = cls.includes("active") || cls.includes("selected") || cls.includes("focused") || cls.includes("highlighted");
                const isMonthCell = !cls.includes("old") && !cls.includes("new") && !cls.includes("off") && !cls.includes("disabled");
                if (isActive && isMonthCell) return { isActive: true, cls };
              }
            }
          }

          const travelWords = ["seyahat", "gidiş", "gidis", "travel", "flight", "departure", "baslangic", "başlangıç"];
          const hasTravelWord = (txt) => travelWords.some((w) => txt.includes(w));

          const allDateInputs = Array.from(document.querySelectorAll(
            "input[data-provide='datepicker'], input.datepicker, input.calendarinput, input.flightDate, " +
            "input[name*='date' i], input[name*='tarih' i], input[placeholder*='Tarih' i], input[placeholder*='tarih' i]"
          ));

          const nonTravelInputs = allDateInputs.filter((inp) => {
            const blob = `${(inp.placeholder || "")} ${(inp.name || "")} ${(inp.id || "")}`.toLowerCase();
            return !hasTravelWord(blob);
          });

          const hint = window.__idataApptInputHint || null;
          let targetInput = null;

          if (hint?.id) targetInput = nonTravelInputs.find((inp) => (inp.id || "") === hint.id) || null;
          if (!targetInput && hint?.name) targetInput = nonTravelInputs.find((inp) => (inp.name || "") === hint.name) || null;
          if (!targetInput && hint?.placeholder) {
            const ph = (hint.placeholder || "").toLowerCase();
            targetInput = nonTravelInputs.find((inp) => (inp.placeholder || "").toLowerCase() === ph) || null;
          }
          if (!targetInput && hint?.y != null && nonTravelInputs.length > 0) {
            targetInput = nonTravelInputs
              .map((inp) => {
                const r = inp.getBoundingClientRect();
                return { inp, dy: Math.abs(r.y - hint.y) };
              })
              .sort((a, b) => a.dy - b.dy)[0]?.inp || null;
          }

          if (targetInput) {
            const v = (targetInput.value || "").trim();
            if (v) {
              const normalized = normalizeDateValue(v);
              if (targetNormalized && normalized === targetNormalized) return { isActive: true, cls: "appt-input-matched-date: " + v };
              const pickedDay = parsePickedDay(v);
              if (!targetNormalized && !Number.isNaN(pickedDay) && pickedDay === dayNum) return { isActive: true, cls: "appt-input-matched-day: " + v };
            }
          }

          for (const inp of nonTravelInputs) {
            const v = (inp.value || "").trim();
            if (!v) continue;
            const normalized = normalizeDateValue(v);
            if (targetNormalized && normalized === targetNormalized) return { isActive: true, cls: "non-travel-input-matched-date: " + v };
            const pickedDay = parsePickedDay(v);
            if (!targetNormalized && !Number.isNaN(pickedDay) && pickedDay === dayNum) return { isActive: true, cls: "non-travel-input-matched-day: " + v };
          }
          return { isActive: false, cls: "" };
        }, dateInfo.day, dateInfo.normalizedDate || null, calIconClicked?.inputX ?? null, calIconClicked?.inputY ?? null);
      };

      const clickDateCellAt = async (targetX, targetY, label = "date-cell") => {
        const roundedX = Math.round(targetX);
        const roundedY = Math.round(targetY);

        await humanClick(page, targetX, targetY, { preMovesNear: true });
        console.log(`  [BOOK] ✅ ${label} humanClick: x:${roundedX}, y:${roundedY}`);
        await delay(900, 1400);

        let verify = await verifyDateSelection();
        console.log(`  [BOOK] ${label} humanClick doğrulama: ${JSON.stringify(verify)}`);
        if (verify.isActive) return verify;

        await page.evaluate((x, y) => {
          const element = document.elementFromPoint(x, y);
          if (!element) return false;

          const opts = (bubbles, cancelable = true) => ({
            view: window, bubbles, cancelable, clientX: x, clientY: y, button: 0, buttons: 1,
          });

          element.dispatchEvent(new MouseEvent("mousemove", opts(true)));
          element.dispatchEvent(new MouseEvent("mouseover", opts(true)));
          element.dispatchEvent(new MouseEvent("mouseenter", { ...opts(false), buttons: 0 }));
          element.dispatchEvent(new MouseEvent("mousedown", opts(true)));
          element.focus?.();
          element.dispatchEvent(new MouseEvent("mouseup", { ...opts(true), buttons: 0 }));
          element.dispatchEvent(new MouseEvent("click", { ...opts(true), buttons: 0 }));
          return true;
        }, targetX, targetY);

        await delay(900, 1400);
        verify = await verifyDateSelection();
        console.log(`  [BOOK] ${label} domClick doğrulama: ${JSON.stringify(verify)}`);
        return verify;
      };

      // === Tek yol: sadece görünür yeşil hücrenin merkezine bas ===
      const primaryClickX = dateInfo.cellX ?? dateInfo.x;
      const primaryClickY = dateInfo.cellY ?? dateInfo.y;
      let dateVerify = { isActive: false, cls: "" };
      try {
        dateVerify = await clickDateCellAt(primaryClickX, primaryClickY, `green-cell day-${dateInfo.day}`);
      } catch (mouseErr) {
        console.log(`  [BOOK] Green-cell click hata: ${mouseErr.message}`);
      }

      if (!dateVerify.isActive) {
        console.log("  [BOOK] Tarih aktif değil, aynı yeşil hücreye son bir kez basılıyor...");
        try {
          dateVerify = await clickDateCellAt(primaryClickX, primaryClickY, `green-cell retry day-${dateInfo.day}`);
        } catch (_) {}
      }

      if (!dateVerify.isActive) {
        const slotProbe = await page.evaluate(() => {
          const txt = (document.body?.innerText || "").replace(/\s+/g, " ");
          const controls = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit'], .getdatebtnhour, li, span"));
          const timeCount = controls.filter((el) => /\b\d{1,2}[:.]\d{2}\b/.test((el.innerText || el.textContent || el.value || "").trim())).length;
          return { timeCount, hasSaatSeciniz: txt.includes("Saat: Seçiniz") || txt.includes("Saat : Seçiniz") };
        });

        if (slotProbe.timeCount > 0) {
          dateVerify = { isActive: true, cls: `time-slots-visible:${slotProbe.timeCount}` };
          console.log(`  [BOOK] Tarih doğrulama bypass: saat slotları görünüyor (${slotProbe.timeCount})`);
        }
      }

      dateSelected = {
        selected: !!dateVerify.isActive,
        day: dateInfo.day,
        isGreen: dateInfo.isGreen,
        greenCount: dateInfo.greenCount,
        bgColor: dateInfo.bgColor,
      };
    }

    console.log(`  [BOOK] Tarih seçimi: ${JSON.stringify(dateSelected)}`);

    if (!dateSelected.selected && dateInfo?.found) {
      console.log("  [BOOK] Takvim dışı manuel tarih enjeksiyonu kapalı; sadece yeşil hücre tıklaması kullanılacak.");
    }

    await delay(2000, 3000);
    const ss2 = await takeScreenshotBase64(page);
    await idataLog("appt_date_picked", `📅 Tarih seçildi: ${dateSelected.selected ? `Gün ${dateSelected.day} (${dateSelected.greenCount} yeşil gün, bg: ${dateSelected.bgColor})` : "Manuel"} | ${getAccountName(account)}`, ss2);

    // ===== STEP 4: Turuncu saat butonuna tıkla =====
    console.log("  [BOOK] Step 4: Turuncu saat butonu aranıyor...");
    await delay(2000, 3000);

    // Saat slotları bazen AJAX ile geç geliyor; birkaç tur bekleyip tekrar tara
    const scanTimeButtons = async () => {
      return await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll(
          "button, a, input[type='button'], input[type='submit'], [role='button'], .getdatebtnhour, li, span, div, td, label"
        ));

        const normalizeTime = (txt) => {
          const m = (txt || "").replace(/\s+/g, " ").match(/(\d{1,2}[:.]\d{2})/);
          if (!m) return "";
          const [h, mm] = m[1].replace(".", ":").split(":");
          return `${String(parseInt(h, 10)).padStart(2, "0")}:${mm}`;
        };

        const parseMinutes = (time) => {
          const m = (time || "").match(/^(\d{2}):(\d{2})$/);
          if (!m) return 9999;
          return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        };

        const timeButtons = [];

        for (const el of candidates) {
          const style = window.getComputedStyle(el);
          const isVisible = style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
          if (!isVisible || el.offsetHeight < 8 || el.offsetWidth < 12) continue;

          const cls = (el.className || "").toLowerCase();
          const tag = el.tagName;
          const role = (el.getAttribute("role") || "").toLowerCase();
          const hrefSelf = el.getAttribute("href") || "";
          const childLink = el.querySelector("a[href]");
          const href = hrefSelf || (childLink ? (childLink.getAttribute("href") || "") : "");
          const hasPostback = href.includes("__doPostBack");

          const rawText = (el.innerText || el.textContent || el.value || el.getAttribute("data-time") || el.getAttribute("title") || "").trim();
          const matchedTime = normalizeTime(rawText);
          if (!matchedTime) continue;

          const childControls = Array.from(el.querySelectorAll("button, a, input"));
          const hasNestedTimeControl = childControls.some((child) => normalizeTime(child.innerText || child.textContent || child.value || ""));
          if (hasNestedTimeControl && tag !== "BUTTON" && tag !== "A" && tag !== "INPUT") continue;

          const isLikelyClickable =
            tag === "BUTTON" ||
            tag === "A" ||
            tag === "INPUT" ||
            role === "button" ||
            cls.includes("btn") ||
            cls.includes("slot") ||
            cls.includes("hour") ||
            cls.includes("getdatebtnhour") ||
            hasPostback;
          if (!isLikelyClickable) continue;

          const bgColor = style.backgroundColor;
          const rgbMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          let isOrange = false;
          if (rgbMatch) {
            const r = parseInt(rgbMatch[1], 10);
            const g = parseInt(rgbMatch[2], 10);
            const b = parseInt(rgbMatch[3], 10);
            isOrange = r > 170 && g > 70 && g < 190 && b < 120;
          }
          if (cls.includes("btn-warning") || cls.includes("btn-orange") || cls.includes("warning") || cls.includes("active") || cls.includes("getdatebtnhour") || cls.includes("slot-selected")) {
            isOrange = true;
          }

          let postbackTarget = null;
          let postbackArg = null;
          const pbMatch = href.match(/__doPostBack\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
          if (pbMatch) {
            postbackTarget = pbMatch[1];
            postbackArg = pbMatch[2];
          }

          const rect = el.getBoundingClientRect();
          timeButtons.push({
            time: matchedTime,
            sortMinute: parseMinutes(matchedTime),
            isOrange,
            bgColor,
            tag,
            cls: (el.className || "").substring(0, 120),
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            postbackTarget,
            postbackArg,
          });
        }

        const sorted = [...timeButtons].sort((a, b) => {
          if (a.isOrange !== b.isOrange) return a.isOrange ? -1 : 1;
          if (a.sortMinute !== b.sortMinute) return a.sortMinute - b.sortMinute;
          return a.y - b.y;
        });

        const target = sorted.length > 0 ? sorted[0] : null;
        return {
          found: !!target,
          target,
          totalSlots: timeButtons.length,
          allSlots: sorted.slice(0, 10).map((t) => ({ time: t.time, isOrange: t.isOrange, tag: t.tag, cls: t.cls.substring(0, 40), pb: !!t.postbackTarget })),
        };
      });
    };

    let timeButtonInfo = { found: false, target: null, totalSlots: 0, allSlots: [] };
    for (let scanAttempt = 0; scanAttempt < 6; scanAttempt++) {
      timeButtonInfo = await scanTimeButtons();
      if (timeButtonInfo.found) break;

      // Slotlar yüklenmediyse seçilen güne fiziksel tıklamayı bir kez daha tetikle
      if (scanAttempt === 1 && dateInfo?.found) {
        try {
          await humanClick(page, dateInfo.cellX ?? dateInfo.x, dateInfo.cellY ?? dateInfo.y, { preMovesNear: true });
          console.log("  [BOOK] Saat listesi için tarih tekrar tıklandı (humanClick)");
        } catch (_) {}
      }

      await delay(700, 1200);
    }

    console.log(`  [BOOK] Saat butonları: ${JSON.stringify(timeButtonInfo)}`);

    // Kritik düzeltme: saat slotu görünüyorsa tarih seçimi aslında başarılıdır.
    if (!dateSelected.selected && timeButtonInfo.found) {
      dateSelected = {
        ...dateSelected,
        selected: true,
      };
      console.log("  [BOOK] Tarih doğrulama geç geldi; görünür saat slotu tarih seçimi kanıtı olarak kabul edildi.");
    }

    let timeButtonResult = { clicked: false };

    if (timeButtonInfo.found && timeButtonInfo.target) {
      const t = timeButtonInfo.target;
      let usedMethod = "human_click";

      const verifyTimeSelection = async () => {
        return await page.evaluate((targetTime) => {
          const normalizeTime = (txt) => {
            const m = (txt || "").replace(/\s+/g, " ").match(/(\d{1,2}[:.]\d{2})/);
            if (!m) return "";
            const [h, mm] = m[1].replace(".", ":").split(":");
            return `${String(parseInt(h, 10)).padStart(2, "0")}:${mm}`;
          };

          const controls = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button'], .getdatebtnhour, li, span, div, td, label"));
          for (const el of controls) {
            const txt = (el.innerText || el.textContent || el.value || "").trim();
            const normalizedTextTime = normalizeTime(txt);
            if (!normalizedTextTime || normalizedTextTime !== targetTime) continue;

            const style = window.getComputedStyle(el);
            const isVisible = style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
            if (!isVisible) continue;

            const cls = (el.className || "").toLowerCase();
            const ariaPressed = (el.getAttribute("aria-pressed") || "").toLowerCase();
            const bg = style.backgroundColor;
            const isActive =
              cls.includes("active") ||
              cls.includes("selected") ||
              cls.includes("checked") ||
              cls.includes("btn-success") ||
              cls.includes("btn-warning") ||
              cls.includes("slot-selected") ||
              ariaPressed === "true";

            if (isActive) return { isActive: true, cls: (el.className || "").substring(0, 100), bg };
          }

          // Sağ özet panelde "Saat: 09:30" gibi metin görünüyorsa seçimi başarılı say
          const pageText = (document.body?.innerText || "").replace(/\s+/g, " ");
          if (pageText.includes(`Saat: ${targetTime}`) || pageText.includes(`Saat : ${targetTime}`)) {
            return { isActive: true, cls: "summary-time-matched", bg: "" };
          }

          return { isActive: false, cls: "", bg: "" };
        }, t.time);
      };

      try {
        await humanClick(page, t.x, t.y, { preMovesNear: true });
        console.log(`  [BOOK] ✅ HumanClick saat: ${t.time} (x:${Math.round(t.x)}, y:${Math.round(t.y)})`);
      } catch (mouseErr) {
        usedMethod = "human_click_error";
        console.log(`  [BOOK] HumanClick saat hata: ${mouseErr.message}`);
      }

      await delay(1500, 2500);
      let timeVerify = await verifyTimeSelection();
      console.log(`  [BOOK] Saat doğrulama-1: ${JSON.stringify(timeVerify)}`);

      if (!timeVerify.isActive && t.postbackTarget) {
        usedMethod = "postback";
        console.log(`  [BOOK] Saat aktif değil, __doPostBack çağrılıyor: ${t.postbackTarget}`);
        await page.evaluate((target, arg) => {
          if (typeof window.__doPostBack === "function") {
            window.__doPostBack(target, arg);
          }
        }, t.postbackTarget, t.postbackArg || "");
        await delay(1500, 2500);
        timeVerify = await verifyTimeSelection();
        console.log(`  [BOOK] Saat doğrulama-2(postback): ${JSON.stringify(timeVerify)}`);
      }

      if (!timeVerify.isActive) {
        usedMethod = "element_handle";
        console.log("  [BOOK] Saat aktif değil, element handle ile deneniyor...");
        try {
          const timeElements = await page.$$("button.getdatebtnhour, button.btn-warning, button, a, input[type='button'], input[type='submit']");
          for (const elHandle of timeElements) {
            const meta = await page.evaluate(el => ({
              text: (el.innerText || el.textContent || el.value || "").trim(),
              cls: (el.className || "").toLowerCase(),
            }), elHandle);
            if (meta.text.includes(t.time) && (meta.cls.includes("getdatebtnhour") || meta.cls.includes("btn") || meta.cls.includes("warning"))) {
              await elHandle.click();
              console.log(`  [BOOK] ✅ Element handle click: ${t.time}`);
              break;
            }
          }
        } catch (ehErr) {
          console.log(`  [BOOK] Element handle hata: ${ehErr.message}`);
        }
        await delay(1000, 2000);
        timeVerify = await verifyTimeSelection();
        console.log(`  [BOOK] Saat doğrulama-3(element): ${JSON.stringify(timeVerify)}`);
      }

      if (!timeVerify.isActive) {
        usedMethod = "full_event_dispatch";
        await page.evaluate((targetTime) => {
          const controls = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button']"));
          for (const el of controls) {
            const text = (el.innerText || el.textContent || el.value || "").trim();
            if (!text.includes(targetTime)) continue;
            el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
            el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            if (typeof el.click === "function") el.click();
            const href = el.getAttribute && el.getAttribute("href");
            if (href && href.includes("__doPostBack")) {
              try { eval(href.replace("javascript:", "")); } catch(e) {}
            }
            break;
          }
        }, t.time);
        await delay(1000, 1500);
        timeVerify = await verifyTimeSelection();
        console.log(`  [BOOK] Saat doğrulama-4(dispatch): ${JSON.stringify(timeVerify)}`);
      }

      timeButtonResult = {
        clicked: !!timeVerify.isActive,
        time: t.time,
        isOrange: t.isOrange,
        method: usedMethod,
      };

      // Saat seçilebildiyse tarih seçimi de fiilen başarılıdır.
      if (timeButtonResult.clicked && !dateSelected.selected) {
        dateSelected = {
          ...dateSelected,
          selected: true,
        };
        console.log("  [BOOK] Saat seçimi başarılı olduğu için tarih seçimi de başarılı kabul edildi.");
      }
    } else {
      // Fallback: select dropdown
      const selectResult = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select"));
        for (const sel of selects) {
          const labelText = (sel.closest("div, label")?.innerText || sel.name || sel.id || "").toLowerCase();
          if (labelText.includes("saat") && sel.options.length > 1) {
            sel.selectedIndex = 1;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return { clicked: true, time: sel.options[1]?.text || "?", method: "select" };
          }
        }
        return { clicked: false };
      });
      timeButtonResult = selectResult;

      if (timeButtonResult.clicked && !dateSelected.selected) {
        dateSelected = {
          ...dateSelected,
          selected: true,
        };
        console.log("  [BOOK] Select fallback sonrası tarih seçimi başarılı kabul edildi.");
      }
    }

    console.log(`  [BOOK] Saat seçimi sonuç: ${JSON.stringify(timeButtonResult)}`);
    await delay(2000, 3000);

    const ss3 = await takeScreenshotBase64(page);
    await idataLog("appt_time_selection", `⏰ Saat: ${timeButtonResult.clicked ? `${timeButtonResult.time} (${timeButtonResult.method})` : "seçilemedi"} | Butonlar: ${JSON.stringify((timeButtonInfo.allSlots || []).slice(0, 5))} | ${getAccountName(account)}`, ss3);

    // Tarih/saat gerçekten seçilmediyse İLERİ'ye basma; booking'i yeniden dene
    if (!dateSelected.selected || !timeButtonResult.clicked) {
      const reason = !dateSelected.selected && !timeButtonResult.clicked
        ? "date_and_time_not_confirmed"
        : (!dateSelected.selected ? "date_not_confirmed" : "time_not_confirmed");
      console.log(`  [BOOK] ⚠️ Doğrulama başarısız, Step5 atlanıyor: ${reason}`);
      await idataLog("appt_selection_invalid", `⚠️ Tarih/saat seçimi doğrulanamadı (${reason}) — akış yeniden denenecek | ${getAccountName(account)}`, ss3);
      return { success: false, partial: true, error: reason };
    }

    // ===== STEP 5: İLERİ butonuna tıkla (TARİH sayfasından çık) =====
    console.log("  [BOOK] Step 5: İLERİ butonuna tıklanıyor (tarih sayfası)...");
    
    // İLERİ butonunun koordinatlarını al
    const ileriInfo = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"]'));
      const ileriBtn = candidates.find(el => {
        const txt = (el.innerText || el.value || el.textContent || "").trim().toUpperCase();
        return txt === "İLERİ" || txt === "ILERI" || txt === "DEVAM" || txt === "NEXT";
      }) || document.querySelector('.btn-success, a.btn-success');
      
      if (ileriBtn) {
        const rect = ileriBtn.getBoundingClientRect();
        const href = ileriBtn.getAttribute("href") || "";
        let postbackTarget = null, postbackArg = null;
        const pbMatch = href.match(/__doPostBack\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
        if (pbMatch) { postbackTarget = pbMatch[1]; postbackArg = pbMatch[2]; }
        return { 
          found: true, text: (ileriBtn.innerText || ileriBtn.value || "").trim(),
          x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
          postbackTarget, postbackArg
        };
      }
      return { found: false };
    });
    
    let step5Ileri = { clicked: false };
    if (ileriInfo.found) {
      // HumanClick ile İLERİ butonuna tıkla
      try {
        await humanClick(page, ileriInfo.x, ileriInfo.y, { preMovesNear: true });
        step5Ileri = { clicked: true, text: ileriInfo.text };
        console.log(`  [BOOK] ✅ HumanClick İLERİ: ${ileriInfo.text} (x:${Math.round(ileriInfo.x)}, y:${Math.round(ileriInfo.y)})`);
      } catch (e) {
        // Fallback: DOM click + postback
        console.log(`  [BOOK] HumanClick İLERİ hata: ${e.message}, DOM click deneniyor...`);
        await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"]'));
          const btn = candidates.find(el => {
            const txt = (el.innerText || el.value || el.textContent || "").trim().toUpperCase();
            return txt === "İLERİ" || txt === "ILERI";
          });
          if (btn) btn.click();
        });
        step5Ileri = { clicked: true, text: ileriInfo.text, method: "dom_fallback" };
      }
    }

    console.log(`  [BOOK] Step 5 İLERİ: ${JSON.stringify(step5Ileri)}`);
    
    if (step5Ileri.clicked) {
      await delay(700, 1400);

      // Uyarı her çıktığında: HEMEN TAMAM -> HEMEN İLERİ
      const MAX_WARNING_RETRIES = 12;
      for (let warningRetry = 0; warningRetry < MAX_WARNING_RETRIES; warningRetry++) {
        const warningState = await page.evaluate(() => {
          const body = (document.body?.innerText || "").toLowerCase();
          const popup = document.querySelector(".swal2-popup, .swal2-container, .modal.show, [role='dialog']");
          const popupText = (popup?.textContent || "").toLowerCase();
          const allText = `${body}\n${popupText}`;

          const isDateWarning =
            allText.includes("bir randevu tarihi ve saati seçiniz") ||
            allText.includes("randevu tarihi ve saati") ||
            allText.includes("tarih ve saat seçiniz") ||
            allText.includes("lütfen başka bir tarih seçin") ||
            allText.includes("başka bir tarih seçin");

          let clickedOk = false;
          if (isDateWarning) {
            const btns = Array.from(
              document.querySelectorAll("button, a, .swal2-confirm, [role='button'], input[type='button'], input[type='submit']")
            );
            const okBtn = btns.find((b) => {
              const txt = (b.innerText || b.value || b.textContent || "").trim().toUpperCase();
              return txt === "TAMAM" || txt === "OK" || txt === "KAPAT" || txt === "ANLADIM";
            });
            if (okBtn) {
              okBtn.click();
              clickedOk = true;
            }
          }

          return { isDateWarning, clickedOk };
        });

        if (!warningState.isDateWarning) {
          console.log(`  [BOOK] ✅ Tarih/saat uyarısı yok, devam ediliyor (deneme ${warningRetry})`);
          break;
        }

        console.log(`  [BOOK] ⚠️ Tarih/Saat uyarısı tespit edildi! Retry ${warningRetry + 1}/${MAX_WARNING_RETRIES} — TAMAM→TARİH→SAAT→İLERİ`);
        const ssWarn = await takeScreenshotBase64(page);
        await idataLog(
          "appt_warning_retry",
          `⚠️ Tarih/Saat uyarısı! Retry ${warningRetry + 1}/${MAX_WARNING_RETRIES} | TAMAM→TARİH→SAAT→İLERİ | ${getAccountName(account)}`,
          ssWarn
        );

        await delay(500, 1000);

        // ===== TAMAM'dan sonra yeniden tarih seç (yalnızca ilk ekrandaki açık tarihler) =====
        const retryTargetDate = announcedAppointmentDates[warningRetry % Math.max(announcedAppointmentDates.length, 1)] || preferredAppointmentDate || null;
        const retryDateInfo = await page.evaluate((targetNormalized, allowedDates, anchorX, anchorY) => {
          const calendarSelector = ".datepicker, .datepicker-dropdown, .bootstrap-datetimepicker-widget, .datepicker-days, .flatpickr-calendar, .ui-datepicker, [class*='datepicker'], [class*='calendar'], .picker-open, table.table-condensed";
          const allowedSet = new Set((allowedDates || []).filter(Boolean));
          const monthMap = {
            january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
            ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
          };
          const normalizeText = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ş/g, "s").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
          const parseMonthYear = (text) => {
            const raw = normalizeText(text);
            const yearMatch = raw.match(/(20\d{2})/);
            let month = null;
            for (const [name, num] of Object.entries(monthMap)) {
              if (raw.includes(normalizeText(name))) { month = num; break; }
            }
            return { month, year: yearMatch ? parseInt(yearMatch[1], 10) : null };
          };
          const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };
          const findCalendarRoot = (startNode) => {
            let node = startNode;
            let best = null;
            let depth = 0;
            while (node && node !== document.body && depth < 8) {
              if (node.matches?.(calendarSelector) && isVisible(node)) {
                const rect = node.getBoundingClientRect();
                const dayCount = node.querySelectorAll?.("td").length || 0;
                if (rect.width >= 140 && rect.height >= 120 && dayCount >= 20) best = node;
              }
              node = node.parentElement;
              depth += 1;
            }
            return best;
          };

          const roots = Array.from(document.querySelectorAll(calendarSelector))
            .map((node) => findCalendarRoot(node) || node)
            .filter((node, idx, arr) => node && isVisible(node) && arr.indexOf(node) === idx);

          const scoredCalendars = roots.map((cal) => {
            const style = window.getComputedStyle(cal);
            const calRect = cal.getBoundingClientRect();
            const headerNodes = Array.from(cal.querySelectorAll(".datepicker-switch, .picker-switch, .datepicker th.switch, .ui-datepicker-title, caption, th"));
            let displayedMonth = null;
            let displayedYear = null;
            for (const node of headerNodes) {
              const parsed = parseMonthYear(node.innerText || node.textContent || "");
              if (parsed.month && parsed.year) { displayedMonth = parsed.month; displayedYear = parsed.year; break; }
            }
            const centerX = calRect.x + calRect.width / 2;
            const centerY = calRect.y + calRect.height / 2;
            const distance = (anchorX != null && anchorY != null) ? Math.hypot(centerX - anchorX, centerY - anchorY) : 9999;
            const insideX = anchorX != null && anchorX >= calRect.x - 24 && anchorX <= calRect.x + calRect.width + 24;
            const belowAnchor = anchorY != null ? calRect.y >= anchorY - 90 : true;
            const zIndex = parseInt(style.zIndex || "0", 10) || 0;
            const score = (insideX ? 220 : -Math.min(220, Math.abs(centerX - (anchorX ?? centerX)))) + (belowAnchor ? 180 : -260) + Math.min(zIndex, 999) / 5 - Math.round(distance);
            return { cal, displayedMonth, displayedYear, score, distance };
          }).sort((a, b) => b.score - a.score || a.distance - b.distance);

          const pickedCalendar = scoredCalendars[0] || null;
          if (!pickedCalendar) return { found: false };

          const allDays = [];
          const tds = pickedCalendar.cal.querySelectorAll("td");
          for (const d of tds) {
            const text = (d.innerText || d.textContent || "").trim();
            if (!/^\d{1,2}$/.test(text)) continue;
            const childFlagEl = d.querySelector("a, span, div");
            const classBlob = `${d.className || ""} ${childFlagEl?.className || ""}`.toLowerCase();
            if (classBlob.includes("disabled") || classBlob.includes("off") || classBlob.includes("old") || classBlob.includes("new") || classBlob.includes("disabled-day")) continue;

            const dayNum = parseInt(text, 10);
            const tdBg = window.getComputedStyle(d).backgroundColor;
            const childBg = childFlagEl ? window.getComputedStyle(childFlagEl).backgroundColor : "";
            const bgColor = childBg && childBg !== "rgba(0, 0, 0, 0)" ? childBg : tdBg;
            const rgbMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            let isGreen = false, isYellow = false, isRed = false;
            if (rgbMatch) {
              const r = parseInt(rgbMatch[1], 10), g = parseInt(rgbMatch[2], 10), b = parseInt(rgbMatch[3], 10);
              isGreen = g > 100 && g > r * 1.2 && g > b * 1.2;
              isYellow = r > 200 && g > 150 && b < 120;
              isRed = r > 150 && r > g * 1.4 && r > b * 1.4;
            }
            if (d.classList.contains("bg-success") || d.classList.contains("success") || classBlob.includes("enabled-day") || classBlob.includes("bg-success")) isGreen = true;
            if (d.classList.contains("bg-warning") || d.classList.contains("warning") || d.classList.contains("today") || d.classList.contains("active") || classBlob.includes("bg-warning") || classBlob.includes("warning") || classBlob.includes("active")) isYellow = true;
            if (d.classList.contains("bg-danger") || d.classList.contains("danger") || classBlob.includes("bg-danger") || classBlob.includes("danger")) isRed = true;
            if (!isGreen || isYellow || isRed) continue;

            const normalizedDate = pickedCalendar.displayedMonth && pickedCalendar.displayedYear
              ? `${pickedCalendar.displayedYear}-${String(pickedCalendar.displayedMonth).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`
              : null;
            if (allowedSet.size > 0 && (!normalizedDate || !allowedSet.has(normalizedDate))) continue;

            const innerLink = d.querySelector("a[href*='doPostBack'], a[href*='javascript'], a");
            const postbackHref = innerLink ? (innerLink.getAttribute("href") || "") : "";
            let postbackTarget = null, postbackArg = null;
            const pbMatch = postbackHref.match(/__doPostBack\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
            if (pbMatch) { postbackTarget = pbMatch[1]; postbackArg = pbMatch[2]; }

            const clickableEl = innerLink || d;
            const rect = clickableEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              allDays.push({
                day: dayNum,
                normalizedDate,
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                cellX: d.getBoundingClientRect().x + d.getBoundingClientRect().width / 2,
                cellY: d.getBoundingClientRect().y + d.getBoundingClientRect().height / 2,
                postbackTarget,
                postbackArg,
                hasLink: !!innerLink
              });
            }
          }
          allDays.sort((a, b) => (a.normalizedDate || "").localeCompare(b.normalizedDate || "") || a.day - b.day);
          if (allDays.length > 0) {
            const target = allDays.find((d) => d.normalizedDate === targetNormalized) || allDays[0];
            return {
              found: true,
              day: target.day,
              normalizedDate: target.normalizedDate,
              x: target.x,
              y: target.y,
              cellX: target.cellX,
              cellY: target.cellY,
              greenCount: allDays.length,
              postbackTarget: target.postbackTarget,
              postbackArg: target.postbackArg,
              hasLink: target.hasLink
            };
          }
          return { found: false };
        }, retryTargetDate?.normalized ?? null, announcedAppointmentDateKeys, calIconClicked?.inputX ?? null, calIconClicked?.inputY ?? null);

        if (retryDateInfo.found) {
          console.log(`  [BOOK] 📅 Retry tarih seçimi: Gün ${retryDateInfo.day} (${retryDateInfo.greenCount} yeşil)`);
          const retryClickX = retryDateInfo.cellX ?? retryDateInfo.x;
          const retryClickY = retryDateInfo.cellY ?? retryDateInfo.y;
          await humanClick(page, retryClickX, retryClickY, { preMovesNear: true });
          await delay(900, 1400);
          const retryDateVerify = await verifyDateSelection();
          console.log(`  [BOOK] Retry tarih doğrulama: ${JSON.stringify(retryDateVerify)}`);
        } else {
          console.log(`  [BOOK] ⚠️ Retry'da takvimde gün bulunamadı`);
        }

        // ===== Yeniden saat seç =====
        await delay(1000, 2000);
        const retryTimeInfo = await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll("a, button, span, div, li, label, td"));
          const timeButtons = [];
          for (const el of candidates) {
            const text = (el.innerText || el.textContent || "").trim();
            const timeMatch = text.match(/^(\d{2}:\d{2})$/);
            if (!timeMatch) continue;
            const style = window.getComputedStyle(el);
            const isVisible = style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
            if (!isVisible || el.offsetHeight < 10) continue;
            const bgColor = style.backgroundColor;
            const rgbMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            let isOrange = false;
            if (rgbMatch) {
              const r = parseInt(rgbMatch[1]), g = parseInt(rgbMatch[2]), b = parseInt(rgbMatch[3]);
              isOrange = r > 180 && g > 80 && b < 100;
            }
            const cls = (el.className || "").toLowerCase();
            if (cls.includes("btn-warning") || cls.includes("btn-orange") || cls.includes("active")) isOrange = true;
            
            // ASP.NET postback
            const href = el.getAttribute("href") || "";
            let postbackTarget = null, postbackArg = null;
            const pbMatch = href.match(/__doPostBack\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
            if (pbMatch) { postbackTarget = pbMatch[1]; postbackArg = pbMatch[2]; }
            
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              timeButtons.push({ time: timeMatch[1], isOrange, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, postbackTarget, postbackArg });
            }
          }
          const orangeButtons = timeButtons.filter(t => t.isOrange);
          // Rastgele saat seç
          const pool = orangeButtons.length > 0 ? orangeButtons : timeButtons;
          if (pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            return { found: true, ...pool[idx], totalSlots: timeButtons.length };
          }
          return { found: false };
        });

        if (retryTimeInfo.found) {
          console.log(`  [BOOK] ⏰ Retry saat seçimi: ${retryTimeInfo.time} (postback=${!!retryTimeInfo.postbackTarget})`);
          await humanClick(page, retryTimeInfo.x, retryTimeInfo.y, { preMovesNear: true });
          await delay(1500, 2500);
          
          // Postback fallback
          if (retryTimeInfo.postbackTarget) {
            await page.evaluate((target, arg) => {
              if (typeof window.__doPostBack === "function") {
                window.__doPostBack(target, arg);
              }
            }, retryTimeInfo.postbackTarget, retryTimeInfo.postbackArg || "");
            console.log(`  [BOOK] ✅ Retry saat __doPostBack çağrıldı`);
            await delay(1500, 2500);
          }
        } else {
          console.log(`  [BOOK] ⚠️ Retry'da saat butonu bulunamadı`);
        }

        // ===== Şimdi İLERİ'ye bas =====
        await delay(500, 1000);
        const ileriRetry = await page.evaluate(() => {
          const candidates = Array.from(
            document.querySelectorAll("a, button, input[type='submit'], input[type='button'], [role='button']")
          );
          const ileriBtn = candidates.find((el) => {
            const txt = (el.innerText || el.value || el.textContent || "").trim().toUpperCase();
            return txt === "İLERİ" || txt === "ILERI" || txt === "DEVAM" || txt === "NEXT";
          });
          if (ileriBtn) {
            ileriBtn.click();
            return { clicked: true, text: (ileriBtn.innerText || ileriBtn.value || ileriBtn.textContent || "").trim() };
          }
          const greenBtn = document.querySelector(".btn-success, a.btn-success, button.btn-success");
          if (greenBtn) {
            greenBtn.click();
            return { clicked: true, text: (greenBtn.innerText || greenBtn.value || greenBtn.textContent || "").trim(), method: "green" };
          }
          return { clicked: false };
        });

        console.log(`  [BOOK] ▶️ Retry İLERİ sonucu: ${JSON.stringify(ileriRetry)}`);
        await delay(800, 1500);
      }

      // Normal popup kontrolü (diğer uyarılar)
      await page.evaluate(() => {
        const closeButtons = document.querySelectorAll('.swal2-confirm, .swal2-close, .modal .btn, button');
        for (const btn of closeButtons) {
          const txt = (btn.innerText || "").trim().toUpperCase();
          if (txt === "TAMAM" || txt === "OK" || txt === "KAPAT" || txt === "EVET") { btn.click(); break; }
        }
      });
      await delay(700, 1200);
    }

    // ===== STEP 6+: Sonraki sayfaları döngüyle işle =====
    // Akış: TARİH → Ek Hizmetlerx (bilgi) → EK HİZMETLER (checkbox'lar) → Popup Tamam → ÖDEME İŞLEMLERİ (fatura+sözleşme) → Kredi kartı sayfası
    const MAX_PAGES = 8;
    for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
      console.log(`  [BOOK] Step 6.${pageIdx}: Sayfa analiz ediliyor...`);
      
      const ssPage = await takeScreenshotBase64(page);
      const pageState = await page.evaluate(() => {
        const body = (document.body?.innerText || "");
        const lower = body.toLowerCase();
        const url = window.location.href;
        const urlLower = url.toLowerCase();
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        return {
          url,
          bodyPreview: body.substring(0, 2000),
          hasIleri: !!Array.from(document.querySelectorAll('a, button, input')).find(el => {
            const txt = (el.innerText || el.value || "").trim().toUpperCase();
            return txt === "İLERİ" || txt === "ILERI";
          }),
          hasOnayla: !!Array.from(document.querySelectorAll('a, button, input')).find(el => {
            const txt = (el.innerText || el.value || "").trim().toUpperCase();
            return txt.includes("ONAYLA") || txt.includes("CONFIRM") || txt.includes("TAMAMLA") || txt.includes("KAYDET");
          }),
          hasOdemeYap: !!Array.from(document.querySelectorAll('a, button, input')).find(el => {
            const txt = (el.innerText || el.value || "").trim().toUpperCase();
            return txt.includes("ÖDEME YAP") || txt.includes("ODEME YAP");
          }),
          hasPayment: lower.includes("ödeme") || lower.includes("payment") || lower.includes("kredi kartı") || lower.includes("banka"),
          hasEkHizmetler: lower.includes("ek hizmetler"),
          hasFatura: lower.includes("fatura bilgileri") || lower.includes("fatura bil"),
          hasSozlesme: lower.includes("okudum") || lower.includes("kabul ediyorum"),
          hasKrediKarti: lower.includes("bankamatik kart") || lower.includes("kredi kartı") || lower.includes("kart numarası") || lower.includes("cvv"),
          hasDateWarning: lower.includes("bir randevu tarihi ve saati seçiniz") || lower.includes("lütfen başka bir tarih seçin") || lower.includes("başka bir tarih seçin"),
          hasDashboardHome: (urlLower.includes("/membership/dashboard") || lower.includes("duyurular")) && (lower.includes("randevu al") || lower.includes("randevu düzenleme")),
          hasError: lower.includes("hata") || lower.includes("error"),
          success: lower.includes("başarılı") || lower.includes("randevunuz oluşturulmuştur") || lower.includes("onaylandı") || lower.includes("tamamlandı"),
          checkboxCount: checkboxes.length,
          hasSelectInputs: document.querySelectorAll("select").length,
        };
      });

      await idataLog(`appt_page_${pageIdx}`, `Sayfa ${pageIdx} | URL: ${pageState.url} | İleri: ${pageState.hasIleri} | Ödeme: ${pageState.hasPayment} | EkHizmet: ${pageState.hasEkHizmetler} | Fatura: ${pageState.hasFatura} | KrediKartı: ${pageState.hasKrediKarti} | DateWarn: ${pageState.hasDateWarning} | Checkbox: ${pageState.checkboxCount} | ${getAccountName(account)}\n${pageState.bodyPreview.substring(0, 500)}`, ssPage);

      // ===== Tarih/saat warning yakalandı — akışı resetle ve üst döngüden yeniden dene =====
      if (pageState.hasDateWarning) {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('.swal2-confirm, .swal2-close, .modal .btn, button, a, [role="button"]'));
          const ok = btns.find(b => {
            const txt = (b.innerText || b.textContent || b.value || "").trim().toUpperCase();
            return txt === "TAMAM" || txt === "OK" || txt === "KAPAT" || txt === "ANLADIM";
          });
          if (ok) ok.click();
        }).catch(() => {});
        await idataLog("appt_date_warning", `⚠️ Tarih/saat warning Step6'da yakalandı, booking akışı yeniden denenecek | ${getAccountName(account)}`, ssPage);
        return { success: false, partial: true, error: "date_time_warning_after_ileri" };
      }

      // ===== Dashboard/duyurular sayfasına geri atıldıysa booking'i yeniden başlat =====
      if (pageState.hasDashboardHome) {
        console.log("  [BOOK] ⚠️ Akış dashboard/duyurular sayfasına döndü (seçim backend'e işlenmemiş olabilir). Yeniden denenecek.");
        await idataLog("appt_redirect_dashboard", `⚠️ Akış duyurular/dashboard sayfasına döndü, booking yeniden denenecek | URL: ${pageState.url} | ${getAccountName(account)}`, ssPage);
        try {
          await page.goto(CONFIG.APPOINTMENT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
          await delay(2000, 3500);
        } catch (_) {}
        return { success: false, partial: true, error: "redirected_dashboard_after_selection" };
      }

      // ===== Başarılı =====
      if (pageState.success) {
        startAlarm();
        await idataLog("appt_booked", `🎉 ÖDEME BAŞARILI — RANDEVU ALINDI! | Hesap: ${account.email}`, ssPage);
        return { success: true, date: dateSelected?.day || "?" };
      }

      // ===== KREDİ KARTI SAYFASI — DUR! =====
      if (pageState.hasKrediKarti) {
        startAlarm();
        await idataLog("appt_payment_page", `💳 KREDİ KARTI SAYFASINA ULAŞILDI! Manuel ödeme gerekli. | Hesap: ${account.email}`, ssPage);
        return { success: true, date: dateSelected?.day || "?", needsPayment: true };
      }

      // ===== ÖDEME İŞLEMLERİ sayfası (Fatura + Sözleşme onayları) =====
      if (pageState.hasFatura && pageState.hasSozlesme && pageState.hasOdemeYap) {
        console.log(`  [BOOK] 💳 ÖDEME sayfası tespit edildi — fatura bilgileri dolduruluyor...`);
        
        // Fatura bilgilerini doldur (Bireysel seçili, şehir/ilçe/adres)
        await page.evaluate((acc) => {
          // Bireysel radio zaten seçili olmalı
          const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
          const bireyselRadio = radios.find(r => {
            const label = r.closest("label")?.innerText || r.parentElement?.innerText || "";
            return label.toLowerCase().includes("bireysel");
          });
          if (bireyselRadio && !bireyselRadio.checked) bireyselRadio.click();

          // Şehir select (Gaziantep vb.)
          if (acc.invoice_city || acc.residence_city) {
            const cityVal = acc.invoice_city || acc.residence_city;
            const selects = Array.from(document.querySelectorAll("select"));
            for (const sel of selects) {
              for (const opt of sel.options) {
                if (opt.text.toLowerCase().includes(cityVal.toLowerCase())) {
                  sel.value = opt.value;
                  sel.dispatchEvent(new Event("change", { bubbles: true }));
                  break;
                }
              }
            }
          }
        }, account);
        await delay(1500, 2500);

        // İlçe select (şehir seçildikten sonra yüklenir)
        if (account.invoice_district) {
          await page.evaluate((district) => {
            const selects = Array.from(document.querySelectorAll("select"));
            // İlçe genellikle 2. select
            for (const sel of selects) {
              for (const opt of sel.options) {
                if (opt.text.toLowerCase().includes(district.toLowerCase())) {
                  sel.value = opt.value;
                  sel.dispatchEvent(new Event("change", { bubbles: true }));
                  break;
                }
              }
            }
          }, account.invoice_district);
          await delay(1000, 2000);
        }

        // Adres input
        if (account.invoice_address) {
          await page.evaluate((addr) => {
            const inputs = Array.from(document.querySelectorAll("input[type='text'], textarea"));
            // Adres alanı genellikle "adres" placeholder veya sonuncu uzun input
            const addrInput = inputs.find(inp => {
              const ph = (inp.placeholder || "").toLowerCase();
              const name = (inp.name || "").toLowerCase();
              return ph.includes("adres") || name.includes("adres") || name.includes("address");
            }) || inputs[inputs.length - 1];
            if (addrInput) {
              addrInput.value = "";
              addrInput.focus();
              addrInput.value = addr;
              addrInput.dispatchEvent(new Event("input", { bubbles: true }));
              addrInput.dispatchEvent(new Event("change", { bubbles: true }));
              addrInput.dispatchEvent(new Event("blur", { bubbles: true }));
            }
          }, account.invoice_address);
          await delay(500, 1000);
        }

        // Sözleşme checkbox'larını işaretle (Okudum anladım kabul ediyorum x2 + KVKK)
        console.log(`  [BOOK] Sözleşme checkbox'ları işaretleniyor...`);
        await page.evaluate(() => {
          const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
          for (const cb of checkboxes) {
            if (!cb.checked) {
              cb.checked = true;
              cb.dispatchEvent(new Event("change", { bubbles: true }));
              cb.dispatchEvent(new Event("click", { bubbles: true }));
              cb.click();
            }
          }
        });
        await delay(1500, 2500);

        const ssFatura = await takeScreenshotBase64(page);
        await idataLog("appt_fatura_filled", `📝 Fatura bilgileri dolduruldu, sözleşmeler onaylandı | Hesap: ${account.email}`, ssFatura);

        // ÖDEME YAP butonuna tıkla
        console.log(`  [BOOK] ÖDEME YAP butonuna tıklanıyor...`);
        await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"]'));
          const btn = candidates.find(el => {
            const txt = (el.innerText || el.value || el.textContent || "").trim().toUpperCase();
            return txt.includes("ÖDEME YAP") || txt.includes("ODEME YAP");
          });
          if (btn) {
            if (btn.disabled) btn.disabled = false;
            btn.click();
          }
        });
        await delay(5000, 8000);

        // Popup kontrolü
        await page.evaluate(() => {
          const closeButtons = document.querySelectorAll('.swal2-confirm, .swal2-close, .modal .btn, button');
          for (const btn of closeButtons) {
            const txt = (btn.innerText || "").trim().toUpperCase();
            if (txt === "TAMAM" || txt === "OK" || txt === "KAPAT" || txt === "EVET") { btn.click(); break; }
          }
        });
        await delay(3000, 5000);
        continue; // Bir sonraki sayfa (kredi kartı sayfası olmalı)
      }

      // ===== EK HİZMETLER sayfası — checkbox'ları İŞARETLEME, direkt İLERİ =====
      if (pageState.hasEkHizmetler && pageState.checkboxCount > 0) {
        console.log(`  [BOOK] Ek Hizmetler sayfası — ${pageState.checkboxCount} checkbox var, hiçbiri işaretlenmeyecek, İLERİ tıklanıyor...`);
        // Tüm checkbox'ların işaretsiz olduğundan emin ol
        await page.evaluate(() => {
          const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
          for (const cb of checkboxes) {
            if (cb.checked) {
              cb.checked = false;
              cb.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
        });
        await delay(500, 1000);
      }

      // ===== Hata durumu =====
      if (pageState.hasError && !pageState.hasIleri && !pageState.hasOnayla && !pageState.hasOdemeYap) {
        return { success: false, error: "Hata sayfası", partial: true };
      }

      // ===== Ödeme sayfası (genel) — durdurup bildir =====
      if (pageState.hasPayment && !pageState.hasIleri && !pageState.hasEkHizmetler) {
        startAlarm();
        await idataLog("appt_payment_page", `💳 ÖDEME SAYFASINA ULAŞILDI! | Hesap: ${account.email}`, ssPage);
        return { success: true, date: dateSelected?.day || "?", needsPayment: true };
      }

      // ===== Onay butonu varsa tıkla =====
      if (pageState.hasOnayla) {
        console.log(`  [BOOK] 🟢 Onay butonu tıklanıyor...`);
        await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('a, button, input'));
          const btn = candidates.find(el => {
            const txt = (el.innerText || el.value || "").trim().toUpperCase();
            return txt.includes("ONAYLA") || txt.includes("CONFIRM") || txt.includes("TAMAMLA") || txt.includes("KAYDET");
          });
          if (btn) btn.click();
        });
        await delay(3000, 5000);
        
        // Popup kapat
        await page.evaluate(() => {
          const closeButtons = document.querySelectorAll('.swal2-confirm, .swal2-close, button');
          for (const btn of closeButtons) {
            const txt = (btn.innerText || "").trim().toUpperCase();
            if (txt === "TAMAM" || txt === "OK" || txt === "KAPAT" || txt === "EVET") { btn.click(); break; }
          }
        });
        await delay(2000, 3000);
        continue;
      }

      // ===== İLERİ butonu varsa tıkla =====
      if (pageState.hasIleri) {
        console.log(`  [BOOK] ➡ İLERİ butonu tıklanıyor (sayfa ${pageIdx})...`);
        await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('a, button, input'));
          const btn = candidates.find(el => {
            const txt = (el.innerText || el.value || "").trim().toUpperCase();
            return txt === "İLERİ" || txt === "ILERI";
          });
          if (btn) btn.click();
        });
        await delay(3000, 5000);
        
        // Popup kapat (ör: "Başvuru Sürecini Kolaylaştırmayı Unutma" popup'ı)
        await page.evaluate(() => {
          const closeButtons = document.querySelectorAll('.swal2-confirm, .swal2-close, .modal .btn, button, a');
          for (const btn of closeButtons) {
            const txt = (btn.innerText || "").trim().toUpperCase();
            if (txt === "TAMAM" || txt === "OK" || txt === "KAPAT" || txt === "EVET") { btn.click(); break; }
          }
        });
        await delay(2000, 3000);
        continue;
      }

      // Ne İLERİ ne ONAYLA var — takıldık
      console.log(`  [BOOK] ⚠ Sayfa ${pageIdx}: İlerleme butonu bulunamadı, durduruluyor.`);
      return { success: false, partial: true, error: `Sayfa ${pageIdx}: buton yok` };
    }

    return { success: false, partial: true, error: "Max sayfa limitine ulaşıldı" };

  } catch (err) {
    console.error(`  [BOOK] Hata: ${err.message}`);
    const ssErr = await takeScreenshotBase64(page);
    await idataLog("appt_book_error", `Randevu alma hatası: ${err.message} | Hesap: ${account.email}`, ssErr);
    return { success: false, error: err.message };
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
            EVOMI_PROXY_REGION = await getNextProxyRegion();
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
              await idataLog("login_success", `Giriş başarılı: ${getAccountName(account)}`);
              
              // Randevu kontrol
              await idataLog("appt_check", `Randevu kontrol ediliyor | ${getAccountName(account)}`);
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
                const datesInfo = apptResult.datesStr ? ` | Açık tarihler: ${apptResult.datesStr}` : "";
                const loginLink = CONFIG.LOGIN_URL;
                await idataLog("appt_found", `🎉 RANDEVU BULUNDU! Manuel ilerleyin!${datesInfo} | Giriş: ${loginLink} | ${getAccountName(account)}`, apptResult.screenshot);
                startAlarm();
                
                // Manuel mod — otomatik booking devre dışı, tarayıcıyı açık tut
                console.log("  🔔 RANDEVU BULUNDU! Tarayıcı açık kalacak — VNC üzerinden manuel ilerleyin.");
                console.log("  ⏳ Tarayıcı 20 dakika açık kalacak...");
                await delay(1200000, 1200000); // 20 dakika bekle
                console.log("  ⏰ 20 dakika doldu, tarayıcı kapanıyor.");
                stopAlarm();
              } else {
                stopAlarm();
                await idataLog("appt_none", `Randevu yok | ${apptResult.message || ""} | ${getAccountName(account)}`, apptResult.screenshot);
                // Randevu yok — tarayıcıyı kapat, check_interval kadar bekleyip yeniden dene
                const waitSec = Math.round(dynamicCheckInterval / 1000);
                console.log(`  ℹ️ Randevu yok. Tarayıcı kapatılıp ${waitSec}s sonra yeniden denenecek.`);
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


      const waitMs = dynamicCheckInterval;
      const waitSec = Math.round(waitMs / 1000);
      await idataLog("bot_idle", `${waitSec}s bekleniyor...`);
      console.log(`  ⏰ ${waitSec}s bekleniyor...`);
      await delay(waitMs, waitMs + 5000);

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
