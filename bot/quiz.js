/**
 * Quiz/Anket Çözücü Bot v3.0 — Browser Use Cloud API
 * Puppeteer yerine Browser Use API kullanır
 * Kullanım: node quiz.js [URL]
 */
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ocrpzwrsyiprfuzsyivf.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc";

const BROWSER_USE_API = "https://api.browser-use.com/api/v2";
const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || "";

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

// ==================== BROWSER USE API ====================

async function getBrowserUseApiKey() {
  // Önce bot_settings'ten dene
  try {
    var settings = await supabaseGet("bot_settings", "key=eq.browser_use_api_key&limit=1");
    if (settings && settings.length > 0 && settings[0].value) return settings[0].value;
  } catch (e) {}
  // Sonra env variable
  if (BROWSER_USE_API_KEY) return BROWSER_USE_API_KEY;
  // Son olarak Supabase edge function secrets'tan (sunucu tarafında)
  return null;
}

async function getProxyCountry() {
  try {
    var settings = await supabaseGet("bot_settings", "select=key,value");
    if (!settings || !Array.isArray(settings)) return "us";
    var map = {};
    for (var i = 0; i < settings.length; i++) map[settings[i].key] = settings[i].value;
    if (map.quiz_proxy_enabled === "false") return null;
    return (map.quiz_proxy_country || map.proxy_country || "US").toLowerCase();
  } catch (e) {
    return "us";
  }
}

