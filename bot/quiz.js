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
  var submitUrl = "https://2captcha.com/in.php?key=" + apiKey +
    "&method=userrecaptcha&googlekey=" + sitekey +
    "&pageurl=" + encodeURIComponent(pageUrl) + "&json=1";
  await supabaseInsertLog("2captcha submit: googlekey=" + sitekey + " | pageurl=" + pageUrl.slice(0,60) + " | apiKey=" + apiKey.slice(0,6) + "...", "info");
  var submitRes = await fetch(submitUrl);
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
  await supabaseInsertLog("CAPTCHA tespit edildi: " + captchaInfo.type + " | sitekey: " + (sitekey || "YOK") + " | hasFrame: " + !!captchaInfo.hasFrame + " | hasGrid: " + !!captchaInfo.hasImageGrid + " | provider: " + provider + " | pageUrl: " + pageUrl.slice(0, 80), "info");
  await supabaseInsertLog("CAPTCHA detay: 2captchaKey=" + (twoCaptchaKey ? twoCaptchaKey.slice(0,6) + "..." : "YOK") + " | capsolverKey=" + (capsolverKey ? capsolverKey.slice(0,6) + "..." : "YOK"), "info");

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
  var dir = path.join(os.tmpdir(), "quiz-chrome-temp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  console.log("[BROWSER] 🧹 Temiz profil: " + dir);
  return dir;
}

function getOrCreatePersistentProfile(accountEmail) {
  // Hesap başına kalıcı profil — çerezler, localStorage korunur
  var safeName = (accountEmail || "default").replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0, 50);
  var dir = path.join(os.homedir(), ".quiz-profiles", safeName);
  var isNew = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  if (isNew) {
    console.log("[BROWSER] 🆕 Yeni kalıcı profil oluşturuldu: " + dir);
  } else {
    console.log("[BROWSER] ♻️ Mevcut kalıcı profil kullanılıyor: " + dir);
  }
  return { dir: dir, isNew: isNew };
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

// ==================== SESSION IP BAN & COOLDOWN (VFS'den) ====================
var quizSessionFailCounts = new Map(); // sessionId -> failCount
var quizSessionBannedUntil = new Map(); // sessionId -> timestamp
var quizAccountCooldowns = new Map(); // accountId -> timestamp
var QUIZ_SESSION_MAX_FAILS = 3;
var QUIZ_SESSION_BAN_DURATION_MS = 30 * 60 * 1000; // 30 dk
var QUIZ_ACCOUNT_COOLDOWN_MS = 10 * 60 * 1000; // 10 dk
var quizConsecutiveErrors = 0;
var QUIZ_MAX_CONSECUTIVE_ERRORS = 5;
var QUIZ_COOLDOWN_BACKOFF_MS = 60 * 1000; // Her ardışık hata sonrası +60s

function quizMarkSessionSuccess(sessionId) {
  if (!sessionId) return;
  quizSessionFailCounts.delete(sessionId);
  quizConsecutiveErrors = 0;
  console.log("[SESSION] ✅ Oturum başarılı: " + sessionId);
}

function quizMarkSessionFail(sessionId, reason) {
  if (!sessionId) return;
  var count = (quizSessionFailCounts.get(sessionId) || 0) + 1;
  quizSessionFailCounts.set(sessionId, count);
  quizConsecutiveErrors++;
  console.log("[SESSION] ❌ Oturum hata: " + sessionId + " (" + count + "/" + QUIZ_SESSION_MAX_FAILS + ")" + (reason ? " | " + reason : ""));

  if (count >= QUIZ_SESSION_MAX_FAILS) {
    quizSessionBannedUntil.set(sessionId, Date.now() + QUIZ_SESSION_BAN_DURATION_MS);
    quizSessionFailCounts.delete(sessionId);
    console.log("[SESSION] 🚫 Oturum banlandı (" + (QUIZ_SESSION_BAN_DURATION_MS / 60000) + " dk): " + sessionId);
  }
}

function quizBanSessionImmediately(sessionId, reason) {
  if (!sessionId) return;
  quizSessionBannedUntil.set(sessionId, Date.now() + QUIZ_SESSION_BAN_DURATION_MS);
  quizSessionFailCounts.delete(sessionId);
  quizConsecutiveErrors++;
  console.log("[SESSION] 🚫 Anında ban: " + sessionId + (reason ? " | " + reason : ""));
}

function quizMarkAccountFail(accountId) {
  if (!accountId) return;
  quizAccountCooldowns.set(accountId, Date.now() + QUIZ_ACCOUNT_COOLDOWN_MS);
  console.log("[ACCOUNT] ⏳ Hesap cooldown: " + accountId + " (" + (QUIZ_ACCOUNT_COOLDOWN_MS / 60000) + " dk)");
}

function isQuizAccountInCooldown(accountId) {
  if (!accountId) return false;
  var until = quizAccountCooldowns.get(accountId) || 0;
  if (Date.now() >= until) {
    quizAccountCooldowns.delete(accountId);
    return false;
  }
  return true;
}

function quizIsPageBlocked(pageContent) {
  if (!pageContent || pageContent.trim().length < 100) return true;
  var lower = pageContent.toLowerCase();
  return lower.includes("access denied") ||
    lower.includes("403 forbidden") ||
    lower.includes("blocked") ||
    lower.includes("unusual traffic") ||
    lower.includes("suspicious activity") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit");
}

