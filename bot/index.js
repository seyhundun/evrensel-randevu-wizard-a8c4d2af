/**
 * VFS Global Randevu Takip Botu v6
 * 
 * Yenilikler v6:
 * - puppeteer-extra + stealth plugin (WebDriver, Chrome.runtime, navigator gizleme)
 * - Browser fingerprint randomization (User-Agent, viewport, timezone, WebGL, canvas)
 * - Her oturumda rastgele profil
 * - Gelişmiş anti-detection
 */

require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

// Stealth plugin — tüm evasion'lar aktif
puppeteer.use(StealthPlugin());

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
  QUEUE_MAX_WAIT_MS: Number(process.env.QUEUE_MAX_WAIT_MS || 180000),
  QUEUE_POLL_MS: Number(process.env.QUEUE_POLL_MS || 10000),
  COOLDOWN_HOURS: Number(process.env.COOLDOWN_HOURS || 2),
  OTP_WAIT_MS: Number(process.env.OTP_WAIT_MS || 120000),
  OTP_POLL_MS: Number(process.env.OTP_POLL_MS || 5000),
  MIN_ACCOUNT_GAP_MS: Number(process.env.MIN_ACCOUNT_GAP_MS || 600000),
  BASE_INTERVAL_MS: Number(process.env.BASE_INTERVAL_MS || 180000),
  MAX_BACKOFF_MS: Number(process.env.MAX_BACKOFF_MS || 900000),
};

// ==================== FINGERPRINT RANDOMIZATION ====================

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1680, height: 1050 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
];

const TIMEZONES = [
  "Europe/Istanbul",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/London",
  "Europe/Amsterdam",
  "Europe/Rome",
];

const LANGUAGES = [
  ["tr-TR", "tr", "en-US", "en"],
  ["en-US", "en", "tr-TR", "tr"],
  ["fr-FR", "fr", "en-US", "en"],
  ["de-DE", "de", "en-US", "en"],
  ["en-GB", "en", "tr-TR", "tr"],
];

const PLATFORMS = ["Win32", "MacIntel", "Linux x86_64"];

const WEBGL_VENDORS = [
  "Google Inc. (NVIDIA)",
  "Google Inc. (Intel)",
  "Google Inc. (AMD)",
  "Intel Inc.",
  "ATI Technologies Inc.",
];

const WEBGL_RENDERERS = [
  "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060, OpenGL 4.5)",
  "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)",
  "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)",
  "ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 640, OpenGL 4.1)",
  "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)",
  "ANGLE (Intel, Intel(R) HD Graphics 620, OpenGL 4.5)",
];

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

// ==================== PROXY POOL ====================
const PROXY_LIST = [
  "195.40.187.58:5240:nfawgadk:6um696v70i61",
  "195.40.186.203:5885:nfawgadk:6um696v70i61",
  "23.26.231.44:7285:nfawgadk:6um696v70i61",
  "59.152.61.149:5589:nfawgadk:6um696v70i61",
  "59.152.61.67:5507:nfawgadk:6um696v70i61",
  "50.114.99.144:6885:nfawgadk:6um696v70i61",
  "59.152.61.232:5672:nfawgadk:6um696v70i61",
  "59.152.61.167:5607:nfawgadk:6um696v70i61",
  "50.114.243.18:6259:nfawgadk:6um696v70i61",
  "23.26.231.10:7251:nfawgadk:6um696v70i61",
];
let proxyIndex = 0;

function getNextProxy() {
  const raw = PROXY_LIST[proxyIndex % PROXY_LIST.length];
  proxyIndex++;
  const [host, port, user, pass] = raw.split(":");
  return { host, port, user, pass, url: `http://${host}:${port}` };
}

const accountLastUsed = new Map();
let consecutiveErrors = 0;

// ==================== HELPERS ====================

function delay(min = 1000, max = 3000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

async function humanMove(page) {
  const vp = page.viewport();
  if (!vp) return;
  const x = Math.floor(Math.random() * vp.width * 0.6 + vp.width * 0.2);
  const y = Math.floor(Math.random() * vp.height * 0.6 + vp.height * 0.2);
  await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10 + 5) });
  await delay(100, 300);
}

