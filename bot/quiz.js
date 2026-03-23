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
  await fetch(SUPABASE_URL + "/rest/v1/idata_tracking_logs", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ message: "[QUIZ] " + message, status: status }),
  });
}

// ==================== AI ANALİZ ====================

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

async function launchBrowser() {
  var connect = require("puppeteer-real-browser").connect;
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
  console.log("Login ekrani kontrol ediliyor...");

  var account = await getLoginAccount();
  if (!account) return false;

  console.log("Email ile giris yapiliyor: " + account.email);
  await supabaseInsertLog("Email giris: " + account.email, "info");

  try {
    // 1) HER ZAMAN önce çerezi kabul et
    await dismissCookies(page);
    await randomDelay(1000, 1800);

    var emailSelector = 'input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[id*="email"], input[id*="user"], input[autocomplete="username"], input[placeholder*="mail" i], input[placeholder*="email" i]';
    var passwordSelector = 'input[type="password"], input[name="password"], input[id*="password"], input[autocomplete="current-password"]';
    var emailInput = await page.$(emailSelector);

    // 2) Email alanı görünmüyorsa SADECE email login butonuna tıkla
    if (!emailInput) {
      var emailLoginButton = await page.$('button.sb-button.sb-button--large.sb-button--wide.sb-button--dark');

      if (!emailLoginButton) {
        var candidates = await page.$$("button, a, div[role='button'], input[type='button'], input[type='submit']");
        for (var c = 0; c < candidates.length; c++) {
          try {
            var info = await page.evaluate(function(el) {
              var style = window.getComputedStyle(el);
              var rect = el.getBoundingClientRect();
              return {
                text: (el.textContent || el.value || "").toLowerCase().replace(/\s+/g, " ").trim(),
                visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
                top: rect.top,
              };
            }, candidates[c]);
            if (!info.visible) continue;
            if (info.text.indexOf("continue with email") !== -1 || info.text.indexOf("continue with e-mail") !== -1 || info.text.indexOf("email ile devam") !== -1 || info.text.indexOf("e-posta ile devam") !== -1) {
              emailLoginButton = candidates[c];
            }
          } catch (e) {}
        }
      }

      if (emailLoginButton) {
        await emailLoginButton.evaluate(function(el) { el.scrollIntoView({ block: "center", behavior: "instant" }); });
        await randomDelay(300, 700);
        await humanClick(page, emailLoginButton);
        await supabaseInsertLog("Continue with Email tiklandi", "info");
        await randomDelay(2500, 4000);
        await dismissCookies(page);
        emailInput = await page.$(emailSelector);
      }
    }

    if (!emailInput) {
      console.log("Email alani bulunamadi");
      await supabaseInsertLog("Email alani bulunamadi", "warning");
      return false;
    }

    // 3) Kayıtlı email'i gir
    await emailInput.evaluate(function(el) { el.scrollIntoView({ block: "center", behavior: "instant" }); });
    await humanClick(page, emailInput);
    await randomDelay(300, 600);
    await page.keyboard.down("Control").catch(function() {});
    await page.keyboard.press("A").catch(function() {});
    await page.keyboard.up("Control").catch(function() {});
    await page.keyboard.press("Backspace").catch(function() {});
    for (var j = 0; j < account.email.length; j++) {
      await page.keyboard.type(account.email[j], { delay: 40 + Math.random() * 60 });
    }
    await supabaseInsertLog("Email alani dolduruldu", "info");
    await randomDelay(500, 1000);

    // 4) Şifre alanını bul / gerekirse devam butonuna bas
    var passwordInput = await page.$(passwordSelector);
    if (!passwordInput) {
      await clickByText(page, "button, a, div[role='button'], input[type='submit']", [
        "next", "continue", "devam", "ileri", "sonraki", "proceed", "submit"
      ], ["google", "apple"]);
      await randomDelay(2000, 4000);
      await dismissCookies(page);
      await page.waitForSelector(passwordSelector, { timeout: 10000 }).catch(function() {});
      passwordInput = await page.$(passwordSelector);
    }

    if (!passwordInput) {
      console.log("Sifre alani bulunamadi");
      await supabaseInsertLog("Sifre alani bulunamadi", "warning");
      return false;
    }

    await passwordInput.evaluate(function(el) { el.scrollIntoView({ block: "center", behavior: "instant" }); });
    await humanClick(page, passwordInput);
    await randomDelay(300, 600);
    for (var m = 0; m < account.password.length; m++) {
      await page.keyboard.type(account.password[m], { delay: 40 + Math.random() * 60 });
    }
    await supabaseInsertLog("Sifre alani dolduruldu", "info");
    await randomDelay(500, 1000);

    // 5) Submit
    await dismissCookies(page);
    await clickByText(page, "button, a, div[role='button'], input[type='submit']", [
      "sign in", "log in", "login", "giriş", "oturum aç", "devam", "continue", "submit", "gönder"
    ], ["google", "apple"]);
    await randomDelay(3000, 6000);

    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
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
  for (var attempt = 0; attempt < 8; attempt++) {
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

        var selectors = [
          "button",
          "a",
          "div[role='button']",
          "input[type='button']",
          "input[type='submit']"
        ];

        var nodes = document.querySelectorAll(selectors.join(","));
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!isVisible(node)) continue;
          var text = (node.textContent || node.value || "").toLowerCase().replace(/\s+/g, " ").trim();
          for (var j = 0; j < keywords.length; j++) {
            if (text === keywords[j] || text.indexOf(keywords[j]) !== -1) {
              node.scrollIntoView({ block: "center", behavior: "instant" });
              node.click();
              return true;
            }
          }
        }

        var cookieContainers = document.querySelectorAll('[id*="cookie" i], [class*="cookie" i], [aria-label*="cookie" i], [data-testid*="cookie" i], [role="dialog"], [aria-modal="true"]');
        for (var k = 0; k < cookieContainers.length; k++) {
          var container = cookieContainers[k];
          if (!isVisible(container)) continue;
          var btns = container.querySelectorAll("button, a, div[role='button'], input[type='button'], input[type='submit']");
          for (var m = 0; m < btns.length; m++) {
            var btnText = (btns[m].textContent || btns[m].value || "").toLowerCase().replace(/\s+/g, " ").trim();
            for (var n = 0; n < keywords.length; n++) {
              if (btnText === keywords[n] || btnText.indexOf(keywords[n]) !== -1) {
                btns[m].scrollIntoView({ block: "center", behavior: "instant" });
                btns[m].click();
                return true;
              }
            }
          }
        }

        return false;
      });
      if (dismissed) {
        console.log("Cookie popup kapatildi");
        await randomDelay(700, 1200);
        return true;
      }
    } catch (e) {}

    await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); }).catch(function() {});
    await randomDelay(400, 800);
    await page.evaluate(function() { window.scrollTo(0, 0); }).catch(function() {});
    await randomDelay(400, 800);
  }
  return false;
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