function getQuizCooldownWait() {
  if (quizConsecutiveErrors <= 1) return 5000;
  var wait = Math.min(quizConsecutiveErrors * QUIZ_COOLDOWN_BACKOFF_MS, 60 * 1000); // max 60s
  return wait;
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

// ==================== ANKET ÇÖZME PROMPT BUILDER ====================

// Old prompt removed — new version is below
function buildSurveySystemPrompt(account, recentText) {
  return `Sen bir web otomasyon asistanısın. Ekran görüntüsünü analiz edip SADECE TEK BİR aksiyon belirle.

GÖREV: Anket sitesine gir, giriş yap, anketleri bul ve SORULARI CEVAPLA.

HESAP BİLGİLERİ:
- Email: ${account.email}
- Şifre: ${account.password}

SON DENEMELER:
${recentText}

🧑 PERSONA (TÜM CEVAPLARDA BU KİŞİLİĞİ KULLAN):
- Adı: Alex Johnson
- Yaş: 29 | Cinsiyet: Male | Medeni hal: Single
- Ülke: United States | Eyalet: California | Şehir: Los Angeles
- ZIP Code: 90210
- Eğitim: Bachelor's Degree (4-year college)
- Meslek: Marketing Coordinator | Sektör: Technology / Software
- Yıllık gelir: $55,000 - $74,999
- Etnik köken: Caucasian / White
- Çocuk: No children
- Telefon: (310) 555-0147
- Araba: 2020 Honda Civic
- Sigorta: BlueCross BlueShield
- Favori markalar: Nike, Apple, Starbucks, Netflix
- Hobiler: hiking, photography, gaming, cooking
- Sosyal medya: Instagram, YouTube, Reddit (günde ~2 saat)
- Alışveriş: Amazon, Target — ayda 3-4 kez online alışveriş

KRİTİK KURALLAR:
1. Aynı butona tekrar tekrar basma. Son 2-3 adım aynıysa FARKLI bir aksiyon seç.
2. Çerez popup varsa önce onu kapat.
3. Giriş gerekiyorsa email/şifre ile giriş yap. Google/Facebook KULLANMA.
4. Sadece ekranda gerçekten görünen öğeleri hedefle.
5. JSON dışında hiçbir şey yazma.
6. ANKET TIKLAMA: Anket listesi gördüğünde İLK ankete tıkla. Kısa metin ver selector olarak.

=== ANKET SORU TİPLERİ VE CEVAPLAMA ===

ÇOKTAN SEÇMELİ (Radio/Checkbox):
- Soruyu oku, persona bilgilerine göre mantıklı/tutarlı cevap ver
- action: "click", selector: seçenek metninin ilk 2-3 kelimesi
- "Prefer not to answer" veya "None of the above" KULLANMA — her zaman gerçekçi cevap ver
- Matris/grid sorusunda: her satır için ayrı tıkla, Agree/Somewhat Agree gibi olumlu seçenekleri tercih et

CHECKBOX LİSTESİ (☐ kare kutucuklar):
- Checkbox'lar KARE kutucuklardır (☐), radio butonlarından farklı
- Birden fazla seçilebilir! En az 1, en fazla 3 tane seç
- Her tıklama ayrı adım: birini tıkla, sonraki adımda diğerini veya Next'e tıkla
- selector: checkbox yanındaki metnin ilk 2-3 kelimesi

AÇIK UÇLU (Textarea/Input):
- action: "type", selector: input veya textarea CSS selectörü
- value: EN AZ 10 kelimelik anlamlı İngilizce cevap
- Kişisel deneyim anlatır gibi yaz: "I recently purchased..." veya "In my experience..."
- ASLA boş bırakma, kısa ve anlamlı yaz

SAYISAL GİRİŞ (Zip Code, Yaş, Gelir vb.):
- ZIP Code sorusu: value: "90210" (Los Angeles CA)
- Yaş sorusu: value: "29"
- Hane halkı sayısı: value: "1"
- Çocuk sayısı: value: "0"
- Gelir: En yakın aralığı seç (55000-74999)
- action: "type", uygun input'a doğru değeri yaz
- ASLA "12345" gibi test/placeholder değerleri KULLANMA!

SLIDER / RANGE:
- action: "move_slider", selector: slider CSS selectörü
- value: "70" (0-100 arası, genelde 60-80)

DROPDOWN / SELECT:
- action: "select_dropdown", selector: select CSS selectörü
- value: seçilecek option metni (kısa)

SÜRÜKLE-BIRAK (Drag and Drop):
- "drag and drop" veya "sürükle" ifadesi gördüğünde:
- action: "drag_drop", selector: sürüklenecek öğenin metni veya CSS selectörü
- value: hedef kutunun CSS selectörü veya açıklaması
- Örnek: Sorudaki doğru cevabı bul (sayı, metin) ve hedef kutuya sürükle
- "drag the number 22" → selector: "22", value: "drop-target"

MANTIK / DOĞRULAMA SORULARI (Attention Check):
- "Please select Strongly Agree" → doğrudan Strongly Agree tıkla
- "What is 2+3?" → 5 yaz veya seç
- "drag the number 22 into the box" → 22'yi sürükle
- Bu soruları DİKKATLİ oku, doğru cevabı ver — yanlış cevap anketten atılma sebebi!

NEXT/CONTINUE/SUBMIT BUTONLARI:
- Soruyu cevapladıktan sonra Next/Continue/Submit butonuna tıkla
- "Please click to continue" + ok (→) butonu → o butona tıkla
- action: "click", selector: "Next" veya "Continue" veya "Submit"

SAYFA KAYDIRMA:
- Soru cevaplandıktan sonra Next butonu görünmüyorsa scroll yap
- action: "scroll"

COMPLETION/DONE SAYFASI:
- "Thank you", "Survey complete", "Congratulations" → action: "next_survey"
- Anket bittiğinde ASLA done: true kullanma

JSON formatı:
{
  "action": "click" | "type" | "scroll" | "wait" | "navigate" | "move_slider" | "select_dropdown" | "drag_drop" | "next_survey",
  "selector": "CSS selector VEYA kısa hedef metni (max 3 kelime)",
  "value": "type/navigate/slider/dropdown/drag_drop için değer",
  "description": "çok kısa açıklama",
  "done": false
}

ÖNEMLİ: "done": true ASLA kullanma. Anket bittiğinde action: "next_survey" kullan.`;
}

// ==================== MOTOR 1: PUPPETEER + GEMINI VISION ====================

async function runGeminiEngine(url, account, settings) {
  const { connect } = require("puppeteer-real-browser");
  var browser = null;
  var page = null;
  var tempDir = null;

  var geminiApiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || "";
  if (!geminiApiKey) throw new Error("Gemini API key bulunamadı! bot_settings'e gemini_api_key ekleyin.");

  // Kalıcı profil: çerezler ve oturum bilgileri korunur
  var usePersistentProfile = settings.quiz_persistent_profile !== "false";
  var profileInfo = null;
  if (usePersistentProfile) {
    profileInfo = getOrCreatePersistentProfile(account.email);
    tempDir = profileInfo.dir;
    await supabaseInsertLog(profileInfo.isNew ? "🆕 Yeni kalıcı profil: " + account.email : "♻️ Kalıcı profil kullanılıyor: " + account.email + " (çerezler korunuyor)", "info");
  } else {
    tempDir = createTempUserDataDir();
    await supabaseInsertLog("🧹 Temiz profil kullanılıyor (kalıcı profil kapalı)", "info");
  }

  var args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1920,1080",
    "--start-maximized",
    "--user-data-dir=" + tempDir,
  ];

  var useProxy = settings.quiz_proxy_enabled !== "false";
  var proxyConfig = undefined;

  if (useProxy) {
    var proxyHost = settings.proxy_host || "core-residential.evomi-proxy.com";
    var proxyPort = settings.proxy_port || "1000";
    // VFS ile aynı alan adları: proxy_user / proxy_pass
    var proxyUser = settings.proxy_user || settings.proxy_username || process.env.PROXY_USERNAME || "";
    var proxyPass = settings.proxy_pass || settings.proxy_password || process.env.PROXY_PASSWORD || "";

    if (!proxyUser || !proxyPass) {
      throw new Error("Proxy aktif ama kullanıcı adı/şifre eksik. bot_settings'e proxy_user ve proxy_pass ekleyin.");
    }

    var country = (settings.quiz_proxy_country || settings.proxy_country || "US").toUpperCase();
    // Session ID: 8 karakter alfanumerik (Evomi uyumlu, VFS ile aynı)
    var sessionId = Math.random().toString(36).slice(2, 10) || "quiz0001";

    // Dinamik bölge rotasyonu: Evomi API'den şehir listesi çek, rastgele seç
    var region = "";
    
    // Önce dashboard'dan seçilen sabit bölge var mı kontrol et
    var dbRegion = (settings.quiz_proxy_region || "").trim().toLowerCase();
    if (dbRegion) {
      region = dbRegion;
      console.log("[PROXY] 🏙 Dashboard bölgesi kullanılıyor: " + region);
    } else {
      // Evomi API'den dinamik şehir çek
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
            var countryCities = allCities.filter(function(c) { return (c.countryCode || "").toUpperCase() === country; });
            if (countryCities.length > 0) {
              var randomCity = countryCities[Math.floor(Math.random() * countryCities.length)];
              region = (randomCity.city || randomCity.name || "").toLowerCase().replace(/\s+/g, ".");
              console.log("[PROXY] Evomi API: " + countryCities.length + " şehir bulundu, rastgele seçim: " + region);
            } else {
              console.log("[PROXY] Evomi API: " + country + " için şehir bulunamadı, fallback kullanılacak");
            }
          }
        }
      } catch (evomiErr) {
        console.log("[PROXY] Evomi bölge çekme hatası: " + evomiErr.message + " — fallback kullanılacak");
      }

      // Fallback: VFS ile aynı ülke bazlı bölge rotasyonu
      if (!region) {
        region = getQuizFallbackRegion(country);
      }
    }

    // Proxy password oluşturma (VFS ile aynı format)
    var basePass = proxyPass.split("_country-")[0].split("_session-")[0].split("_city-")[0];
    var suffix = "_country-" + country.toLowerCase();
    suffix += "_session-quiz" + sessionId;
    if (region) suffix += "_city-" + region;
    proxyPass = basePass + suffix;

    proxyConfig = {
      host: proxyHost,
      port: proxyPort,
      username: proxyUser,
      password: proxyPass,
    };

    console.log("[QUIZ] Proxy: " + proxyHost + ":" + proxyPort + " | ülke=" + country + " | şehir=" + (region || "rastgele") + " | session=quiz" + sessionId);
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

    // IP doğrulaması — hangi IP'den bağlandığını logla
    try {
      await page.goto("https://ip.evomi.com/s", { waitUntil: "networkidle2", timeout: 15000 });
      var detectedIp = await page.evaluate(function() { return document.body ? document.body.innerText.trim() : "bilinmiyor"; });
      console.log("[QUIZ] Aktif IP: " + detectedIp);
      await supabaseInsertLog("🌐 Bağlantı IP: " + detectedIp, "info");
    } catch(ipErr) {
      console.log("[QUIZ] IP tespiti başarısız: " + ipErr.message);
      await supabaseInsertLog("⚠️ IP tespiti başarısız", "warning");
    }

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await supabaseInsertLog("Sayfa yüklendi: " + url, "info");

    // Sayfa engel kontrolü (VFS ile aynı)
    var pageContent = await page.evaluate(function() { return document.body ? document.body.innerText : ""; }).catch(function() { return ""; });
    if (quizIsPageBlocked(pageContent)) {
      await supabaseInsertLog("🚫 Sayfa engellendi — yeni oturum denenecek", "warning");
      throw new Error("blocked: Sayfa engellendi (403/access denied/rate limit)");
    }

    // Sayfa yüklendikten sonra insan benzeri davranış
    await humanIdle(1500, 3000);
    await humanMove(page);
    await humanScroll(page);

    // === OTOMATİK GİRİŞ KONTROLÜ ===
    // Kalıcı profil sayesinde zaten login olmuş olabilir — login sayfasında değilsek direkt anketlere başla
    var currentUrl = page.url();
    var isLoginPage = /\/login|\/p\/login|signin|sign-in/i.test(currentUrl);
    var isAlreadyLoggedIn = await page.evaluate(function() {
      var body = document.body ? document.body.innerText : '';
      // Swagbucks dashboard göstergeleri
      var dashboardIndicators = ['My SB', 'Earn SB', 'Daily Goal', 'Survey', 'Discover', 'Your Surveys', 'Answer', 'Gold Surveys'];
      for (var i = 0; i < dashboardIndicators.length; i++) {
        if (body.includes(dashboardIndicators[i])) return true;
      }
      // Login formu yoksa muhtemelen giriş yapılmış
      var hasLoginForm = document.querySelector('input[type="password"]') || document.querySelector('form[action*="login"]');
      return !hasLoginForm && !body.includes('Log In') && !body.includes('Sign In') && body.length > 200;
    }).catch(function() { return false; });

    if (!isLoginPage && isAlreadyLoggedIn) {
      console.log('[QUIZ] ✅ Zaten giriş yapılmış! Login atlanıyor, direkt anketlere geçiliyor.');
      await supabaseInsertLog('✅ Otomatik giriş algılandı — login atlanıyor, direkt anketlere başlanıyor', 'success');
      // Anket sayfasına yönlendir (Swagbucks answer sayfası)
      var surveyUrl = 'https://www.swagbucks.com/surveys';
      try {
        await page.goto(surveyUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await supabaseInsertLog('Anket sayfasına yönlendirildi: ' + surveyUrl, 'info');
        await humanIdle(1000, 2000);
      } catch (navErr) {
        console.log('[QUIZ] Anket sayfasına yönlendirme başarısız, mevcut sayfada devam ediliyor');
      }
    } else if (isLoginPage || !isAlreadyLoggedIn) {
      console.log('[QUIZ] Login sayfası tespit edildi, giriş yapılacak');
    }

    var maxSteps = 500; // Sürekli anket çözme — kapanmayacak
    var surveysCompleted = 0;
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
        if ((captchaErr.message || "").toLowerCase().includes("detached")) {
          throw new Error("Detached frame — IP rotasyonu gerekli");
        }
      }

      // Her adımda rastgele insan benzeri hareket
      if (Math.random() > 0.4) await humanMove(page);

      // Sayfanın kaydırılabilir olup olmadığını kontrol et ve tam sayfa screenshot al
      var pageScrollInfo = await page.evaluate(function() {
        function normalize(text) {
          return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
        }

        function isContinueLike(text) {
          return /(please click to continue|click to continue|continue|next|submit|verify|devam etmek|devam et|devam|ileri|sonraki|gönder|gonder)/.test(normalize(text));
        }

        var scrollable = document.documentElement.scrollHeight > window.innerHeight + 50;
        var atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 100);
        // Continue/Next/Submit butonu ekranın altında mı kontrol et
        var submitBtn = null;
        var btns = document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"], [onclick], [tabindex]');
        for (var i = 0; i < btns.length; i++) {
          var txt = [btns[i].textContent || "", btns[i].value || "", btns[i].getAttribute("aria-label") || "", btns[i].getAttribute("title") || ""].join(" ");
          if (isContinueLike(txt) || /^[→»›⟶➜➡➝⮕]+$/.test((btns[i].textContent || "").trim())) {
            var rect = btns[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              submitBtn = { text: normalize(txt), visible: rect.top < window.innerHeight && rect.bottom > 0, top: rect.top };
              break;
            }
          }
        }
        return { scrollable: scrollable, atBottom: atBottom, submitBtn: submitBtn, scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, viewportH: window.innerHeight };
      });

      // Eğer sayfa kaydırılabilir ve Continue butonu görünmüyorsa, aşağı kaydır
      if (pageScrollInfo.scrollable && !pageScrollInfo.atBottom && pageScrollInfo.submitBtn && !pageScrollInfo.submitBtn.visible) {
        console.log("[SCROLL] Continue butonu görünmüyor, aşağı kaydırılıyor...");
        await supabaseInsertLog("⬇️ Sayfayı kaydırıyor (Continue butonu ekranın altında)", "info");
        await page.evaluate(function() { window.scrollBy({ top: 500, behavior: 'smooth' }); });
        await quizDelay(800, 1500);
      }

      // fullPage screenshot al ki AI tüm sayfayı görsün
      var screenshot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 70, fullPage: false });
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

      // Stuck detection: son 3 aksiyon aynıysa zorla scroll yap
      if (recentActions.length >= 3) {
        var last3 = recentActions.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          console.log("[STUCK] Son 3 aksiyon aynı, zorla scroll yapılıyor");
          await supabaseInsertLog("⚠️ Takılma algılandı, sayfayı kaydırıyor", "warning");
          await page.evaluate(function() { window.scrollBy({ top: 600, behavior: 'smooth' }); });
          await quizDelay(1000, 2000);
          recentActions.push("scroll: forced_unstuck");
          continue;
        }
      }

      await supabaseInsertLog("Adım " + stepCount + ": " + action.description, "info");

      if (action.done) {
        surveysCompleted++;
        console.log("[QUIZ] ✅ Anket #" + surveysCompleted + " tamamlandı: " + action.description);
        await supabaseInsertLog("✅ Anket #" + surveysCompleted + " tamamlandı! Bir sonrakine geçiliyor...", "success");
        recentActions = [];
        // Ana sayfaya dön ve bir sonraki anketi bul
        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
          await supabaseInsertLog("Ana sayfaya dönüldü, yeni anket aranıyor", "info");
          await humanIdle(2000, 4000);
          await humanMove(page);
        } catch (navErr) {
          console.error("[NAV] Ana sayfaya dönüş hatası:", navErr.message);
        }
        continue;
      }

      // next_survey aksiyonu: anket bitti, bir sonrakine geç
      if (action.action === "next_survey") {
        surveysCompleted++;
        console.log("[QUIZ] ✅ Anket #" + surveysCompleted + " tamamlandı, sonrakine geçiliyor");
        await supabaseInsertLog("✅ Anket #" + surveysCompleted + " tamamlandı! Sonrakine geçiliyor...", "success");
        recentActions = [];
        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
          await supabaseInsertLog("Ana sayfaya dönüldü, yeni anket aranıyor", "info");
          await humanIdle(2000, 4000);
          await humanMove(page);
        } catch (navErr) {
          console.error("[NAV] Ana sayfaya dönüş hatası:", navErr.message);
        }
        continue;
      }

      try {
        // Yeni sekme algılama: tıklamadan önceki sekme sayısını kaydet
        var pagesBefore = browser.targets().filter(function(t) { return t.type() === "page"; });
        var pagesBeforeCount = pagesBefore.length;

        await executeAction(page, action);

        // === HER TIKLAMADAN SONRA: Sayfanın en altına in ve Continue/Next/Submit ara ===
        if (action.action === 'click' || action.action === 'select_dropdown' || action.action === 'move_slider') {
          await quizDelay(500, 1000);
          // Sayfanın en altına scroll
          await page.evaluate(function() { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); });
          await quizDelay(600, 1200);
          
          // Continue/Next/Submit butonunu bul ve tıkla
          var autoClicked = await page.evaluate(function() {
            function normalize(text) {
              return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
            }

            function isDisabled(el) {
              return !!(el && (el.disabled || el.getAttribute('aria-disabled') === 'true'));
            }

            function isContinueLike(text) {
              return /(please click to continue|click to continue|continue|next|submit|verify|devam etmek|devam et|devam|ileri|sonraki|gönder|gonder)/.test(normalize(text));
            }

            function findPromptButton() {
              var prompt = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, span, div')).find(function(node) {
                var rect = node.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return false;
                return /(please click to continue|click to continue|devam etmek için|devam etmek icin)/.test(normalize(node.textContent || ''));
              });
              if (!prompt) return null;

              var promptRect = prompt.getBoundingClientRect();
              var controls = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"], [onclick], [tabindex]'));
              var best = null;
              var bestScore = 0;
              for (var i = 0; i < controls.length; i++) {
                var el = controls[i];
                var rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0 || isDisabled(el)) continue;
                var blob = normalize([el.textContent || '', el.value || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || '', el.className || ''].join(' '));
                var score = 0;
                if (isContinueLike(blob)) score += 100;
                if (/^[→»›⟶➜➡➝⮕]+$/.test((el.textContent || '').trim())) score += 70;
                if (rect.top >= promptRect.bottom - 12) score += 30;
                if (Math.abs((rect.left + rect.width / 2) - (promptRect.left + promptRect.width / 2)) < Math.max(220, promptRect.width)) score += 20;
                if (prompt.parentElement && (prompt.parentElement.contains(el) || el.parentElement === prompt.parentElement)) score += 60;
                if (score > bestScore) {
                  best = el;
                  bestScore = score;
                }
              }
              return bestScore >= 60 ? best : null;
            }

            var btns = document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"], [onclick], [tabindex]');
            for (var i = 0; i < btns.length; i++) {
              var txt = [btns[i].textContent || '', btns[i].value || '', btns[i].getAttribute('aria-label') || '', btns[i].getAttribute('title') || ''].join(' ');
              if (isContinueLike(txt) || /^[→»›⟶➜➡➝⮕]+$/.test((btns[i].textContent || '').trim())) {
                var rect = btns[i].getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && !isDisabled(btns[i])) {
                  btns[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return { found: true, text: normalize(txt), disabled: false };
                } else if (isDisabled(btns[i])) {
                  return { found: true, text: normalize(txt), disabled: true };
                }
              }
            }
            var promptBtn = findPromptButton();
            if (promptBtn) {
              promptBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return { found: true, text: normalize(promptBtn.textContent || promptBtn.value || promptBtn.getAttribute('aria-label') || 'continue prompt'), disabled: false, promptFallback: true };
            }
            return { found: false };
          });
          
          if (autoClicked && autoClicked.found && !autoClicked.disabled) {
            await quizDelay(300, 600);
            // Fiziksel tıklama
            var clicked = await page.evaluate(function() {
              function normalize(text) {
                return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
              }

              function isDisabled(el) {
                return !!(el && (el.disabled || el.getAttribute('aria-disabled') === 'true'));
              }

              function isContinueLike(text) {
                return /(please click to continue|click to continue|continue|next|submit|verify|devam etmek|devam et|devam|ileri|sonraki|gönder|gonder)/.test(normalize(text));
              }

              function fireClick(el) {
                if (!el || isDisabled(el)) return null;
                var rect = el.getBoundingClientRect();
                var x = rect.left + rect.width / 2;
                var y = rect.top + rect.height / 2;
                var events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
                for (var i = 0; i < events.length; i++) {
                  try {
                    el.dispatchEvent(new MouseEvent(events[i], { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
                  } catch (e) {}
                }
                try { el.click(); } catch (e) {}
                return normalize(el.textContent || el.value || el.getAttribute('aria-label') || 'continue');
              }

              var btns = document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"], [onclick], [tabindex]');
              for (var i = 0; i < btns.length; i++) {
                var txt = [btns[i].textContent || '', btns[i].value || '', btns[i].getAttribute('aria-label') || '', btns[i].getAttribute('title') || ''].join(' ');
                if ((isContinueLike(txt) || /^[→»›⟶➜➡➝⮕]+$/.test((btns[i].textContent || '').trim())) && !isDisabled(btns[i])) {
                  return fireClick(btns[i]);
                }
              }

              var prompt = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, span, div')).find(function(node) {
                var rect = node.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return false;
                return /(please click to continue|click to continue|devam etmek için|devam etmek icin)/.test(normalize(node.textContent || ''));
              });
              if (prompt) {
                var promptRect = prompt.getBoundingClientRect();
                var controls = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"], [onclick], [tabindex]'));
                var best = null;
                var bestScore = 0;
                for (var j = 0; j < controls.length; j++) {
                  var el = controls[j];
                  var rect = el.getBoundingClientRect();
                  if (rect.width <= 0 || rect.height <= 0 || isDisabled(el)) continue;
                  var blob = normalize([el.textContent || '', el.value || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || '', el.className || ''].join(' '));
                  var score = 0;
                  if (isContinueLike(blob)) score += 100;
                  if (/^[→»›⟶➜➡➝⮕]+$/.test((el.textContent || '').trim())) score += 70;
                  if (rect.top >= promptRect.bottom - 12) score += 30;
                  if (Math.abs((rect.left + rect.width / 2) - (promptRect.left + promptRect.width / 2)) < Math.max(220, promptRect.width)) score += 20;
                  if (prompt.parentElement && (prompt.parentElement.contains(el) || el.parentElement === prompt.parentElement)) score += 60;
                  if (score > bestScore) {
                    best = el;
                    bestScore = score;
                  }
                }
                if (best && bestScore >= 60) return fireClick(best);
              }

              return null;
            });
            if (clicked) {
              console.log('[AUTO-CONTINUE] ✅ ' + clicked + ' butonuna otomatik tıklandı');
              await supabaseInsertLog('⏩ ' + clicked + ' butonuna otomatik tıklandı', 'info');
              await quizDelay(1500, 3000);
            }
          }
        }

        // Tıklamadan sonra yeni sekme açılmış mı kontrol et
        await quizDelay(1500, 3000);
        var pagesAfter = browser.targets().filter(function(t) { return t.type() === "page"; });

        if (pagesAfter.length > pagesBeforeCount) {
          console.log("[TAB] 🆕 Yeni sekme algılandı (" + pagesBeforeCount + " → " + pagesAfter.length + ")");
          await supabaseInsertLog("Yeni sekme açıldı, geçiş yapılıyor", "info");

          var allPages = await browser.pages();
          var oldPage = page;
          var newPage = allPages[allPages.length - 1];

          if (newPage && newPage !== page) {
            await newPage.bringToFront();
            try { await newPage.setViewport({ width: 1920, height: 1080 }); } catch (e) {}
            try {
              await newPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
            } catch (e) {}

            // Eski sekmeyi kapat (ilk sekme korunsun)
            try {
              var remainingPages = await browser.pages();
              if (remainingPages.length > 2 && oldPage !== remainingPages[0]) {
                await oldPage.close();
                console.log("[TAB] 🗑️ Eski sekme kapatıldı");
              }
            } catch (closeErr) {
              console.log("[TAB] Eski sekme kapatma hatası:", closeErr.message);
            }

            page = newPage;
            console.log("[TAB] ✅ Yeni sekmeye geçildi: " + page.url());
            await supabaseInsertLog("Yeni sekmeye geçildi: " + page.url().slice(0, 80), "success");

            await humanIdle(1500, 3000);
            await humanMove(page);
          }

          // Fazla sekmeleri temizle (maks 3 sekme kalsın)
          try {
            var currentPages = await browser.pages();
            if (currentPages.length > 3) {
              console.log("[TAB] 🧹 Fazla sekme temizleniyor: " + currentPages.length + " açık");
              for (var pi = 1; pi < currentPages.length - 1; pi++) {
                if (currentPages[pi] !== page) {
                  try { await currentPages[pi].close(); } catch (e) {}
                }
              }
              var afterClean = await browser.pages();
              console.log("[TAB] ✅ Temizlik sonrası: " + afterClean.length + " sekme");
            }
          } catch (cleanErr) {}
        } else {
          await humanIdle(1000, 2500);
        }

        // Bazen scroll yap
        if (Math.random() > 0.6) await humanScroll(page);
      } catch (actionErr) {
        console.error("[GEMINI] Aksiyon hatası:", actionErr.message);
        await supabaseInsertLog("Aksiyon hatası: " + actionErr.message, "warning");
      }
    }

    var finalScreenshot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 70 });
    await supabaseInsertLog("Quiz oturumu tamamlandı - " + stepCount + " adım, " + surveysCompleted + " anket çözüldü", "success", "data:image/jpeg;base64," + finalScreenshot);
  } catch (err) {
    console.error("[GEMINI] Hata:", err.message);
    await supabaseInsertLog("Hata: " + err.message, "error");
    throw err;
  } finally {
    // Tarayıcıyı kapat — kalıcı profilde profil silinmez
    try {
      if (browser) {
        await browser.close().catch(function() {});
        console.log("[QUIZ] 🔒 Tarayıcı kapatıldı");
      }
    } catch (e) {}
    if (tempDir && !usePersistentProfile) {
      cleanupUserDataDir(tempDir);
      await supabaseInsertLog("Tarayıcı kapatıldı ve profil temizlendi", "info");
    } else {
      await supabaseInsertLog("Tarayıcı kapatıldı (profil korundu: " + (account.email || "?") + ")", "info");
    }
  }
}

