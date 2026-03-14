import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Search, AlertCircle, Clock, Image as ImageIcon, X,
  LogIn, FormInput, ShieldCheck, KeyRound, Globe, Timer, MonitorSmartphone,
  UserPlus, MousePointer, Wifi, Ban, RefreshCw, Network, Trash2
} from "lucide-react";

interface LogEntry {
  id: string;
  status: string;
  message: string | null;
  screenshot_url: string | null;
  created_at: string;
}

const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  // --- Bot lifecycle ---
  bot_start:      { icon: <MonitorSmartphone className="w-4 h-4" />, label: "Bot Başladı", color: "text-primary bg-primary/10" },
  bot_stop:       { icon: <MonitorSmartphone className="w-4 h-4" />, label: "Bot Durdu", color: "text-muted-foreground bg-muted/50" },
  bot_idle:       { icon: <Timer className="w-4 h-4" />, label: "Bekleme", color: "text-muted-foreground bg-muted/50" },

  // --- IP ---
  ip_change:      { icon: <Network className="w-4 h-4" />, label: "IP Değişti", color: "text-cyan-500 bg-cyan-500/10" },
  ip_blocked:     { icon: <Ban className="w-4 h-4" />, label: "IP Engellendi", color: "text-red-500 bg-red-500/10" },

  // --- Login flow ---
  login_start:    { icon: <LogIn className="w-4 h-4" />, label: "Giriş Başladı", color: "text-blue-500 bg-blue-500/10" },
  login_navigate: { icon: <Globe className="w-4 h-4" />, label: "Sayfa Açılıyor", color: "text-blue-400 bg-blue-400/10" },
  login_form:     { icon: <FormInput className="w-4 h-4" />, label: "Form Dolduruluyor", color: "text-blue-500 bg-blue-500/10" },
  login_captcha:  { icon: <ShieldCheck className="w-4 h-4" />, label: "CAPTCHA Çözülüyor", color: "text-amber-500 bg-amber-500/10" },
  login_captcha_debug: { icon: <ShieldCheck className="w-4 h-4" />, label: "CAPTCHA Debug", color: "text-amber-400 bg-amber-400/10 text-xs" },
  login_success:  { icon: <CheckCircle2 className="w-4 h-4" />, label: "Giriş Başarılı", color: "text-green-500 bg-green-500/10" },
  login_fail:     { icon: <AlertCircle className="w-4 h-4" />, label: "Giriş Başarısız", color: "text-destructive bg-destructive/10" },
  login_otp:      { icon: <KeyRound className="w-4 h-4" />, label: "📧 Giriş OTP Bekleniyor", color: "text-amber-500 bg-amber-500/10 font-bold" },
  login_post_click: { icon: <LogIn className="w-4 h-4" />, label: "Giriş Tıklandı", color: "text-blue-400 bg-blue-400/10" },
  login_otp_screen: { icon: <KeyRound className="w-4 h-4" />, label: "OTP Ekranı", color: "text-amber-500 bg-amber-500/10" },

  // --- Registration flow ---
  reg_start:      { icon: <UserPlus className="w-4 h-4" />, label: "Kayıt Başladı", color: "text-violet-500 bg-violet-500/10" },
  reg_form:       { icon: <FormInput className="w-4 h-4" />, label: "Kayıt Formu", color: "text-violet-500 bg-violet-500/10" },
  reg_captcha:    { icon: <ShieldCheck className="w-4 h-4" />, label: "Kayıt CAPTCHA", color: "text-amber-500 bg-amber-500/10" },
  reg_complete:   { icon: <CheckCircle2 className="w-4 h-4" />, label: "Kayıt Tamamlandı", color: "text-green-500 bg-green-500/10" },
  reg_fail:       { icon: <AlertCircle className="w-4 h-4" />, label: "Kayıt Başarısız", color: "text-destructive bg-destructive/10" },

  // --- Appointment flow ---
  appt_check:     { icon: <Search className="w-4 h-4" />, label: "Randevu Kontrol", color: "text-primary bg-primary/10" },
  appt_found:     { icon: <CheckCircle2 className="w-4 h-4" />, label: "🎉 RANDEVU BULUNDU!", color: "text-green-600 bg-green-500/15 font-bold" },
  appt_none:      { icon: <Ban className="w-4 h-4" />, label: "Randevu Yok", color: "text-muted-foreground bg-muted/50" },
  appt_book:      { icon: <MousePointer className="w-4 h-4" />, label: "Randevu Alınıyor", color: "text-green-500 bg-green-500/10" },
  appt_booked:    { icon: <CheckCircle2 className="w-4 h-4" />, label: "✅ Randevu Alındı!", color: "text-green-600 bg-green-500/15 font-bold" },

  // --- Account management ---
  account_switch: { icon: <RefreshCw className="w-4 h-4" />, label: "Hesap Değişti", color: "text-blue-400 bg-blue-400/10" },
  account_banned: { icon: <Ban className="w-4 h-4" />, label: "Hesap Engellendi", color: "text-red-500 bg-red-500/10" },
  account_cooldown: { icon: <Timer className="w-4 h-4" />, label: "Hesap Soğutma", color: "text-amber-500 bg-amber-500/10" },

  cloudflare:     { icon: <ShieldCheck className="w-4 h-4" />, label: "⚠️ Cloudflare Engeli", color: "text-amber-500 bg-amber-500/10 font-bold" },
  cf_retry:       { icon: <RefreshCw className="w-4 h-4" />, label: "CF Yeniden Deneniyor", color: "text-cyan-500 bg-cyan-500/10" },

  // --- Network / page ---
  page_load:      { icon: <Globe className="w-4 h-4" />, label: "Sayfa Yüklendi", color: "text-blue-400 bg-blue-400/10" },
  network_error:  { icon: <Wifi className="w-4 h-4" />, label: "Ağ Hatası", color: "text-destructive bg-destructive/10" },

  // --- Generic ---
  info:           { icon: <Clock className="w-4 h-4" />, label: "Bilgi", color: "text-muted-foreground bg-muted/50" },
  error:          { icon: <AlertCircle className="w-4 h-4" />, label: "Hata", color: "text-destructive bg-destructive/10" },
};

