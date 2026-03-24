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
        await new Promise(function(resolve) { setTimeout(resolve, 2500); });
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
  switch (action.action) {
    case "click": {
      try {
        if (action.selector && /^[.#\[]|^[a-z]+[.#\[]/i.test(action.selector)) {
          await page.click(action.selector);
          return;
        }
      } catch (e) {}

      var searchTexts = buildClickSearchTexts(action);
      var clickResult = await page.evaluate(function(candidates) {
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

        var phrases = (candidates || []).map(normalize).filter(Boolean);
        var weakWords = { button: true, buton: true, tıkla: true, tikla: true, click: true, link: true, için: true, icin: true, yap: true, bas: true, press: true };
        var words = [];
        for (var p = 0; p < phrases.length; p++) {
          var parts = phrases[p].split(" ");
          for (var w = 0; w < parts.length; w++) {
            var word = parts[w];
            if (word.length > 1 && !weakWords[word] && words.indexOf(word) === -1) words.push(word);
          }
        }

        var elements = Array.from(document.querySelectorAll("button, a, input[type=submit], input[type=button], [role=button], label, [onclick], [tabindex]"))
          .filter(isVisible);

        var best = null;
        var bestScore = 0;
        var bestText = "";

        for (var i = 0; i < elements.length; i++) {
          var el = elements[i];
          var text = normalize(el.textContent || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "");
          if (!text) continue;

          var score = 0;
          for (var j = 0; j < phrases.length; j++) {
            var phrase = phrases[j];
            if (!phrase) continue;
            if (text === phrase) score = Math.max(score, 100);
            else if (text.includes(phrase) || phrase.includes(text)) score = Math.max(score, 80);
          }

          if (score < 80 && words.length > 0) {
            var matched = 0;
            for (var k = 0; k < words.length; k++) {
              if (text.includes(words[k])) matched++;
            }
            if (matched > 0) score = Math.max(score, matched * 20);
          }

          if (score > bestScore) {
            best = el;
            bestScore = score;
            bestText = text;
          }
        }

        if (best && bestScore >= 40) {
          best.click();
          return { clicked: true, matchedText: bestText, score: bestScore };
        }

        return { clicked: false, matchedText: bestText, score: bestScore };
      }, searchTexts);

      if (!clickResult.clicked) {
        throw new Error("Tıklanabilir öğe bulunamadı: " + searchTexts.join(" | "));
      }
      return;
    }

    case "type":
      try {
        await page.click(action.selector);
        await page.evaluate(function(sel) {
          var el = document.querySelector(sel);
          if (el) el.value = "";
        }, action.selector);
        for (var c = 0; c < action.value.length; c++) {
          await page.keyboard.type(action.value[c]);
          await new Promise(function(resolve) { setTimeout(resolve, 30 + Math.random() * 70); });
        }
      } catch (typeErr) {
        await page.evaluate(function(val, desc) {
          var inputs = document.querySelectorAll("input, textarea");
          for (var i = 0; i < inputs.length; i++) {
            var inp = inputs[i];
            var placeholder = (inp.placeholder || "").toLowerCase();
            var label = (inp.getAttribute("aria-label") || "").toLowerCase();
            var type = (inp.type || "").toLowerCase();
            if (desc.toLowerCase().includes("email") && (type === "email" || placeholder.includes("email") || label.includes("email"))) {
              inp.value = val; inp.dispatchEvent(new Event("input", {bubbles: true})); return;
            }
            if (desc.toLowerCase().includes("password") && (type === "password" || placeholder.includes("password") || label.includes("password"))) {
              inp.value = val; inp.dispatchEvent(new Event("input", {bubbles: true})); return;
            }
          }
        }, action.value, action.description || action.selector || "");
      }
      break;

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
