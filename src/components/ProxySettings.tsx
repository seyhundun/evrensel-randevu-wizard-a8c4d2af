import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Network, Shield, Clock, Globe } from "lucide-react";

interface ProxySettingsProps {
  configId: string | null;
}

export default function ProxySettings({ configId }: ProxySettingsProps) {
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [lastReset, setLastReset] = useState<string | null>(null);
  const [cfStatus, setCfStatus] = useState<{ blocked: boolean; ip: string | null; since: string | null }>({
    blocked: false, ip: null, since: null,
  });

  useEffect(() => {
    if (!configId) return;
    loadData();
    const channel = supabase
      .channel("proxy-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "tracking_logs", filter: `config_id=eq.${configId}` }, () => loadData())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tracking_configs", filter: `id=eq.${configId}` }, () => loadCfStatus())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [configId]);

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

  const rows = [
    { label: "Aktif IP", value: currentIp || "—", icon: <Network className="w-3.5 h-3.5" /> },
    {
      label: "Son IP Değişimi",
      value: lastReset ? new Date(lastReset).toLocaleString("tr-TR") : "—",
      icon: <Clock className="w-3.5 h-3.5" />,
    },
    { label: "Captcha Solver", value: "capsolver.com", icon: <Shield className="w-3.5 h-3.5" /> },
    { label: "Proxy", value: "Evomi Residential", icon: <Globe className="w-3.5 h-3.5" /> },
    { label: "Proxy Host", value: "rp.evomi.com", icon: <Network className="w-3.5 h-3.5" /> },
  ];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Proxy & Bot Ayarları</h3>
        {cfStatus.blocked && (
          <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-[10px] hover:bg-destructive/10">
            CF Engeli
          </Badge>
        )}
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
