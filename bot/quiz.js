/**
 * Quiz/Anket Çözücü Bot v2.1
 * Email/şifre login + AI cevaplarıyla otomatik doldurma
 * Kullanım: node quiz.js [URL]
 */
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ocrpzwrsyiprfuzsyivf.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc";
const DISPLAY = process.env.QUIZ_DISPLAY || ":99";
let currentBrowser = null;

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

async function supabaseInsertLog(message, status) {
  status = status || "info";
  var fetch = (await import("node-fetch")).default;
  await fetch(SUPABASE_URL + "/rest/v1/quiz_tracking_logs", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ message: "[QUIZ] " + message, status: status }),
  });
}

// ==================== AI AJAN ====================

async function extractPageElements(page) {
  return await page.evaluate(function() {
    var results = [];
    var selectors = 'button, a, input, select, textarea, div[role="button"], label, [onclick]';
    var nodes = document.querySelectorAll(selectors);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      var cookieParent = el.closest('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [role="dialog"], [aria-modal="true"], [class*="gdpr" i], [id*="gdpr" i]');
      results.push({
        index: results.length,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        text: (el.textContent || el.value || "").replace(/\s+/g, " ").trim().slice(0, 100),
        id: el.id || null,
        name: el.name || null,
        className: (el.className || "").toString().slice(0, 100),
        href: el.href ? el.href.slice(0, 150) : null,
        placeholder: el.placeholder || null,
        ariaLabel: el.getAttribute("aria-label") || null,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        isInCookieBanner: !!cookieParent
      });
    }
    return results;
  });
}

async function askAgent(task, elements, context) {
  var fetch = (await import("node-fetch")).default;
  var res = await fetch(SUPABASE_URL + "/functions/v1/dom-agent", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ elements: elements, task: task, context: context || null }),
  });
  if (!res.ok) {
    var errText = await res.text();
    throw new Error("Agent hatasi (" + res.status + "): " + errText);
  }
  return await res.json();
}

async function executeAgentActions(page, actions) {
  var allElements = await page.$$('button, a, input, select, textarea, div[role="button"], label, [onclick]');
  var visibleElements = [];
  for (var i = 0; i < allElements.length; i++) {
    var visible = await page.evaluate(function(el) {
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    }, allElements[i]);
    if (visible) visibleElements.push(allElements[i]);
  }

  for (var j = 0; j < actions.length; j++) {
    var action = actions[j];
    console.log("  Agent action: " + action.type + " [" + action.elementIndex + "] - " + action.reason);
    await supabaseInsertLog("Agent: " + action.type + " - " + action.reason, "info");

    if (action.type === "none" || action.type === "wait") { await randomDelay(1000, 2000); continue; }

    var targetEl = visibleElements[action.elementIndex];
    if (!targetEl) { console.log("  Element bulunamadi: index " + action.elementIndex); continue; }

    await targetEl.evaluate(function(el) { el.scrollIntoView({ block: "center", behavior: "instant" }); });
    await randomDelay(300, 600);

    if (action.type === "click") {
      await humanClick(page, targetEl);
      await randomDelay(500, 1500);
    } else if (action.type === "type" && action.value) {
      await humanClick(page, targetEl);
      await randomDelay(200, 400);
      await page.keyboard.down("Control").catch(function() {});
      await page.keyboard.press("A").catch(function() {});
      await page.keyboard.up("Control").catch(function() {});
      await page.keyboard.press("Backspace").catch(function() {});
      for (var k = 0; k < action.value.length; k++) {
        await page.keyboard.type(action.value[k], { delay: 40 + Math.random() * 60 });
      }
      await randomDelay(300, 600);
    }
  }
}

async function agentStep(page, task, context) {
  var elements = await extractPageElements(page);
  console.log("  " + elements.length + " element tespit edildi, AI'a soruluyor...");
  await supabaseInsertLog("Agent step: " + task.slice(0, 120), "info");
  var result = await askAgent(task, elements, context);
  console.log("  Agent cevabi: " + result.status + " - " + result.message);
  if (result.status === "found" && result.actions && result.actions.length > 0) {
    await executeAgentActions(page, result.actions);
  }
  return result;
}

async function legacyDismissCookies(page) {
  for (var attempt = 0; attempt < 5; attempt++) {
    try {
      var dismissed = await page.evaluate(function() {
        function isVisible(el) {
          if (!el) return false;
          var style = window.getComputedStyle(el);
          var rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        }

        var keywords = [
          "accept all", "accept", "allow all", "allow", "agree", "i agree", "got it", "ok", "okay",
          "kabul", "kabul et", "hepsini kabul et", "tamam", "anladım", "çerezleri kabul et", "cookie kabul"
        ];
        var rejectWords = ["reject", "reject all", "more choices", "manage", "preferences", "ayar", "reddet", "tercih"];
        var nodes = document.querySelectorAll("button, a, div[role='button'], input[type='button'], input[type='submit']");
        var bestNode = null;
        var bestScore = -9999;
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!isVisible(node)) continue;
          var text = (node.textContent || node.value || "").toLowerCase().replace(/\s+/g, " ").trim();
          if (!text) continue;
          var blocked = false;
          for (var r = 0; r < rejectWords.length; r++) {
            if (text.indexOf(rejectWords[r]) !== -1) { blocked = true; break; }
          }
          if (blocked) continue;
          var rect = node.getBoundingClientRect();
          var score = 0;
          var cookieParent = node.closest('[id*="cookie" i], [class*="cookie" i], [aria-label*="cookie" i], [data-testid*="cookie" i], [id*="consent" i], [class*="consent" i], [role="dialog"], [aria-modal="true"]');
          if (cookieParent) score += 120;
          if (rect.left < window.innerWidth * 0.45) score += 70;
          if (rect.top > window.innerHeight * 0.45) score += 40;
          for (var j = 0; j < keywords.length; j++) {
            if (text === keywords[j]) score += 200;
            else if (text.indexOf(keywords[j]) !== -1) score += 120;
          }
          if (score > bestScore) {
            bestScore = score;
            bestNode = node;
          }
        }

        if (bestNode && bestScore > 0) {
          bestNode.scrollIntoView({ block: "center", behavior: "instant" });
          bestNode.click();
          return true;
        }

        return false;
      });
      if (dismissed) return true;
    } catch (e) {}
    await randomDelay(300, 700);
  }
  return false;
}

