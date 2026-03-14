import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Network, Shield, Clock, Globe, Zap, Loader2, CheckCircle2, XCircle, Copy } from "lucide-react";
import { toast } from "sonner";

interface ProxySettingsProps {
  configId: string | null;
}

export default function ProxySettings({ configId }: ProxySettingsProps) {
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [lastReset, setLastReset] = useState<string | null>(null);
  const [proxyHost, setProxyHost] = useState("—");
  const [proxyCountry, setProxyCountry] = useState("—");
  const [cfStatus, setCfStatus] = useState<{ blocked: boolean; ip: string | null; since: string | null }>({
    blocked: false, ip: null, since: null,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; ip?: string | null; message?: string; curl_test?: string; config?: any } | null>(null);

  useEffect(() => {
    loadBotSettings();
    if (!configId) return;
    loadData();
    const channel = supabase
      .channel("proxy-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "tracking_logs", filter: `config_id=eq.${configId}` }, () => loadData())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tracking_configs", filter: `id=eq.${configId}` }, () => loadCfStatus())
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_settings" }, () => loadBotSettings())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [configId]);

  const loadBotSettings = async () => {
    const { data } = await supabase.from("bot_settings").select("key, value");
    if (data) {
      const map = Object.fromEntries(data.map(d => [d.key, d.value]));
      setProxyHost(map.proxy_host || "—");
      setProxyCountry(map.proxy_country || "—");
    }
  };

  const loadData = async () => {
    if (!configId) return;
    const { data: logs } = await supabase
      .from("tracking_logs")
      .select("message, created_at")
      .eq("config_id", configId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (logs) {
      for (const log of logs) {
        const match = log.message?.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/);
        if (match) {
          setCurrentIp(match[1]);
          setLastReset(log.created_at);
          break;
        }
      }
    }
    loadCfStatus();
  };

  const loadCfStatus = async () => {
    if (!configId) return;
    const { data } = await supabase
      .from("tracking_configs")
      .select("cf_blocked_since, cf_blocked_ip" as any)
      .eq("id", configId)
      .single();
    if (data) {
      const d = data as any;
      setCfStatus({
        blocked: !!d.cf_blocked_since,
        ip: d.cf_blocked_ip || null,
        since: d.cf_blocked_since || null,
      });
    }
  };

  const testProxy = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("proxy-test");
      if (error) throw error;
      setTestResult(data);
      if (data?.ip) {
        toast.success(`Proxy çalışıyor! IP: ${data.ip}`);
      } else if (data?.ok) {
        toast.info("Yapılandırma doğru, sunucudan test edin");
      } else {
        toast.error(data?.error || "Test başarısız");
      }
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

  const rows = [
    { label: "Aktif IP", value: currentIp || "—", icon: <Network className="w-3.5 h-3.5" /> },
    {
      label: "Son IP Değişimi",
      value: lastReset ? new Date(lastReset).toLocaleString("tr-TR") : "—",
      icon: <Clock className="w-3.5 h-3.5" />,
    },
    { label: "Captcha Solver", value: "capsolver.com", icon: <Shield className="w-3.5 h-3.5" /> },
    { label: "Proxy", value: "Evomi Residential", icon: <Globe className="w-3.5 h-3.5" /> },
    { label: "Proxy Host", value: proxyHost, icon: <Network className="w-3.5 h-3.5" /> },
    { label: "Proxy Ülke", value: proxyCountry, icon: <Globe className="w-3.5 h-3.5" /> },
  ];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Proxy & Bot Ayarları</h3>
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
            {testing ? "Test..." : "Proxy Test"}
          </Button>
        </div>
      </div>

      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              {row.icon}
              <span className="text-xs">{row.label}</span>
            </div>
            <span className="text-xs font-mono font-medium text-foreground truncate max-w-[140px]">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Proxy Test Result */}
      {testResult && (
        <div className={`rounded-md border p-2.5 space-y-1.5 ${
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
        </div>
      )}

      {cfStatus.blocked && cfStatus.ip && (
        <div className="rounded-md bg-destructive/5 border border-destructive/20 p-2.5">
          <p className="text-[11px] text-destructive font-medium">
            Cloudflare engeli: {cfStatus.ip}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {cfStatus.since && new Date(cfStatus.since).toLocaleString("tr-TR")} tarihinden beri
          </p>
        </div>
      )}
    </Card>
  );
}
