/**
 * Quiz/Anket Çözücü Bot v5.1 — Dual Engine + Anti-Detection
 * Motor 1: Local Puppeteer + Gemini Vision (varsayılan, ücretsiz)
 * Motor 2: Browser Use Cloud API (alternatif, ücretli)
 * Anti-detection: VFS bot seviyesinde humanMove/humanType/humanScroll
 * Kullanım: node quiz.js [URL]
 */
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ocrpzwrsyiprfuzsyivf.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc";

const BROWSER_USE_API = "https://api.browser-use.com/api/v2";

// ==================== SUPABASE HELPERS ====================

async function supabaseGet(table, query) {
  query = query || "";
  var fetch = (await import("node-fetch")).default;
  var res = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?" + query, {
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
  });
  return res.json();
}

async function supabaseUpdate(table, id, data) {
  var fetch = (await import("node-fetch")).default;
  await fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(data),
  });
}

async function supabaseInsertLog(message, status, screenshotUrl) {
  status = status || "info";
  var fetch = (await import("node-fetch")).default;
  var body = { message: "[QUIZ] " + message, status: status };
  if (screenshotUrl) body.screenshot_url = screenshotUrl;
  await fetch(SUPABASE_URL + "/rest/v1/quiz_tracking_logs", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}

async function getSettings() {
  var settings = await supabaseGet("bot_settings", "select=key,value");
  if (!settings || !Array.isArray(settings)) return {};
  var map = {};
  for (var i = 0; i < settings.length; i++) map[settings[i].key] = settings[i].value;
  return map;
}

// ==================== HESAP YÖNETİMİ ====================

async function getLoginAccount() {
  var accounts = await supabaseGet("quiz_accounts", "status=eq.active&order=last_used_at.asc.nullsfirst&limit=1");
  if (!accounts || accounts.length === 0) {
    console.log("Aktif giris hesabi bulunamadi!");
    await supabaseInsertLog("Aktif giris hesabi bulunamadi", "error");
    return null;
  }
  var acc = accounts[0];
  await supabaseUpdate("quiz_accounts", acc.id, { last_used_at: new Date().toISOString() });
  return acc;
}

// ==================== CAPTCHA SOLVER (2captcha / Capsolver) ====================

async function detectCaptchaOnPage(page) {
  function getQueryParam(url, key) {
    try {
      var match = String(url || "").match(new RegExp("[?&]" + key + "=([^&#]+)"));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (e) {
      return null;
    }
  }

  async function inspectFrame(frame) {
    var frameUrl = "";
    try { frameUrl = frame.url(); } catch (e) {}

    var infoFromUrl = {
      recaptchaSitekey: /recaptcha|google\.com\/recaptcha/i.test(frameUrl) ? getQueryParam(frameUrl, "k") : null,
      hcaptchaSitekey: /hcaptcha/i.test(frameUrl) ? getQueryParam(frameUrl, "sitekey") : null,
      turnstileSitekey: /challenges\.cloudflare\.com/i.test(frameUrl) ? getQueryParam(frameUrl, "sitekey") : null,
      hasRecaptchaFrame: /recaptcha|google\.com\/recaptcha/i.test(frameUrl),
      hasHCaptchaFrame: /hcaptcha/i.test(frameUrl),
      hasTurnstileFrame: /challenges\.cloudflare\.com/i.test(frameUrl),
      hasRecaptchaGrid: /recaptcha\/api2\/bframe|recaptcha challenge/i.test(frameUrl),
      hasHCaptchaGrid: /hcaptcha/i.test(frameUrl),
    };

    var infoFromDom = {};
    try {
      infoFromDom = await frame.evaluate(function() {
        function getAttr(selector, attr) {
          var el = document.querySelector(selector);
          return el ? el.getAttribute(attr) : null;
        }

        var html = document.documentElement ? document.documentElement.innerHTML : "";
        var recaptchaSitekeyMatch = html.match(/grecaptcha\.render\([\s\S]*?sitekey["'\s:=,]+["']?([0-9A-Za-z_-]{20,})/i);
        var hcaptchaSitekeyMatch = html.match(/(?:data-hcaptcha-sitekey|hcaptcha\.render\([\s\S]*?sitekey)["'\s:=,]+["']?([0-9A-Za-z_-]{20,})/i);
        var turnstileSitekeyMatch = html.match(/turnstile\.render\([\s\S]*?sitekey["'\s:=,]+["']?([0-9A-Za-z_-]{20,})/i);

        return {
          recaptchaSitekey: getAttr('.g-recaptcha', 'data-sitekey') || (recaptchaSitekeyMatch ? recaptchaSitekeyMatch[1] : null),
          hcaptchaSitekey: getAttr('.h-captcha, [data-hcaptcha-sitekey]', 'data-hcaptcha-sitekey') || getAttr('.h-captcha[data-sitekey]', 'data-sitekey') || (hcaptchaSitekeyMatch ? hcaptchaSitekeyMatch[1] : null),
          turnstileSitekey: getAttr('.cf-turnstile', 'data-sitekey') || (turnstileSitekeyMatch ? turnstileSitekeyMatch[1] : null),
          hasRecaptchaFrame: !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"], .g-recaptcha, textarea[name="g-recaptcha-response"]'),
          hasHCaptchaFrame: !!document.querySelector('iframe[src*="hcaptcha"], iframe[title*="hcaptcha" i], .h-captcha, [data-hcaptcha-sitekey], textarea[name="h-captcha-response"]'),
          hasTurnstileFrame: !!document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, input[name="cf-turnstile-response"]'),
          hasRecaptchaGrid: !!document.querySelector('iframe[title*="recaptcha challenge" i], iframe[src*="bframe"], .rc-imageselect-table-33, .rc-imageselect-table-44, .rc-imageselect-table, #rc-imageselect, .rc-imageselect-desc-wrapper, .rc-imageselect-instructions'),
          hasHCaptchaGrid: !!document.querySelector('iframe[title*="hcaptcha" i], .challenge-container, .challenge-image-grid, [class*="challenge-image"]'),
        };
      });
    } catch (e) {}

    return {
      recaptchaSitekey: infoFromDom.recaptchaSitekey || infoFromUrl.recaptchaSitekey || null,
      hcaptchaSitekey: infoFromDom.hcaptchaSitekey || infoFromUrl.hcaptchaSitekey || null,
      turnstileSitekey: infoFromDom.turnstileSitekey || infoFromUrl.turnstileSitekey || null,
      hasRecaptchaFrame: !!(infoFromDom.hasRecaptchaFrame || infoFromUrl.hasRecaptchaFrame),
      hasHCaptchaFrame: !!(infoFromDom.hasHCaptchaFrame || infoFromUrl.hasHCaptchaFrame),
      hasTurnstileFrame: !!(infoFromDom.hasTurnstileFrame || infoFromUrl.hasTurnstileFrame),
      hasRecaptchaGrid: !!(infoFromDom.hasRecaptchaGrid || infoFromUrl.hasRecaptchaGrid),
      hasHCaptchaGrid: !!(infoFromDom.hasHCaptchaGrid || infoFromUrl.hasHCaptchaGrid),
      frameUrl: frameUrl,
    };
  }

  var frames = [];
  try {
    frames = page.frames();
  } catch (e) {}
  if (!frames || frames.length === 0) frames = [page.mainFrame ? page.mainFrame() : page];

  var combined = {
    recaptchaSitekey: null,
    hcaptchaSitekey: null,
    turnstileSitekey: null,
    hasRecaptchaFrame: false,
    hasHCaptchaFrame: false,
    hasTurnstileFrame: false,
    hasRecaptchaGrid: false,
    hasHCaptchaGrid: false,
  };

  for (var i = 0; i < frames.length; i++) {
    var info = await inspectFrame(frames[i]);
    if (!combined.recaptchaSitekey && info.recaptchaSitekey) combined.recaptchaSitekey = info.recaptchaSitekey;
    if (!combined.hcaptchaSitekey && info.hcaptchaSitekey) combined.hcaptchaSitekey = info.hcaptchaSitekey;
    if (!combined.turnstileSitekey && info.turnstileSitekey) combined.turnstileSitekey = info.turnstileSitekey;
    combined.hasRecaptchaFrame = combined.hasRecaptchaFrame || info.hasRecaptchaFrame;
    combined.hasHCaptchaFrame = combined.hasHCaptchaFrame || info.hasHCaptchaFrame;
    combined.hasTurnstileFrame = combined.hasTurnstileFrame || info.hasTurnstileFrame;
    combined.hasRecaptchaGrid = combined.hasRecaptchaGrid || info.hasRecaptchaGrid;
    combined.hasHCaptchaGrid = combined.hasHCaptchaGrid || info.hasHCaptchaGrid;
  }

  if (combined.hcaptchaSitekey || combined.hasHCaptchaFrame || combined.hasHCaptchaGrid) {
    return {
      type: "hcaptcha",
      sitekey: combined.hcaptchaSitekey,
      hasFrame: combined.hasHCaptchaFrame,
      hasImageGrid: combined.hasHCaptchaGrid,
    };
  }
  if (combined.recaptchaSitekey || combined.hasRecaptchaFrame || combined.hasRecaptchaGrid) {
    return {
      type: "recaptcha_v2",
      sitekey: combined.recaptchaSitekey,
      hasFrame: combined.hasRecaptchaFrame,
      hasImageGrid: combined.hasRecaptchaGrid,
    };
  }
  if (combined.turnstileSitekey || combined.hasTurnstileFrame) {
    return {
      type: "turnstile",
      sitekey: combined.turnstileSitekey,
      hasFrame: combined.hasTurnstileFrame,
    };
  }

  return null;
}

async function solveRecaptchaWith2Captcha(apiKey, sitekey, pageUrl) {
  var fetch = (await import("node-fetch")).default;
  console.log("[2CAPTCHA] reCAPTCHA v2 çözülüyor: " + sitekey);
  await supabaseInsertLog("2captcha: reCAPTCHA çözülüyor...", "info");

  // Submit task
  var submitRes = await fetch("https://2captcha.com/in.php?key=" + apiKey +
    "&method=userrecaptcha&googlekey=" + sitekey +
    "&pageurl=" + encodeURIComponent(pageUrl) + "&json=1");
  var submitData = await submitRes.json();

  if (submitData.status !== 1) {
    throw new Error("2captcha submit hatası: " + JSON.stringify(submitData));
  }

  var taskId = submitData.request;
  console.log("[2CAPTCHA] Task ID: " + taskId);

  // Poll for result (max 120s)
  for (var i = 0; i < 24; i++) {
    await new Promise(function(r) { setTimeout(r, 5000); });
    var pollRes = await fetch("https://2captcha.com/res.php?key=" + apiKey + "&action=get&id=" + taskId + "&json=1");
    var pollData = await pollRes.json();

    if (pollData.status === 1) {
      console.log("[2CAPTCHA] Çözüldü! Token uzunluğu: " + pollData.request.length);
      await supabaseInsertLog("2captcha: reCAPTCHA çözüldü ✓", "success");
      return pollData.request;
    }
    if (pollData.request !== "CAPCHA_NOT_READY") {
      throw new Error("2captcha polling hatası: " + JSON.stringify(pollData));
    }
  }
  throw new Error("2captcha: Zaman aşımı (120s)");
}

async function solveHCaptchaWith2Captcha(apiKey, sitekey, pageUrl) {
  var fetch = (await import("node-fetch")).default;
  console.log("[2CAPTCHA] hCaptcha çözülüyor: " + sitekey);
  await supabaseInsertLog("2captcha: hCaptcha çözülüyor...", "info");

  var submitRes = await fetch("https://2captcha.com/in.php?key=" + apiKey +
    "&method=hcaptcha&sitekey=" + sitekey +
    "&pageurl=" + encodeURIComponent(pageUrl) + "&json=1");
  var submitData = await submitRes.json();

  if (submitData.status !== 1) throw new Error("2captcha hcaptcha submit hatası: " + JSON.stringify(submitData));

  var taskId = submitData.request;
  for (var i = 0; i < 24; i++) {
    await new Promise(function(r) { setTimeout(r, 5000); });
    var pollRes = await fetch("https://2captcha.com/res.php?key=" + apiKey + "&action=get&id=" + taskId + "&json=1");
    var pollData = await pollRes.json();
    if (pollData.status === 1) {
      await supabaseInsertLog("2captcha: hCaptcha çözüldü ✓", "success");
      return pollData.request;
    }
    if (pollData.request !== "CAPCHA_NOT_READY") throw new Error("2captcha hcaptcha hatası: " + JSON.stringify(pollData));
  }
  throw new Error("2captcha hcaptcha: Zaman aşımı");
}

async function solveRecaptchaWithCapsolver(apiKey, sitekey, pageUrl) {
  var fetch = (await import("node-fetch")).default;
  console.log("[CAPSOLVER] reCAPTCHA v2 çözülüyor: " + sitekey);
  await supabaseInsertLog("Capsolver: reCAPTCHA çözülüyor...", "info");

  var submitRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: { type: "ReCaptchaV2TaskProxyLess", websiteURL: pageUrl, websiteKey: sitekey }
    })
  });
  var submitData = await submitRes.json();
  if (submitData.errorId !== 0) throw new Error("Capsolver submit hatası: " + (submitData.errorDescription || JSON.stringify(submitData)));

  var taskId = submitData.taskId;
  for (var i = 0; i < 24; i++) {
    await new Promise(function(r) { setTimeout(r, 5000); });
    var pollRes = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId: taskId })
    });
    var pollData = await pollRes.json();
    if (pollData.status === "ready") {
      await supabaseInsertLog("Capsolver: reCAPTCHA çözüldü ✓", "success");
      return pollData.solution.gRecaptchaResponse;
    }
    if (pollData.status !== "processing") throw new Error("Capsolver hatası: " + JSON.stringify(pollData));
  }
  throw new Error("Capsolver: Zaman aşımı");
}

async function solveHCaptchaWithCapsolver(apiKey, sitekey, pageUrl) {
  var fetch = (await import("node-fetch")).default;
  console.log("[CAPSOLVER] hCaptcha çözülüyor: " + sitekey);
  await supabaseInsertLog("Capsolver: hCaptcha çözülüyor...", "info");

  var submitRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: { type: "HCaptchaTaskProxyLess", websiteURL: pageUrl, websiteKey: sitekey }
    })
  });
  var submitData = await submitRes.json();
  if (submitData.errorId !== 0) throw new Error("Capsolver hcaptcha hatası: " + (submitData.errorDescription || JSON.stringify(submitData)));

  var taskId = submitData.taskId;
  for (var i = 0; i < 24; i++) {
    await new Promise(function(r) { setTimeout(r, 5000); });
    var pollRes = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId: taskId })
    });
    var pollData = await pollRes.json();
    if (pollData.status === "ready") {
      await supabaseInsertLog("Capsolver: hCaptcha çözüldü ✓", "success");
      return pollData.solution.gRecaptchaResponse;
    }
    if (pollData.status !== "processing") throw new Error("Capsolver hcaptcha hatası: " + JSON.stringify(pollData));
  }
  throw new Error("Capsolver hcaptcha: Zaman aşımı");
}