async function humanType(page, target, text, options = {}) {
  const {
    clearFirst = false,
    minDelay = 70,
    maxDelay = 220,
    pauseChance = 0.14,
    pauseMin = 220,
    pauseMax = 950,
  } = options;

  if (!text && text !== 0) return false;
  const element = typeof target === "string" ? await page.$(target) : target;
  if (!element) return false;

  await element.click({ clickCount: 1 });
  await delay(180, 450);

  if (clearFirst) {
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await delay(120, 300);
  }

  for (const ch of String(text)) {
    const keyDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    await page.keyboard.type(ch, { delay: keyDelay });
    if (Math.random() < pauseChance) {
      await delay(pauseMin, pauseMax);
    }
  }

  await delay(180, 420);
  return true;
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
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: CONFIG.QUEUE_POLL_MS + 5000 }).catch(() => {});
      await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
      continue;
    }
    await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
  }
  return { ok: false, reason: `Waiting room timeout (${Math.round(CONFIG.QUEUE_MAX_WAIT_MS / 1000)}s)` };
}

// ==================== OTP HANDLING ====================

async function readManualOtp(accountId) {
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ action: "get_account_otp", account_id: accountId }),
    });
    const data = await res.json();
    if (data.manual_otp) {
      console.log(`  [OTP] ✅ Manuel OTP bulundu: ${data.manual_otp}`);
      await fetch(CONFIG.API_URL, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({ action: "clear_account_otp", account_id: accountId }),
      });
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
    await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ action: "set_otp_requested", account_id: accountId }),
    });
    console.log("  [OTP] 📱 SMS OTP bekleniyor - dashboard'dan girilebilir");
  } catch (err) {
    console.error("  [OTP] otp_requested_at ayarlama hatası:", err.message);
  }
}

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
  await setOtpRequested(account.id);

  const startTime = Date.now();
  const maxWait = CONFIG.OTP_WAIT_MS;
  const pollInterval = CONFIG.OTP_POLL_MS;
  
  while (Date.now() - startTime < maxWait) {
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

// ==================== APPLY FINGERPRINT ====================

async function applyFingerprint(page, fp) {
  await page.emulateTimezone(fp.timezone);
  await page.setUserAgent(fp.userAgent);
  await page.setViewport(fp.viewport);
  
  await page.evaluateOnNewDocument((fp) => {
    Object.defineProperty(navigator, "platform", { get: () => fp.platform });
    Object.defineProperty(navigator, "languages", { get: () => fp.languages });
    Object.defineProperty(navigator, "language", { get: () => fp.languages[0] });
    Object.defineProperty(navigator, "deviceMemory", { get: () => fp.deviceMemory });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => fp.hardwareConcurrency });
    Object.defineProperty(screen, "colorDepth", { get: () => fp.screenDepth });
    Object.defineProperty(screen, "pixelDepth", { get: () => fp.screenDepth });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => fp.maxTouchPoints });
    
    // WebGL fingerprint spoof
    const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return fp.webglVendor;
      if (param === 37446) return fp.webglRenderer;
      return getParameterOrig.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== "undefined") {
      const getParameter2Orig = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return fp.webglVendor;
        if (param === 37446) return fp.webglRenderer;
        return getParameter2Orig.call(this, param);
      };
    }
    
    // Canvas fingerprint noise
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
    
    // AudioContext fingerprint noise
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(channel) {
      const data = origGetChannelData.call(this, channel);
      if (data.length > 100) {
        for (let i = 0; i < Math.min(10, data.length); i++) {
          data[i] += Math.random() * 0.0001;
        }
      }
      return data;
    };
    
    // Connection API spoof
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, "effectiveType", { get: () => "4g" });
      Object.defineProperty(navigator.connection, "rtt", { get: () => Math.floor(Math.random() * 50 + 25) });
      Object.defineProperty(navigator.connection, "downlink", { get: () => Math.random() * 5 + 5 });
    }
    
    // Battery API
    if (navigator.getBattery) {
      navigator.getBattery = () => Promise.resolve({
        charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
        addEventListener: () => {}, removeEventListener: () => {},
      });
    }
    
    // Permissions API
    const origQuery = Permissions.prototype.query;
    Permissions.prototype.query = function(desc) {
      if (desc.name === "notifications") {
        return Promise.resolve({ state: "prompt", onchange: null });
      }
      return origQuery.call(this, desc);
    };
    
  }, fp);
  
  console.log(`  [FP] UA: ${fp.userAgent.substring(0, 50)}... | VP: ${fp.viewport.width}x${fp.viewport.height} | TZ: ${fp.timezone} | Platform: ${fp.platform}`);
}