async function clickPreferredCookieButton(page) {
  try {
    var candidates = await page.$$("button, a, div[role='button'], input[type='button'], input[type='submit']");
    var best = null;
    var bestScore = -9999;

    for (var i = 0; i < candidates.length; i++) {
      try {
        var info = await page.evaluate(function(el) {
          var style = window.getComputedStyle(el);
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return null;
          var text = (el.textContent || el.value || "").toLowerCase().replace(/\s+/g, " ").trim();
          var parent = el.closest('[id*="cookie" i], [class*="cookie" i], [aria-label*="cookie" i], [data-testid*="cookie" i], [id*="consent" i], [class*="consent" i], [role="dialog"], [aria-modal="true"]');
          return {
            text: text,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            inCookie: !!parent,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          };
        }, candidates[i]);

        if (!info || !info.text) continue;
        if (info.text.indexOf("reject") !== -1 || info.text.indexOf("reddet") !== -1 || info.text.indexOf("manage") !== -1 || info.text.indexOf("preferences") !== -1 || info.text.indexOf("more choices") !== -1) continue;

        var score = 0;
        if (info.inCookie) score += 300;
        if (info.text === "accept all") score += 500;
        if (info.text.indexOf("accept all") !== -1) score += 400;
        if (info.text.indexOf("accept") !== -1) score += 260;
        if (info.text.indexOf("kabul") !== -1) score += 260;
        if (info.text.indexOf("agree") !== -1) score += 180;
        if (info.top > info.viewportHeight * 0.65) score += 180;
        if (info.left < info.viewportWidth * 0.45) score += 220;

        if (score > bestScore) {
          best = candidates[i];
          bestScore = score;
        }
      } catch (e) {}
    }

    if (best && bestScore > 0) {
      await best.evaluate(function(el) { el.scrollIntoView({ block: "center", behavior: "instant" }); });
      await randomDelay(250, 500);
      await humanClick(page, best);
      await supabaseInsertLog("Cookie kabul butonu soldan/assagidan onceliklendirilerek tiklandi", "info");
      return true;
    }
  } catch (e) {}

  return false;
}

// ==================== AI ANALİZ ====================

// ==================== reCAPTCHA v2 ÇÖZÜCÜ (2Captcha) ====================

async function get2CaptchaApiKey() {
  try {
    var settings = await supabaseGet("bot_settings", "key=eq.captcha_api_key&limit=1");
    if (settings && settings.length > 0 && settings[0].value) return settings[0].value;
  } catch (e) {}
  return process.env.TWOCAPTCHA_API_KEY || null;
}

async function solveRecaptchaV2(page) {
  try {
    // reCAPTCHA iframe var mı kontrol et
    var recaptchaInfo = await page.evaluate(function() {
      // reCAPTCHA sitekey'i bul
      var recaptchaEl = document.querySelector('[data-sitekey], .g-recaptcha');
      if (recaptchaEl) {
        return { sitekey: recaptchaEl.getAttribute("data-sitekey"), found: true };
      }
      // iframe içinde olabilir
      var iframe = document.querySelector('iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"]');
      if (iframe) {
        var src = iframe.src || "";
        var match = src.match(/[?&]k=([^&]+)/);
        return { sitekey: match ? match[1] : null, found: true };
      }
      // Challenge popup kontrolü
      var challengeFrame = document.querySelector('iframe[title*="recaptcha challenge"], iframe[src*="bframe"]');
      if (challengeFrame) return { sitekey: null, found: true, challengeOnly: true };
      return { found: false };
    });

    if (!recaptchaInfo.found) return false;

    console.log("  reCAPTCHA v2 algilandi, 2Captcha ile cozuluyor...");
    await supabaseInsertLog("reCAPTCHA v2 algilandi, 2Captcha ile cozuluyor", "info");

    var apiKey = await get2CaptchaApiKey();
    if (!apiKey) {
      console.log("  2Captcha API key bulunamadi!");
      await supabaseInsertLog("2Captcha API key eksik - bot_settings'te captcha_api_key tanimlayin", "error");
      return false;
    }

    var sitekey = recaptchaInfo.sitekey;
    if (!sitekey) {
      // Sayfadaki tüm script/iframe'lerden sitekey bulmaya çalış
      sitekey = await page.evaluate(function() {
        var scripts = document.querySelectorAll("script[src*='recaptcha']");
        for (var i = 0; i < scripts.length; i++) {
          var m = (scripts[i].src || "").match(/[?&]render=([^&]+)/);
          if (m) return m[1];
        }
        var allHtml = document.documentElement.outerHTML;
        var keyMatch = allHtml.match(/sitekey['":\s]+(['"]([\w-]+)['"])/);
        return keyMatch ? keyMatch[2] : null;
      });
    }

    if (!sitekey) {
      console.log("  reCAPTCHA sitekey bulunamadi");
      await supabaseInsertLog("reCAPTCHA sitekey bulunamadi", "warning");
      return false;
    }

    var pageUrl = await page.url();
    console.log("  Sitekey: " + sitekey);
    await supabaseInsertLog("reCAPTCHA sitekey: " + sitekey.slice(0, 20) + "...", "info");

    // 2Captcha'ya gönder
    var fetch = (await import("node-fetch")).default;
    var createRes = await fetch("https://2captcha.com/in.php?key=" + apiKey + "&method=userrecaptcha&googlekey=" + sitekey + "&pageurl=" + encodeURIComponent(pageUrl) + "&json=1");
    var createData = await createRes.json();

    if (createData.status !== 1) {
      console.log("  2Captcha gönderilemedi:", createData.request);
      await supabaseInsertLog("2Captcha hata: " + createData.request, "error");
      return false;
    }

    var taskId = createData.request;
    console.log("  2Captcha task: " + taskId + " - cozum bekleniyor...");
    await supabaseInsertLog("2Captcha task olusturuldu: " + taskId, "info");

    // Çözümü bekle (max 120sn)
    var token = null;
    for (var attempt = 0; attempt < 24; attempt++) {
      await new Promise(function(r) { setTimeout(r, 5000); });
      var resultRes = await fetch("https://2captcha.com/res.php?key=" + apiKey + "&action=get&id=" + taskId + "&json=1");
      var resultData = await resultRes.json();
      if (resultData.status === 1) {
        token = resultData.request;
        break;
      }
      if (resultData.request !== "CAPCHA_NOT_READY") {
        console.log("  2Captcha hatasi:", resultData.request);
        await supabaseInsertLog("2Captcha cozum hatasi: " + resultData.request, "error");
        return false;
      }
    }

    if (!token) {
      console.log("  2Captcha zaman asimi");
      await supabaseInsertLog("2Captcha zaman asimi (120sn)", "error");
      return false;
    }

    console.log("  reCAPTCHA cozuldu! Token enjekte ediliyor...");
    await supabaseInsertLog("reCAPTCHA cozuldu, token enjekte ediliyor", "success");

    // Token'ı sayfaya enjekte et
    await page.evaluate(function(t) {
      // g-recaptcha-response textarea'ya yaz
      var textareas = document.querySelectorAll("#g-recaptcha-response, textarea[name='g-recaptcha-response']");
      for (var i = 0; i < textareas.length; i++) {
        textareas[i].style.display = "block";
        textareas[i].value = t;
      }
      // Callback'i çağır
      if (typeof window.___grecaptcha_cfg !== "undefined") {
        var clients = window.___grecaptcha_cfg.clients;
        if (clients) {
          for (var key in clients) {
            var client = clients[key];
            try {
              // Callback fonksiyonunu bul
              var findCallback = function(obj) {
                if (!obj || typeof obj !== "object") return null;
                for (var k in obj) {
                  if (typeof obj[k] === "function") return obj[k];
                  if (typeof obj[k] === "object") {
                    var found = findCallback(obj[k]);
                    if (found) return found;
                  }
                }
                return null;
              };
              var cb = findCallback(client);
              if (cb) cb(t);
            } catch (e2) {}
          }
        }
      }
      // Fallback: grecaptcha callback
      if (typeof window.grecaptcha !== "undefined" && window.grecaptcha.getResponse) {
        try { window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute && window.grecaptcha.enterprise.execute(); } catch (e3) {}
      }
    }, token);

    await randomDelay(1000, 2000);
    return true;
  } catch (err) {
    console.error("  reCAPTCHA cozme hatasi:", err.message);
    await supabaseInsertLog("reCAPTCHA hatasi: " + err.message, "error");
    return false;
  }
}