async function injectCaptchaToken(page, captchaType, token) {
  await page.evaluate(function(type, token) {
    if (type === "recaptcha_v2") {
      // Set g-recaptcha-response textarea
      var textarea = document.querySelector('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
      if (textarea) {
        textarea.style.display = "block";
        textarea.value = token;
        textarea.style.display = "none";
      }
      // Also try calling the callback
      try {
        if (typeof window.___grecaptcha_cfg !== "undefined") {
          var clients = window.___grecaptcha_cfg.clients;
          for (var key in clients) {
            var client = clients[key];
            // Navigate nested objects to find callback
            function findCallback(obj, depth) {
              if (depth > 5) return;
              for (var k in obj) {
                if (typeof obj[k] === "function" && k.length < 3) { obj[k](token); return true; }
                if (typeof obj[k] === "object" && obj[k] !== null) { if (findCallback(obj[k], depth + 1)) return true; }
              }
            }
            findCallback(client, 0);
          }
        }
      } catch (e) {}
    } else if (type === "hcaptcha") {
      var textarea = document.querySelector('[name="h-captcha-response"], textarea[name="h-captcha-response"]');
      if (textarea) { textarea.value = token; }
      try { if (window.hcaptcha) window.hcaptcha.execute(); } catch (e) {}
    }
  }, captchaType, token);
}

async function tryAutoSolveCaptcha(page, settings) {
  var captchaInfo = await detectCaptchaOnPage(page);
  if (!captchaInfo) return false;

  var provider = (settings.captcha_provider || "2captcha").toLowerCase();
  var twoCaptchaKey = (settings.captcha_api_key || process.env.CAPTCHA_API_KEY || "").trim();
  var capsolverKey = (settings.capsolver_api_key || process.env.CAPSOLVER_API_KEY || "").trim();
  var pageUrl = page.url();

  // Sitekey'i temizle - boş string, undefined, null kontrolü
  var sitekey = (captchaInfo.sitekey || "").trim();
  captchaInfo.sitekey = sitekey || null;

  console.log("[CAPTCHA] Tespit edildi: " + captchaInfo.type + " | sitekey: " + (sitekey || "YOK") + " | provider: " + provider);
  await supabaseInsertLog("CAPTCHA tespit edildi: " + captchaInfo.type + " | sitekey: " + (sitekey ? sitekey.slice(0,20) + "..." : "YOK") + " (provider: " + provider + ")", "info");

  if (!sitekey) {
    if (captchaInfo.type === "recaptcha_v2" && captchaInfo.hasImageGrid) {
      await supabaseInsertLog("reCAPTCHA image-grid açık ama sitekey bulunamadı, API çağrısı atlanıyor", "warning");
    } else if (captchaInfo.type === "hcaptcha" && captchaInfo.hasImageGrid) {
      await supabaseInsertLog("hCaptcha image-grid açık ama sitekey bulunamadı, yanlış provider çağrısı engellendi", "warning");
    } else {
      await supabaseInsertLog("CAPTCHA sitekey bulunamadı (googlekey eksik), API çağrısı yapılmıyor", "warning");
    }
    return false;
  }

  // Turnstile is handled by puppeteer-real-browser's built-in turnstile solver
  if (captchaInfo.type === "turnstile") {
    await supabaseInsertLog("Turnstile: puppeteer-real-browser otomatik çözer, bekleniyor...", "info");
    await new Promise(function(r) { setTimeout(r, 5000); });
    return true;
  }

  var token = null;

  try {
    if (captchaInfo.type === "recaptcha_v2") {
      if (!captchaInfo.sitekey) {
        await supabaseInsertLog("reCAPTCHA challenge tespit edildi ama sitekey çözülemedi", "error");
        return false;
      }
      if (provider === "capsolver" && capsolverKey) {
        token = await solveRecaptchaWithCapsolver(capsolverKey, captchaInfo.sitekey, pageUrl);
      } else if (provider === "2captcha" && twoCaptchaKey) {
        token = await solveRecaptchaWith2Captcha(twoCaptchaKey, captchaInfo.sitekey, pageUrl);
      } else if (provider === "auto") {
        if (capsolverKey) {
          try { token = await solveRecaptchaWithCapsolver(capsolverKey, captchaInfo.sitekey, pageUrl); } catch (e) {
            console.log("[CAPTCHA] Capsolver başarısız, 2captcha deneniyor: " + e.message);
            if (twoCaptchaKey) token = await solveRecaptchaWith2Captcha(twoCaptchaKey, captchaInfo.sitekey, pageUrl);
          }
        } else if (twoCaptchaKey) {
          token = await solveRecaptchaWith2Captcha(twoCaptchaKey, captchaInfo.sitekey, pageUrl);
        }
      }
    } else if (captchaInfo.type === "hcaptcha") {
      if (provider === "capsolver" && capsolverKey) {
        token = await solveHCaptchaWithCapsolver(capsolverKey, captchaInfo.sitekey, pageUrl);
      } else if (provider === "2captcha" && twoCaptchaKey) {
        token = await solveHCaptchaWith2Captcha(twoCaptchaKey, captchaInfo.sitekey, pageUrl);
      } else if (provider === "auto") {
        if (capsolverKey) {
          try { token = await solveHCaptchaWithCapsolver(capsolverKey, captchaInfo.sitekey, pageUrl); } catch (e) {
            if (twoCaptchaKey) token = await solveHCaptchaWith2Captcha(twoCaptchaKey, captchaInfo.sitekey, pageUrl);
          }
        } else if (twoCaptchaKey) {
          token = await solveHCaptchaWith2Captcha(twoCaptchaKey, captchaInfo.sitekey, pageUrl);
        }
      }
    }
  } catch (err) {
    console.error("[CAPTCHA] Çözme hatası:", err.message);
    await supabaseInsertLog("CAPTCHA çözme hatası: " + err.message, "error");
    return false;
  }

  if (!token) {
    await supabaseInsertLog("CAPTCHA: API key tanımsız veya provider eşleşmiyor", "warning");
    return false;
  }

  // Inject token and try to submit
  await injectCaptchaToken(page, captchaInfo.type, token);
  await new Promise(function(r) { setTimeout(r, 1500); });

  // Try clicking submit after CAPTCHA solve
  try {
    await page.evaluate(function() {
      var submitBtns = document.querySelectorAll('button[type="submit"], input[type="submit"], button.submit, #submit, .btn-submit');
      for (var i = 0; i < submitBtns.length; i++) {
        var rect = submitBtns[i].getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) { submitBtns[i].click(); return; }
      }
    });
  } catch (e) {}

  await supabaseInsertLog("CAPTCHA token enjekte edildi, form gönderildi", "success");
  return true;
}