const defaultStatus = { icon: <Clock className="w-4 h-4" />, label: "Log", color: "text-muted-foreground bg-muted/50" };

function extractIp(message: string | null): string | null {
  if (!message) return null;
  // Match IPv4: "IP: 1.2.3.4"
  const ipv4 = message.match(/IP:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i);
  if (ipv4) return ipv4[1];
  // Match residential proxy: "IP: residential (adana)"
  const res = message.match(/IP:\s*(residential\s*\([^)]+\))/i);
  if (res) return res[1];
  return null;
}

function extractAccount(message: string | null): string | null {
  if (!message) return null;
  const match = message.match(/Hesap:\s*([^\s|]+@[^\s|]+)/i) || message.match(/\|\s*([^\s|]+@[^\s|]+)/);
  return match ? match[1] : null;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return "Şimdi";
  if (secs < 60) return `${secs}sn önce`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}sa önce`;
  return `${Math.floor(hours / 24)}g önce`;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function IdataTrackingLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [configActive, setConfigActive] = useState(false);
  const [appointmentFound, setAppointmentFound] = useState(false);
  const [alarmDismissed, setAlarmDismissed] = useState(false);

  // Dashboard sesli alarm
  useEffect(() => {
    if (!appointmentFound || alarmDismissed) return;
    
    // Web Audio API ile bip sesi oluştur
    const playAlarm = () => {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = "square";
        gain.gain.value = 0.3;
        osc.start();
        setTimeout(() => { osc.frequency.value = 1100; }, 200);
        setTimeout(() => { osc.frequency.value = 880; }, 400);
        setTimeout(() => { osc.stop(); ctx.close(); }, 600);
      } catch {}
    };

    playAlarm();
    const interval = setInterval(playAlarm, 5000);
    return () => clearInterval(interval);
  }, [appointmentFound, alarmDismissed]);

  const fetchConfig = async () => {
    const { data } = await supabase
      .from("idata_config" as any)
      .select("is_active")
      .limit(1)
      .single();
    if (data) setConfigActive((data as any).is_active);
  };

  const fetchLogs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("idata_tracking_logs" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    const logList = (data as unknown as LogEntry[] | null) ?? [];
    setLogs(logList);
    // İlk yüklemede en son log appt_found ise alarm aç
    if (logList.length > 0 && logList[0].status === "appt_found") {
      setAppointmentFound(true);
    }
    setLoading(false);
  };

  const clearLogs = async () => {
    if (!confirm("Tüm iDATA loglarını silmek istediğinize emin misiniz?")) return;
    await supabase.from("idata_tracking_logs" as any).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setLogs([]);
  };

  useEffect(() => {
    fetchLogs();
    fetchConfig();
    const channel = supabase
      .channel("idata-tracking-logs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "idata_tracking_logs" },
        (payload) => {
          const newLog = payload.new as LogEntry;
          setLogs((prev) => [newLog, ...prev].slice(0, 100));
          if (newLog.status === "appt_found") {
            setAppointmentFound(true);
            setAlarmDismissed(false);
          }
          if (newLog.status === "appt_none" && !alarmDismissed) {
            setAppointmentFound(false);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "idata_config" },
        () => fetchConfig()
      )
      .subscribe();

    const interval = setInterval(fetchLogs, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const latestIpLog = logs.find((l) => extractIp(l.message));
  const currentIp = latestIpLog ? extractIp(latestIpLog.message) : null;
  const lastLogTime = logs[0]?.created_at;
  const lastLogAge = lastLogTime ? (Date.now() - new Date(lastLogTime).getTime()) / 1000 : Infinity;
  const botActive = configActive && lastLogAge < 300;

  const filters = [
    { key: "all", label: "Tümü" },
    { key: "login", label: "Giriş" },
    { key: "reg", label: "Kayıt" },
    { key: "appt", label: "Randevu" },
    { key: "ip", label: "IP" },
    { key: "error", label: "Hatalar" },
  ];

  const filteredLogs = logs.filter((log) => {
    if (filter === "all") return true;
    if (filter === "login") return log.status.startsWith("login");
    if (filter === "reg") return log.status.startsWith("reg");
    if (filter === "appt") return log.status.startsWith("appt");
    if (filter === "ip") return log.status.startsWith("ip_") || log.status === "network_error" || log.status === "bot_start";
    if (filter === "error") return log.status === "error" || log.status.includes("fail") || log.status === "network_error" || log.status === "ip_blocked";
    return true;
  });

  return (
    <div className="space-y-3">
      {/* 🚨 RANDEVU BULUNDU ALARM BANNER */}
      {appointmentFound && !alarmDismissed && (
        <div className="relative overflow-hidden rounded-xl border-2 border-green-500 bg-green-500/10 p-4 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-4xl">🎉</span>
              <div>
                <h3 className="text-lg font-bold text-green-600">RANDEVU BULUNDU!</h3>
                <p className="text-sm text-green-600/80">Hemen giriş yapıp randevuyu alın!</p>
                <a
                  href="https://it-tr-appointment.idata.com.tr/tr/membership/dashboard/application/availability"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-lg bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition-colors"
                >
                  <Globe className="w-4 h-4" /> iDATA'ya Git
                </a>
              </div>
            </div>
            <button
              onClick={() => setAlarmDismissed(true)}
              className="absolute top-2 right-2 p-1 rounded-md hover:bg-green-500/20 transition-colors"
            >
              <X className="w-5 h-5 text-green-600" />
            </button>
          </div>
        </div>
      )}
      {/* Bot Status Bar */}
      <div className="flex items-center justify-between rounded-lg bg-card border border-border/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {botActive ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
                <span className="text-sm font-medium text-green-600">iDATA Bot Çalışıyor</span>
              </>
            ) : (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground/40"></span>
                </span>
                <span className="text-sm font-medium text-muted-foreground">iDATA Bot Durdu</span>
              </>
            )}
          </div>
          {currentIp && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20">
              <Network className="w-3.5 h-3.5 text-cyan-500" />
              <span className="text-xs font-mono font-medium text-cyan-600">{currentIp}</span>
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{logs.length} kayıt</span>
        <Button variant="ghost" size="sm" onClick={clearLogs} className="gap-1.5 text-xs text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
          Temizle
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MonitorSmartphone className="w-4 h-4 text-muted-foreground" />
          🇮🇹 iDATA Bot Aktivitesi
        </h3>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && logs.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">Yükleniyor...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm rounded-lg bg-secondary/50">
          {logs.length === 0
            ? "Henüz iDATA bot aktivitesi yok. Bot çalışmaya başladığında burada adım adım göreceksiniz."
            : "Bu filtrede kayıt yok."}
        </div>
      ) : (
        <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1 font-mono">
          {filteredLogs.map((log) => {
            const cfg = statusConfig[log.status] ?? defaultStatus;
            const ip = extractIp(log.message);
            const account = extractAccount(log.message);
            return (
              <div
                key={log.id}
                className={`flex items-start gap-2.5 rounded-lg bg-card border border-border/50 px-3 py-2 text-xs transition-colors hover:bg-secondary/30 ${
                  log.status === "appt_found" || log.status === "appt_booked" ? "ring-2 ring-green-500/30 bg-green-500/5" : ""
                } ${log.status === "error" || log.status.includes("fail") || log.status === "ip_blocked" ? "bg-destructive/5" : ""
                } ${log.status === "ip_change" ? "bg-cyan-500/5" : ""}`}
              >
                <span className={`mt-0.5 flex items-center justify-center rounded-md p-1 shrink-0 ${cfg.color}`}>
                  {cfg.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold ${cfg.color.split(" ")[0]}`}>{cfg.label}</span>
                      {ip && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 text-[10px] font-mono">
                          <Network className="w-3 h-3" />
                          {ip}
                        </span>
                      )}
                      {account && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                          {account}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatTime(log.created_at)} · {timeAgo(log.created_at)}
                    </span>
                  </div>
                  {log.message && (
                    <p className="text-muted-foreground mt-0.5 leading-relaxed">{log.message}</p>
                  )}
                  {log.screenshot_url && (
                    <button
                      onClick={() => {
                        const url = log.screenshot_url!;
                        // Base64 veri ise data URI'ye çevir
                        const isBase64 = !url.startsWith("http") && !url.startsWith("data:");
                        setLightboxUrl(isBase64 ? `data:image/png;base64,${url}` : url);
                      }}
                      className="mt-1 flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Screenshot görüntüle
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={lightboxUrl}
              alt="Bot screenshot"
              className="w-full h-auto max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}