// ==================== ANA İŞLEM ====================

async function processQuiz(url) {
  var browser, page;
  try {
    // 1) Chrome aç - HER ZAMAN önce tarayıcıyı aç
    var result = await launchBrowser();
    browser = result.browser; page = result.page;

    // 2) Sayfaya git
    console.log("Sayfaya gidiliyor: " + url);
    await supabaseInsertLog("Sayfaya gidiliyor: " + url, "info");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await randomDelay(2000, 4000);
    await forceDesktopWindow(page);
    page = await reopenInFreshTabIfNeeded(browser, page, url);

    // 3) Cookie popup kapat
    await dismissCookies(page);

    // 4) Login gerekiyorsa yap
    var loginOk = await handleEmailLogin(page);
    if (!loginOk) {
      console.log("Email giris basarisiz - VNC uzerinden manuel giris yapabilirsiniz");
      await supabaseInsertLog("Email giris basarisiz - manuel giris gerekli", "warning");
    }

    // 5) Sayfanın yüklenmesini bekle
    await randomDelay(3000, 5000);
    await dismissCookies(page);

    // 6) AI Analiz (login sonrası sayfa içeriği daha doğru analiz edilir)
    try {
      var currentUrl = await page.url();
      var ai = await analyzeWithAI(currentUrl);
      if (ai.questions.length > 0) {
        var result2 = await fillAnswers(page, ai.questions);
        await supabaseInsertLog("Quiz tamamlandi - " + result2.filled + "/" + ai.questions.length + " soru dolduruldu", result2.failed > 0 ? "warning" : "success");
      } else {
        console.log("Quiz sorusu bulunamadi - sayfa login/dashboard olabilir");
        await supabaseInsertLog("Soru bulunamadi - giris tamamlandi", "info");
      }
    } catch (aiErr) {
      console.log("AI analiz atlandi: " + aiErr.message);
      await supabaseInsertLog("AI analiz atlandi: " + aiErr.message, "warning");
    }

    console.log("Tarayici acik kaliyor - VNC den kontrol edebilirsiniz.");
    await new Promise(function(resolve) { browser.on("disconnected", resolve); });
  } catch (err) {
    console.error("Quiz hatasi:", err.message);
    await supabaseInsertLog("Hata: " + err.message, "error");
  } finally {
    if (browser) { try { browser.close(); } catch (e) {} }
  }
}

// ==================== DB POLLING ====================

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