// ==================== TEMP PROFILE (VFS'den) ====================
const path = require("path");
const fs = require("fs");
const os = require("os");

function createTempUserDataDir() {
  var dir = path.join(os.tmpdir(), "quiz-chrome-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  console.log("[BROWSER] 🧹 Temiz profil: " + dir);
  return dir;
}

function cleanupUserDataDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log("[BROWSER] 🗑 Profil temizlendi: " + dir);
    }
  } catch (e) {
    console.warn("[BROWSER] Profil temizleme hatası: " + e.message);
  }
}

// ==================== PROXY REGION ROTATION (VFS'den) ====================
var QUIZ_PROXY_REGIONS_BY_COUNTRY = {
  TR: ["ankara", "istanbul", "izmir", "bursa", "antalya", "adana", "konya"],
  US: ["new.york", "los.angeles", "chicago", "houston", "phoenix", "philadelphia"],
  GB: ["london", "manchester", "birmingham", "leeds", "glasgow"],
  DE: ["berlin", "munich", "hamburg", "frankfurt", "cologne"],
  FR: ["paris", "lyon", "marseille", "toulouse", "nice", "bordeaux"],
  NL: ["amsterdam", "rotterdam", "the.hague", "utrecht", "eindhoven"],
  PL: ["warsaw", "krakow", "wroclaw", "gdansk", "poznan", "lodz"],
  IT: ["rome", "milan", "naples", "turin", "florence"],
  DK: ["copenhagen", "aarhus", "odense", "aalborg"],
};
var quizRegionIndex = -1;

