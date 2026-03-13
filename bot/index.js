/**
 * VFS Global Randevu Takip Botu v7.1
 * puppeteer-real-browser + Fingerprint + Kayıt Otomasyonu
 * Proxy DEVRE DIŞI
 */

require("dotenv").config();

let Solver;
try {
  const mod = require("2captcha-ts");
  Solver = mod.Solver || mod.default?.Solver || mod;
} catch (e) {
  console.log("⚠ 2captcha-ts yüklü değil, HTTP fallback ile devam edilecek.");
}

const CONFIG = {
  API_URL: "https://ocrpzwrsyiprfuzsyivf.supabase.co/functions/v1/bot-api",
  API_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc",
  VFS_URL: "https://visa.vfsglobal.com/tur/tr/fra/login",
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
  { width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1536, height: 864 },
  { width: 1440, height: 900 }, { width: 1680, height: 1050 }, { width: 1280, height: 720 },
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

function delay(min = 1000, max = 3000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

async function humanMove(page) {
  try {
    const vp = page.viewport();
    const w = vp?.width || 1366;
    const h = vp?.height || 768;
    const x = Math.floor(Math.random() * w * 0.6 + w * 0.2);
    const y = Math.floor(Math.random() * h * 0.6 + h * 0.2);
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10 + 5) });
    await delay(100, 300);
  } catch {}
}

async function humanType(page, target, text, options = {}) {
  const { clearFirst = false, minDelay = 70, maxDelay = 220, pauseChance = 0.14, pauseMin = 220, pauseMax = 950 } = options;
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
    if (Math.random() < pauseChance) await delay(pauseMin, pauseMax);
  }
  await delay(180, 420);
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
    return title.includes("waiting room") || body.includes("şu anda sıradasınız") ||
      body.includes("tahmini bekleme süreniz") || body.includes("this page will auto refresh") ||
      body.includes("bu sayfa otomatik olarak yenilenecektir");
  });
}

async function postQueueScreenshot(page, context, waitedSec) {
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
      message: `[${context}] Sıra bekleniyor (${waitedSec}s) | URL: ${pageUrl.substring(0, 80)} | Başlık: ${pageTitle.substring(0, 60)}`,
      slots_available: 0,
      screenshot_base64: ss,
    }, "queue_screenshot:insert_log");
    console.log(`  [${context}] 📸 Kuyruk screenshot gönderildi (${waitedSec}s)`);
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
      // Her 30s'de bir screenshot gönder
      if (Date.now() - lastScreenshotAt > 30000) {
        await postQueueScreenshot(page, "QUEUE", waitedSec);
        lastScreenshotAt = Date.now();
      }
      await solveTurnstile(page);
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: CONFIG.QUEUE_POLL_MS + 5000 }).catch(() => {});
      await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
      continue;
    }
    // Bekleme odası değilse ama form da yoksa — durumu logla
    if (attempt % 3 === 0 && Date.now() - lastScreenshotAt > 30000) {
      await postQueueScreenshot(page, "QUEUE", waitedSec);
      lastScreenshotAt = Date.now();
    }
    await delay(CONFIG.QUEUE_POLL_MS, CONFIG.QUEUE_POLL_MS + 3000);
  }
  return { ok: false, reason: `Waiting room timeout (${Math.round(CONFIG.QUEUE_MAX_WAIT_MS / 1000)}s)` };
}