async function analyzeWithAI(url) {
  var fetch = (await import("node-fetch")).default;
  console.log("AI analiz basliyor: " + url);
  await supabaseInsertLog("AI analiz basliyor: " + url, "info");
  var res = await fetch(SUPABASE_URL + "/functions/v1/analyze-link", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ url: url, mode: "bot" }),
  });
  var data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "AI analiz hatasi: " + res.status);
  var questions;
  try {
    var answerText = data.answer;
    var jsonMatch = answerText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, answerText];
    var jsonStr = jsonMatch[1].trim();
    var parsed = JSON.parse(jsonStr);
    questions = parsed.questions || [];
  } catch (e) {
    console.error("AI cevabi JSON parse edilemedi:", e.message);
    console.log("Ham cevap:", data.answer);
    await supabaseInsertLog("AI cevabi parse edilemedi: " + e.message, "error");
    return { questions: [], rawAnswer: data.answer };
  }
  console.log(questions.length + " soru tespit edildi");
  await supabaseInsertLog(questions.length + " soru tespit edildi", "success");
  return { questions: questions, rawAnswer: data.answer };
}

// ==================== TARAYICI KONTROL ====================

async function preparePage(page) {
  await page.evaluateOnNewDocument(function() {
    Object.defineProperty(navigator, "webdriver", { get: function() { return false; } });
  });
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
}

async function forceDesktopWindow(page) {
  try {
    var client = await page.target().createCDPSession();
    var windowInfo = await client.send("Browser.getWindowForTarget").catch(function() { return null; });
    if (windowInfo && windowInfo.windowId) {
      await client.send("Browser.setWindowBounds", {
        windowId: windowInfo.windowId,
        bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: "normal" },
      }).catch(function() {});
    }
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1920,
      screenHeight: 1080,
      positionX: 0,
      positionY: 0,
      scale: 1,
      screenOrientation: { angle: 0, type: "landscapePrimary" },
    }).catch(function() {});
  } catch (e) {}
}

async function getQuizProxyConfig() {
  try {
    var settings = await supabaseGet("bot_settings", "select=key,value");
    if (!settings || !Array.isArray(settings)) return null;
    var map = {};
    for (var i = 0; i < settings.length; i++) map[settings[i].key] = settings[i].value;
    
    if (map.quiz_proxy_enabled === "false") {
      console.log("Quiz proxy devre disi");
      return null;
    }
    
    var host = map.proxy_host || "core-residential.evomi-proxy.com";
    var port = parseInt(map.proxy_port || "1000", 10);
    var username = map.proxy_username || "";
    var password = map.proxy_password || "";
    var country = (map.quiz_proxy_country || map.proxy_country || "US").toLowerCase();
    var region = (map.quiz_proxy_region || "").toLowerCase();
    
    // Session ID for fresh IP
    var sessionId = "quiz" + Math.random().toString(36).slice(2, 10);
    var fullPassword = password + "_country-" + country;
    if (region) fullPassword += "_city-" + region;
    fullPassword += "_session-" + sessionId;
    
    return { host: host, port: port, username: username, password: fullPassword };
  } catch (e) {
    console.error("Quiz proxy config hatasi:", e.message);
    return null;
  }
}

async function launchBrowser() {
  var connect = require("puppeteer-real-browser").connect;
  
  var proxyConfig = await getQuizProxyConfig();
  
  var options = {
    headless: false,
    turnstile: false,
    disableXvfb: true,
    customConfig: {
      chromePath: undefined,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
        "--window-size=1920,1080",
      ],
    },
    connectOption: {},
  };
  
  if (proxyConfig) {
    options.connectOption.proxy = {
      host: proxyConfig.host,
      port: proxyConfig.port,
      username: proxyConfig.username,
      password: proxyConfig.password,
    };
    console.log("Quiz proxy aktif: " + proxyConfig.host + ":" + proxyConfig.port + " (session: " + proxyConfig.password.split("_session-")[1] + ")");
    await supabaseInsertLog("Proxy aktif: " + proxyConfig.host + " | Ülke: " + proxyConfig.password.match(/_country-([^_]+)/)?.[1] || "?", "info");
  } else {
    console.log("Quiz proxy KAPALI — doğrudan bağlantı");
    await supabaseInsertLog("Proxy kapalı — doğrudan bağlantı", "info");
  }
  
  process.env.DISPLAY = DISPLAY;
  console.log("Chrome baslatiliyor (Display: " + DISPLAY + ")...");
  var result = await connect(options);
  currentBrowser = result.browser;
  await preparePage(result.page);
  await forceDesktopWindow(result.page);
  await result.page.bringToFront().catch(function() {});
  return { browser: result.browser, page: result.page };
}

async function reopenInFreshTabIfNeeded(browser, page, url) {
  try {
    var width = await page.evaluate(function() { return window.innerWidth || document.documentElement.clientWidth || 0; });
    if (width >= 1200) return page;

    console.log("Dar/mobil görünüm algılandı (" + width + "px), yeni sekmede tekrar açılıyor...");
    await supabaseInsertLog("Dar görünüm algılandı, yeni sekmede tekrar açılıyor", "warning");

    var newPage = await browser.newPage();
    await preparePage(newPage);
    await forceDesktopWindow(newPage);
    await newPage.bringToFront().catch(function() {});
    await newPage.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await randomDelay(1500, 2500);
    await dismissCookies(newPage);

    try { await page.close(); } catch (e) {}
    return newPage;
  } catch (e) {
    return page;
  }
}