async function createBrowserUseTask(taskPrompt, startUrl, proxyCountry) {
  var fetch = (await import("node-fetch")).default;
  var apiKey = await getBrowserUseApiKey();
  if (!apiKey) {
    throw new Error("Browser Use API key bulunamadi! bot_settings veya .env dosyasinda BROWSER_USE_API_KEY tanimlayin.");
  }

  var body = {
    task: taskPrompt,
    llm: "gemini-2.5-flash",
    startUrl: startUrl,
    maxSteps: 100,
    vision: true,
    highlightElements: true,
    sessionSettings: {
      browserScreenWidth: 1920,
      browserScreenHeight: 1080,
    },
  };

  // Proxy ülke ayarı
  if (proxyCountry) {
    body.sessionSettings.proxyCountryCode = proxyCountry;
  }

  console.log("Browser Use task olusturuluyor...");
  console.log("  Start URL: " + startUrl);
  console.log("  Proxy: " + (proxyCountry || "yok"));
  await supabaseInsertLog("Browser Use task olusturuluyor: " + startUrl, "info");

  var res = await fetch(BROWSER_USE_API + "/tasks", {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error("Browser Use task olusturulamadi (" + res.status + "): " + errText);
  }

  var data = await res.json();
  console.log("Task olusturuldu: " + data.id);
  await supabaseInsertLog("Browser Use task olusturuldu: " + data.id, "success");
  return data;
}

async function pollTaskStatus(taskId) {
  var fetch = (await import("node-fetch")).default;
  var apiKey = await getBrowserUseApiKey();

  var res = await fetch(BROWSER_USE_API + "/tasks/" + taskId + "/status", {
    method: "GET",
    headers: { "X-Browser-Use-API-Key": apiKey },
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error("Task status alinamadi (" + res.status + "): " + errText);
  }

  return await res.json();
}

async function getTaskLogs(taskId) {
  var fetch = (await import("node-fetch")).default;
  var apiKey = await getBrowserUseApiKey();

  var res = await fetch(BROWSER_USE_API + "/tasks/" + taskId + "/logs", {
    method: "GET",
    headers: { "X-Browser-Use-API-Key": apiKey },
  });

  if (!res.ok) return [];
  var data = await res.json();
  return data || [];
}

async function waitForTaskCompletion(taskId, maxWaitMs) {
  maxWaitMs = maxWaitMs || 300000; // 5 dakika
  var startTime = Date.now();
  var lastLogCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      var status = await pollTaskStatus(taskId);

      // Log'ları al ve yenilerini göster
      try {
        var logs = await getTaskLogs(taskId);
        if (Array.isArray(logs) && logs.length > lastLogCount) {
          for (var i = lastLogCount; i < logs.length; i++) {
            var log = logs[i];
            var logMsg = (typeof log === "string") ? log : (log.message || log.step || JSON.stringify(log)).slice(0, 200);
            console.log("  [BU] " + logMsg);
            await supabaseInsertLog("Agent: " + logMsg.slice(0, 150), "info");
          }
          lastLogCount = logs.length;
        }
      } catch (logErr) {
        // Log alma hatası kritik değil
      }

      if (status.status === "finished") {
        console.log("Task tamamlandi!");
        console.log("  Basarili: " + status.isSuccess);
        console.log("  Maliyet: $" + (status.cost || "?"));
        if (status.output) {
          console.log("  Sonuc: " + (status.output || "").slice(0, 500));
        }
        await supabaseInsertLog(
          "Task tamamlandi | Basarili: " + status.isSuccess + " | Maliyet: $" + (status.cost || "?"),
          status.isSuccess ? "success" : "warning"
        );
        return status;
      }

      if (status.status === "stopped") {
        console.log("Task durduruldu!");
        await supabaseInsertLog("Task durduruldu", "warning");
        return status;
      }

      // Hâlâ çalışıyor
      console.log("  Task durumu: " + status.status + " (" + Math.round((Date.now() - startTime) / 1000) + "sn)");
    } catch (pollErr) {
      console.error("  Polling hatasi: " + pollErr.message);
    }

    // 5 saniye bekle
    await new Promise(function(r) { setTimeout(r, 5000); });
  }

  console.log("Task zaman asimi (" + Math.round(maxWaitMs / 1000) + "sn)");
  await supabaseInsertLog("Task zaman asimi", "error");
  return { status: "timeout", isSuccess: false };
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

// ==================== ANA İŞLEM ====================

async function processQuiz(url) {
  try {
    // 1) Hesap bilgilerini al
    var account = await getLoginAccount();
    if (!account) {
      console.log("Hesap bulunamadi, islem iptal");
      await supabaseInsertLog("Hesap bulunamadi, islem iptal", "error");
      return;
    }

    // 2) Proxy ülke ayarını al
    var proxyCountry = await getProxyCountry();

    // 3) Task prompt'unu oluştur
    var taskPrompt = buildTaskPrompt(url, account);

    console.log("=== Quiz Bot v3.0 — Browser Use Cloud ===");
    console.log("URL: " + url);
    console.log("Hesap: " + account.email);
    await supabaseInsertLog("Quiz baslatiliyor: " + url + " | Hesap: " + account.email, "info");

    // 4) Browser Use task oluştur
    var task = await createBrowserUseTask(taskPrompt, url, proxyCountry);

    // 5) Tamamlanmasını bekle
    var result = await waitForTaskCompletion(task.id, 600000); // 10 dakika max

    // 6) Sonucu logla
    if (result.isSuccess) {
      console.log("=== Quiz basariyla tamamlandi! ===");
      await supabaseInsertLog("Quiz basariyla tamamlandi! Sonuc: " + (result.output || "").slice(0, 200), "success");
    } else {
      console.log("=== Quiz tamamlanamadi ===");
      await supabaseInsertLog("Quiz tamamlanamadi: " + (result.output || result.status), "error");
      await supabaseUpdate("quiz_accounts", account.id, { fail_count: (account.fail_count || 0) + 1 });
    }

    return result;
  } catch (err) {
    console.error("Quiz hatasi:", err.message);
    await supabaseInsertLog("Hata: " + err.message, "error");
  }
}

function buildTaskPrompt(url, account) {
  var isDirectQuiz = /\/(survey|answer|quiz|poll|questionnaire)/i.test(url);
  var host = "";
  try { host = new URL(url).hostname; } catch (e) {}

  var prompt = `Sen bir anket çözücü botsun. Aşağıdaki adımları sırasıyla uygula:

ADIM 1 - ÇEREZ POPUP:
- Sayfa açıldığında bir çerez/cookie kabul popup'ı varsa "Accept All", "Kabul Et", "I Agree" gibi KABUL butonuna tıkla.
- "Reject", "Manage", "Preferences" gibi butonlara TIKLAMA.
- Popup yoksa bu adımı atla.

ADIM 2 - GİRİŞ YAP:
- Sayfada login/giriş formu veya "Log In", "Sign In" butonu varsa:
  a) Önce "Log In" veya "Sign In" butonuna tıkla
  b) "Continue with Email" butonu varsa ona tıkla (Google/Apple/Facebook butonlarına TIKLAMA!)
  c) Email alanına şunu yaz: ${account.email}
  d) Password alanına şunu yaz: ${account.password}
  e) "Log In", "Sign In", "Submit" gibi giriş butonuna tıkla
  f) reCAPTCHA varsa çözmeye çalış
- Zaten giriş yapılmışsa bu adımı atla.

ADIM 3 - ANKET SAYFASINA GİT:`;

  if (isDirectQuiz) {
    prompt += `
- Bu URL zaten bir anket sayfası. Doğrudan soruları çözmeye başla.`;
  } else {
    prompt += `
- Sayfada "Answer", "Surveys", "Anketler", "Earn" gibi bir menü/link varsa tıkla.
- Yoksa ${host}/surveys veya ${host}/answer adresine gitmeyi dene.
- Anket listesi sayfasında mevcut anketlerden birine tıkla.`;
  }

  prompt += `

ADIM 4 - ANKETLERİ ÇÖZ:
- Sayfadaki soruları oku ve mantıklı cevaplar ver:
  * Çoktan seçmeli sorularda en uygun seçeneği tıkla
  * Metin girişi gereken yerlere kısa ve mantıklı cevaplar yaz
  * Likert ölçeği (1-5, 1-10) sorularında orta-üst değerleri seç
  * "Next", "Continue", "İleri" butonlarıyla sonraki sayfaya geç
- Her sayfadaki tüm soruları cevapla, sonra "Next" veya "Submit" butonuna bas.
- Birden fazla sayfa varsa hepsini tamamla.
- Anket bittiğinde sonuç ekranını bekle.

ADIM 5 - SONUÇ:
- Tamamlanan anket sayısını ve kazanılan puanı/ödülü raporla.
- Hata varsa ne olduğunu açıkla.

ÖNEMLİ KURALLAR:
- Google, Apple, Facebook ile giriş yapMA. Sadece email/şifre kullan.
- Sayfadan AYRILMA, sadece anket akışını takip et.
- Her adımda cookie popup çıkarsa kapat.
- Maksimum 5 anket çöz, sonra dur.`;

  return prompt;
}

// ==================== ÇOKLU ANKET MODU ====================

async function processMultipleQuizzes(url, maxTasks) {
  maxTasks = maxTasks || 3;
  var account = await getLoginAccount();
  if (!account) return;

  var proxyCountry = await getProxyCountry();

  console.log("=== Coklu anket modu: " + maxTasks + " task ===");
  await supabaseInsertLog("Coklu anket modu baslatiliyor: " + maxTasks + " task", "info");

  for (var i = 0; i < maxTasks; i++) {
    console.log("\n--- Task " + (i + 1) + "/" + maxTasks + " ---");
    await supabaseInsertLog("Task " + (i + 1) + "/" + maxTasks + " baslatiliyor", "info");

    var taskPrompt = buildTaskPrompt(url, account);
    try {
      var task = await createBrowserUseTask(taskPrompt, url, proxyCountry);
      var result = await waitForTaskCompletion(task.id, 600000);

      if (!result.isSuccess) {
        console.log("Task basarisiz, durduruluyor");
        await supabaseInsertLog("Task " + (i + 1) + " basarisiz, dongu durduruluyor", "warning");
        break;
      }
    } catch (err) {
      console.error("Task hatasi:", err.message);
      await supabaseInsertLog("Task " + (i + 1) + " hatasi: " + err.message, "error");
      break;
    }

    // Sonraki task için kısa bekleme
    if (i < maxTasks - 1) {
      console.log("Sonraki task icin 10sn bekleniyor...");
      await new Promise(function(r) { setTimeout(r, 10000); });
    }
  }

  console.log("=== Coklu anket modu tamamlandi ===");
  await supabaseInsertLog("Coklu anket modu tamamlandi", "success");
}

// ==================== DB POLLING ====================

async function pollForQuizTasks() {
  console.log("Quiz bot v3.0 (Browser Use) baslatildi - gorev bekleniyor...");
  await supabaseInsertLog("Quiz bot v3.0 (Browser Use) baslatildi", "info");

  // API key kontrolü
  var apiKey = await getBrowserUseApiKey();
  if (!apiKey) {
    console.error("HATA: Browser Use API key bulunamadi!");
    console.error("bot_settings tablosuna 'browser_use_api_key' ekleyin veya .env'de BROWSER_USE_API_KEY tanimlayin");
    await supabaseInsertLog("Browser Use API key bulunamadi!", "error");
    return;
  }
  console.log("Browser Use API key OK");
  await supabaseInsertLog("Browser Use API key dogrulandi", "success");

  while (true) {
    try {
      var tasks = await supabaseGet("link_analyses", "status=eq.quiz_pending&order=created_at.asc&limit=1");
      if (tasks && tasks.length > 0) {
        var task = tasks[0];
        console.log("\nYeni quiz gorevi: " + task.url);
        await supabaseUpdate("link_analyses", task.id, { status: "quiz_running" });

        try {
          await processQuiz(task.url);
          await supabaseUpdate("link_analyses", task.id, { status: "quiz_done" });
        } catch (taskErr) {
          console.error("Gorev hatasi:", taskErr.message);
          await supabaseUpdate("link_analyses", task.id, { status: "quiz_done" });
          await supabaseInsertLog("Gorev hatasi: " + taskErr.message, "error");
        }
      }
    } catch (err) {
      console.error("Polling hatasi:", err.message);
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