function getQuizFallbackRegion(countryCode) {
  var cc = (countryCode || "US").toUpperCase();
  var regions = QUIZ_PROXY_REGIONS_BY_COUNTRY[cc] || QUIZ_PROXY_REGIONS_BY_COUNTRY.US;
  quizRegionIndex = (quizRegionIndex + 1) % regions.length;
  var region = regions[quizRegionIndex];
  console.log("[PROXY] 🏙 Fallback bölge rotasyonu: " + region + " (" + (quizRegionIndex + 1) + "/" + regions.length + ") [" + cc + "]");
  return region;
}

// ==================== ANTİ-DETECTİON HELPERS (VFS'den) ====================

function quizDelay(min, max) {
  if (!min) min = 2000;
  if (!max) max = 5000;
  return new Promise(function(r) { setTimeout(r, Math.floor(Math.random() * (max - min) + min)); });
}

// İnsan benzeri scroll
async function humanScroll(page) {
  try {
    var scrollAmount = Math.floor(Math.random() * 300) + 100;
    var direction = Math.random() > 0.3 ? 1 : -1;
    await page.evaluate(function(amount) { window.scrollBy({ top: amount, behavior: 'smooth' }); }, scrollAmount * direction);
    await quizDelay(800, 2000);
  } catch (e) {}
}

// İnsan benzeri idle (okuyormuş gibi)
async function humanIdle(min, max) {
  if (!min) min = 2000;
  if (!max) max = 6000;
  var wait = Math.floor(Math.random() * (max - min) + min);
  await new Promise(function(r) { setTimeout(r, wait); });
}

// İnsan benzeri mouse hareketi
async function humanMove(page) {
  try {
    var vp = page.viewport();
    var w = (vp && vp.width) || 1366;
    var h = (vp && vp.height) || 768;
    var moves = Math.floor(Math.random() * 3) + 1;
    for (var i = 0; i < moves; i++) {
      var x = Math.floor(Math.random() * w * 0.6 + w * 0.2);
      var y = Math.floor(Math.random() * h * 0.6 + h * 0.2);
      await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 20 + 10) });
      await quizDelay(300, 800);
    }
    if (Math.random() > 0.5) await humanScroll(page);
  } catch (e) {}
}

// İnsan benzeri typing — typo simülasyonu ile
async function humanType(page, selector, text) {
  if (!text && text !== 0) return false;
  try {
    var element = await page.$(selector);
    if (!element) return false;

    await humanIdle(800, 2000);
    await element.click({ clickCount: 1 });
    await quizDelay(400, 900);

    // Önce alanı temizle
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await quizDelay(300, 700);

    for (var i = 0; i < String(text).length; i++) {
      var ch = String(text)[i];
      var keyDelay = Math.floor(Math.random() * 230) + 120;
      await page.keyboard.type(ch, { delay: keyDelay });
      // Rastgele duraklamalar
      if (Math.random() < 0.2) await quizDelay(400, 1500);
      // Typo simülasyonu (düşük olasılık)
      if (Math.random() < 0.03 && String(text).length > 5) {
        var wrongKey = String.fromCharCode(97 + Math.floor(Math.random() * 26));
        await page.keyboard.type(wrongKey, { delay: keyDelay });
        await quizDelay(300, 800);
        await page.keyboard.press("Backspace");
        await quizDelay(200, 500);
      }
    }
    await quizDelay(400, 1000);

    // React/Angular uyumluluğu
    await page.evaluate(function(sel, value) {
      var el = document.querySelector(sel);
      if (!el) return;
      var proto = Object.getPrototypeOf(el);
      var descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (descriptor && descriptor.set) descriptor.set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }, selector, String(text));

    return true;
  } catch (e) {
    return false;
  }
}

// ==================== MOTOR 1: PUPPETEER + GEMINI VISION ====================

