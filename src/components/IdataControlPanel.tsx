import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Play, Square, ShieldAlert, RotateCcw, Server, ServerOff, Clock } from "lucide-react";
import { toast } from "sonner";

export default function IdataControlPanel() {
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [cfBlocked, setCfBlocked] = useState(false);
  const [cfBlockedIp, setCfBlockedIp] = useState<string | null>(null);
  const [cfBlockedSince, setCfBlockedSince] = useState<string | null>(null);
  const [lastLogAt, setLastLogAt] = useState<string | null>(null);
  const [serverAlive, setServerAlive] = useState(false);
  const [checkInterval, setCheckInterval] = useState(300);

  useEffect(() => {
    loadConfig();
    checkServerAlive();
    const interval = setInterval(checkServerAlive, 15000);
    const channel = supabase
      .channel("idata-config-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "idata_config" }, () => loadConfig())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "idata_tracking_logs" }, () => checkServerAlive())
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const loadConfig = async () => {
    const { data } = await supabase
      .from("idata_config" as any)
      .select("*")
      .limit(1)
      .single();
    if (data) {
      const cfg = data as any;
      setConfigId(cfg.id);
      setIsActive(cfg.is_active);
      setCfBlocked(!!cfg.cf_blocked_since);
      setCfBlockedIp(cfg.cf_blocked_ip || null);
      setCfBlockedSince(cfg.cf_blocked_since || null);
      setCheckInterval(cfg.check_interval || 300);
    }
  };

  const checkServerAlive = async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("idata_tracking_logs" as any)
      .select("created_at")
      .gte("created_at", fiveMinAgo)
      .order("created_at", { ascending: false })
      .limit(1);
    const logs = data as any[] | null;
    if (logs && logs.length > 0) {
      setLastLogAt(logs[0].created_at);
      setServerAlive(true);
    } else {
      // Check last log ever
      const { data: lastData } = await supabase
        .from("idata_tracking_logs" as any)
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      const lastLogs = lastData as any[] | null;
      setLastLogAt(lastLogs?.[0]?.created_at || null);
      setServerAlive(false);
    }
  };

  const toggle = async () => {
    if (!configId) return;
    setLoading(true);
    const newState = !isActive;
    const { error } = await supabase
      .from("idata_config" as any)
      .update({ is_active: newState } as any)
      .eq("id", configId);
    if (error) {
      toast.error("Hata: " + error.message);
    } else {
      setIsActive(newState);
      toast.success(newState ? "iDATA botu başlatıldı" : "iDATA botu durduruldu");
    }
    setLoading(false);
  };

  const retryCf = async () => {
    if (!configId) return;
    setLoading(true);
    const { error } = await supabase
      .from("idata_config" as any)
      .update({ cf_retry_requested: true, cf_blocked_since: null, cf_blocked_ip: null } as any)
      .eq("id", configId);
    if (error) {
      toast.error("Hata: " + error.message);
    } else {
      setCfBlocked(false);
      toast.success("Yeni IP ile tekrar deneniyor...");
    }
    setLoading(false);
  };

  const cfDuration = cfBlockedSince
    ? Math.floor((Date.now() - new Date(cfBlockedSince).getTime()) / 1000)
    : 0;

  const formatLastSeen = (dateStr: string | null) => {
    if (!dateStr) return "Hiç log yok";
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return `${diff}s önce`;
    if (diff < 3600) return `${Math.floor(diff / 60)}dk önce`;
    return `${Math.floor(diff / 3600)}sa önce`;
  };

  return (
    <div className="space-y-3">
      {/* Server Status Bar */}
      <div className={`flex items-center justify-between p-3 rounded-lg border ${
        serverAlive
          ? "border-green-500/30 bg-green-500/10"
          : "border-red-500/30 bg-red-500/10"
      }`}>
        <div className="flex items-center gap-2">
          {serverAlive ? (
            <Server className="w-5 h-5 text-green-600 dark:text-green-400" />
          ) : (
            <ServerOff className="w-5 h-5 text-red-500 dark:text-red-400" />
          )}
          <div>
            <p className={`text-sm font-semibold ${
              serverAlive ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"
            }`}>
              Sunucu: {serverAlive ? "Çalışıyor ✅" : "Durdu ❌"}
            </p>
            <p className="text-xs text-muted-foreground">
              Son aktivite: {formatLastSeen(lastLogAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {serverAlive && isActive && !cfBlocked && (
            <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              Aktif
            </span>
          )}
          {!isActive && (
            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Pasif</span>
          )}
        </div>
      </div>

      {/* Check Interval Slider */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-muted/30">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          Kontrol Aralığı
          <span className="ml-auto tabular-nums text-primary font-semibold text-xs">
            {checkInterval >= 60 ? `${Math.floor(checkInterval / 60)}dk ${checkInterval % 60 > 0 ? `${checkInterval % 60}s` : ""}` : `${checkInterval}s`}
          </span>
        </Label>
        <Slider
          value={[checkInterval]}
          onValueChange={async ([v]) => {
            setCheckInterval(v);
            if (configId) {
              await supabase
                .from("idata_config" as any)
                .update({ check_interval: v } as any)
                .eq("id", configId);
            }
          }}
          min={30}
          max={1800}
          step={30}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>30s</span>
          <span>10dk</span>
          <span>20dk</span>
          <span>30dk</span>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex items-center gap-3">
        <Button
          onClick={toggle}
          disabled={loading}
          variant={isActive ? "destructive" : "default"}
          size="sm"
          className="gap-1.5"
        >
          {isActive ? (
            <><Square className="w-4 h-4" /> Botu Durdur</>
          ) : (
            <><Play className="w-4 h-4" /> Botu Başlat</>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          {isActive
            ? "Bot aktif — veritabanı üzerinden kontrol ediliyor"
            : "Bot pasif — başlatmak için tıklayın"}
        </p>
      </div>

      {/* Cloudflare Block Alert */}
      {cfBlocked && isActive && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
          <ShieldAlert className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Cloudflare engeli algılandı
            </p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/60">
              IP: {cfBlockedIp || "?"} • {cfDuration}s önce
            </p>
          </div>
          <Button
            onClick={retryCf}
            disabled={loading}
            size="sm"
            variant="outline"
            className="gap-1.5 border-amber-500/50 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 flex-shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
            Yeni IP ile Dene
          </Button>
        </div>
      )}
    </div>
  );
}
