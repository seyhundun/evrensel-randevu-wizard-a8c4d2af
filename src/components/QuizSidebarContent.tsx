import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Network, Globe, Wifi, MapPin, Activity, Shield, Zap, Loader2,
  CheckCircle2, AlertTriangle, Clock, Brain, Play, Square
} from "lucide-react";

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

export default function QuizSidebarContent() {
  const [proxyHost, setProxyHost] = useState("—");
  const [proxyPort, setProxyPort] = useState("—");
  const [proxyCountry, setProxyCountry] = useState("—");
  const [proxyRegion, setProxyRegion] = useState("—");
  const [quizProxyEnabled, setQuizProxyEnabled] = useState(true);
  const [captchaProvider, setCaptchaProvider] = useState("—");
  const [captchaApiKey, setCaptchaApiKey] = useState(false);
  const [quizStatus, setQuizStatus] = useState<"idle" | "running">("idle");
  const [lastLog, setLastLog] = useState<{ message: string; time: string; status: string } | null>(null);
  const [stats, setStats] = useState({ total: 0, success: 0, error: 0, successRate: 100 });

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from("bot_settings").select("key, value");
    if (data) {
      const map = Object.fromEntries(data.map(d => [d.key, d.value]));
      setProxyHost(map.proxy_host || "—");
      setProxyPort(map.proxy_port || "1000");
      setProxyCountry(map.quiz_proxy_country || map.proxy_country || "—");
      setProxyRegion(map.quiz_proxy_region || "—");
      setQuizProxyEnabled(map.quiz_proxy_enabled !== "false");
      setCaptchaProvider(map.captcha_provider || "2captcha");
      setCaptchaApiKey(!!(map.captcha_api_key));
    }
  }, []);

  const loadLogs = useCallback(async () => {
    // Last log
    const { data: logs } = await supabase
      .from("quiz_tracking_logs")
      .select("message, created_at, status")
      .order("created_at", { ascending: false })
      .limit(1);
    if (logs && logs.length > 0) {
      setLastLog({ message: logs[0].message || "", time: logs[0].created_at, status: logs[0].status });
    }

    // Stats from last 50
    const { data: recentLogs } = await supabase
      .from("quiz_tracking_logs")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(50);
    const total = recentLogs?.length || 0;
    const errors = recentLogs?.filter(l => l.status === "error").length || 0;
    const successes = recentLogs?.filter(l => l.status === "success").length || 0;
    const rate = total > 0 ? Math.round(((total - errors) / total) * 100) : 100;
    setStats({ total, success: successes, error: errors, successRate: rate });

    // Check if quiz is running
    const { data: running } = await supabase
      .from("link_analyses")
      .select("id")
      .eq("status", "quiz_running")
      .limit(1);
    setQuizStatus(running && running.length > 0 ? "running" : "idle");
  }, []);

  useEffect(() => {
    loadSettings();
    loadLogs();
    const ch = supabase
      .channel("quiz-sidebar-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_settings" }, () => loadSettings())
      .on("postgres_changes", { event: "*", schema: "public", table: "quiz_tracking_logs" }, () => loadLogs())
      .on("postgres_changes", { event: "*", schema: "public", table: "link_analyses" }, () => loadLogs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadSettings, loadLogs]);

  const toggleQuizProxy = async () => {
    const newVal = !quizProxyEnabled;
    setQuizProxyEnabled(newVal);
    // Upsert quiz_proxy_enabled
    const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", "quiz_proxy_enabled").limit(1);
    if (existing && existing.length > 0) {
      await supabase.from("bot_settings").update({ value: newVal ? "true" : "false" }).eq("key", "quiz_proxy_enabled");
    } else {
      await supabase.from("bot_settings").insert({ key: "quiz_proxy_enabled", value: newVal ? "true" : "false", label: "Quiz Proxy Aktif" });
    }
    toast.success(newVal ? "Quiz proxy aktif" : "Quiz proxy kapalı");
  };

  const healthColor = stats.successRate >= 80 ? "text-emerald-500" : stats.successRate >= 50 ? "text-amber-500" : "text-destructive";

  return (
    <div className="p-3 space-y-3">
      {/* Bot Status */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${quizStatus === "running" ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
            <h3 className="text-xs font-semibold text-foreground">Quiz Bot Durumu</h3>
          </div>
          <Badge className={`text-[10px] ${quizStatus === "running" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-secondary text-muted-foreground"}`}>
            {quizStatus === "running" ? "Çalışıyor" : "Bekliyor"}
          </Badge>
        </div>

        {/* Last Activity */}
        {lastLog && (
          <div className="rounded-md border bg-card p-2 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Son Aktivite
              </span>
              <span className="text-[10px] text-foreground/70 tabular-nums">
                {timeAgo(lastLog.time)}
              </span>
            </div>
            <p className="text-[10px] text-foreground/80 truncate">
              {lastLog.message?.replace("[QUIZ] ", "").slice(0, 80)}
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Activity className="w-3 h-3" />
              Başarı Oranı (son 50)
            </span>
            <span className={`text-xs font-bold tabular-nums ${healthColor}`}>
              %{stats.successRate}
            </span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                stats.successRate >= 80 ? "bg-emerald-500" :
                stats.successRate >= 50 ? "bg-amber-500" : "bg-destructive"
              }`}
              style={{ width: `${stats.successRate}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{stats.success} başarılı</span>
            <span>{stats.error} hata</span>
          </div>
        </div>
      </Card>

      {/* Proxy Settings */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5 text-muted-foreground" />
            Proxy Ayarları
          </h3>
          <Switch checked={quizProxyEnabled} onCheckedChange={toggleQuizProxy} />
        </div>

        {quizProxyEnabled && (
          <>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />
                Proxy Türü
              </Label>
              <div className="flex h-7 items-center justify-between rounded-md border bg-secondary/40 px-2.5 text-[11px]">
                <span className="font-medium text-foreground">🏠 Core Residential</span>
                <span className="font-mono text-muted-foreground">Port {proxyPort}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border bg-card p-2 space-y-1">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Wifi className="w-3 h-3" />
                  <span className="text-[10px]">Host</span>
                </div>
                <p className="text-[10px] font-mono font-semibold text-foreground truncate">
                  {proxyHost}
                </p>
              </div>
              <div className="rounded-md border bg-card p-2 space-y-1">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  <span className="text-[10px]">Ülke</span>
                </div>
                <p className="text-xs font-mono font-semibold text-foreground truncate">
                  {proxyCountry}
                </p>
              </div>
            </div>

            {proxyRegion !== "—" && (
              <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1 text-[10px]">
                <span className="text-muted-foreground">Bölge</span>
                <span className="font-medium text-foreground capitalize">{proxyRegion}</span>
              </div>
            )}
          </>
        )}
      </Card>

      {/* CAPTCHA Settings */}
      <Card className="p-3 space-y-2">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          CAPTCHA Ayarları
        </h3>
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1">
            <span className="text-muted-foreground">Sağlayıcı</span>
            <span className="font-medium text-foreground">{captchaProvider}</span>
          </div>
          <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1">
            <span className="text-muted-foreground">API Key</span>
            <span className={`font-medium ${captchaApiKey ? "text-emerald-600" : "text-destructive"}`}>
              {captchaApiKey ? "✓ Tanımlı" : "✗ Eksik"}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