async function runGeminiEngine(url, account, settings) {
  const { connect } = require("puppeteer-real-browser");
  var browser = null;
  var page = null;

  var geminiApiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || "";
  if (!geminiApiKey) throw new Error("Gemini API key bulunamadı! bot_settings'e gemini_api_key ekleyin.");

  var args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1920,1080",
    "--start-maximized",
  ];

  var useProxy = settings.quiz_proxy_enabled !== "false";
  var proxyConfig = undefined;

  if (useProxy) {
    var proxyHost = settings.proxy_host || "core-residential.evomi-proxy.com";
    var proxyPort = settings.proxy_port || "1000";
    var proxyUser = settings.quiz_proxy_username || settings.proxy_username || process.env.PROXY_USERNAME || "";
    var proxyPass = settings.quiz_proxy_password || settings.proxy_password || process.env.PROXY_PASSWORD || "";

    if (!proxyUser || !proxyPass) {
      throw new Error("Proxy aktif ama kullanıcı adı/şifre eksik. bot_settings'e proxy_username ve proxy_password ekleyin.");
    }

    var country = (settings.quiz_proxy_country || settings.proxy_country || "US").toLowerCase();
    var sessionId = Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 8) || "quiz0001";

    // Dinamik bölge rotasyonu: Evomi API'den şehir listesi çek, rastgele seç
    var region = "";
    try {
      var evomiApiKey = settings.evomi_api_key || "";
      if (evomiApiKey) {
        var fetch2 = (await import("node-fetch")).default;
        var evomiRes = await fetch2("https://api.evomi.com/public/settings", {
          headers: { "x-apikey": evomiApiKey },
        });
        if (evomiRes.ok) {
          var evomiData = await evomiRes.json();
          var product = "rpc";
          if (proxyHost.includes("premium")) product = "rp";
          var productData = evomiData?.data?.[product];
          var allCities = productData?.cities?.data || [];
          var countryCities = allCities.filter(function(c) { return (c.countryCode || "").toUpperCase() === country.toUpperCase(); });
          if (countryCities.length > 0) {
            var randomCity = countryCities[Math.floor(Math.random() * countryCities.length)];
            region = (randomCity.city || randomCity.name || "").toLowerCase();
            console.log("[PROXY] Evomi API: " + countryCities.length + " şehir bulundu, rastgele seçim: " + region);
          } else {
            console.log("[PROXY] Evomi API: " + country.toUpperCase() + " için şehir bulunamadı, rastgele IP kullanılacak");
          }
        }
      }
    } catch (evomiErr) {
      console.log("[PROXY] Evomi bölge çekme hatası: " + evomiErr.message + " — rastgele IP kullanılacak");
    }

    // Fallback: settings'den gelen sabit bölge
    if (!region) {
      region = (settings.quiz_proxy_region || "").trim().toLowerCase();
    }

    var suffix = "_country-" + country;
    if (region) suffix += "_city-" + region;
    suffix += "_session-" + sessionId;

    proxyPass = proxyPass.split("_country-")[0].split("_session-")[0].split("_city-")[0] + suffix;

    proxyConfig = {
      host: proxyHost,
      port: proxyPort,
      username: proxyUser,
      password: proxyPass,
    };

    console.log("[GEMINI] Proxy: " + proxyHost + ":" + proxyPort + " | ülke=" + country + " | şehir=" + (region || "rastgele") + " | session=" + sessionId);
    await supabaseInsertLog("Proxy aktif: " + proxyHost + ":" + proxyPort + " | ülke=" + country + " | şehir=" + (region || "rastgele"), "info");
  }

  var connectOptions = {
    headless: false,
    args: args,
    turnstile: true,
    disableXvfb: true,
  };

  if (proxyConfig) {
    connectOptions.proxy = proxyConfig;
  }

  var launched = await connect(connectOptions);
  browser = launched.browser;
  page = launched.page;

  if (!page) throw new Error("Tarayıcı sekmesi oluşturulamadı");

  try {
    await page.setViewport({ width: 1920, height: 1080 });

    // İlk sayfa yüklemeden önce insan benzeri hareket
    await humanMove(page);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await supabaseInsertLog("Sayfa yüklendi: " + url, "info");

    // Sayfa yüklendikten sonra insan benzeri davranış
    await humanIdle(1500, 3000);
    await humanMove(page);
    await humanScroll(page);

    var maxSteps = 30;
    var stepCount = 0;
    var recentActions = [];

    // Determine which vision function to use
    var engineType = settings.quiz_engine || "gemini";
    var visionFn;
    if (engineType === "lovable_ai") {
      var lovableKey = settings.lovable_api_key || process.env.LOVABLE_API_KEY || "";
      if (!lovableKey) throw new Error("Lovable API key bulunamadı! bot_settings'e lovable_api_key ekleyin.");
      visionFn = function(ss, url, acc, st, ra) { return askLovableAIVision(lovableKey, ss, url, acc, st, ra); };
    } else if (engineType === "openai") {
      var openaiKey = settings.openai_api_key || process.env.OPENAI_API_KEY || "";
      if (!openaiKey) throw new Error("OpenAI API key bulunamadı! bot_settings'e openai_api_key ekleyin.");
      visionFn = function(ss, url, acc, st, ra) { return askOpenAIVision(openaiKey, ss, url, acc, st, ra); };
    } else {
      visionFn = function(ss, url, acc, st, ra) { return askGeminiVision(geminiApiKey, ss, url, acc, st, ra); };
    }

    while (stepCount < maxSteps) {
      stepCount++;
      console.log("[" + engineType.toUpperCase() + "] Adım " + stepCount + "/" + maxSteps);

      // === CAPTCHA AUTO-DETECTION ===
      try {
        var captchaSolved = await tryAutoSolveCaptcha(page, settings);
        if (captchaSolved) {
          console.log("[CAPTCHA] Otomatik çözüldü, 3s bekleniyor...");
          await quizDelay(2000, 4000);
          continue;
        }
      } catch (captchaErr) {
        console.error("[CAPTCHA] Oto-çözme hatası:", captchaErr.message);
        await supabaseInsertLog("CAPTCHA oto-çözme hatası: " + captchaErr.message, "warning");
      }

      // Her adımda rastgele insan benzeri hareket
      if (Math.random() > 0.4) await humanMove(page);

      var screenshot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 70 });
      var currentUrl = page.url();
      var action = await visionFn(screenshot, currentUrl, account, stepCount, recentActions);

      if (!action) {
        console.log("[" + engineType.toUpperCase() + "] AI cevap vermedi, durduruluyor");
        await supabaseInsertLog("AI cevap vermedi, durduruluyor", "warning");
        break;
      }

      var actionSummary = [action.action || "?", action.selector || action.value || action.description || ""].join(": ");
      recentActions.push(actionSummary);
      if (recentActions.length > 5) recentActions.shift();

      await supabaseInsertLog("Adım " + stepCount + ": " + action.description, "info");

      if (action.done) {
        console.log("[GEMINI] Görev tamamlandı: " + action.description);
        await supabaseInsertLog("Görev tamamlandı: " + action.description, "success");
        break;
      }

      try {
        await executeAction(page, action);
        // İnsan benzeri bekleme — sabit değil rastgele
        await humanIdle(2000, 4000);
        // Bazen scroll yap
        if (Math.random() > 0.6) await humanScroll(page);
      } catch (actionErr) {
        console.error("[GEMINI] Aksiyon hatası:", actionErr.message);
        await supabaseInsertLog("Aksiyon hatası: " + actionErr.message, "warning");
      }
    }

    var finalScreenshot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 70 });
    await supabaseInsertLog("Quiz tamamlandı - " + stepCount + " adım", "success", "data:image/jpeg;base64," + finalScreenshot);
  } catch (err) {
    console.error("[GEMINI] Hata:", err.message);
    await supabaseInsertLog("Hata: " + err.message, "error");
    throw err;
  } finally {
    console.log("[GEMINI] Tarayıcı açık bırakıldı (VNC)");
    await supabaseInsertLog("Tarayıcı açık bırakıldı (VNC izleme)", "info");
  }
}

async function askGeminiVision(apiKey, screenshotBase64, currentUrl, account, step, recentActions) {
  var fetch = (await import("node-fetch")).default;
  var recentText = (recentActions && recentActions.length > 0)
    ? recentActions.map(function(a, i) { return (i + 1) + ". " + a; }).join("\n")
    : "Yok";

  var systemPrompt = `Sen bir web otomasyon asistanısın. Ekran görüntüsünü analiz edip SADECE TEK BİR aksiyon belirle.

GÖREV: Anket sitesine gir, giriş yap, anketleri bul ve çöz.

HESAP BİLGİLERİ:
- Email: ${account.email}
- Şifre: ${account.password}

SON DENEMELER:
${recentText}

KRİTİK KURALLAR:
1. Aynı butona tekrar tekrar basma. Son 2-3 adım aynıysa FARKLI bir aksiyon seç.
2. Eğer 'Log In' tıklandıysa ama sayfa değişmediyse sonraki adım email alanını doldurmak, giriş modalını açmak veya login sayfasına gitmek olmalı.
3. Çerez popup varsa önce onu kapat.
4. Giriş gerekiyorsa email/şifre ile giriş yap. Google/Facebook KULLANMA.
5. Sadece ekranda gerçekten görünen öğeleri hedefle.
6. JSON dışında hiçbir şey yazma.

JSON formatı:
{
  "action": "click" | "type" | "scroll" | "wait" | "navigate",
  "selector": "Kısa hedef metni veya CSS selector",
  "value": "type/navigate için değer",
  "description": "çok kısa açıklama",
  "done": false
}`;

  var body = {
    contents: [{
      parts: [
        { text: "Mevcut URL: " + currentUrl + "\nAdım: " + step + "\n\nEkran görüntüsünü analiz et ve bir sonraki aksiyonu belirle." },
        { inlineData: { mimeType: "image/jpeg", data: screenshotBase64 } }
      ]
    }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024
    }
  };

  var maxRetries = 3;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (res.status === 429) {
        var waitSec = (attempt + 1) * 10;
        console.log("[GEMINI] Rate limit (429), " + waitSec + "s bekleniyor... (deneme " + (attempt + 1) + "/" + maxRetries + ")");
        await supabaseInsertLog("Rate limit, " + waitSec + "s bekleniyor (deneme " + (attempt + 1) + ")", "warning");
        await new Promise(function(r) { setTimeout(r, waitSec * 1000); });
        continue;
      }

      if (!res.ok) {
        var errText = await res.text();
        console.error("[GEMINI] API hata:", res.status, errText);
        throw new Error("Gemini API hata: " + res.status);
      }

      var data = await res.json();
      var text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!text || !text.trim()) {
        await supabaseInsertLog("Gemini boş cevap döndürdü", "warning");
        return null;
      }

      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (parseErr) {
          await supabaseInsertLog("Gemini JSON parse hatası: " + String(parseErr.message || parseErr).slice(0, 120), "warning");
        }
      }

      await supabaseInsertLog("Gemini parse edilemeyen cevap: " + text.slice(0, 180), "warning");
      return null;
    } catch (err) {
      console.error("[GEMINI] Vision hata:", err.message);
      await supabaseInsertLog("Gemini vision hata: " + err.message, "warning");
      if (attempt < maxRetries - 1) {
        await new Promise(function(r) { setTimeout(r, 5000); });
        continue;
      }
      return null;
    }
  }
  return null;
}

