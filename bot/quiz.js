/**
 * Quiz/Anket Çözücü Bot v2.0
 * Google login + AI cevaplarıyla otomatik doldurma
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

async function launchBrowser() {
  var connect = require("puppeteer-real-browser").connect;
  var options = {
    headless: false, turnstile: false, disableXvfb: true,
    customConfig: { chromePath: undefined, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--start-maximized", "--window-size=1920,1080"] },
    connectOption: {},
  };
  process.env.DISPLAY = DISPLAY;
  console.log("Chrome baslatiliyor (Display: " + DISPLAY + ")...");
  var result = await connect(options);
  currentBrowser = result.browser;
  await result.page.evaluateOnNewDocument(function() { Object.defineProperty(navigator, "webdriver", { get: function() { return false; } }); });
  await result.page.setViewport({ width: 1920, height: 1080 });
  return { browser: result.browser, page: result.page };
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

// ==================== GOOGLE LOGIN ====================

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
    // Look for email input field
    var emailInput = await page.$('input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[id*="email"], input[id*="user"], input[placeholder*="mail"], input[placeholder*="email"]');
    
    if (!emailInput) {
      // Try to find and click "Continue with Email" or login button first
      var loginBtn = null;
      var buttons = await page.$$("button, a, div[role='button']");
      for (var i = 0; i < buttons.length; i++) {
        var text = await page.evaluate(function(el) { return (el.textContent || "").toLowerCase(); }, buttons[i]);
        if (text.indexOf("email") !== -1 || text.indexOf("e-posta") !== -1 || text.indexOf("sign in") !== -1 || text.indexOf("log in") !== -1 || text.indexOf("giriş") !== -1) {
          loginBtn = buttons[i];
          break;
        }
      }
      if (loginBtn) {
        console.log("Login butonu bulundu, tiklaniyor...");
        await humanClick(page, loginBtn);
        await randomDelay(2000, 4000);
        emailInput = await page.$('input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[id*="email"], input[id*="user"], input[placeholder*="mail"], input[placeholder*="email"]');
      }
    }

    if (!emailInput) {
      // Fallback: first visible text/email input
      emailInput = await page.$('input[type="text"], input[type="email"]');
    }

    if (!emailInput) {
      console.log("Email alani bulunamadi - login gerekmiyor olabilir");
      return true;
    }

    // Type email
    await humanClick(page, emailInput);
    await randomDelay(300, 600);
    await page.evaluate(function(el) { el.value = ''; }, emailInput);
    for (var j = 0; j < account.email.length; j++) {
      await emailInput.type(account.email[j], { delay: 40 + Math.random() * 60 });
    }
    await randomDelay(500, 1000);

    // Look for password field (might be on same page or next page)
    var passwordInput = await page.$('input[type="password"]');
    
    if (!passwordInput) {
      // Click Next/Continue button to go to password page
      var nextBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (!nextBtn) {
        var allBtns = await page.$$("button, div[role='button'], a");
        for (var k = 0; k < allBtns.length; k++) {
          var btnText = await page.evaluate(function(el) { return (el.textContent || "").toLowerCase().trim(); }, allBtns[k]);
          if (btnText === "next" || btnText === "continue" || btnText === "devam" || btnText === "ileri" || btnText === "sonraki" || btnText === "giriş" || btnText === "sign in" || btnText === "log in") {
            nextBtn = allBtns[k];
            break;
          }
        }
      }
      if (nextBtn) {
        await humanClick(page, nextBtn);
        await randomDelay(3000, 5000);
      }
      await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(function() {});
      passwordInput = await page.$('input[type="password"]');
    }

    if (passwordInput) {
      await humanClick(page, passwordInput);
      await randomDelay(300, 600);
      for (var m = 0; m < account.password.length; m++) {
        await passwordInput.type(account.password[m], { delay: 40 + Math.random() * 60 });
      }
      await randomDelay(500, 1000);

      // Click submit/login button
      var submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (!submitBtn) {
        var allBtns2 = await page.$$("button, div[role='button']");
        for (var n = 0; n < allBtns2.length; n++) {
          var btnText2 = await page.evaluate(function(el) { return (el.textContent || "").toLowerCase().trim(); }, allBtns2[n]);
          if (btnText2 === "sign in" || btnText2 === "log in" || btnText2 === "login" || btnText2 === "giriş" || btnText2 === "oturum aç" || btnText2 === "submit" || btnText2 === "gönder") {
            submitBtn = allBtns2[n];
            break;
          }
        }
      }
      if (submitBtn) {
        await humanClick(page, submitBtn);
        await randomDelay(3000, 6000);
      }
    }

    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(function() {});
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
  for (var attempt = 0; attempt < 3; attempt++) {
    var dismissed = await page.evaluate(function() {
      var keywords = ["accept all", "accept", "kabul", "tamam", "ok", "agree", "i agree", "got it", "allow all"];
      var buttons = document.querySelectorAll("button, a, div[role='button']");
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].textContent || "").toLowerCase().trim();
        for (var j = 0; j < keywords.length; j++) {
          if (text === keywords[j] || (text.length < 30 && text.indexOf(keywords[j]) !== -1)) {
            buttons[i].click();
            return true;
          }
        }
      }
      return false;
    });
    if (dismissed) {
      console.log("Cookie popup kapatildi");
      await randomDelay(500, 1000);
      return;
    }
    await randomDelay(500, 1000);
  }
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
    // 1) AI Analiz
    var ai = await analyzeWithAI(url);
    if (ai.questions.length === 0) { console.log("Soru bulunamadi. Ham AI cevabi:"); console.log(ai.rawAnswer); await supabaseInsertLog("Soru bulunamadi", "warning"); return; }

    // 2) Chrome ac
    var result = await launchBrowser();
    browser = result.browser; page = result.page;

    // 3) Sayfaya git
    console.log("Sayfaya gidiliyor: " + url);
    await supabaseInsertLog("Sayfaya gidiliyor: " + url, "info");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await randomDelay(2000, 4000);

    // 4) Cookie popup kapat
    await dismissCookies(page);

    // 5) Google login gerekiyorsa yap
    var loginOk = await handleEmailLogin(page);
    if (!loginOk) {
      console.log("Email giris basarisiz - VNC uzerinden manuel giris yapabilirsiniz");
      await supabaseInsertLog("Email giris basarisiz - manuel giris gerekli", "warning");
    }

    // 6) Sayfanin yuklenmesini bekle
    await randomDelay(3000, 5000);
    await dismissCookies(page);

    // 7) Sorulari doldur
    var result2 = await fillAnswers(page, ai.questions);
    await supabaseInsertLog("Quiz tamamlandi - " + result2.filled + "/" + ai.questions.length + " soru dolduruldu", result2.failed > 0 ? "warning" : "success");

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