// ==================== INSAN BENZERİ ETKİLEŞİM ====================

function randomDelay(min, max) { min = min || 100; max = max || 400; return new Promise(function(r) { setTimeout(r, min + Math.random() * (max - min)); }); }

async function humanType(page, selector, text) {
  await page.click(selector, { clickCount: 3 });
  await randomDelay(100, 200);
  for (var i = 0; i < text.length; i++) { await page.type(selector, text[i], { delay: 30 + Math.random() * 80 }); }
  await randomDelay(200, 400);
}

async function humanClick(page, element) {
  var box = await element.boundingBox();
  if (!box) return false;
  var x = box.x + box.width / 2 + (Math.random() - 0.5) * 4;
  var y = box.y + box.height / 2 + (Math.random() - 0.5) * 4;
  await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
  await randomDelay(50, 150);
  await page.mouse.down();
  await randomDelay(30, 80);
  await page.mouse.up();
  return true;
}

async function clickByText(page, selectors, keywords, excludeKeywords) {
  excludeKeywords = excludeKeywords || [];
  var elements = await page.$$(selectors);
  // First pass: try exact/priority matches (first keyword has highest priority)
  for (var pass = 0; pass < keywords.length; pass++) {
    for (var i = 0; i < elements.length; i++) {
      try {
        var info = await page.evaluate(function(el) {
          var style = window.getComputedStyle(el);
          var rect = el.getBoundingClientRect();
          return {
            text: (el.textContent || el.value || "").toLowerCase().replace(/\s+/g, " ").trim(),
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
          };
        }, elements[i]);
        if (!info.visible) continue;
        // Skip excluded keywords (e.g. "google", "apple")
        var excluded = false;
        for (var e = 0; e < excludeKeywords.length; e++) {
          if (info.text.indexOf(excludeKeywords[e]) !== -1) { excluded = true; break; }
        }
        if (excluded) continue;
        if (info.text.indexOf(keywords[pass]) !== -1) {
          await elements[i].evaluate(function(el) { el.scrollIntoView({ block: "center", behavior: "instant" }); });
          await randomDelay(200, 400);
          if (await humanClick(page, elements[i])) return true;
        }
      } catch (e2) {}
    }
  }
  return false;
}

