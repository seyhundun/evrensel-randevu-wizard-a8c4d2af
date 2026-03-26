/**
 * Sunucu Komut Ajanı
 * Dashboard'dan gönderilen komutları çalıştırır
 * Kullanım: node cmd-agent.js
 * PM2: pm2 start cmd-agent.js --name cmd-agent
 */

require("dotenv").config();

const SUPABASE_URL = "https://ocrpzwrsyiprfuzsyivf.supabase.co/rest/v1";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcnB6d3JzeWlwcmZ1enN5aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDQ1NzksImV4cCI6MjA4ODg4MDU3OX0.5MzKGm6byd1zLxjgxaXyQq5VfPFo_CE2MhcXijIRarc";
const POLL_INTERVAL = 3000; // 3 saniye

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
};

// Güvenlik: tehlikeli komutları engelle
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//i,
  /mkfs/i,
  /dd\s+if=/i,
  /:(){ :|:& };:/,
  />\s*\/dev\/sd/i,
  /shutdown/i,
  /reboot/i,
  /init\s+0/i,
  /halt/i,
];

function isCommandSafe(cmd) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return false;
  }
  return true;
}

async function pollAndExecute() {
  try {
    const fetch = (await import("node-fetch")).default;
    const { execSync } = require("child_process");

    // Bekleyen komutları al
    const res = await fetch(
      `${SUPABASE_URL}/server_commands?status=eq.pending&order=created_at.asc&limit=1`,
      { headers }
    );
    const commands = await res.json();
    if (!Array.isArray(commands) || commands.length === 0) return;

    const cmd = commands[0];
    console.log(`📥 Komut alındı: ${cmd.command} (${cmd.id})`);

    // Güvenlik kontrolü
    if (!isCommandSafe(cmd.command)) {
      await fetch(`${SUPABASE_URL}/server_commands?id=eq.${cmd.id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "error",
          output: "⛔ Güvenlik: Bu komut engellendi.",
          executed_at: new Date().toISOString(),
        }),
      });
      console.log(`⛔ Tehlikeli komut engellendi: ${cmd.command}`);
      return;
    }

    // Durumu "running" yap
    await fetch(`${SUPABASE_URL}/server_commands?id=eq.${cmd.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "running" }),
    });

    // Komutu çalıştır
    let output = "";
    let status = "done";
    try {
      output = execSync(cmd.command, {
        timeout: 30000, // 30 saniye timeout
        encoding: "utf8",
        maxBuffer: 1024 * 1024, // 1MB
        cwd: process.env.HOME || "/root",
      });
    } catch (err) {
      status = "error";
      output = err.stderr || err.stdout || err.message || "Bilinmeyen hata";
    }

    // Çıktıyı 10KB ile sınırla
    if (output.length > 10000) {
      output = output.slice(0, 10000) + "\n... (çıktı kırpıldı, toplam " + output.length + " karakter)";
    }

    // Sonucu kaydet
    await fetch(`${SUPABASE_URL}/server_commands?id=eq.${cmd.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        status,
        output: output || "(boş çıktı)",
        executed_at: new Date().toISOString(),
      }),
    });

    console.log(`✅ Komut tamamlandı: ${cmd.command} → ${status}`);
  } catch (err) {
    console.error("❌ Poll hatası:", err.message);
  }
}

console.log("🖥️ Sunucu Komut Ajanı başlatıldı");
console.log(`📡 Polling aralığı: ${POLL_INTERVAL}ms`);

setInterval(pollAndExecute, POLL_INTERVAL);
pollAndExecute(); // İlk çalıştırma