// ==================== LOVABLE AI VISION ====================

async function askLovableAIVision(apiKey, screenshotBase64, currentUrl, account, step, recentActions) {
  var fetch = (await import("node-fetch")).default;
  var recentText = (recentActions && recentActions.length > 0)
    ? recentActions.map(function(a, i) { return (i + 1) + ". " + a; }).join("\n")
    : "Yok";

  var systemPrompt = `Sen bir web otomasyon asistanısın. Ekran görüntüsünü analiz edip SADECE TEK BİR aksiyon belirle.

GÖREV: Anket sitesine gir, giriş yap, anketleri bul ve çöz.

HESAP BİLGİLERİ:
- Email: ${account.email}
- Şifre: ${account.password}

SON DENEMELER:
${recentText}

KRİTİK KURALLAR:
1. Aynı butona tekrar tekrar basma. Son 2-3 adım aynıysa FARKLI bir aksiyon seç.
2. Eğer 'Log In' tıklandıysa ama sayfa değişmediyse sonraki adım email alanını doldurmak olmalı.
3. Çerez popup varsa önce onu kapat.
4. Giriş gerekiyorsa email/şifre ile giriş yap. Google/Facebook KULLANMA.
5. Sadece ekranda gerçekten görünen öğeleri hedefle.
6. JSON dışında hiçbir şey yazma.

JSON formatı:
{
  "action": "click" | "type" | "scroll" | "wait" | "navigate",
  "selector": "Kısa hedef metni veya CSS selector",
  "value": "type/navigate için değer",
  "description": "çok kısa açıklama",
  "done": false
}`;

  var body = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Mevcut URL: " + currentUrl + "\nAdım: " + step + "\n\nEkran görüntüsünü analiz et ve bir sonraki aksiyonu belirle." },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + screenshotBase64 } }
        ]
      }
    ],
    max_tokens: 1024,
    temperature: 0.2
  };

  var maxRetries = 3;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (res.status === 429) {
        var waitSec = (attempt + 1) * 10;
        console.log("[LOVABLE-AI] Rate limit (429), " + waitSec + "s bekleniyor...");
        await supabaseInsertLog("Rate limit, " + waitSec + "s bekleniyor (deneme " + (attempt + 1) + ")", "warning");
        await new Promise(function(r) { setTimeout(r, waitSec * 1000); });
        continue;
      }
      if (res.status === 402) {
        throw new Error("Lovable AI kredisi bitti! Settings > Workspace > Usage'dan kredi ekleyin.");
      }
      if (!res.ok) {
        var errText = await res.text();
        console.error("[LOVABLE-AI] API hata:", res.status, errText);
        throw new Error("Lovable AI hata: " + res.status);
      }

      var data = await res.json();
      var text = data.choices?.[0]?.message?.content || "";

      if (!text || !text.trim()) {
        await supabaseInsertLog("Lovable AI boş cevap döndürdü", "warning");
        return null;
      }

      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (parseErr) {
          await supabaseInsertLog("Lovable AI JSON parse hatası: " + String(parseErr.message).slice(0, 120), "warning");
        }
      }
      await supabaseInsertLog("Lovable AI parse edilemeyen cevap: " + text.slice(0, 180), "warning");
      return null;
    } catch (err) {
      console.error("[LOVABLE-AI] Vision hata:", err.message);
      await supabaseInsertLog("Lovable AI hata: " + err.message, "warning");
      if (attempt < maxRetries - 1) { await new Promise(function(r) { setTimeout(r, 5000); }); continue; }
      return null;
    }
  }
  return null;
}

// ==================== OPENAI VISION ====================

async function askOpenAIVision(apiKey, screenshotBase64, currentUrl, account, step, recentActions) {
  var fetch = (await import("node-fetch")).default;
  var recentText = (recentActions && recentActions.length > 0)
    ? recentActions.map(function(a, i) { return (i + 1) + ". " + a; }).join("\n")
    : "Yok";

  var systemPrompt = `Sen bir web otomasyon asistanısın. Ekran görüntüsünü analiz edip SADECE TEK BİR aksiyon belirle.

GÖREV: Anket sitesine gir, giriş yap, anketleri bul ve çöz.

HESAP BİLGİLERİ:
- Email: ${account.email}
- Şifre: ${account.password}

SON DENEMELER:
${recentText}

KRİTİK KURALLAR:
1. Aynı butona tekrar tekrar basma.
2. Çerez popup varsa önce kapat.
3. Email/şifre ile giriş yap. Google/Facebook KULLANMA.
4. JSON dışında hiçbir şey yazma.

JSON formatı:
{
  "action": "click" | "type" | "scroll" | "wait" | "navigate",
  "selector": "Kısa hedef metni veya CSS selector",
  "value": "type/navigate için değer",
  "description": "çok kısa açıklama",
  "done": false
}`;

  var body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Mevcut URL: " + currentUrl + "\nAdım: " + step + "\nAnaliz et ve sonraki aksiyonu belirle." },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + screenshotBase64 } }
        ]
      }
    ],
    max_tokens: 1024,
    temperature: 0.2
  };

  var maxRetries = 3;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (res.status === 429) {
        var waitSec = (attempt + 1) * 10;
        console.log("[OPENAI] Rate limit (429), " + waitSec + "s bekleniyor...");
        await supabaseInsertLog("OpenAI rate limit, " + waitSec + "s bekleniyor", "warning");
        await new Promise(function(r) { setTimeout(r, waitSec * 1000); });
        continue;
      }
      if (!res.ok) {
        var errText = await res.text();
        throw new Error("OpenAI API hata: " + res.status + " - " + errText.slice(0, 200));
      }

      var data = await res.json();
      var text = data.choices?.[0]?.message?.content || "";

      if (!text || !text.trim()) return null;

      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (e) {
          await supabaseInsertLog("OpenAI JSON parse hatası", "warning");
        }
      }
      return null;
    } catch (err) {
      console.error("[OPENAI] Vision hata:", err.message);
      await supabaseInsertLog("OpenAI hata: " + err.message, "warning");
      if (attempt < maxRetries - 1) { await new Promise(function(r) { setTimeout(r, 5000); }); continue; }
      return null;
    }
  }
  return null;
}