async function recoverFromSocialPopup(page) {
  try {
    var socialHosts = ["appleid.apple.com", "accounts.google.com", "apple.com", "google.com"];
    var currentUrl = page.url().toLowerCase();
    for (var i = 0; i < socialHosts.length; i++) {
      if (currentUrl.indexOf(socialHosts[i]) !== -1) {
        console.log("Beklenmeyen sosyal giris sayfasi algilandi, geri donuluyor...");
        await supabaseInsertLog("Sosyal popup algilandi, geri donuluyor", "warning");
        await page.goBack({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
        await randomDelay(1500, 2500);
        return true;
      }
    }

    if (currentBrowser && typeof currentBrowser.pages === "function") {
      var pages = await currentBrowser.pages().catch(function() { return []; });
      for (var j = 0; j < pages.length; j++) {
        var p = pages[j];
        if (p === page) continue;
        var url = "";
        try { url = (p.url() || "").toLowerCase(); } catch (e) {}
        for (var k = 0; k < socialHosts.length; k++) {
          if (url.indexOf(socialHosts[k]) !== -1) {
            try {
              await p.close();
              console.log("Sosyal popup kapatildi: " + url);
            } catch (e2) {}
          }
        }
      }
    }
  } catch (e) {}
  return false;
}

async function clickSwagbucksEmailButton(page) {
  var candidates = await page.$$("button, a, div[role='button']");
  var best = null;
  var bestScore = -9999;

  for (var i = 0; i < candidates.length; i++) {
    try {
      var info = await page.evaluate(function(el) {
        var style = window.getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        return {
          text: (el.textContent || el.value || "").toLowerCase().replace(/\s+/g, " ").trim(),
          className: (el.className || "").toString().toLowerCase(),
          id: (el.id || "").toLowerCase(),
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
          y: rect.top,
        };
      }, candidates[i]);

      if (!info.visible || !info.text) continue;
      if (info.text.indexOf("google") !== -1 || info.text.indexOf("apple") !== -1 || info.text.indexOf("facebook") !== -1) continue;
      if (info.text.indexOf("email") === -1 && info.text.indexOf("e-mail") === -1 && info.text.indexOf("e-posta") === -1) continue;

      var score = 0;
      if (info.text === "continue with email") score += 200;
      if (info.text.indexOf("continue with email") !== -1) score += 150;
      if (info.text.indexOf("email") !== -1) score += 80;
      if (info.className.indexOf("sb-button--dark") !== -1) score += 120;
      if (info.id.indexOf("email") !== -1) score += 30;
      if (info.y > 350) score += 40;

      if (score > bestScore) {
        best = candidates[i];
        bestScore = score;
      }
    } catch (e) {}
  }

  if (!best) return false;
  await best.evaluate(function(el) { el.scrollIntoView({ block: "center", behavior: "instant" }); });
  await randomDelay(250, 450);
  if (await humanClick(page, best)) return true;
  try {
    await best.evaluate(function(el) { el.click(); });
    return true;
  } catch (e2) {}
  return false;
}

// ==================== LOGIN ====================

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

async function handleEmailLogin(page) {
  console.log("Login: AI agent ile kontrol ediliyor...");
  var account = await getLoginAccount();
  if (!account) return false;

  console.log("Email ile giris yapiliyor: " + account.email);
  await supabaseInsertLog("Email giris: " + account.email, "info");

  try {
    // ===== ADIM 1: ÇEREZLERİ KABUL ET =====
    console.log("  Adim 1: Cerezleri kabul ediliyor...");
    await recoverFromSocialPopup(page);
    await dismissCookies(page);
    await randomDelay(1500, 2500);

    // ===== ADIM 2: AI AGENT İLE LOGIN SAYFASINI BUL =====
    console.log("  Adim 2: Login sayfasi araniyor (AI agent)...");
    await supabaseInsertLog("Agent: Login sayfasi araniyor", "info");
    var step1 = await agentStep(page, "Sayfada 'Log In', 'Sign In', 'Giris Yap' gibi bir navigasyon butonu veya linki varsa tikla. Email/kullanici adi input alani zaten gorunuyorsa status: already_done dondur. Google/Apple/Facebook butonlarina TIKLAMA.", null);
    if (step1.status === "found") {
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
      await randomDelay(2000, 3000);
      await recoverFromSocialPopup(page);
      await dismissCookies(page);
    }

    // ===== ADIM 3: CONTINUE WITH EMAIL (AI Agent) =====
    console.log("  Adim 3: Continue with Email araniyor (AI agent)...");
    var step2 = await agentStep(page, "Sayfada 'Continue with Email', 'Email ile devam et' gibi bir buton varsa tikla. Email/kullanici input alani zaten gorunuyorsa status: already_done dondur. Google/Apple/Facebook butonlarina TIKLAMA.", null);
    if (step2.status === "found") {
      await randomDelay(2500, 4000);
      await recoverFromSocialPopup(page);
      await dismissCookies(page);
    }

    // ===== ADIM 4: EMAIL GİR (AI Agent) =====
    console.log("  Adim 4: Email giriliyor (AI agent)...");
    await supabaseInsertLog("Agent: Email giriliyor", "info");
    var step3 = await agentStep(page, "Email veya kullanici adi input alanini bul ve su degeri yaz: " + account.email, "Bu bir login formu. Email alanina yazi yazilacak.");
    if (step3.status !== "found") {
      console.log("  Agent: Email alani bulunamadi");
      await supabaseInsertLog("Agent: Email alani bulunamadi", "warning");
      return false;
    }
    await supabaseInsertLog("Email dolduruldu", "info");
    await randomDelay(500, 1000);

    // ===== ADIM 5: ŞİFRE GİR (AI Agent) =====
    console.log("  Adim 5: Sifre giriliyor (AI agent)...");
    var step4 = await agentStep(page, "Sifre (password) input alanini bul ve su degeri yaz: " + account.password + ". Sifre alani yoksa 'Next', 'Continue', 'Devam' gibi ilerleme butonuna tikla.", "Login formu, email zaten girildi.");
    if (step4.status === "found" && step4.actions) {
      var hasPassword = false;
      for (var a = 0; a < step4.actions.length; a++) {
        if (step4.actions[a].type === "type") hasPassword = true;
      }
      if (!hasPassword) {
        // Next/Continue'a tıklandı, şifre alanı henüz yok
        await randomDelay(2000, 4000);
        await recoverFromSocialPopup(page);
        await dismissCookies(page);
        console.log("  Adim 5b: Sifre alani tekrar araniyor...");
        await agentStep(page, "Sifre (password) input alanini bul ve su degeri yaz: " + account.password, "Login formu ikinci adim, email girildi, simdi sifre girilecek.");
      }
    } else if (step4.status !== "found") {
      // Fallback: Eski yöntemle şifre alanı ara
      var passwordSelector = 'input[type="password"], input[name="password"], input[id*="password"]';
      await recoverFromSocialPopup(page);
      await clickByText(page, "button, a, div[role='button'], input[type='submit']", [
        "next", "continue", "devam", "ileri", "sonraki", "proceed", "submit"
      ], ["google", "apple", "facebook"]);
      await randomDelay(2000, 4000);
      await page.waitForSelector(passwordSelector, { timeout: 10000 }).catch(function() {});
      var passwordInput = await page.$(passwordSelector);
      if (passwordInput) {
        await humanClick(page, passwordInput);
        await randomDelay(300, 600);
        for (var m = 0; m < account.password.length; m++) {
          await page.keyboard.type(account.password[m], { delay: 40 + Math.random() * 60 });
        }
      }
    }
    await supabaseInsertLog("Sifre dolduruldu", "info");
    await randomDelay(500, 1000);

    // ===== ADIM 6: GİRİŞ YAP (AI Agent) =====
    console.log("  Adim 6: Giris butonu araniyor (AI agent)...");
    await supabaseInsertLog("Agent: Giris butonuna tiklaniyor", "info");
    await agentStep(page, "'Log In', 'Sign In', 'Login', 'Giris Yap', 'Submit' gibi giris butonuna tikla. Google/Apple/Facebook/Create/Register butonlarina TIKLAMA.", "Login formu, email ve sifre girildi, simdi submit edilecek.");

    await randomDelay(2000, 3000);

    // ===== ADIM 7: reCAPTCHA VARSA ÇÖZ =====
    var captchaSolved = await solveRecaptchaV2(page);
    if (captchaSolved) {
      console.log("  reCAPTCHA cozuldu, giris butonu tekrar tiklaniyor...");
      await supabaseInsertLog("reCAPTCHA cozuldu, tekrar submit", "info");
      // Submit'e tekrar bas
      await agentStep(page, "'Log In', 'Sign In', 'Login', 'Submit', 'Verify' gibi giris/dogrulama butonuna tikla.", "reCAPTCHA cozuldu, formu gonder.");
      await randomDelay(3000, 5000);
    } else {
      await randomDelay(1000, 3000);
    }

    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
    await recoverFromSocialPopup(page);
    await dismissCookies(page);
    console.log("Email giris tamamlandi!");
    await supabaseInsertLog("Email giris basarili: " + account.email, "success");
    return true;
  } catch (err) {
    console.error("Email giris hatasi:", err.message);
    await supabaseInsertLog("Email giris hatasi: " + err.message, "error");
    await supabaseUpdate("quiz_accounts", account.id, { fail_count: (account.fail_count || 0) + 1 });
    return false;
  }
}

// ==================== COOKIE POPUP KAPATMA ====================

async function dismissCookies(page) {
  var preferredClicked = await clickPreferredCookieButton(page);
  if (preferredClicked) {
    console.log("  Cookie popup tercihli buton ile kapatildi");
    await randomDelay(700, 1200);
    return true;
  }

  try {
    console.log("  Cookie: AI agent ile deneniyor...");
    var agentResult = await agentStep(page, "Sayfadaki cookie/cerez popup'inda once alt bolgedeki soldaki kabul butonunu tercih et. 'Accept All', 'Kabul Et', 'Accept', 'Allow All', 'I Agree', 'Got it' gibi KABUL butonuna tikla. 'Reject', 'Manage', 'Preferences', 'More choices' gibi butonlara TIKLAMA. isInCookieBanner: true olan ve sayfanin alt-sol tarafindaki elementlere oncelik ver.", null);
    if (agentResult.status === "found") {
      console.log("  Cookie popup AI agent ile kapatildi");
      await randomDelay(700, 1200);
      return true;
    }
    if (agentResult.status === "already_done" || agentResult.status === "not_found") {
      console.log("  Cookie popup bulunamadi veya zaten yok");
      return false;
    }
  } catch (agentErr) {
    console.log("  AI agent cookie hatasi: " + agentErr.message);
  }
  console.log("  Cookie: fallback heuristic deneniyor...");
  return await legacyDismissCookies(page);
}

// ==================== SORU DOLDURMA ====================

async function fillAnswers(page, questions) {
  console.log(questions.length + " soruyu doldurmaya basliyor...");
  await supabaseInsertLog(questions.length + " soruyu doldurmaya basliyor", "info");
  var filled = 0, failed = 0;
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    try {
      console.log("--- Soru " + q.question_number + ": " + (q.question_text || "").slice(0, 60) + "...");
      console.log("   Tip: " + q.type + ", Cevap: " + q.answer);
      var success = false;
      if (q.type === "multiple_choice") success = await fillMultipleChoice(page, q);
      else if (q.type === "text_input") success = await fillTextInput(page, q);
      else console.log("   Bilinmeyen soru tipi: " + q.type);
      if (success) filled++; else failed++;
      await randomDelay(500, 1500);
    } catch (err) { console.error("   Soru " + q.question_number + " hatasi:", err.message); failed++; }
  }
  var msg = "Doldurma tamamlandi: " + filled + " basarili, " + failed + " basarisiz";
  console.log(msg);
  await supabaseInsertLog(msg, failed > 0 ? "warning" : "success");
  return { filled: filled, failed: failed };
}

async function fillMultipleChoice(page, q) {
  if (q.selector_hint) { try { var el = await page.$(q.selector_hint); if (el) { await humanClick(page, el); console.log("   Selector ile secildi"); return true; } } catch (e) {} }
  var answerText = q.answer.toLowerCase().trim();
  var found = await page.evaluate(function(answer) {
    var inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var label = (input.labels && input.labels[0]) || input.closest("label") || (input.parentElement && input.parentElement.querySelector("label, span, div"));
      if (label) { var labelText = (label.textContent || "").toLowerCase().trim(); if (labelText.indexOf(answer) !== -1 || answer.indexOf(labelText) !== -1) { input.scrollIntoView({ behavior: "smooth", block: "center" }); return { found: true, id: input.id, name: input.name, value: input.value }; } }
    }
    var allElements = document.querySelectorAll("li, div, span, p, a, button");
    for (var j = 0; j < allElements.length; j++) {
      var el = allElements[j]; var text = (el.textContent || "").toLowerCase().trim();
      if (text === answer || (text.length < 200 && text.indexOf(answer) !== -1)) { var clickable = el.querySelector("input") || el; clickable.scrollIntoView({ behavior: "smooth", block: "center" }); return { found: true, tagFallback: true }; }
    }
    return { found: false };
  }, answerText);
  if (found.found) {
    if (found.id) { await page.click("#" + found.id); }
    else if (found.name && found.value) { await page.click('input[name="' + found.name + '"][value="' + found.value + '"]'); }
    else {
      var elements = await page.$$("li, div, span, label, a");
      for (var k = 0; k < elements.length; k++) {
        var text = await page.evaluate(function(e) { return (e.textContent || "").toLowerCase().trim(); }, elements[k]);
        if (text && (text === answerText || text.indexOf(answerText) !== -1)) { var input = await elements[k].$("input"); await humanClick(page, input || elements[k]); break; }
      }
    }
    console.log("   Coktan secmeli cevap secildi");
    return true;
  }
  if (q.answer_index !== undefined && q.answer_index !== null) {
    var radios = await page.$$('input[type="radio"], input[type="checkbox"]');
    if (radios.length > q.answer_index) { await humanClick(page, radios[q.answer_index]); console.log("   Index ile secildi: " + q.answer_index); return true; }
  }
  console.log("   Coktan secmeli cevap bulunamadi");
  return false;
}

