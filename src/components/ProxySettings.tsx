import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Network, Shield, Clock, Globe, Zap, Loader2, CheckCircle2, XCircle, Copy, Activity, AlertTriangle, Wifi, WifiOff, MapPin, Smartphone } from "lucide-react";
import { toast } from "sonner";

interface ProxySettingsProps {
  configId: string | null;
}

interface HealthData {
  currentIp: string | null;
  lastReset: string | null;
  lastSuccess: { time: string; message: string } | null;
  lastError: { time: string; message: string } | null;
  region: string | null;
  totalChecks: number;
  errorCount: number;
  successRate: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}sn önce`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}sa önce`;
  return `${Math.floor(hr / 24)}g önce`;
}

export default function ProxySettings({ configId }: ProxySettingsProps) {
  const [proxyHost, setProxyHost] = useState("—");
  const [proxyPort, setProxyPort] = useState("—");
  const [proxyCountry, setProxyCountry] = useState("—");
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [proxyType, setProxyType] = useState("core"); // core, premium
  const [cfStatus, setCfStatus] = useState<{ blocked: boolean; ip: string | null; since: string | null }>({
    blocked: false, ip: null, since: null,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; ip?: string | null; message?: string; curl_test?: string; config?: any } | null>(null);
  const [health, setHealth] = useState<HealthData>({
    currentIp: null, lastReset: null, lastSuccess: null, lastError: null,
    region: null, totalChecks: 0, errorCount: 0, successRate: 100,
  });

  // Derive proxy type from host/port
  const deriveProxyType = (host: string, port: string) => {
    if (host.startsWith("mp.")) return "mobile";
    if (port === "1001") return "premium";
    return "core";
  };

  const loadBotSettings = useCallback(async () => {
    const { data } = await supabase.from("bot_settings").select("key, value");
    if (data) {
      const map = Object.fromEntries(data.map(d => [d.key, d.value]));
      setProxyHost(map.proxy_host || "—");
      setProxyPort(map.proxy_port || "—");
      setProxyCountry(map.proxy_country || "—");
      setProxyEnabled(map.proxy_enabled !== "false");
      // Use stored proxy_type if available, otherwise derive from host/port
      setProxyType(map.proxy_type || deriveProxyType(map.proxy_host || "", map.proxy_port || ""));
      setHealth(prev => ({ ...prev, region: map.proxy_region || null }));
    }
  }, []);

  const loadHealthData = useCallback(async () => {
    if (!configId) return;

    // Current IP from ip_change logs
    const { data: ipLogs } = await supabase
      .from("tracking_logs")
      .select("message, created_at")
      .eq("config_id", configId)
      .eq("status", "ip_change")
      .order("created_at", { ascending: false })
      .limit(1);

    let currentIp: string | null = null;
    let lastReset: string | null = null;
    let region: string | null = null;

    if (ipLogs && ipLogs.length > 0) {
      const msg = ipLogs[0].message || "";
      const ipMatch = msg.match(/Aktif IP:\s*([^\s|]+)/);
      if (ipMatch?.[1]) currentIp = ipMatch[1];
      lastReset = ipLogs[0].created_at;
      const regionMatch = msg.match(/bölge:\s*([^\s|,)]+)/i);
      if (regionMatch?.[1]) region = regionMatch[1];
    }

    // Last successful check
    const { data: successLogs } = await supabase
      .from("tracking_logs")
      .select("message, created_at")
      .eq("config_id", configId)
      .in("status", ["no_appointment", "found", "checking"])
      .order("created_at", { ascending: false })
      .limit(1);

    const lastSuccess = successLogs?.[0]
      ? { time: successLogs[0].created_at, message: successLogs[0].message || "" }
      : null;

    // Last error
    const { data: errorLogs } = await supabase
      .from("tracking_logs")
      .select("message, created_at")
      .eq("config_id", configId)
      .in("status", ["error", "network_error", "cloudflare", "session_expired"])
      .order("created_at", { ascending: false })
      .limit(1);

    const lastError = errorLogs?.[0]
      ? { time: errorLogs[0].created_at, message: errorLogs[0].message || "" }
      : null;

    // Stats — last 50 logs
    const { data: recentLogs } = await supabase
      .from("tracking_logs")
      .select("status")
      .eq("config_id", configId)
      .order("created_at", { ascending: false })
      .limit(50);

    const total = recentLogs?.length || 0;
    const errors = recentLogs?.filter(l =>
      ["error", "network_error", "cloudflare", "session_expired"].includes(l.status)
    ).length || 0;
    const rate = total > 0 ? Math.round(((total - errors) / total) * 100) : 100;

    // Total checks
    const { count } = await supabase
      .from("tracking_logs")
      .select("*", { count: "exact", head: true })
      .eq("config_id", configId);

    setHealth({
      currentIp, lastReset, lastSuccess, lastError,
      region: region || health.region,
      totalChecks: count || 0, errorCount: errors, successRate: rate,
    });

    // CF status
    const { data: cfData } = await supabase
      .from("tracking_configs")
      .select("cf_blocked_since, cf_blocked_ip" as any)
      .eq("id", configId)
      .single();
    if (cfData) {
      const d = cfData as any;
      setCfStatus({
        blocked: !!d.cf_blocked_since,
        ip: d.cf_blocked_ip || null,
        since: d.cf_blocked_since || null,
      });
    }
  }, [configId]);

  useEffect(() => {
    loadBotSettings();
    if (!configId) return;
    loadHealthData();
    const channel = supabase
      .channel("proxy-health")
      .on("postgres_changes", { event: "*", schema: "public", table: "tracking_logs", filter: `config_id=eq.${configId}` }, () => loadHealthData())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tracking_configs", filter: `id=eq.${configId}` }, () => loadHealthData())
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_settings" }, () => loadBotSettings())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [configId, loadBotSettings, loadHealthData]);

  const testProxy = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("proxy-test");
      if (error) throw error;
      setTestResult(data);
      if (data?.ip) toast.success(`Proxy çalışıyor! IP: ${data.ip}`);
      else if (data?.ok) toast.info("Yapılandırma doğru, sunucudan test edin");
      else toast.error(data?.error || "Test başarısız");
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message });
      toast.error("Proxy test hatası: " + err.message);
    }
    setTesting(false);
  };

  const copyCurl = () => {
    if (testResult?.curl_test) {
      navigator.clipboard.writeText(testResult.curl_test);
      toast.success("Curl komutu kopyalandı");
    }
  };

  // Health indicator color
  const healthColor = health.successRate >= 80
    ? "text-emerald-500"
    : health.successRate >= 50
      ? "text-amber-500"
      : "text-destructive";

  const handleProxyTypeChange = async (type: string) => {
    const config: Record<string, { host: string; port: string; label: string }> = {
      mobile: { host: "mp.evomi.com", port: "3000", label: "Mobile" },
      core: { host: "rp.evomi.com", port: "1000", label: "Core Residential" },
      premium: { host: "rp.evomi.com", port: "1001", label: "Premium Residential" },
    };
    const c = config[type];
    if (!c) return;

    setProxyType(type);
    // Update host, port, and proxy_type in bot_settings
    const updates: [string, string, string][] = [
      ["proxy_host", c.host, "Proxy Host"],
      ["proxy_port", c.port, "Proxy Port"],
      ["proxy_type", type, "Proxy Type"],
    ];
    for (const [key, value, label] of updates) {
      const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", key).maybeSingle();
      if (existing) {
        await supabase.from("bot_settings").update({ value }).eq("key", key);
      } else {
        await supabase.from("bot_settings").insert({ key, value, label });
      }
    }
    toast.success(`Proxy türü ${c.label} olarak değiştirildi (${c.host}:${c.port})`);
  };

  return (
    <div className="space-y-3">
      {/* Connection Status Card */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              cfStatus.blocked ? "bg-destructive animate-pulse" :
              health.currentIp ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
            }`} />
            <h3 className="text-xs font-semibold text-foreground">Bağlantı Durumu</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {cfStatus.blocked && (
              <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-[10px] hover:bg-destructive/10">
                CF Engeli
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] gap-1 px-2"
              onClick={testProxy}
              disabled={testing}
            >
              {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              {testing ? "Test..." : "Test"}
            </Button>
          </div>
        </div>

        {/* Proxy Type Selector */}
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Smartphone className="w-3 h-3" />
            Proxy Türü
          </Label>
          <Select value={proxyType} onValueChange={handleProxyTypeChange}>
            <SelectTrigger className="h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mobile">📱 Mobile (3G/4G/5G) — En güçlü</SelectItem>
              <SelectItem value="core">🏠 Core Residential — Ekonomik</SelectItem>
              <SelectItem value="premium">⭐ Premium Residential — Kaliteli</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* IP & Region */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border bg-card p-2 space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Wifi className="w-3 h-3" />
              <span className="text-[10px]">Aktif IP</span>
            </div>
            <p className="text-xs font-mono font-semibold text-foreground truncate">
              {health.currentIp || "—"}
            </p>
          </div>
          <div className="rounded-md border bg-card p-2 space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="w-3 h-3" />
              <span className="text-[10px]">Bölge</span>
            </div>
            <p className="text-xs font-mono font-semibold text-foreground truncate capitalize">
              {health.region || proxyCountry || "—"}
            </p>
          </div>
        </div>

        {/* Success Rate Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Activity className="w-3 h-3" />
              Başarı Oranı (son 50)
            </span>
            <span className={`text-xs font-bold tabular-nums ${healthColor}`}>
              %{health.successRate}
            </span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                health.successRate >= 80 ? "bg-emerald-500" :
                health.successRate >= 50 ? "bg-amber-500" : "bg-destructive"
              }`}
              style={{ width: `${health.successRate}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Toplam: {health.totalChecks} kontrol</span>
            <span>{health.errorCount}/50 hata</span>
          </div>
        </div>
      </Card>

      {/* Health Details Card */}
      <Card className="p-3 space-y-2.5">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          Sağlık Detayları
        </h3>

        {/* Last Success */}
        <div className={`rounded-md border p-2 space-y-0.5 ${
          health.lastSuccess ? "bg-emerald-500/5 border-emerald-500/15" : "bg-card"
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              Son Başarılı Bağlantı
            </span>
            {health.lastSuccess && (
              <span className="text-[10px] text-emerald-600 font-medium tabular-nums">
                {timeAgo(health.lastSuccess.time)}
              </span>
            )}
          </div>
          <p className="text-[10px] text-foreground/80 truncate">
            {health.lastSuccess?.message
              ? health.lastSuccess.message.substring(0, 80)
              : "Henüz kayıt yok"}
          </p>
        </div>

        {/* Last Error */}
        <div className={`rounded-md border p-2 space-y-0.5 ${
          health.lastError ? "bg-destructive/5 border-destructive/15" : "bg-card"
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-destructive" />
              Son Hata
            </span>
            {health.lastError && (
              <span className="text-[10px] text-destructive font-medium tabular-nums">
                {timeAgo(health.lastError.time)}
              </span>
            )}
          </div>
          <p className="text-[10px] text-foreground/80 truncate">
            {health.lastError?.message
              ? health.lastError.message.substring(0, 80)
              : "Hata yok ✓"}
          </p>
        </div>

        {/* IP Change */}
        <div className="rounded-md border bg-card p-2 space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Son IP Değişimi
            </span>
            {health.lastReset && (
              <span className="text-[10px] text-foreground/70 tabular-nums">
                {timeAgo(health.lastReset)}
              </span>
            )}
          </div>
          <p className="text-[10px] text-foreground/80">
            {health.lastReset
              ? new Date(health.lastReset).toLocaleString("tr-TR")
              : "—"}
          </p>
        </div>

        {/* Proxy Config Summary */}
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1">
            <span className="text-muted-foreground">Proxy</span>
            <span className={`font-medium ${proxyEnabled ? "text-emerald-600" : "text-amber-600"}`}>
              {proxyEnabled ? "Aktif" : "Kapalı"}
            </span>
          </div>
          <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1">
            <span className="text-muted-foreground">CAPTCHA</span>
            <span className="font-medium text-foreground">capsolver</span>
          </div>
          {proxyEnabled && (
            <>
              <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1">
                <span className="text-muted-foreground">Host</span>
                <span className="font-mono text-foreground truncate max-w-[80px]">{proxyHost}</span>
              </div>
              <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1">
                <span className="text-muted-foreground">Ülke</span>
                <span className="font-medium text-foreground">{proxyCountry}</span>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Proxy Test Result */}
      {testResult && (
        <Card className={`p-2.5 space-y-1.5 ${
          testResult.ok
            ? testResult.ip
              ? "bg-emerald-500/5 border-emerald-500/20"
              : "bg-amber-500/5 border-amber-500/20"
            : "bg-destructive/5 border-destructive/20"
        }`}>
          <div className="flex items-center gap-1.5">
            {testResult.ok ? (
              testResult.ip ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Zap className="w-3.5 h-3.5 text-amber-500" />
              )
            ) : (
              <XCircle className="w-3.5 h-3.5 text-destructive" />
            )}
            <span className={`text-[11px] font-medium ${
              testResult.ok
                ? testResult.ip ? "text-emerald-600" : "text-amber-600"
                : "text-destructive"
            }`}>
              {testResult.ip
                ? `Proxy aktif — IP: ${testResult.ip}`
                : testResult.ok
                  ? "Yapılandırma doğru"
                  : testResult.message || "Test başarısız"}
            </span>
          </div>

          {testResult.config && (
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <p>Host: {testResult.config.host}:{testResult.config.port}</p>
              <p>Ülke: {testResult.config.country} | User: {testResult.config.user}</p>
            </div>
          )}

          {testResult.curl_test && (
            <button
              onClick={copyCurl}
              className="flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
            >
              <Copy className="w-3 h-3" />
              Sunucu curl komutunu kopyala
            </button>
          )}
        </Card>
      )}

      {/* CF Block Alert */}
      {cfStatus.blocked && cfStatus.ip && (
        <Card className="p-2.5 bg-destructive/5 border-destructive/20">
          <div className="flex items-center gap-1.5">
            <WifiOff className="w-3.5 h-3.5 text-destructive" />
            <p className="text-[11px] text-destructive font-medium">
              Cloudflare engeli: {cfStatus.ip}
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 ml-5">
            {cfStatus.since && new Date(cfStatus.since).toLocaleString("tr-TR")} tarihinden beri
          </p>
        </Card>
      )}
    </div>
  );
}
