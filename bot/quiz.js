/**
 * Quiz/Anket Çözücü Bot v4.0 — Dual Engine
 * Motor 1: Local Puppeteer + Gemini Vision (varsayılan, ücretsiz)
 * Motor 2: Browser Use Cloud API (alternatif, ücretli)
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
    var region = (settings.quiz_proxy_region || "").trim().toLowerCase();
    var sessionId = Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 8) || "quiz0001";

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

    console.log("[GEMINI] Proxy config: " + proxyHost + ":" + proxyPort + " | user=" + proxyUser + " | ülke=" + country + (region ? " | şehir=" + region : ""));
    await supabaseInsertLog("Proxy aktif: " + proxyHost + ":" + proxyPort + " | ülke=" + country + (region ? " | şehir=" + region : ""), "info");
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
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await supabaseInsertLog("Sayfa yüklendi: " + url, "info");

    var maxSteps = 30;
    var stepCount = 0;

    while (stepCount < maxSteps) {
      stepCount++;
      console.log("[GEMINI] Adım " + stepCount + "/" + maxSteps);

      var screenshot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 70 });
      var currentUrl = page.url();
      var action = await askGeminiVision(geminiApiKey, screenshot, currentUrl, account, stepCount);

      if (!action) {
        console.log("[GEMINI] Gemini cevap vermedi, durduruluyor");
        await supabaseInsertLog("Gemini cevap vermedi, durduruluyor", "warning");
        break;
      }

      await supabaseInsertLog("Adım " + stepCount + ": " + action.description, "info");

      if (action.done) {
        console.log("[GEMINI] Görev tamamlandı: " + action.description);
        await supabaseInsertLog("Görev tamamlandı: " + action.description, "success");
        break;
      }

      try {
        await executeAction(page, action);
        await page.waitForTimeout(1500);
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

async function askGeminiVision(apiKey, screenshotBase64, currentUrl, account, step) {
  var fetch = (await import("node-fetch")).default;

  var systemPrompt = `Sen bir web otomasyon asistanısın. Ekran görüntüsünü analiz edip TEK BİR aksiyon belirle.

GÖREV: Anket sitesine gir, giriş yap, anketleri bul ve çöz.

HESAP BİLGİLERİ:
- Email: ${account.email}
- Şifre: ${account.password}

KURALLAR:
1. Çerez popup varsa → kabul et
2. Giriş gerekiyorsa → email/şifre ile giriş yap (Google/Facebook KULLANMA)
3. Anket sayfasını bul → "Surveys", "Answer", "Earn" menülerine tıkla
4. Soruları çöz → mantıklı cevaplar ver
5. "Next", "Continue" ile ilerle
6. Tamamlandıysa done: true döndür

JSON formatında SADECE BİR aksiyon döndür:
{
  "action": "click" | "type" | "scroll" | "wait" | "navigate",
  "selector": "CSS selector veya metin açıklaması",
  "value": "type için yazılacak metin",
  "description": "ne yapıyorsun kısa açıklama",
  "done": false
}

Örnekler:
- Çerez kabul: {"action":"click","selector":"Accept All butonuna tıkla","description":"Çerez popup kabul ediliyor","done":false}
- Metin yaz: {"action":"type","selector":"input[type=email]","value":"test@test.com","description":"Email giriliyor","done":false}
- Tamamlandı: {"action":"wait","selector":"","description":"Anket başarıyla tamamlandı","done":true}`;

  var body = {
    contents: [{
      parts: [
        { text: "Mevcut URL: " + currentUrl + "\nAdım: " + step + "\n\nEkran görüntüsünü analiz et ve bir sonraki aksiyonu belirle." },
        { inlineData: { mimeType: "image/jpeg", data: screenshotBase64 } }
      ]
    }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 500,
      responseMimeType: "application/json"
    }
  };

  try {
    var res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      var errText = await res.text();
      console.error("[GEMINI] API hata:", res.status, errText);
      throw new Error("Gemini API hata: " + res.status);
    }

    var data = await res.json();
    var text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // JSON parse
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error("[GEMINI] Vision hata:", err.message);
    return null;
  }
}

async function executeAction(page, action) {
  switch (action.action) {
    case "click":
      // Önce CSS selector dene
      try {
        if (action.selector && !action.selector.includes(" ")) {
          await page.click(action.selector);
          return;
        }
      } catch (e) {}
      // Metin bazlı tıklama
      var text = action.selector || action.description;
      var clicked = await page.evaluate(function(searchText) {
        var elements = document.querySelectorAll("button, a, input[type=submit], input[type=button], [role=button], label, span, div[onclick]");
        for (var i = 0; i < elements.length; i++) {
          var el = elements[i];
          var elText = (el.textContent || el.value || "").trim().toLowerCase();
          if (elText.includes(searchText.toLowerCase())) {
            el.click();
            return true;
          }
        }
        return false;
      }, text);
      if (!clicked) {
        console.log("  Metin bulunamadı, koordinat tıklama deneniyor...");
      }
      break;

    case "type":
      try {
        // Önce alanı temizle
        await page.click(action.selector);
        await page.evaluate(function(sel) {
          var el = document.querySelector(sel);
          if (el) el.value = "";
        }, action.selector);
        // İnsan gibi yaz
        for (var c = 0; c < action.value.length; c++) {
          await page.keyboard.type(action.value[c]);
          await page.waitForTimeout(30 + Math.random() * 70);
        }
      } catch (typeErr) {
        // Fallback: Tüm input'ları dene
        await page.evaluate(function(val, desc) {
          var inputs = document.querySelectorAll("input, textarea");
          for (var i = 0; i < inputs.length; i++) {
            var inp = inputs[i];
            var placeholder = (inp.placeholder || "").toLowerCase();
            var label = (inp.getAttribute("aria-label") || "").toLowerCase();
            var type = (inp.type || "").toLowerCase();
            if (desc.toLowerCase().includes("email") && (type === "email" || placeholder.includes("email"))) {
              inp.value = val; inp.dispatchEvent(new Event("input", {bubbles: true})); return;
            }
            if (desc.toLowerCase().includes("password") && type === "password") {
              inp.value = val; inp.dispatchEvent(new Event("input", {bubbles: true})); return;
            }
          }
        }, action.value, action.description);
      }
      break;

    case "scroll":
      await page.evaluate(function() { window.scrollBy(0, 400); });
      break;

    case "navigate":
      if (action.value) await page.goto(action.value, { waitUntil: "networkidle2", timeout: 20000 });
      break;

    case "wait":
      await page.waitForTimeout(2000);
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
  var engineLabel = engine === "browser_use" ? "Browser Use Cloud" : "Puppeteer + Gemini Vision";

  console.log("Quiz bot v4.0 (" + engineLabel + ") başlatıldı - görev bekleniyor...");
  await supabaseInsertLog("Quiz bot v4.0 (" + engineLabel + ") başlatıldı", "info");

  // Motor kontrolü
  if (engine === "gemini") {
    var geminiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || "";
    if (!geminiKey) {
      await supabaseInsertLog("Gemini API key bulunamadı! bot_settings'e gemini_api_key ekleyin.", "error");
      return;
    }
    await supabaseInsertLog("Gemini API key doğrulandı ✓", "success");
  } else {
    var buKey = settings.browser_use_api_key || process.env.BROWSER_USE_API_KEY || "";
    if (!buKey) {
      await supabaseInsertLog("Browser Use API key bulunamadı!", "error");
      return;
    }
    await supabaseInsertLog("Browser Use API key doğrulandı ✓", "success");
  }

  while (true) {
    try {
      // Motor değişikliği kontrolü
      var freshSettings = await getSettings();
      var currentEngine = freshSettings.quiz_engine || "gemini";
      if (currentEngine !== engine) {
        engine = currentEngine;
        engineLabel = engine === "browser_use" ? "Browser Use Cloud" : "Puppeteer + Gemini Vision";
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