async function waitForRegistrationFormAfterQueue(page) {
  const startedAt = Date.now();
  let attempt = 0;

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

      return {
        hasVisibleEmail,
        visiblePasswordCount,
        title: (document.title || "").toLowerCase(),
        body: (document.body?.innerText || "").toLowerCase(),
      };
    });

    if (formState.hasVisibleEmail && formState.visiblePasswordCount >= 2) {
      console.log(`  [REG] ✅ Kayıt formu hazır (${attempt}. deneme).`);
      return { ok: true };
    }

    const waitingRoom = await isWaitingRoomPage(page);
    if (waitingRoom) {
      const waitedSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  [REG] Sırada bekleniyor... ${waitedSec}s`);
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
        'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name*="turnstile"], textarea[name="g-recaptcha-response"]'
      )
    );
    const token = fields.map((el) => String(el.value || "").trim()).find((v) => v.length > 20);
    return token || "";
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
          console.log("  [CAPTCHA] ✅ Turnstile iframe tıklandı (token bekleniyor)");
          return true;
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
        console.log("  [CAPTCHA] ✅ Turnstile iframe merkez tıklandı");
        return true;
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

async function solveTurnstile(page) {
  const context = await getTurnstileContext(page);

  if (!context.hasWidget) {
    console.log("  [CAPTCHA] Turnstile bulunamadı.");
    return false;
  }

  if (context.sitekey && CONFIG.CAPTCHA_API_KEY) {
    const solved = await _solve(page, context);
    if (solved) return true;
  }

  if (!context.sitekey && CONFIG.CAPTCHA_API_KEY) {
    console.log("  [CAPTCHA] Sitekey bulunamadı, iframe click fallback deneniyor...");
  } else if (!CONFIG.CAPTCHA_API_KEY) {
    console.log("  [CAPTCHA] API key yok, yalnızca iframe click deneniyor...");
  }

  const clicked = await tryClickTurnstileCheckbox(page);
  if (!clicked) {
    console.log("  [CAPTCHA] Turnstile çözülemedi.");
    return false;
  }

  const token = await waitForTurnstileToken(page, 9000);
  return !!token || clicked;
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
    let token = "";

    if (Solver) {
      try {
        const solver = new (Solver.Solver || Solver)(CONFIG.CAPTCHA_API_KEY);
        const result = await solver.cloudflareTurnstile(payload);
        token = result?.data || result?.token || result?.request || result?.code || "";
      } catch (solverErr) {
        console.log(`  [CAPTCHA] SDK çözümü başarısız, HTTP fallback: ${solverErr.message}`);
      }
    }

    if (!token) {
      token = await solveTurnstileWithHttp(payload);
    }

    if (!token) throw new Error("Token alınamadı");

    console.log("  [CAPTCHA] ✅ Çözüldü!");

    await page.evaluate((t) => {
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
      }

      if (typeof window.turnstileCallback === "function") window.turnstileCallback(t);
      if (typeof window.onTurnstileSuccess === "function") window.onTurnstileSuccess(t);
      if (window.turnstile) {
        try {
          window.turnstile.getResponse = () => t;
        } catch {}
      }
    }, token);

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
async function launchBrowser() {
  const { connect } = require("puppeteer-real-browser");
  const { browser, page } = await connect({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
    ],
  });
  console.log("  [BROWSER] ✅ Real browser başlatıldı (proxy yok)");
  return { browser, page };
}

// ==================== MAIN CHECK ====================
async function checkAppointments(config, account) {
  const { id, country, city } = config;
  const ts = new Date().toLocaleTimeString("tr-TR");
  console.log(`\n[${ts}] Kontrol: ${country} ${city} | Hesap: ${account.email}`);

  let browser;
  try {
    const fp = generateFingerprint();
    const { browser: br, page } = await launchBrowser();
    browser = br;
    await applyFingerprint(page, fp);
    await humanMove(page);

    // STEP 1: Giriş sayfası
    console.log("  [1/6] Giriş sayfası...");
    await page.goto(CONFIG.VFS_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
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

      // Turnstile checkbox
      try {
        const turnstileFrame = page.frames().find(f => f.url().includes("challenges.cloudflare.com"));
        if (turnstileFrame) {
          const checkbox = await turnstileFrame.$('input[type="checkbox"], .cb-i');
          if (checkbox) { await checkbox.click(); console.log("  [4/6] ✅ Turnstile checkbox tıklandı"); await delay(2000, 4000); }
        }
      } catch (e) {}

      const submitBtn = await page.evaluateHandle(() => {
        const btns = [...document.querySelectorAll("button")];
        return btns.find((b) => {
          const txt = b.textContent.toLowerCase();
          return txt.includes("oturum") || txt.includes("sign in") || txt.includes("login") || txt.includes("giriş");
        }) || document.querySelector('button[type="submit"]') || null;
      });
      if (submitBtn && submitBtn.asElement()) await submitBtn.asElement().click();
      else await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
      await delay(3000, 5000);
    } catch (loginErr) {
      console.log("  [4/6] ⚠ Giriş formu hatası:", loginErr.message);
    }

    // STEP 5: OTP
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
        url, isNotFound: url.includes("page-not-found") || url.includes("404"),
        isSessionExpired: body.includes("oturum süresi doldu") || body.includes("session expired"),
        isBanned: body.includes("engellenmiş") || body.includes("blocked") || body.includes("banned"),
        isWaitingRoom: (document.title || "").toLowerCase().includes("waiting room"),
        isLoginPage: url.includes("/login"), isDashboard: url.includes("/dashboard") || url.includes("/appointment"),
        hasLoginForm: !!document.querySelector('input[type="email"], input[name="email"], #email'),
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
      if (isBanned) { await updateAccountStatus(account.id, "banned"); return { found: false, accountBanned: true }; }
      const newFailCount = (account.fail_count || 0) + 1;
      if (newFailCount >= 3) { await updateAccountStatus(account.id, "cooldown", newFailCount); }
      else { await updateAccountStatus(account.id, "active", newFailCount); }
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
          return txt.includes("new booking") || txt.includes("yeni başvuru") || txt.includes("start new") || txt.includes("randevu") || txt.includes("book appointment");
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
    const noAppointmentPhrases = ["no appointment", "no available", "currently no date", "randevu bulunmamaktadır", "müsait randevu yok", "no open schedule", "fully booked", "no slot", "appointment is not available", "no dates available", "no timeslot available"];
    const appointmentFoundPhrases = ["select date", "available slot", "tarih seçin", "available appointment", "open slot", "choose a date", "select a time", "appointment available"];
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

    const hasCaptchaToken = Array.from(
      document.querySelectorAll('input[name="cf-turnstile-response"], input[name*="turnstile"], textarea[name="g-recaptcha-response"]')
    ).some((el) => String(el.value || "").trim().length > 20);

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

async function tryForceRegistrationSubmit(page) {
  return await page.evaluate(() => {
    const keywords = ["devam et", "devam", "continue", "register", "create", "kayıt", "oluştur", "sign up"];
    const buttons = Array.from(document.querySelectorAll("button"));
    const submitBtn = buttons.find((b) => {
      const txt = (b.textContent || "").toLowerCase().trim();
      return keywords.some((k) => txt.includes(k));
    }) || document.querySelector('button[type="submit"]');

    if (!submitBtn) return { clicked: false, forced: false, reason: "no_submit_button" };

    const wasDisabled = !!submitBtn.disabled;
    if (wasDisabled) {
      submitBtn.disabled = false;
      submitBtn.removeAttribute("disabled");
      submitBtn.setAttribute("aria-disabled", "false");
    }

    const form = submitBtn.closest("form");
    if (form && typeof form.requestSubmit === "function") form.requestSubmit(submitBtn);
    else submitBtn.click();

    return { clicked: true, forced: wasDisabled, reason: wasDisabled ? "force_enabled" : "normal_click" };
  });
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

  let browser;
  let page;
  try {
    const fp = generateFingerprint();
    const launched = await launchBrowser();
    browser = launched.browser;
    page = launched.page;
    await applyFingerprint(page, fp);
    await humanMove(page);

    const regUrl = CONFIG.VFS_URL.replace("/login", "/register");
    console.log("  [REG 1/7] Kayıt sayfası...");
    await page.goto(regUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await delay(3000, 6000);
    await humanMove(page);

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
        await delay(500, 1500);
        await cookieBtn.asElement().click();
        console.log("  [REG 2/7] ✅ Cookie kabul edildi");
        await delay(1000, 2000);
      }
    } catch (e) {}

    // CAPTCHA
    console.log("  [REG 3/7] CAPTCHA...");
    await solveTurnstile(page);
    await delay(2000, 4000);

    // Form yüklenmesini bekle
    console.log("  [REG 4/7] Form bekleniyor...");
    const registrationFormResult = await waitForRegistrationFormAfterQueue(page);
    if (!registrationFormResult.ok) {
      const snapshot = await takeScreenshotBase64(page);
      await postRegError(account, page, registrationFormResult.reason);
      if (snapshot) console.log("  [REG] 📸 Form timeout screenshot alındı");
      throw new Error(registrationFormResult.reason);
    }
    await delay(1800, 3200);

    // ========== FORM DOLDURMA ==========
    console.log("  [REG 5/7] Form dolduruluyor...");

    // Angular uyumlu input doldurma helper
    async function fillAngularInput(page, element, value) {
      await element.click({ clickCount: 3 });
      await delay(200, 400);
      await page.keyboard.press("Backspace");
      await delay(100, 200);

      // Önce humanType ile yaz
      for (const ch of String(value)) {
        await page.keyboard.type(ch, { delay: Math.floor(Math.random() * 150) + 50 });
        if (Math.random() < 0.1) await delay(150, 400);
      }
      await delay(200, 500);

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
    await delay(500, 1100);
    await humanMove(page);

    // ŞİFRE + ONAY
    const passwordInputs = await page.$$('input[type="password"]');
    console.log(`  [REG] ${passwordInputs.length} şifre alanı bulundu`);
    if (passwordInputs.length < 2) throw new Error("Şifre alanları bulunamadı");
    for (let i = 0; i < passwordInputs.length; i++) {
      await fillAngularInput(page, passwordInputs[i], account.password);
      await delay(450, 1000);
      if (i === 0) await humanMove(page);
    }
    console.log("  [REG] ✅ Şifre girildi");
    await delay(700, 1300);

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
    await delay(1000, 2000);

    // CHECKBOX'LAR
    console.log("  [REG 6/7] Onay kutuları...");
    await tickAllCheckboxes(page);
    await delay(1000, 2000);

    // CAPTCHA
    console.log("  [REG] CAPTCHA kontrol...");
    await solveTurnstile(page);
    await delay(2000, 4000);

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
              message: `[REG] Form dolduruldu, Devam Et tıklanacak | ${account.email}`,
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

    const btnInfo = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.map(b => ({ text: (b.textContent || '').trim().substring(0, 30), disabled: b.disabled, type: b.type }));
    });
    console.log('  [REG] Butonlar:', JSON.stringify(btnInfo));

    try {
      const submitBtn = await page.evaluateHandle(() => {
        const btns = [...document.querySelectorAll("button")];
        const keywords = ["devam et", "devam", "continue", "register", "kayıt", "create", "oluştur", "sign up"];
        return btns.find((b) => {
          const txt = (b.textContent || "").toLowerCase().trim();
          return keywords.some(k => txt.includes(k));
        }) || document.querySelector('button[type="submit"]') || null;
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
              console.log("  [REG] ⚠ CAPTCHA token görünmüyor, iframe click + force submit deneniyor...");
              await tryClickTurnstileCheckbox(page);
              await delay(1200, 2200);
            }

            const forceResult = await tryForceRegistrationSubmit(page);
            console.log(`  [REG] Force submit: clicked=${forceResult.clicked}, forced=${forceResult.forced}, reason=${forceResult.reason}`);

            if (!forceResult.clicked) {
              if (afterDiag.hasTurnstileWidget && !afterDiag.hasCaptchaToken) {
                throw new Error("Devam Et butonu pasif: CAPTCHA doğrulaması tamamlanmadı");
              }
              throw new Error("Devam Et butonu pasif kaldı (form invalid)");
            }

            clickedSubmit = true;
            await delay(1200, 2400);
          }
        }

        if (!clickedSubmit) {
          await submitBtn.asElement().click();
          clickedSubmit = true;
          console.log("  [REG] ✅ Devam Et tıklandı");
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

    await delay(4000, 7000);

    // OTP DOĞRULAMA
    console.log("  [REG] OTP doğrulama kontrol...");
    const otpDetected = await page.evaluate(() => {
      const text = (document.body?.innerText || "").toLowerCase();
      const hasText = /otp|verification code|doğrulama kodu|one time|sms code|email code|kodu girin|code sent/.test(text);
      const hasInput = !!document.querySelector('input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[maxlength="1"], input[maxlength="6"]');
      return hasText || hasInput;
    });

    if (!otpDetected) {
      const pageText = await page.evaluate(() => (document.body?.innerText || '').substring(0, 300));
      console.log("  [REG] Sayfa durumu:", pageText.substring(0, 200));
      await postRegError(account, page, "OTP ekranı bulunamadı");
      await completeRegistration(account.id, false);
      return false;
    }

    const otpType = await page.evaluate(() => {
      const t = (document.body?.innerText || "").toLowerCase();
      return (t.includes("sms") || t.includes("mobile") || t.includes("telefon")) ? "sms" : "email";
    });
    console.log(`  [REG] 📱 ${otpType.toUpperCase()} OTP bekleniyor - dashboard'dan girin`);

    const otp = await waitForRegistrationOtp(account.id, otpType, 180000);
    if (!otp) {
      await postRegError(account, page, `${otpType} OTP timeout (180s)`);
      await completeRegistration(account.id, false);
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
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const btn = btns.find(b => {
        const txt = b.textContent.toLowerCase();
        return txt.includes("verify") || txt.includes("doğrula") || txt.includes("onayla") || txt.includes("confirm") || txt.includes("gönder");
      }) || document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });
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
        await page.evaluate(() => {
          const btns = [...document.querySelectorAll("button")];
          const btn = btns.find(b => {
            const txt = b.textContent.toLowerCase();
            return txt.includes("verify") || txt.includes("doğrula") || txt.includes("onayla") || txt.includes("confirm");
          }) || document.querySelector('button[type="submit"]');
          if (btn) btn.click();
        });
        await delay(4000, 7000);
      } else {
        await postRegError(account, page, `${secondOtpType} OTP timeout`);
        await completeRegistration(account.id, false);
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

    if (success) console.log("  [REG] ✅ KAYIT BAŞARILI!");
    else { console.log("  [REG] ⚠ Sonuç belirsiz"); await postRegError(account, page, "OTP sonrası başarı sinyali bulunamadı"); }
    await completeRegistration(account.id, success);
    return success;
  } catch (err) {
    console.error("  [REG] Genel hata:", err.message);
    await postRegError(account, page, err.message);
    await completeRegistration(account.id, false);
    return false;
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// ==================== MAIN LOOP ====================
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  VFS Randevu Takip Botu v7.1");
  console.log("  Real Browser + Fingerprint + Kayıt");
  console.log("  Proxy: KAPALI");
  console.log("═══════════════════════════════════════════");

  if (CONFIG.CAPTCHA_API_KEY) console.log("✅ CAPTCHA çözücü aktif");
  else console.log("⚠ CAPTCHA_API_KEY yok");
  console.log("✅ Fingerprint randomization aktif");
  console.log("✅ OTP false-positive düzeltmesi aktif");
  console.log("✅ Otomatik kayıt aktif");

  while (true) {
    try {
      // Bekleyen kayıtları kontrol et
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
        console.log("\n❌ Kullanılabilir VFS hesabı yok!");
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

        if (result.found) { console.log("\n🎉 RANDEVU BULUNDU!"); consecutiveErrors = 0; }
        else if (result.accountBanned) { console.log(`\n⛔ Hesap banlı: ${account.email}`); consecutiveErrors++; }
        else { if (!result.otpRequired) consecutiveErrors = 0; else consecutiveErrors++; }

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