// ==================== MAIN CHECK ====================

async function checkAppointments(config, account) {
  const { id, country, city } = config;
  const ts = new Date().toLocaleTimeString("tr-TR");
  console.log(`\n[${ts}] Kontrol: ${country} ${city} | Hesap: ${account.email}`);

  let browser;
  try {
    const proxy = getNextProxy();
    const fp = generateFingerprint();
    console.log(`  [PROXY] ${proxy.host}:${proxy.port}`);
    
    browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS ? "new" : false,
      slowMo: CONFIG.SLOW_MO,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        `--window-size=${fp.viewport.width},${fp.viewport.height}`,
        `--proxy-server=${proxy.url}`,
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-web-security",
      ],
    });

    const page = await browser.newPage();
    await page.authenticate({ username: proxy.user, password: proxy.pass });
    await applyFingerprint(page, fp);
    await humanMove(page);

    // STEP 1: Giriş sayfası
    console.log("  [1/6] Giriş sayfası...");
    await page.goto(CONFIG.VFS_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000, 6000);
    await humanMove(page);

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
        await delay(500, 1500);
        await cookieBtn.asElement().click();
        console.log("  [2/6] ✅ Cookie kabul edildi.");
        await delay(1000, 2000);
      }
    } catch (e) {}

    // STEP 3: CAPTCHA + Queue
    console.log("  [3/6] CAPTCHA + sıra kontrol...");
    await humanMove(page);
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
      await humanMove(page);
      await delay(500, 1500);
      
      await page.click('input[type="email"], input[name="email"], #email');
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await delay(100, 300);
      
      for (const ch of account.email) {
        await page.keyboard.type(ch, { delay: Math.random() * 120 + 30 });
        if (Math.random() < 0.05) await delay(200, 600);
      }
      await delay(800, 1500);
      
      await page.click('input[type="password"]');
      await delay(300, 600);
      for (const ch of account.password) {
        await page.keyboard.type(ch, { delay: Math.random() * 120 + 30 });
        if (Math.random() < 0.05) await delay(200, 600);
      }
      await delay(800, 1500);
      await humanMove(page);

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

    // STEP 5: OTP Doğrulama
    console.log("  [5/6] OTP kontrol...");
    const otpResult = await handleOtpVerification(page, account);
    if (!otpResult.ok && otpResult.reason === "otp_required") {
      console.log("  [5/6] ❌ OTP doğrulama gerekli");
      await reportResult(id, "error", `OTP doğrulama gerekli | Hesap: ${account.email}`, 0, otpResult.screenshot);
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

      const newFailCount = (account.fail_count || 0) + 1;
      if (newFailCount >= 3) {
        console.log(`  [ACCOUNT] ${account.email} - 3 başarısız, beklemeye alınıyor`);
        await updateAccountStatus(account.id, "cooldown", newFailCount);
      } else {
        await updateAccountStatus(account.id, "active", newFailCount);
      }
      return { found: false, accountBanned: false };
    }

    console.log("  [5/6] ✅ Giriş başarılı!");
    await updateAccountStatus(account.id, "active", 0);

    // STEP 6: Randevu kontrol
    console.log("  [6/6] Randevu kontrol...");
    await delay(2000, 4000);
    await humanMove(page);
    
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
        await delay(500, 1500);
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

// ==================== REGISTRATION ====================

async function fetchPendingRegistrations() {
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ action: "get_pending_registrations" }),
    });
    const data = await res.json();
    return data.ok ? (data.accounts || []) : [];
  } catch (err) {
    console.error("  [REG] Kayıt listesi hatası:", err.message);
    return [];
  }
}

async function setRegistrationOtpNeeded(accountId, otpType) {
  try {
    await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ action: "set_registration_otp_needed", account_id: accountId, otp_type: otpType }),
    });
    console.log(`  [REG] 📱 ${otpType.toUpperCase()} doğrulama kodu bekleniyor - dashboard'dan girilebilir`);
  } catch (err) {
    console.error("  [REG] OTP istek hatası:", err.message);
  }
}

async function getRegistrationOtp(accountId) {
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ action: "get_registration_otp", account_id: accountId }),
    });
    const data = await res.json();
    return data.registration_otp || null;
  } catch (err) {
    console.error("  [REG] OTP okuma hatası:", err.message);
    return null;
  }
}