function buildClickSearchTexts(action) {
  var items = [];

  function pushText(value) {
    if (!value) return;
    var normalized = String(value).trim();
    if (!normalized) return;
    if (items.indexOf(normalized) === -1) items.push(normalized);

    var cleaned = normalized
      .replace(/["'“”‘’]/g, " ")
      .replace(/\b(butonuna|butonu|button|linki|link|tıkla|tikla|click|için|icin|yap|bas|press)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned && items.indexOf(cleaned) === -1) items.push(cleaned);
  }

  pushText(action.selector);
  pushText(action.description);

  var source = [action.selector, action.description].filter(Boolean).join(" ");
  var matches = source.match(/["'“”‘’]([^"'“”‘’]{2,60})["'“”‘’]/g) || [];
  for (var i = 0; i < matches.length; i++) {
    pushText(matches[i].replace(/^["'“”‘’]|["'“”‘’]$/g, ""));
  }

  return items;
}

async function executeAction(page, action) {
  function looksLikeCssSelector(value) {
    return !!value && /^[.#\[]|^[a-z]+[.#\[]/i.test(value);
  }

  async function getCandidateFrames() {
    var frames = [page];
    try {
      var childFrames = page.frames();
      for (var i = 0; i < childFrames.length; i++) {
        if (frames.indexOf(childFrames[i]) === -1) frames.push(childFrames[i]);
      }
    } catch (e) {}
    return frames;
  }

  async function tryDirectClick(targetPage, selector) {
    if (!looksLikeCssSelector(selector)) return false;
    try {
      await targetPage.click(selector);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function trySmartClick(targetPage, candidates) {
    return await targetPage.evaluate(function(candidates) {
      function normalize(text) {
        return String(text || "")
          .toLowerCase()
          .replace(/["'“”‘’]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function isVisible(el) {
        var rect = el.getBoundingClientRect();
        var style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }

      function isCaptchaLike(el) {
        var cls = normalize(el.className || "");
        var aria = normalize(el.getAttribute("aria-label") || "");
        var title = normalize(el.getAttribute("title") || "");
        var data = normalize(el.getAttribute("data-testid") || "");
        var combined = [cls, aria, title, data].join(" ");
        return /(challenge|captcha|tile|grid|traffic|crosswalk|bus|car|bicycle|hydrant|motorcycle)/.test(combined);
      }

      var phrases = (candidates || []).map(normalize).filter(Boolean);
      var weakWords = { button: true, buton: true, tıkla: true, tikla: true, click: true, link: true, için: true, icin: true, yap: true, bas: true, press: true, kareye: true, kare: true, olduğu: true };
      var words = [];
      for (var p = 0; p < phrases.length; p++) {
        var parts = phrases[p].split(" ");
        for (var w = 0; w < parts.length; w++) {
          var word = parts[w];
          if (word.length > 1 && !weakWords[word] && words.indexOf(word) === -1) words.push(word);
        }
      }

      var selectors = [
        "button, a, input[type=submit], input[type=button], [role=button], label, [onclick], [tabindex]",
        "div, span"
      ];
      var elements = Array.from(document.querySelectorAll(selectors.join(","))).filter(isVisible);

      var best = null;
      var bestScore = 0;
      var bestText = "";

      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var text = normalize(el.textContent || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "");
        var score = 0;

        if (isCaptchaLike(el)) score += 35;

        for (var j = 0; j < phrases.length; j++) {
          var phrase = phrases[j];
          if (!phrase) continue;
          if (text && text === phrase) score = Math.max(score, 100);
          else if (text && (text.includes(phrase) || phrase.includes(text))) score = Math.max(score, 80);
        }

        if (words.length > 0) {
          var matched = 0;
          var blob = [text, normalize(el.className || ""), normalize(el.getAttribute("aria-label") || ""), normalize(el.getAttribute("title") || "")].join(" ");
          for (var k = 0; k < words.length; k++) {
            if (blob.includes(words[k])) matched++;
          }
          if (matched > 0) score = Math.max(score, matched * 20);
        }

        if (score > bestScore) {
          best = el;
          bestScore = score;
          bestText = text || normalize(el.className || "");
        }
      }

      if (best && bestScore >= 40) {
        best.click();
        return { clicked: true, matchedText: bestText, score: bestScore };
      }

      return { clicked: false, matchedText: bestText, score: bestScore };
    }, candidates);
  }

  switch (action.action) {
    case "click": {
      var frames = await getCandidateFrames();
      for (var f = 0; f < frames.length; f++) {
        if (await tryDirectClick(frames[f], action.selector)) return;
      }

      var searchTexts = buildClickSearchTexts(action);
      for (var i = 0; i < frames.length; i++) {
        try {
          var clickResult = await trySmartClick(frames[i], searchTexts);
          if (clickResult.clicked) return;
        } catch (e) {}
      }

      throw new Error("Tıklanabilir öğe bulunamadı: " + searchTexts.join(" | "));
    }

    case "type": {
      var typeFrames = await getCandidateFrames();
      var desc = (action.description || action.selector || "").toLowerCase();
      var isPasswordField = /password|şifre|sifre|parola/i.test(desc);
      var isEmailField = /email|e-posta|eposta|mail/i.test(desc);

      // Strategy 1: Try CSS selector click + keyboard type
      for (var tf = 0; tf < typeFrames.length; tf++) {
        try {
          await typeFrames[tf].click(action.selector);
          await typeFrames[tf].evaluate(function(sel) {
            var el = document.querySelector(sel);
            if (el) el.value = "";
          }, action.selector);
          for (var c = 0; c < action.value.length; c++) {
            await page.keyboard.type(action.value[c]);
            await new Promise(function(resolve) { setTimeout(resolve, 30 + Math.random() * 70); });
          }
          return;
        } catch (typeErr) {}
      }

      // Strategy 2: Smart field detection - find by type/placeholder/label
      for (var tfi = 0; tfi < typeFrames.length; tfi++) {
        try {
          var typed = await typeFrames[tfi].evaluate(function(val, isPass, isEmail) {
            function setNativeValue(el, value) {
              var valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
              if (valueSetter) valueSetter.call(el, value);
              else el.value = value;
              el.dispatchEvent(new Event("input", {bubbles: true}));
              el.dispatchEvent(new Event("change", {bubbles: true}));
            }

            var inputs = document.querySelectorAll("input, textarea");
            for (var i = 0; i < inputs.length; i++) {
              var inp = inputs[i];
              var placeholder = (inp.placeholder || "").toLowerCase();
              var label = (inp.getAttribute("aria-label") || "").toLowerCase();
              var name = (inp.name || "").toLowerCase();
              var id = (inp.id || "").toLowerCase();
              var type = (inp.type || "").toLowerCase();
              var rect = inp.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;

              var matchesPassword = type === "password" || placeholder.includes("password") || label.includes("password") || name.includes("password") || id.includes("password") || placeholder.includes("şifre") || placeholder.includes("parola");
              var matchesEmail = type === "email" || placeholder.includes("email") || label.includes("email") || name.includes("email") || id.includes("email");

              if (isPass && matchesPassword) {
                inp.focus();
                setNativeValue(inp, val);
                return true;
              }
              if (isEmail && matchesEmail) {
                inp.focus();
                setNativeValue(inp, val);
                return true;
              }
            }
            return false;
          }, action.value, isPasswordField, isEmailField);
          if (typed) return;
        } catch (e) {}
      }

      // Strategy 3: Click the field by smart match, then keyboard type
      for (var tf2 = 0; tf2 < typeFrames.length; tf2++) {
        try {
          var selector = isPasswordField ? 'input[type="password"]' : isEmailField ? 'input[type="email"], input[name*="email"], input[placeholder*="email" i]' : null;
          if (selector) {
            await typeFrames[tf2].click(selector);
            await typeFrames[tf2].evaluate(function(sel) {
              var el = document.querySelector(sel);
              if (el) el.value = "";
            }, selector);
            await new Promise(function(r) { setTimeout(r, 200); });
            for (var ch = 0; ch < action.value.length; ch++) {
              await page.keyboard.type(action.value[ch]);
              await new Promise(function(r) { setTimeout(r, 30 + Math.random() * 70); });
            }
            return;
          }
        } catch (e) {}
      }
      break;
    }

    case "scroll":
      await page.evaluate(function() { window.scrollBy(0, 400); });
      break;

    case "navigate":
      if (action.value) await page.goto(action.value, { waitUntil: "networkidle2", timeout: 20000 });
      break;

    case "wait":
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });
      break;
  }
}

// ==================== MOTOR 2: BROWSER USE CLOUD ====================

async function runBrowserUseEngine(url, account, settings) {
  var fetch = (await import("node-fetch")).default;
  var apiKey = settings.browser_use_api_key || process.env.BROWSER_USE_API_KEY || "";
  if (!apiKey) throw new Error("Browser Use API key bulunamadı!");

  var proxyCountry = null;
  if (settings.quiz_proxy_enabled !== "false") {
    proxyCountry = (settings.quiz_proxy_country || settings.proxy_country || "US").toLowerCase();
  }

  var taskPrompt = buildTaskPrompt(url, account);
  await supabaseInsertLog("Browser Use task oluşturuluyor: " + url, "info");

  var body = {
    task: taskPrompt,
    llm: "gemini-2.5-flash",
    startUrl: url,
    maxSteps: 100,
    vision: true,
    highlightElements: true,
    sessionSettings: { browserScreenWidth: 1920, browserScreenHeight: 1080 },
  };
  if (proxyCountry) body.sessionSettings.proxyCountryCode = proxyCountry;

  var res = await fetch(BROWSER_USE_API + "/tasks", {
    method: "POST",
    headers: { "X-Browser-Use-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error("Browser Use task oluşturulamadı (" + res.status + "): " + errText);
  }

  var data = await res.json();
  await supabaseInsertLog("Browser Use task oluşturuldu: " + data.id, "success");

  // Poll
  var startTime = Date.now();
  var maxWait = 600000;
  while (Date.now() - startTime < maxWait) {
    var statusRes = await fetch(BROWSER_USE_API + "/tasks/" + data.id + "/status", {
      headers: { "X-Browser-Use-API-Key": apiKey },
    });
    if (statusRes.ok) {
      var status = await statusRes.json();
      if (status.status === "finished") {
        await supabaseInsertLog("Task tamamlandı | Başarılı: " + status.isSuccess + " | Maliyet: $" + (status.cost || "?"), status.isSuccess ? "success" : "warning");
        return status;
      }
      if (status.status === "stopped") {
        await supabaseInsertLog("Task durduruldu", "warning");
        return status;
      }
    }
    await new Promise(function(r) { setTimeout(r, 5000); });
  }
  await supabaseInsertLog("Task zaman aşımı", "error");
  return { status: "timeout", isSuccess: false };
}

function buildTaskPrompt(url, account) {
  var host = "";
  try { host = new URL(url).hostname; } catch (e) {}

  return `Sen bir anket çözücü botsun. Adımlar:
1. Çerez popup varsa "Accept All" tıkla
2. Giriş: Email=${account.email} Şifre=${account.password} (Google/Facebook KULLANMA!)
3. Anket sayfasını bul (Surveys/Answer/Earn)
4. Soruları mantıklı cevapla, Next/Continue ile ilerle
5. Max 5 anket çöz
KURALLAR: Sayfadan ayrılma, her cookie popup'ı kapat.`;
}

// ==================== ANA İŞLEM ====================

async function processQuiz(url) {
  try {
    var account = await getLoginAccount();
    if (!account) return;

    var settings = await getSettings();
    var engine = settings.quiz_engine || "gemini";

    console.log("=== Quiz Bot v4.0 — Motor: " + engine.toUpperCase() + " ===");
    console.log("URL: " + url);
    console.log("Hesap: " + account.email);
    await supabaseInsertLog("Quiz başlatılıyor [" + engine + "]: " + url + " | Hesap: " + account.email, "info");

    if (engine === "browser_use") {
      await runBrowserUseEngine(url, account, settings);
    } else {
      // gemini, lovable_ai, openai all use the same Puppeteer engine
      await runGeminiEngine(url, account, settings);
    }

  } catch (err) {
    console.error("Quiz hatası:", err.message);
    await supabaseInsertLog("Hata: " + err.message, "error");
  }
}

// ==================== DB POLLING ====================

async function pollForQuizTasks() {
  var settings = await getSettings();
  var engine = settings.quiz_engine || "gemini";
  var engineLabels = {
    gemini: "Puppeteer + Gemini Vision",
    lovable_ai: "Puppeteer + Lovable AI",
    openai: "Puppeteer + OpenAI GPT-4o-mini",
    browser_use: "Browser Use Cloud"
  };
  var engineLabel = engineLabels[engine] || engine;

  console.log("Quiz bot v5.0 (" + engineLabel + ") başlatıldı - görev bekleniyor...");
  await supabaseInsertLog("Quiz bot v5.0 (" + engineLabel + ") başlatıldı", "info");

  // Motor kontrolü
  var keyChecks = {
    gemini: { key: settings.gemini_api_key || process.env.GEMINI_API_KEY || "", name: "Gemini API key" },
    lovable_ai: { key: settings.lovable_api_key || process.env.LOVABLE_API_KEY || "", name: "Lovable API key" },
    openai: { key: settings.openai_api_key || process.env.OPENAI_API_KEY || "", name: "OpenAI API key" },
    browser_use: { key: settings.browser_use_api_key || process.env.BROWSER_USE_API_KEY || "", name: "Browser Use API key" }
  };
  var check = keyChecks[engine];
  if (check) {
    if (!check.key) {
      await supabaseInsertLog(check.name + " bulunamadı! bot_settings'e ekleyin.", "error");
      return;
    }
    await supabaseInsertLog(check.name + " doğrulandı ✓", "success");
  }

  while (true) {
    try {
      // Motor değişikliği kontrolü
      var freshSettings = await getSettings();
      var currentEngine = freshSettings.quiz_engine || "gemini";
      if (currentEngine !== engine) {
        engine = currentEngine;
        engineLabel = engineLabels[currentEngine] || currentEngine;
        console.log("Motor değişti: " + engineLabel);
        await supabaseInsertLog("Motor değişti: " + engineLabel, "info");
      }

      var tasks = await supabaseGet("link_analyses", "status=eq.quiz_pending&order=created_at.asc&limit=1");
      if (tasks && tasks.length > 0) {
        var task = tasks[0];
        console.log("\nYeni quiz görevi: " + task.url);
        await supabaseUpdate("link_analyses", task.id, { status: "quiz_running" });

        try {
          await processQuiz(task.url);
          await supabaseUpdate("link_analyses", task.id, { status: "quiz_done" });
        } catch (taskErr) {
          console.error("Görev hatası:", taskErr.message);
          await supabaseUpdate("link_analyses", task.id, { status: "quiz_done" });
          await supabaseInsertLog("Görev hatası: " + taskErr.message, "error");
        }
      }
    } catch (err) {
      console.error("Polling hatası:", err.message);
    }
    await new Promise(function(r) { setTimeout(r, 5000); });
  }
}

// ==================== CLI ====================

var args = process.argv.slice(2);
if (args.length > 0) {
  processQuiz(args[0]).then(function() { process.exit(0); });
} else {
  pollForQuizTasks();
}