async function fillTextInput(page, q) {
  if (q.selector_hint) { try { var el = await page.$(q.selector_hint); if (el) { await humanType(page, q.selector_hint, q.answer); console.log("   Selector ile dolduruldu"); return true; } } catch (e) {} }
  var filled = await page.evaluate(function(qText, answer) {
    var inputs = document.querySelectorAll('input[type="text"], textarea, input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i]; var parent = input.closest("div, fieldset, section, form");
      if (parent) { var parentText = (parent.textContent || "").toLowerCase(); if (parentText.indexOf(qText.toLowerCase().slice(0, 30)) !== -1) { input.scrollIntoView({ behavior: "smooth", block: "center" }); input.focus(); input.value = answer; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; } }
    }
    return false;
  }, q.question_text || "", q.answer);
  if (filled) { console.log("   Metin girisi dolduruldu"); return true; }
  console.log("   Metin alani bulunamadi");
  return false;
}

async function handlePostLoginOnboarding(page) {
  try {
    var currentUrl = (await page.url()) || "";
    if (currentUrl.toLowerCase().indexOf("onboarding") === -1) return false;

    console.log("Post-login onboarding ekrani algilandi, devam ediliyor...");
    await supabaseInsertLog("Post-login onboarding algilandi", "info");
    await dismissCookies(page);

    var step = await agentStep(
      page,
      "Onboarding ekranindasin. Survey/profil tamamlama adimini devam ettir. 'Complete Your Profile' karti, 'Continue', 'Start', 'Take Survey', 'Go to homepage', 'Explore on my own' gibi quiz veya anasayfaya geciren guvenli bir link/buton varsa tikla. Email verification bekleyen alanlara takilma.",
      "Amac quiz/survey akisini devam ettirmek. Email verify zorunluysa homepage veya survey tarafina gecis seceneklerini tercih et."
    );

    if (step.status === "found") {
      await randomDelay(2500, 4500);
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
      await dismissCookies(page);
      await supabaseInsertLog("Onboarding ekrani gecildi", "success");
      return true;
    }

    var fallbackClicked = await clickByText(page, "button, a, div[role='button'], input[type='submit']", [
      "take me to the homepage", "explore on my own", "continue", "start", "take survey", "complete your profile"
    ], ["verify email", "google", "apple", "facebook"]);

    if (fallbackClicked) {
      await randomDelay(2500, 4500);
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
      await dismissCookies(page);
      await supabaseInsertLog("Onboarding fallback ile gecildi", "success");
      return true;
    }
  } catch (err) {
    await supabaseInsertLog("Onboarding gecis hatasi: " + err.message, "warning");
  }

  return false;
}

// ==================== ANA İŞLEM ====================