async function completeRegistration(accountId, success) {
  try {
    await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ action: "complete_registration", account_id: accountId, success }),
    });
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
    if (otp) {
      console.log(`  [REG] ✅ ${otpType} OTP alındı: ${otp}`);
      return otp;
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [REG] ${otpType} OTP bekleniyor... ${elapsed}s / ${Math.round(timeoutMs / 1000)}s`);
    await delay(5000, 6000);
  }
  console.log(`  [REG] ❌ ${otpType} OTP zaman aşımı`);
  return null;
}

function normalizePhoneNumber(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  let mobileNumber = digits;

  if (mobileNumber.startsWith("90") && mobileNumber.length > 10) {
    mobileNumber = mobileNumber.slice(2);
  }
  if (mobileNumber.startsWith("0")) {
    mobileNumber = mobileNumber.slice(1);
  }
  if (mobileNumber.length > 10) {
    mobileNumber = mobileNumber.slice(-10);
  }

  return { dialCode: "90", mobileNumber };
}

async function selectTurkeyDialCode(page) {
  // Debug: log all select elements and their options
  const selectInfo = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll("select"));
    return selects.map((s, i) => ({
      index: i,
      id: s.id,
      name: s.name,
      className: s.className.substring(0, 60),
      optionCount: s.options.length,
      options: Array.from(s.options).map(o => ({ value: o.value, text: (o.textContent || "").trim() })),
      currentValue: s.value,
    }));
  });
  console.log("  [REG] Select elements:", JSON.stringify(selectInfo, null, 2));

  // Method 1: Find the right select and use Puppeteer's page.select()
  for (let i = 0; i < selectInfo.length; i++) {
    const info = selectInfo[i];
    const turkeyOpt = info.options.find(o => {
      const combined = `${o.text} ${o.value}`.toLowerCase();
      return combined.includes("turkey") || combined.includes("türkiye") || combined.includes("(90)") || combined.includes("+90");
    });

    if (!turkeyOpt) continue;

    // Build a CSS selector for this specific select
    let selector = "select";
    if (info.id) selector = `select#${info.id}`;
    else if (info.name) selector = `select[name="${info.name}"]`;
    else selector = `select:nth-of-type(${i + 1})`;

    console.log(`  [REG] Turkey option bulundu: value="${turkeyOpt.value}", text="${turkeyOpt.text}" → selector: ${selector}`);

    // Click the select first like a human
    try {
      await page.click(selector);
      await delay(300, 700);
    } catch (e) {
      console.log("  [REG] Select click hatası, devam ediliyor:", e.message);
    }

    // Use page.select() — this properly triggers change events
    try {
      await page.select(selector, turkeyOpt.value);
      console.log(`  [REG] ✅ Dial code seçildi (page.select: ${turkeyOpt.text})`);
      await delay(400, 900);

      // Also manually dispatch Angular-compatible events
      await page.evaluate((sel, val) => {
        const selectEl = document.querySelector(sel);
        if (!selectEl) return;
        selectEl.value = val;
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        // Angular specific
        const ngModelEvent = new Event("ngModelChange", { bubbles: true });
        selectEl.dispatchEvent(ngModelEvent);
      }, selector, turkeyOpt.value);

      return true;
    } catch (e) {
      console.log("  [REG] page.select hatası:", e.message);
    }
  }

  console.log("  [REG] ⚠ Hiçbir select'te Turkey bulunamadı");
  return false;
}