async function askGeminiVision(apiKey, screenshotBase64, currentUrl, account, step, recentActions) {
  var fetch = (await import("node-fetch")).default;
  var recentText = (recentActions && recentActions.length > 0)
    ? recentActions.map(function(a, i) { return (i + 1) + ". " + a; }).join("\n")
    : "Yok";

  var systemPrompt = buildSurveySystemPrompt(account, recentText);

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

  var systemPrompt = buildSurveySystemPrompt(account, recentText);

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

  var systemPrompt = buildSurveySystemPrompt(account, recentText);

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

  if (/(continue|next|submit|verify|devam|ileri|sonraki|go on)/i.test(source)) {
    ["Continue", "Next", "Submit", "Verify", "Please click to continue", "click to continue", "Devam", "Devam et", "İleri", "Sonraki"].forEach(pushText);
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
        if (!el) return false;
        var rect = el.getBoundingClientRect();
        var style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }

      function isDisabled(el) {
        if (!el) return true;
        return !!(el.disabled || el.getAttribute("aria-disabled") === "true");
      }

      function isContinuePhrase(text) {
        var value = normalize(text);
        return /(please click to continue|click to continue|continue|next|submit|verify|devam etmek|devam et|devam|ileri|sonraki|gönder|gonder)/.test(value);
      }

      function getElementBlob(el) {
        if (!el) return "";
        return normalize([
          el.textContent || "",
          el.value || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.getAttribute("data-testid") || "",
          el.getAttribute("name") || "",
          el.className || ""
        ].join(" "));
      }

      function isCaptchaLike(el) {
        var cls = normalize(el.className || "");
        var aria = normalize(el.getAttribute("aria-label") || "");
        var title = normalize(el.getAttribute("title") || "");
        var data = normalize(el.getAttribute("data-testid") || "");
        var combined = [cls, aria, title, data].join(" ");
        return /(challenge|captcha|tile|grid|traffic|crosswalk|bus|car|bicycle|hydrant|motorcycle)/.test(combined);
      }

      function looksClickable(el) {
        if (!el) return false;
        var tag = (el.tagName || "").toLowerCase();
        var role = normalize(el.getAttribute("role") || "");
        var href = el.getAttribute("href");
        var type = (el.getAttribute("type") || "").toLowerCase();
        return tag === "a" || tag === "button" || tag === "label" || tag === "input" || !!href || role === "button" || role === "checkbox" || role === "radio" || role === "option" || el.hasAttribute("onclick") || el.hasAttribute("tabindex") || type === "checkbox" || type === "radio";
      }

      function getClickableTarget(el) {
        if (!el) return null;
        if (looksClickable(el) && isVisible(el)) return el;

        var closest = el.closest('a, button, label, [role="button"], [role="checkbox"], [role="radio"], [role="option"], [onclick], [tabindex], input[type="checkbox"], input[type="radio"]');
        if (closest && isVisible(closest)) return closest;

        // Checkbox/radio'nun label'ına tıklamak için parent'ı da kontrol et
        var parent = el.parentElement;
        if (parent) {
          var parentTag = (parent.tagName || "").toLowerCase();
          if (parentTag === "label" && isVisible(parent)) return parent;
          // Container div tıklanabilir olabilir
          if (parent.hasAttribute("onclick") || parent.hasAttribute("tabindex")) return parent;
        }

        var child = el.querySelector('a, button, label, [role="button"], [onclick], [tabindex], input[type="checkbox"], input[type="radio"]');
        if (child && isVisible(child)) return child;

        return isVisible(el) ? el : null;
      }

      // Checkbox/radio elemanlarını metin bazlı bul (custom div-based checkboxlar dahil)
      function findCheckboxByText(searchText) {
        var normalSearch = normalize(searchText);
        // Önce role="checkbox/radio/option" ve aria- bazlı elementleri tara
        var roleEls = document.querySelectorAll('[role="checkbox"], [role="radio"], [role="option"], [role="listitem"], [aria-checked], [data-value]');
        for (var r = 0; r < roleEls.length; r++) {
          var rEl = roleEls[r];
          if (!isVisible(rEl)) continue;
          var rText = normalize(rEl.textContent || rEl.getAttribute("aria-label") || "");
          if (rText && (rText === normalSearch || rText.indexOf(normalSearch) !== -1)) return rEl;
        }

        // Geniş arama: tüm label, div, span, li, td, p
        var allEls = document.querySelectorAll('label, div, span, li, td, p, a');
        var bestEl = null;
        var bestScore = 0;
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          if (!isVisible(el)) continue;
          var text = normalize(el.textContent || "");
          if (!text) continue;
          
          // Exact match veya contains
          var score = 0;
          if (text === normalSearch) score = 100;
          else if (text.indexOf(normalSearch) !== -1) score = 80;
          else if (normalSearch.indexOf(text) !== -1 && text.length > 3) score = 60;
          
          if (score <= bestScore) continue;
          
          // Yakınında checkbox/radio var mı?
          var input = el.querySelector('input[type="checkbox"], input[type="radio"]');
          if (!input) {
            var prev = el.previousElementSibling;
            if (prev && (prev.tagName || "").toLowerCase() === "input") input = prev;
          }
          if (!input && el.parentElement) {
            input = el.parentElement.querySelector('input[type="checkbox"], input[type="radio"]');
          }

          // Custom checkbox: container'a bakarak anla (border, card-like div)
          var isCustomCheckbox = false;
          var container = el.closest('[class*="check"], [class*="option"], [class*="answer"], [class*="choice"], [class*="select"], [class*="item"], [class*="card"]');
          if (!container) {
            // Parent div'in kendisi tıklanabilir container olabilir
            var par = el.parentElement;
            if (par && par.tagName === "DIV") {
              var parStyle = window.getComputedStyle(par);
              if (parStyle.cursor === "pointer" || parStyle.borderStyle !== "none" || par.hasAttribute("tabindex") || par.hasAttribute("onclick")) {
                container = par;
              }
            }
          }
          if (container && isVisible(container)) isCustomCheckbox = true;
          
          if (input) { score += 20; }
          if (isCustomCheckbox) { score += 15; }
          
          if (score > bestScore) {
            bestScore = score;
            // Tıklama önceliği: input > custom container > element
            bestEl = input || (isCustomCheckbox ? container : el);
          }
        }
        return bestEl;
      }

      function findContinuePromptButton() {
        var allNodes = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, span, div'));
        var promptNode = null;
        for (var i = 0; i < allNodes.length; i++) {
          var node = allNodes[i];
          if (!isVisible(node)) continue;
          var text = normalize(node.textContent || "");
          if (text && /(please click to continue|click to continue|devam etmek için|devam etmek icin)/.test(text)) {
            promptNode = node;
            break;
          }
        }

        var controls = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"], [onclick], [tabindex]'))
          .filter(isVisible)
          .filter(function(el) { return !isDisabled(el); });

        if (controls.length === 0) return null;

        var bestControl = null;
        var bestScore = 0;
        for (var j = 0; j < controls.length; j++) {
          var control = controls[j];
          var blob = getElementBlob(control);
          var rect = control.getBoundingClientRect();
          var score = 0;

          if (isContinuePhrase(blob)) score += 110;
          if (/arrow|continue|next|primary|cta|submit|forward/.test(blob)) score += 25;
          if (/^[→»›⟶➜➡➝⮕]+$/.test((control.textContent || '').trim())) score += 70;
          if (rect.width >= 48 && rect.height >= 28) score += 10;

          if (promptNode) {
            var promptRect = promptNode.getBoundingClientRect();
            var sameContainer = promptNode.parentElement && (promptNode.parentElement.contains(control) || control.parentElement === promptNode.parentElement);
            var belowPrompt = rect.top >= (promptRect.bottom - 12);
            var horizontalAligned = Math.abs((rect.left + rect.width / 2) - (promptRect.left + promptRect.width / 2)) < Math.max(220, promptRect.width);
            if (sameContainer) score += 70;
            if (belowPrompt) score += 35;
            if (horizontalAligned) score += 20;
            if (rect.top > promptRect.top && rect.top - promptRect.bottom < 260) score += 25;
          }

          if (score > bestScore) {
            bestScore = score;
            bestControl = control;
          }
        }

        return bestScore >= 60 ? bestControl : null;
      }

      function fireSmartClick(el) {
        if (!el) return false;
        var target = getClickableTarget(el);
        if (!target) return false;

        var rect = target.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

        try { target.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}

        for (var i = 0; i < events.length; i++) {
          try {
            target.dispatchEvent(new MouseEvent(events[i], {
              view: window,
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              button: 0
            }));
          } catch (e) {}
        }

        try { target.click(); } catch (e) {}
        return true;
      }

      var phrases = (candidates || []).map(normalize).filter(Boolean);
      var weakWords = { button: true, buton: true, tıkla: true, tikla: true, click: true, link: true, için: true, icin: true, yap: true, bas: true, press: true, kareye: true, kare: true, olduğu: true, kazandıran: true, anketi: true, başlat: true, çözmek: true, tiklayın: true, tıklayın: true, ilk: true, liste: true, listesindeki: true };
      var words = [];
      for (var p = 0; p < phrases.length; p++) {
        var parts = phrases[p].split(" ");
        for (var w = 0; w < parts.length; w++) {
          var word = parts[w];
          if (word.length > 1 && !weakWords[word] && words.indexOf(word) === -1) words.push(word);
        }
      }

      var surveyKeywords = ["survey", "anket", "earn", "sb", "min", "answer"];
      var isSurveyAction = false;
      for (var sk = 0; sk < surveyKeywords.length; sk++) {
        for (var sp = 0; sp < phrases.length; sp++) {
          if (phrases[sp].includes(surveyKeywords[sk])) { isSurveyAction = true; break; }
        }
        if (isSurveyAction) break;
      }

      var selectors = [
        "button, a, input[type=submit], input[type=button], [role=button], label, [onclick], [tabindex]",
        "li, article, section, div, span, tr, td"
      ];
      var elements = Array.from(document.querySelectorAll(selectors.join(","))).filter(isVisible);

      var best = null;
      var bestScore = 0;
      var bestText = "";
      var wantsContinue = false;
      for (var wp = 0; wp < phrases.length; wp++) {
        if (isContinuePhrase(phrases[wp])) {
          wantsContinue = true;
          break;
        }
      }

      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var text = normalize(el.textContent || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "");
        var href = normalize(el.getAttribute("href") || "");
        var cls = normalize(el.className || "");
        var tag = (el.tagName || "").toLowerCase();
        var aria = normalize(el.getAttribute("aria-label") || "");
        var title = normalize(el.getAttribute("title") || "");
        var dataTest = normalize(el.getAttribute("data-testid") || "");
        var name = normalize(el.getAttribute("name") || "");
        var blob = [text, cls, aria, title, href, dataTest, name].join(" ");
        var score = 0;

        if (isCaptchaLike(el)) score += 35;

        if (isSurveyAction) {
          if ((text.includes("earn") && text.includes("sb")) || (text.includes("survey #") || /survey\s*#?\d+/i.test(text))) score += 35;
          if (text.includes("min")) score += 20;
          if (href.includes("survey") || href.includes("answer") || href.includes("offer")) score += 30;
          if (cls.includes("survey") || cls.includes("card") || cls.includes("offer")) score += 18;
          if (tag === "a" || tag === "article" || tag === "li") score += 12;
        }

        for (var j = 0; j < phrases.length; j++) {
          var phrase = phrases[j];
          if (!phrase) continue;
          if (text && text === phrase) score = Math.max(score, 100);
          else if (text && text.includes(phrase)) score = Math.max(score, 82);
          else if (phrase && text && phrase.split(" ").every(function(part) { return !part || text.includes(part); })) score = Math.max(score, 70);
        }

        if (words.length > 0) {
          var matched = 0;
          for (var k = 0; k < words.length; k++) {
            if (blob.includes(words[k])) matched++;
          }
          if (matched > 0) score = Math.max(score, matched * 20);
        }

        if (wantsContinue) {
          if (isContinuePhrase(blob)) score = Math.max(score, 105);
          if (/^[→»›⟶➜➡➝⮕]+$/.test((el.textContent || '').trim())) score = Math.max(score, 85);
          if ((tag === "button" || tag === "a" || tag === "input") && !isDisabled(el)) score += 12;
        }

        for (var np = 0; np < phrases.length; np++) {
          var numMatch = phrases[np].match(/\d{5,}/);
          if (numMatch && text.includes(numMatch[0])) score = Math.max(score, 92);
        }

        if (score > bestScore) {
          best = el;
          bestScore = score;
          bestText = text ? text.slice(0, 120) : cls;
        }
      }

      var threshold = isSurveyAction ? 24 : 40;
      if (best && bestScore >= threshold) {
        return { clicked: fireSmartClick(best), matchedText: bestText, score: bestScore };
      }

      if (wantsContinue && (!best || bestScore < threshold)) {
        var continuePromptButton = findContinuePromptButton();
        if (continuePromptButton) {
          return { clicked: fireSmartClick(continuePromptButton), matchedText: getElementBlob(continuePromptButton).slice(0, 120), score: 95, continuePromptFallback: true };
        }
      }

      // Checkbox/radio fallback: metin bazlı arama
      if (!best || bestScore < threshold) {
        for (var cf = 0; cf < phrases.length; cf++) {
          var cbEl = findCheckboxByText(phrases[cf]);
          if (cbEl) {
            return { clicked: fireSmartClick(cbEl), matchedText: normalize(cbEl.textContent || "").slice(0, 60), score: 75, checkboxFallback: true };
          }
        }
      }

      return { clicked: false, matchedText: bestText, score: bestScore };
    }, candidates);
  }

  async function trySurveyCardFallback(targetPage) {
    return await targetPage.evaluate(function() {
      function isVisible(el) {
        if (!el) return false;
        var rect = el.getBoundingClientRect();
        var style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }

      function clickLikeHuman(el) {
        if (!el || !isVisible(el)) return false;
        var rect = el.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
        try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
        for (var i = 0; i < events.length; i++) {
          try {
            el.dispatchEvent(new MouseEvent(events[i], {
              view: window,
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              button: 0
            }));
          } catch (e) {}
        }
        try { el.click(); } catch (e) {}
        return true;
      }

      var cardCandidates = Array.from(document.querySelectorAll('a, article, li, section, div'))
        .filter(isVisible)
        .filter(function(el) {
          var text = String(el.textContent || "").toLowerCase();
          return (text.includes("earn") && text.includes("sb") && text.includes("min")) || /survey\s*#?\d+/i.test(text);
        })
        .sort(function(a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });

      if (cardCandidates.length === 0) return false;

      var first = cardCandidates[0];
      var clickable = first.matches('a, button, [role="button"]')
        ? first
        : first.querySelector('a, button, [role="button"], [onclick], [tabindex]') || first.closest('a, button, [role="button"], [onclick], [tabindex]') || first;

      return clickLikeHuman(clickable);
    });
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

      var descLower = ((action.description || "") + " " + (action.selector || "")).toLowerCase();
      var isSurveyClick = /survey|anket|earn|sb|min|answer/.test(descLower);
      if (isSurveyClick) {
        for (var sf = 0; sf < frames.length; sf++) {
          try {
            var surveyClicked = await trySurveyCardFallback(frames[sf]);
            if (surveyClicked) {
              console.log("[CLICK] 🎯 Survey card fallback başarılı");
              return;
            }
          } catch (e) {}
        }
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
      // Strategy 4: Survey textarea fallback — find any visible textarea/input and type
      if (!isPasswordField && !isEmailField && action.value) {
        for (var tf3 = 0; tf3 < typeFrames.length; tf3++) {
          try {
            var surveyTyped = await typeFrames[tf3].evaluate(function(val) {
              function setNativeValue(el, value) {
                var valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
                if (valueSetter) valueSetter.call(el, value);
                else el.value = value;
                el.dispatchEvent(new Event("input", {bubbles: true}));
                el.dispatchEvent(new Event("change", {bubbles: true}));
              }
              // Find visible textarea first, then text inputs
              var fields = Array.from(document.querySelectorAll("textarea, input[type='text'], input:not([type])"));
              for (var i = 0; i < fields.length; i++) {
                var f = fields[i];
                var rect = f.getBoundingClientRect();
                var style = window.getComputedStyle(f);
                if (rect.width > 50 && rect.height > 10 && style.display !== "none" && style.visibility !== "hidden") {
                  var type = (f.type || "").toLowerCase();
                  // Skip password/email/hidden fields
                  if (type === "password" || type === "email" || type === "hidden" || type === "submit") continue;
                  f.focus();
                  f.value = "";
                  setNativeValue(f, val);
                  return true;
                }
              }
              return false;
            }, action.value);
            if (surveyTyped) {
              console.log("[TYPE] 📝 Survey textarea fallback ile yazıldı");
              return;
            }
          } catch (e) {}
        }
      }
      break;
    }

    case "move_slider": {
      var sliderFrames = await getCandidateFrames();
      var targetValue = parseInt(action.value) || 50;
      
      for (var sf = 0; sf < sliderFrames.length; sf++) {
        try {
          var sliderMoved = await sliderFrames[sf].evaluate(function(selector, targetVal) {
            function isVisible(el) {
              var rect = el.getBoundingClientRect();
              var style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            }

            // Try CSS selector first
            var slider = null;
            try { slider = document.querySelector(selector); } catch(e) {}
            
            // Fallback: find any visible range input
            if (!slider || !isVisible(slider)) {
              var ranges = Array.from(document.querySelectorAll('input[type="range"], [role="slider"]'));
              for (var i = 0; i < ranges.length; i++) {
                if (isVisible(ranges[i])) { slider = ranges[i]; break; }
              }
            }
            
            if (!slider) return false;
            
            // For input[type=range]
            if (slider.tagName === "INPUT" && slider.type === "range") {
              var min = parseFloat(slider.min) || 0;
              var max = parseFloat(slider.max) || 100;
              var newVal = min + (max - min) * (targetVal / 100);
              var valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(slider), 'value')?.set;
              if (valueSetter) valueSetter.call(slider, String(newVal));
              else slider.value = String(newVal);
              slider.dispatchEvent(new Event("input", {bubbles: true}));
              slider.dispatchEvent(new Event("change", {bubbles: true}));
              return true;
            }
            
            // For custom sliders (role=slider) — simulate click at percentage position
            var rect = slider.getBoundingClientRect();
            var x = rect.left + (rect.width * targetVal / 100);
            var y = rect.top + rect.height / 2;
            var clickEvent = new MouseEvent("click", {
              clientX: x, clientY: y, bubbles: true
            });
            slider.dispatchEvent(clickEvent);
            return true;
          }, action.selector || "", targetValue);
          
          if (sliderMoved) {
            console.log("[SLIDER] 🎚 Slider değeri ayarlandı: " + targetValue);
            return;
          }
        } catch (e) {}
      }
      
      // Physical mouse fallback for custom sliders
      try {
        var sliderEl = await page.$(action.selector || 'input[type="range"]');
        if (sliderEl) {
          var box = await sliderEl.boundingBox();
          if (box) {
            var clickX = box.x + (box.width * targetValue / 100);
            var clickY = box.y + box.height / 2;
            await page.mouse.click(clickX, clickY);
            console.log("[SLIDER] 🎚 Fiziksel tıklama ile slider ayarlandı");
          }
        }
      } catch (e) {}
      break;
    }

    case "select_dropdown": {
      var ddFrames = await getCandidateFrames();
      
      for (var df = 0; df < ddFrames.length; df++) {
        try {
          var ddSelected = await ddFrames[df].evaluate(function(selector, optionText) {
            function isVisible(el) {
              var rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }
            
            var selectEl = null;
            try { selectEl = document.querySelector(selector); } catch(e) {}
            
            // Fallback: find any visible select element
            if (!selectEl || selectEl.tagName !== "SELECT") {
              var selects = Array.from(document.querySelectorAll("select"));
              for (var i = 0; i < selects.length; i++) {
                if (isVisible(selects[i])) { selectEl = selects[i]; break; }
              }
            }
            
            if (!selectEl) return false;
            
            var options = Array.from(selectEl.options);
            var optLower = (optionText || "").toLowerCase().trim();
            var target = null;
            
            // Exact match first
            for (var i = 0; i < options.length; i++) {
              if ((options[i].text || "").toLowerCase().trim() === optLower) { target = options[i]; break; }
            }
            // Partial match
            if (!target) {
              for (var i = 0; i < options.length; i++) {
                if ((options[i].text || "").toLowerCase().includes(optLower)) { target = options[i]; break; }
              }
            }
            // First non-empty option fallback
            if (!target) {
              for (var i = 0; i < options.length; i++) {
                if (options[i].value && !options[i].disabled && i > 0) { target = options[i]; break; }
              }
            }
            
            if (target) {
              selectEl.value = target.value;
              selectEl.dispatchEvent(new Event("change", {bubbles: true}));
              selectEl.dispatchEvent(new Event("input", {bubbles: true}));
              return true;
            }
            return false;
          }, action.selector || "", action.value || "");
          
          if (ddSelected) {
            console.log("[DROPDOWN] 📋 Dropdown seçimi yapıldı: " + action.value);
            return;
          }
        } catch (e) {}
      }
      break;
    }

    case "scroll":
      var scrollDir = (action.value === "up") ? -400 : 400;
      await page.evaluate(function(d) { window.scrollBy({ top: d, behavior: 'smooth' }); }, scrollDir);
      await quizDelay(800, 1500);
      break;

    case "navigate":
      if (action.value) await page.goto(action.value, { waitUntil: "networkidle2", timeout: 20000 });
      break;

    case "wait":
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });
      break;

    case "next_survey":
      // Handled in main loop — just wait
      await new Promise(function(resolve) { setTimeout(resolve, 1000); });
      break;

    case "drag_drop": {
      console.log("[DRAG_DROP] Sürükle-bırak: " + action.selector + " → " + action.value);
      var ddFrames = await getCandidateFrames();
      var ddDone = false;
      for (var ddf = 0; ddf < ddFrames.length && !ddDone; ddf++) {
        try {
          ddDone = await ddFrames[ddf].evaluate(function(sourceText, targetText) {
            function normalize(text) { return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
            function isVisible(el) {
              if (!el) return false;
              var rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }

            var allEls = Array.from(document.querySelectorAll('*')).filter(isVisible);
            var srcNorm = normalize(sourceText);
            var tgtNorm = normalize(targetText);

            var sourceEl = null;
            var targetEl = null;

            for (var i = 0; i < allEls.length; i++) {
              var el = allEls[i];
              var text = normalize(el.textContent || '');
              var draggable = el.getAttribute('draggable') === 'true' || el.classList.contains('draggable') || el.getAttribute('data-drag') !== null;

              if (!sourceEl && (text === srcNorm || (text.includes(srcNorm) && text.length < srcNorm.length + 10))) {
                if (draggable || el.closest('[draggable="true"]')) {
                  sourceEl = el.closest('[draggable="true"]') || el;
                } else {
                  sourceEl = el;
                }
              }

              var isDropZone = el.classList.contains('drop-target') || el.classList.contains('dropzone') || el.classList.contains('drop-zone') ||
                el.getAttribute('data-drop') !== null || el.getAttribute('data-droppable') !== null ||
                (el.style.border && el.style.border.includes('dashed')) ||
                window.getComputedStyle(el).borderStyle === 'dashed';

              if (!targetEl && isDropZone) {
                targetEl = el;
              }
              if (!targetEl && tgtNorm && text.includes(tgtNorm)) {
                targetEl = el;
              }
            }

            if (!targetEl) {
              var placeholders = Array.from(document.querySelectorAll('[class*="drop"], [class*="placeholder"], [class*="target"], [style*="dashed"]')).filter(isVisible);
              if (placeholders.length > 0) targetEl = placeholders[0];
            }

            if (!sourceEl || !targetEl) return false;

            var srcRect = sourceEl.getBoundingClientRect();
            var tgtRect = targetEl.getBoundingClientRect();
            var srcX = srcRect.left + srcRect.width / 2;
            var srcY = srcRect.top + srcRect.height / 2;
            var tgtX = tgtRect.left + tgtRect.width / 2;
            var tgtY = tgtRect.top + tgtRect.height / 2;

            var dataTransfer = new DataTransfer();
            try { dataTransfer.setData('text/plain', srcNorm); } catch(e) {}

            function fire(el, type, x, y, dt) {
              var evt = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
              el.dispatchEvent(evt);
            }

            fire(sourceEl, 'pointerdown', srcX, srcY, dataTransfer);
            fire(sourceEl, 'mousedown', srcX, srcY, dataTransfer);
            fire(sourceEl, 'dragstart', srcX, srcY, dataTransfer);
            fire(sourceEl, 'drag', srcX, srcY, dataTransfer);
            fire(targetEl, 'dragenter', tgtX, tgtY, dataTransfer);
            fire(targetEl, 'dragover', tgtX, tgtY, dataTransfer);
            fire(targetEl, 'drop', tgtX, tgtY, dataTransfer);
            fire(sourceEl, 'dragend', tgtX, tgtY, dataTransfer);
            fire(targetEl, 'pointerup', tgtX, tgtY, dataTransfer);
            fire(targetEl, 'mouseup', tgtX, tgtY, dataTransfer);

            return true;
          }, action.selector || "", action.value || "");
        } catch (ddErr) {
          console.error("[DRAG_DROP] Frame hata:", ddErr.message);
        }
      }

      if (!ddDone) {
        console.log("[DRAG_DROP] DOM drag başarısız, Puppeteer mouse ile deneniyor...");
        try {
          var coords = await page.evaluate(function(sourceText) {
            function normalize(text) { return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
            function isVisible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
            var srcNorm = normalize(sourceText);
            var allEls = Array.from(document.querySelectorAll('*')).filter(isVisible);
            var src = null, tgt = null;
            for (var i = 0; i < allEls.length; i++) {
              var text = normalize(allEls[i].textContent || '');
              if (!src && (text === srcNorm || (text.includes(srcNorm) && text.length < srcNorm.length + 10))) {
                src = allEls[i];
              }
              var isDrop = allEls[i].classList.contains('drop-target') || allEls[i].classList.contains('dropzone') ||
                allEls[i].getAttribute('data-drop') !== null || window.getComputedStyle(allEls[i]).borderStyle === 'dashed';
              if (!tgt && isDrop) tgt = allEls[i];
            }
            if (!tgt) {
              var ph = Array.from(document.querySelectorAll('[class*="drop"], [class*="placeholder"], [class*="target"], [style*="dashed"]')).filter(isVisible);
              if (ph.length > 0) tgt = ph[0];
            }
            if (!src || !tgt) return null;
            var sr = src.getBoundingClientRect();
            var tr = tgt.getBoundingClientRect();
            return { sx: sr.left + sr.width/2, sy: sr.top + sr.height/2, tx: tr.left + tr.width/2, ty: tr.top + tr.height/2 };
          }, action.selector || "");

          if (coords) {
            await page.mouse.move(coords.sx, coords.sy, { steps: 5 });
            await page.mouse.down();
            await new Promise(function(r) { setTimeout(r, 200); });
            await page.mouse.move(coords.tx, coords.ty, { steps: 15 });
            await new Promise(function(r) { setTimeout(r, 100); });
            await page.mouse.up();
            console.log("[DRAG_DROP] ✅ Mouse drag tamamlandı");
          } else {
            console.log("[DRAG_DROP] ❌ Kaynak/hedef bulunamadı");
          }
        } catch (mouseErr) {
          console.error("[DRAG_DROP] Mouse drag hatası:", mouseErr.message);
        }
      } else {
        console.log("[DRAG_DROP] ✅ DOM drag tamamlandı");
      }
      break;
    }
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
  var MAX_RETRIES = 50;

  for (var retry = 0; retry < MAX_RETRIES; retry++) {
    var sessionId = "quiz" + Math.random().toString(36).slice(2, 10);

    try {
      var account = await getLoginAccount();
      if (!account) return;

      // Hesap cooldown kontrolü
      if (isQuizAccountInCooldown(account.id)) {
        var remainMs = (quizAccountCooldowns.get(account.id) || 0) - Date.now();
        console.log("[ACCOUNT] ⏳ " + account.email + " cooldown'da (" + Math.round(remainMs / 1000) + "s), atlanıyor...");
        await supabaseInsertLog(account.email + " cooldown'da, atlanıyor", "warning");
        continue;
      }

      var settings = await getSettings();
      var engine = settings.quiz_engine || "gemini";

      console.log("=== Quiz Bot v5.1 — Motor: " + engine.toUpperCase() + " | Deneme: " + (retry + 1) + "/" + MAX_RETRIES + " | Session: " + sessionId + " ===");
      console.log("URL: " + url);
      console.log("Hesap: " + account.email);
      await supabaseInsertLog("Quiz başlatılıyor [" + engine + "]: " + url + " | Hesap: " + account.email + " | Deneme: " + (retry + 1), "info");

      if (engine === "browser_use") {
        await runBrowserUseEngine(url, account, settings);
      } else {
        await runGeminiEngine(url, account, settings);
      }

      // Başarılı — session ve hesap sıfırla
      quizMarkSessionSuccess(sessionId);
      quizConsecutiveErrors = 0;
      return; // Başarılı, çık

    } catch (err) {
      console.error("[QUIZ] Hata (deneme " + (retry + 1) + "):", err.message);
      await supabaseInsertLog("Hata (deneme " + (retry + 1) + "): " + err.message, "error");

      var errMsg = (err.message || "").toLowerCase();
      var isBlocked = errMsg.includes("blocked") || errMsg.includes("403") || errMsg.includes("access denied") || errMsg.includes("rate limit") || errMsg.includes("unusual traffic");
      var isCaptchaFail = errMsg.includes("captcha") || errMsg.includes("sitekey") || errMsg.includes("detached frame") || errMsg.includes("detached");

      if (isBlocked) {
        quizBanSessionImmediately(sessionId, "sayfa engellendi");
        if (account) quizMarkAccountFail(account.id);
        await supabaseInsertLog("🚫 Engel algılandı — IP rotasyonu ve hesap cooldown uygulandı", "warning");
      } else if (isCaptchaFail) {
        quizMarkSessionFail(sessionId, "captcha hatası");
        await supabaseInsertLog("🔄 CAPTCHA/Frame hatası — yeni IP ile tekrar denenecek (deneme " + (retry + 2) + ")", "warning");
      } else {
        quizMarkSessionFail(sessionId, err.message.slice(0, 80));
      }

      // Ardışık hata bazlı bekleme (artan cooldown)
      if (retry < MAX_RETRIES - 1) {
        var waitMs = isCaptchaFail ? (3000 + Math.random() * 5000) : getQuizCooldownWait();
        console.log("[QUIZ] ⏳ " + Math.round(waitMs / 1000) + "s bekleniyor (ardışık hata: " + quizConsecutiveErrors + ")...");
        await supabaseInsertLog("Yeni oturum için " + Math.round(waitMs / 1000) + "s bekleniyor", "info");
        await new Promise(function(r) { setTimeout(r, waitMs); });
      }
    }
  }

  console.log("[QUIZ] ❌ Tüm denemeler başarısız: " + url);
  await supabaseInsertLog("Tüm denemeler başarısız (" + MAX_RETRIES + "x): " + url, "error");
  await supabaseInsertLog("🔁 Görev tekrar kuyruğa alınıyor: " + url, "info");
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
          await supabaseUpdate("link_analyses", task.id, { status: "quiz_pending" });
          await supabaseInsertLog("Görev hatası, tekrar kuyruğa alındı: " + taskErr.message, "warning");
          await new Promise(function(r) { setTimeout(r, 10000); });
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