async function processQuiz(url) {
  var browser, page;
  var TARGET_URL = url; // Hedef URL - bot SADECE buraya odaklanacak
  try {
    // 1) Chrome aç
    var result = await launchBrowser();
    browser = result.browser; page = result.page;

    // 2) SADECE hedef URL'ye git
    console.log("Hedef sayfaya gidiliyor: " + TARGET_URL);
    await supabaseInsertLog("Hedef sayfaya gidiliyor: " + TARGET_URL, "info");
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await randomDelay(2000, 4000);
    await forceDesktopWindow(page);
    page = await reopenInFreshTabIfNeeded(browser, page, TARGET_URL);

    // 3) Cookie popup kapat
    await dismissCookies(page);

    // 4) Login gerekiyorsa yap
    var needsLogin = await page.evaluate(function() {
      var loginIndicators = ["log in", "sign in", "login", "signin", "s'identifier", "s'inscrire"];
      var text = (document.body.textContent || "").toLowerCase();
      var hasLoginButton = false;
      var buttons = document.querySelectorAll("button, a");
      for (var i = 0; i < buttons.length; i++) {
        var btnText = (buttons[i].textContent || "").toLowerCase().trim();
        for (var j = 0; j < loginIndicators.length; j++) {
          if (btnText === loginIndicators[j] || btnText.indexOf(loginIndicators[j]) !== -1) {
            hasLoginButton = true; break;
          }
        }
        if (hasLoginButton) break;
      }
      var hasEmailInput = !!document.querySelector('input[type="email"], input[name="email"], input[type="password"]');
      return hasLoginButton || hasEmailInput;
    });

    if (needsLogin) {
      console.log("Login gerekli, giris yapiliyor...");
      var loginOk = await handleEmailLogin(page);
      if (!loginOk) {
        console.log("Email giris basarisiz - VNC uzerinden manuel giris yapabilirsiniz");
        await supabaseInsertLog("Email giris basarisiz - manuel giris gerekli", "warning");
      } else {
        // Login sonrası HEDEF URL'ye geri dön (bot başka yere gitmesin)
        await randomDelay(2000, 3000);
        var currentUrl = (await page.url()) || "";
        if (currentUrl.indexOf(new URL(TARGET_URL).pathname) === -1) {
          console.log("Login sonrasi hedef URL'ye geri donuluyor: " + TARGET_URL);
          await supabaseInsertLog("Hedef URL'ye geri donuluyor", "info");
          await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 30000 });
          await randomDelay(2000, 3000);
          await dismissCookies(page);
        }
      }
    } else {
      console.log("Login gerekli degil, devam ediliyor...");
    }

    // 5) SADECE bu sayfadaki quizi çöz
    await randomDelay(2000, 3000);
    await dismissCookies(page);

    console.log("=== Hedef sayfada quiz cozuluyor ===");
    await supabaseInsertLog("Hedef sayfada quiz analiz ediliyor: " + TARGET_URL, "info");

    var currentPageUrl = await page.url();
    var ai = await analyzeWithAI(currentPageUrl);

    if (ai.questions.length > 0) {
      var fillResult = await fillAnswers(page, ai.questions);
      var msg = "Quiz tamamlandi: " + fillResult.filled + "/" + ai.questions.length + " soru dolduruldu";
      console.log(msg);
      await supabaseInsertLog(msg, fillResult.failed > 0 ? "warning" : "success");

      // Submit butonu varsa tıkla
      await randomDelay(1000, 2000);
      await agentStep(page, "'Submit', 'Gonder', 'Complete', 'Finish', 'Done', 'Next' gibi anketi tamamlayan bir buton varsa tikla.", "Anket sorulari dolduruldu, simdi gonderilecek.");
      await randomDelay(2000, 3000);
    } else {
      console.log("Bu sayfada soru bulunamadi");
      await supabaseInsertLog("Hedef sayfada soru bulunamadi - VNC ile kontrol edin", "warning");
    }

    // 6) Tarayıcıyı açık bırak - BAŞKA SAYFAYA GİTME
    console.log("Gorev tamamlandi. Tarayici acik kaliyor - VNC den kontrol edebilirsiniz.");
    await supabaseInsertLog("Gorev tamamlandi, tarayici acik", "success");
    await new Promise(function(resolve) { browser.on("disconnected", resolve); });
  } catch (err) {
    console.error("Quiz hatasi:", err.message);
    await supabaseInsertLog("Hata: " + err.message, "error");
  } finally {
    if (browser) { try { browser.close(); } catch (e) {} }
  }
}

// ==================== DB POLLING ====================

async function navigateToSurveys(page) {
  var currentUrl = (await page.url()) || "";
  console.log("Anket sayfasina yonlendirme deneniyor... (simdi: " + currentUrl + ")");
  await supabaseInsertLog("Anket sayfasina yonlendirme deneniyor", "info");

  // Bilinen anket sayfası URL kalıpları
  var surveyPaths = ["/survey", "/surveys", "/answer", "/activities", "/discover"];
  for (var i = 0; i < surveyPaths.length; i++) {
    if (currentUrl.toLowerCase().indexOf(surveyPaths[i]) !== -1) {
      console.log("Zaten anket sayfasindayiz: " + currentUrl);
      return true;
    }
  }

  // AI agent ile anket/survey linkini bul
  var step = await agentStep(
    page,
    "Sayfadaki navigasyon menusunde veya icerikte 'Surveys', 'Anketler', 'Answer', 'Activities', 'Discover', 'Earn', 'Daily Poll', 'Gold Surveys' gibi anketlere/gorevlere goturen bir link veya buton varsa tikla. Login/signup butonlarina TIKLAMA.",
    "Amac: Anket listeleme sayfasina gitmek."
  );

  if (step.status === "found") {
    await randomDelay(2500, 4000);
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
    await dismissCookies(page);
    await supabaseInsertLog("Anket sayfasina yonlendirildi", "success");
    return true;
  }

  // Fallback: Bilinen survey URL'lerine doğrudan git
  var host = "";
  try { host = new URL(currentUrl).origin; } catch (e) {}
  if (host) {
    var directPaths = ["/surveys", "/survey", "/discover"];
    for (var j = 0; j < directPaths.length; j++) {
      try {
        await page.goto(host + directPaths[j], { waitUntil: "networkidle2", timeout: 15000 });
        var afterUrl = (await page.url()) || "";
        if (afterUrl.indexOf(directPaths[j]) !== -1) {
          await dismissCookies(page);
          await supabaseInsertLog("Anket sayfasina dogrudan gidildi: " + directPaths[j], "success");
          return true;
        }
      } catch (e) {}
    }
  }

  await supabaseInsertLog("Anket sayfasi bulunamadi", "warning");
  return false;
}

async function findSurveyLinks(page) {
  return await page.evaluate(function() {
    var links = [];
    var allLinks = document.querySelectorAll("a[href]");
    var surveyKeywords = ["survey", "answer", "quiz", "poll", "questionnaire", "anket", "profil"];
    var seen = {};
    for (var i = 0; i < allLinks.length; i++) {
      var el = allLinks[i];
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || style.display === "none" || style.visibility === "hidden") continue;
      var href = (el.href || "").trim();
      var text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!href || seen[href]) continue;
      var lower = (href + " " + text).toLowerCase();
      var isSurvey = false;
      for (var j = 0; j < surveyKeywords.length; j++) {
        if (lower.indexOf(surveyKeywords[j]) !== -1) { isSurvey = true; break; }
      }
      if (!isSurvey) continue;
      if (href.indexOf("javascript:") === 0 || href.indexOf("#") === 0) continue;
      seen[href] = true;
      links.push({ href: href, text: text });
    }
    return links;
  });
}