async function registerVfsAccount(account) {
  const ts = new Date().toLocaleTimeString("tr-TR");
  console.log(`\n[${ts}] 📝 VFS Kayıt: ${account.email}`);

  let browser;
  try {
    const proxy = getNextProxy();
    const fp = generateFingerprint();
    console.log(`  [PROXY] ${proxy.host}:${proxy.port}`);

    browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS ? "new" : false,
      slowMo: CONFIG.SLOW_MO,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        `--window-size=${fp.viewport.width},${fp.viewport.height}`,
        `--proxy-server=${proxy.url}`,
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-web-security",
      ],
    });

    const page = await browser.newPage();
    await page.authenticate({ username: proxy.user, password: proxy.pass });
    await applyFingerprint(page, fp);
    await humanMove(page);

    // Navigate to VFS registration page
    const regUrl = CONFIG.VFS_URL.replace("/login", "/register");
    console.log("  [REG 1/5] Kayıt sayfası...");
    await page.goto(regUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000, 6000);
    await humanMove(page);

    // Cookie banner
    console.log("  [REG 2/5] Cookie banner...");
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
        await delay(1000, 2000);
      }
    } catch (e) {}

    // CAPTCHA + Queue
    console.log("  [REG 3/5] CAPTCHA + sıra kontrol...");
    await solveTurnstile(page);
    await delay(2000, 4000);

    // Fill registration form (exact VFS form structure)
    console.log("  [REG 4/5] Kayıt formu dolduruluyor...");
    await humanMove(page);

    // 1. Email field
    const emailInput = await page.$('input[type="email"], input[placeholder*="email"], input[name*="email"]');
    if (emailInput) {
      await humanType(page, emailInput, account.email, {
        clearFirst: true,
        minDelay: 80,
        maxDelay: 240,
        pauseChance: 0.18,
        pauseMin: 280,
        pauseMax: 1200,
      });
      await delay(500, 1100);
    }
    await humanMove(page);

    // 2. Password + Confirm Password (2 separate password fields)
    const passwordInputs = await page.$$('input[type="password"]');
    console.log(`  [REG] ${passwordInputs.length} şifre alanı bulundu`);
    for (let i = 0; i < passwordInputs.length; i++) {
      await humanType(page, passwordInputs[i], account.password, {
        clearFirst: true,
        minDelay: 85,
        maxDelay: 230,
        pauseChance: 0.15,
        pauseMin: 240,
        pauseMax: 900,
      });
      await delay(450, 1000);
      if (i === 0) await humanMove(page);
    }
    await delay(700, 1300);

    // 3. Mobile Number - Dial Code dropdown + Mobile Number field
    if (account.phone) {
      const { dialCode, mobileNumber } = normalizePhoneNumber(account.phone);
      console.log(`  [REG] Telefon: +${dialCode} ${mobileNumber}`);

      const dialCodeSelected = await selectTurkeyDialCode(page);
      if (!dialCodeSelected) {
        throw new Error("Dial code Turkey(90) seçilemedi");
      }

      const mobileInput = await page.evaluateHandle(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };

        const scoreInput = (inp) => {
          const meta = `${inp.name || ""} ${inp.id || ""} ${inp.placeholder || ""} ${inp.getAttribute("aria-label") || ""}`.toLowerCase();
          const sectionText = (inp.closest("mat-form-field, .mat-mdc-form-field, .form-group, .row, div")?.textContent || "").toLowerCase();

          if (/otp|code|verify|email|mail|password|şifre/.test(meta)) return -10;

          let score = 0;
          if (/mobile|phone|tel|gsm|cep|telefon/.test(meta)) score += 5;
          if (/mobile number|phone number|telefon numarası|cep numarası|cep telefonu|ön ek olmadan/.test(sectionText)) score += 4;
          if (inp.type === "tel") score += 3;
          return score;
        };

        const candidates = Array.from(document.querySelectorAll('input[type="tel"], input[type="text"], input[type="number"]'))
          .filter((inp) => isVisible(inp) && !inp.disabled && !inp.readOnly)
          .map((inp) => ({ inp, score: scoreInput(inp) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score);

        return candidates[0]?.inp || null;
      });

      if (mobileInput && mobileInput.asElement()) {
        await humanType(page, mobileInput.asElement(), mobileNumber, {
          clearFirst: true,
          minDelay: 90,
          maxDelay: 250,
          pauseChance: 0.12,
          pauseMin: 220,
          pauseMax: 800,
        });
        await delay(500, 1100);
      } else {
        throw new Error("Telefon numarası alanı bulunamadı");
      }
    }
    await humanMove(page);
    await delay(1000, 2000);

    // 4. Check ALL checkboxes (Privacy, Data Transfer, Terms & Conditions)
    const checkboxes = await page.$$('input[type="checkbox"]');
    console.log(`  [REG] ${checkboxes.length} checkbox bulundu`);
    for (let i = 0; i < checkboxes.length; i++) {
      const isChecked = await checkboxes[i].evaluate(el => el.checked);
      if (!isChecked) {
        await checkboxes[i].click();
        await delay(300, 800);
      }
    }
    await delay(1000, 2000);

    // 5. Solve Turnstile CAPTCHA
    console.log("  [REG] CAPTCHA çözülüyor...");
    await solveTurnstile(page);
    await delay(2000, 4000);

    // 6. Click "Continue" button
    const regBtn = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll("button")];
      return btns.find((b) => {
        const txt = b.textContent.toLowerCase().trim();
        return txt.includes("continue") || txt.includes("devam") || txt.includes("kayıt") || 
               txt.includes("register") || txt.includes("sign up") || txt.includes("oluştur");
      }) || document.querySelector('button[type="submit"]') || null;
    });
    if (regBtn && regBtn.asElement()) {
      await regBtn.asElement().click();
      console.log("  [REG] ✅ Continue butonuna tıklandı");
    } else {
      await page.click('button[type="submit"]');
    }
    await delay(5000, 8000);

    // Take screenshot for debugging
    const ss = await takeScreenshotBase64(page);
    await reportResult("registration", "checking", `Kayıt formu gönderildi | ${account.email}`, 0, ss);

    // STEP 5: Handle verification codes
    console.log("  [REG 5/5] Doğrulama kodları...");

    // Check if email verification is needed
    const pageText = await page.evaluate(() => (document.body?.innerText || "").toLowerCase());
    const needsEmailVerify = pageText.includes("e-posta") || pageText.includes("email") ||
                              pageText.includes("doğrulama") || pageText.includes("verification") ||
                              pageText.includes("verify");

    if (needsEmailVerify) {
      console.log("  [REG] Email doğrulama kodu gerekli");
      const emailOtp = await waitForRegistrationOtp(account.id, "email", 180000);
      if (!emailOtp) {
        await completeRegistration(account.id, false);
        return false;
      }

      // Enter email OTP
      const otpFilled = await page.evaluate((code) => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"]');
        const otpInputs = [...inputs].filter(inp => {
          const name = (inp.name || "").toLowerCase();
          const placeholder = (inp.placeholder || "").toLowerCase();
          const id = (inp.id || "").toLowerCase();
          return name.includes("otp") || name.includes("code") || name.includes("verification") ||
                 placeholder.includes("kod") || placeholder.includes("code") || id.includes("otp") || id.includes("code");
        });
        if (otpInputs.length > 0) {
          if (otpInputs[0].maxLength === 1 && otpInputs.length >= 4) {
            for (let i = 0; i < Math.min(code.length, otpInputs.length); i++) {
              otpInputs[i].value = code[i];
              otpInputs[i].dispatchEvent(new Event("input", { bubbles: true }));
              otpInputs[i].dispatchEvent(new Event("change", { bubbles: true }));
            }
          } else {
            otpInputs[0].value = code;
            otpInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
            otpInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
          }
          return true;
        }
        const singleInput = document.querySelector('input[type="text"]');
        if (singleInput) {
          singleInput.value = code;
          singleInput.dispatchEvent(new Event("input", { bubbles: true }));
          singleInput.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      }, emailOtp);

      if (otpFilled) {
        await delay(500, 1000);
        const submitted = await page.evaluate(() => {
          const btns = [...document.querySelectorAll("button")];
          const btn = btns.find(b => {
            const txt = b.textContent.toLowerCase();
            return txt.includes("verify") || txt.includes("doğrula") || txt.includes("onayla") ||
                   txt.includes("submit") || txt.includes("gönder") || txt.includes("confirm");
          }) || document.querySelector('button[type="submit"]');
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (submitted) {
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
          await delay(3000, 5000);
        }
      }
    }

    // Check if SMS verification is also needed
    const pageText2 = await page.evaluate(() => (document.body?.innerText || "").toLowerCase());
    const needsSmsVerify = pageText2.includes("sms") || pageText2.includes("telefon") ||
                            pageText2.includes("phone") || pageText2.includes("mobile");

    if (needsSmsVerify) {
      console.log("  [REG] SMS doğrulama kodu gerekli");
      const smsOtp = await waitForRegistrationOtp(account.id, "sms", 180000);
      if (!smsOtp) {
        await completeRegistration(account.id, false);
        return false;
      }

      // Enter SMS OTP (same logic)
      await page.evaluate((code) => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"]');
        for (const inp of inputs) {
          const name = (inp.name || "").toLowerCase();
          const placeholder = (inp.placeholder || "").toLowerCase();
          if (name.includes("otp") || name.includes("code") || name.includes("sms") ||
              placeholder.includes("kod") || placeholder.includes("code") || placeholder.includes("sms")) {
            inp.value = code;
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }, smsOtp);

      await delay(500, 1000);
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button")];
        const btn = btns.find(b => {
          const txt = b.textContent.toLowerCase();
          return txt.includes("verify") || txt.includes("doğrula") || txt.includes("onayla") ||
                 txt.includes("confirm") || txt.includes("gönder");
        }) || document.querySelector('button[type="submit"]');
        if (btn) btn.click();
      });
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
      await delay(3000, 5000);
    }

    // Check if registration was successful
    const finalText = await page.evaluate(() => (document.body?.innerText || "").toLowerCase());
    const finalUrl = await page.evaluate(() => window.location.href.toLowerCase());
    const success = finalUrl.includes("login") || finalUrl.includes("dashboard") ||
                    finalText.includes("başarılı") || finalText.includes("success") ||
                    finalText.includes("tamamlandı") || finalText.includes("completed");

    const finalSs = await takeScreenshotBase64(page);
    await reportResult("registration", success ? "found" : "error",
      `Kayıt ${success ? "başarılı" : "sonucu belirsiz"} | ${account.email}`, 0, finalSs);
    await completeRegistration(account.id, success);
    return success;
  } catch (err) {
    console.error("  [REG] Genel hata:", err.message);
    await completeRegistration(account.id, false);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

// ==================== MAIN LOOP ====================

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  VFS Randevu Takip Botu v7");
  console.log("  Stealth + Fingerprint + Auto Registration");
  console.log("═══════════════════════════════════════════");

  if (CONFIG.CAPTCHA_API_KEY) {
    console.log("✅ CAPTCHA çözücü aktif");
  } else {
    console.log("⚠ CAPTCHA_API_KEY yok, Turnstile çözülemeyecek!");
  }
  console.log("✅ Stealth plugin aktif");
  console.log("✅ Otomatik kayıt aktif");

  while (true) {
    try {
      // Check for pending registrations first
      const pendingRegs = await fetchPendingRegistrations();
      if (pendingRegs.length > 0) {
        console.log(`\n📝 ${pendingRegs.length} bekleyen kayıt var`);
        for (const reg of pendingRegs) {
          await registerVfsAccount(reg);
          await delay(10000, 20000);
        }
      }

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
        const now = Date.now();
        const availableAccounts = accounts.filter(acc => {
          const lastUsed = accountLastUsed.get(acc.id) || 0;
          return (now - lastUsed) >= CONFIG.MIN_ACCOUNT_GAP_MS;
        });

        if (availableAccounts.length === 0) {
          const oldestUsed = accounts.reduce((oldest, acc) => {
            const t = accountLastUsed.get(acc.id) || 0;
            return t < (accountLastUsed.get(oldest.id) || 0) ? acc : oldest;
          }, accounts[0]);
          const lastUsed = accountLastUsed.get(oldestUsed.id) || 0;
          const waitMs = Math.max(0, CONFIG.MIN_ACCOUNT_GAP_MS - (now - lastUsed));
          console.log(`\n⏳ Tüm hesaplar yakın zamanda kullanıldı. ${Math.round(waitMs / 1000)}s bekleniyor...`);
          await new Promise((r) => setTimeout(r, waitMs));
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
        const result = await checkAppointments(config, account);

        if (result.found) {
          console.log("\n🎉 RANDEVU BULUNDU!");
          consecutiveErrors = 0;
        } else if (result.accountBanned) {
          console.log(`\n⛔ Hesap banlı: ${account.email}`);
          consecutiveErrors++;
        } else {
          const wasError = result.accountBanned === false && !result.otpRequired;
          if (wasError) consecutiveErrors = 0;
          else consecutiveErrors++;
        }

        const baseInterval = Math.max(config.check_interval * 1000, CONFIG.BASE_INTERVAL_MS);
        const backoffMultiplier = Math.min(Math.pow(1.5, consecutiveErrors), 5);
        const interval = Math.min(baseInterval * backoffMultiplier, CONFIG.MAX_BACKOFF_MS);
        const jitter = Math.floor(Math.random() * 60000) + 15000;
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
ENDOFFILE
npm install puppeteer-extra puppeteer-extra-plugin-stealth && pm2 restart vfs-bot && pm2 logs vfs-bot