async function solveSingleSurvey(page, surveyUrl) {
  console.log("Anket aciliyor: " + surveyUrl);
  await supabaseInsertLog("Anket aciliyor: " + surveyUrl, "quiz_solving");

  try {
    await page.goto(surveyUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await randomDelay(2000, 4000);
    await dismissCookies(page);

    // Sayfada soru var mi analiz et
    var currentUrl = await page.url();
    var ai = await analyzeWithAI(currentUrl);

    if (ai.questions.length > 0) {
      var result = await fillAnswers(page, ai.questions);
      var msg = "Anket tamamlandi: " + result.filled + "/" + ai.questions.length + " soru dolduruldu";
      console.log(msg);
      await supabaseInsertLog(msg, result.failed > 0 ? "warning" : "success");

      // Submit butonu varsa tıkla
      await randomDelay(1000, 2000);
      await agentStep(page, "'Submit', 'Gonder', 'Complete', 'Finish', 'Done', 'Next' gibi anketi tamamlayan bir buton varsa tikla.", "Anket sorulari dolduruldu, simdi gonderilecek.");
      await randomDelay(2000, 4000);
      return true;
    } else {
      console.log("Bu sayfada soru bulunamadi");
      await supabaseInsertLog("Anket sayfasinda soru bulunamadi: " + surveyUrl.slice(0, 80), "warning");
      return false;
    }
  } catch (err) {
    console.error("Anket cozme hatasi:", err.message);
    await supabaseInsertLog("Anket hatasi: " + err.message, "error");
    return false;
  }
}

async function findAndSolveSurveys(page) {
  var MAX_SURVEYS = 10;
  var solved = 0;
  var failed = 0;

  console.log("=== Anket arama ve cozme dongusu basliyor ===");
  await supabaseInsertLog("Anket arama dongusu basliyor (max " + MAX_SURVEYS + ")", "info");

  // Önce mevcut sayfada soru var mı kontrol et (doğrudan link gelmiş olabilir)
  try {
    var directUrl = await page.url();
    var directAi = await analyzeWithAI(directUrl);
    if (directAi.questions.length > 0) {
      var directResult = await fillAnswers(page, directAi.questions);
      await supabaseInsertLog("Direkt anket: " + directResult.filled + "/" + directAi.questions.length, directResult.failed > 0 ? "warning" : "success");
      await agentStep(page, "'Submit', 'Gonder', 'Complete', 'Finish', 'Done', 'Next' gibi anketi tamamlayan bir buton varsa tikla.", "Anket sorulari dolduruldu.");
      solved++;
      await randomDelay(2000, 4000);
    }
  } catch (e) {
    console.log("Direkt sayfa analizi atlandi: " + e.message);
  }

  // Anket listeleme sayfasına git
  var foundSurveyPage = await navigateToSurveys(page);
  if (!foundSurveyPage) {
    if (solved === 0) {
      await supabaseInsertLog("Anket sayfasi bulunamadi, bot durdu", "warning");
    }
    return { solved: solved, failed: failed };
  }

  // Anket linklerini bul ve tek tek çöz
  for (var round = 0; round < 3 && solved < MAX_SURVEYS; round++) {
    await randomDelay(2000, 3000);
    var surveyLinks = await findSurveyLinks(page);
    console.log(surveyLinks.length + " anket linki bulundu (tur " + (round + 1) + ")");
    await supabaseInsertLog(surveyLinks.length + " anket linki bulundu", "info");

    if (surveyLinks.length === 0) {
      // AI agent ile anket kartlarını/butonlarını bul
      var agentFind = await agentStep(
        page,
        "Sayfada anket/survey kartlari, 'Start Survey', 'Take Survey', 'Answer', 'Begin' gibi anket baslat butonlari varsa ilkine tikla. Yoksa status: not_found dondur.",
        "Anket listeleme sayfasindayiz, tiklanabilir anket ariyoruz."
      );

      if (agentFind.status === "found") {
        await randomDelay(2500, 4000);
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
        await dismissCookies(page);

        var surveyResult = await solveSingleSurvey(page, await page.url());
        if (surveyResult) solved++;
        else failed++;

        // Anket listesine geri dön
        await page.goBack({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
        await randomDelay(2000, 3000);
        await dismissCookies(page);
        continue;
      }

      break;
    }

    var listPageUrl = await page.url();

    for (var s = 0; s < surveyLinks.length && solved < MAX_SURVEYS; s++) {
      var link = surveyLinks[s];
      console.log("Anket " + (s + 1) + "/" + surveyLinks.length + ": " + link.text.slice(0, 50));

      var ok = await solveSingleSurvey(page, link.href);
      if (ok) solved++;
      else failed++;

      // Anket listesine geri dön
      try {
        await page.goto(listPageUrl, { waitUntil: "networkidle2", timeout: 20000 });
        await randomDelay(2000, 3000);
        await dismissCookies(page);
      } catch (backErr) {
        console.error("Listeye geri donme hatasi:", backErr.message);
        break;
      }
    }
  }

  var summary = "Anket dongusu bitti: " + solved + " cozuldu, " + failed + " basarisiz";
  console.log(summary);
  await supabaseInsertLog(summary, solved > 0 ? "success" : "warning");
  return { solved: solved, failed: failed };
}

async function pollForQuizTasks() {
  console.log("Quiz bot baslatildi - gorev bekleniyor...");
  await supabaseInsertLog("Quiz bot baslatildi - gorev bekleniyor", "info");
  while (true) {
    try {
      var tasks = await supabaseGet("link_analyses", "status=eq.quiz_pending&order=created_at.asc&limit=1");
      if (tasks.length > 0) {
        var task = tasks[0];
        console.log("Yeni quiz gorevi: " + task.url);
        await supabaseUpdate("link_analyses", task.id, { status: "quiz_running" });
        await processQuiz(task.url);
        await supabaseUpdate("link_analyses", task.id, { status: "quiz_done" });
      }
    } catch (err) { console.error("Polling hatasi:", err.message); }
    await new Promise(function(r) { setTimeout(r, 5000); });
  }
}

// ==================== CLI ====================

var args = process.argv.slice(2);
if (args.length > 0) { processQuiz(args[0]).then(function() { process.exit(0); }); }
else { pollForQuizTasks(); }
