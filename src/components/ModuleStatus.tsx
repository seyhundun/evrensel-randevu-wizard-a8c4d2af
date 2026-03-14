import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Globe, Users, Bot, Play, Square, Loader2 } from "lucide-react";
import type { TrackingStatus } from "@/lib/constants";

interface ModuleStatusProps {
  status: TrackingStatus;
  configId: string | null;
  onStart: () => void;
  onStop: () => void;
  canStart: boolean;
}

interface BotHealth {
  botActive: boolean;
  lastLogAge: number;
  currentIp: string | null;
  accountCount: number;
  activeAccountCount: number;
}

export default function ModuleStatus({ status, configId, onStart, onStop, canStart }: ModuleStatusProps) {
  const [health, setHealth] = useState<BotHealth>({
    botActive: false,
    lastLogAge: Infinity,
    currentIp: null,
    accountCount: 0,
    activeAccountCount: 0,
  });

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [configId]);

  const checkHealth = async () => {
    // Check bot activity from logs
    let botActive = false;
    let lastLogAge = Infinity;
    let currentIp: string | null = null;

    if (configId) {
      const { data: logs } = await supabase
        .from("tracking_logs")
        .select("status, message, created_at")
        .eq("config_id", configId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (logs && logs.length > 0) {
        lastLogAge = (Date.now() - new Date(logs[0].created_at).getTime()) / 1000;
        botActive = lastLogAge < 300;
        const ipLog = logs.find(l => l.message?.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/));
        if (ipLog) {
          const match = ipLog.message?.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/);
          currentIp = match ? match[1] : null;
        }
      }
    }

    // Check accounts
    const { count: totalCount } = await supabase
      .from("vfs_accounts")
      .select("*", { count: "exact", head: true });
    const { count: activeCount } = await supabase
      .from("vfs_accounts")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");

    setHealth({
      botActive,
      lastLogAge,
      currentIp,
      accountCount: totalCount ?? 0,
      activeAccountCount: activeCount ?? 0,
    });
  };

  const isSearching = status === "searching";

  const modules = [
    {
      name: "Web Servisi",
      icon: <Globe className="w-4 h-4" />,
      active: true, // Frontend always running
      description: "Panel aktif",
    },
    {
      name: "Hesap Servisi",
      icon: <Users className="w-4 h-4" />,
      active: health.activeAccountCount > 0,
      description: health.activeAccountCount > 0
        ? `${health.activeAccountCount}/${health.accountCount} hesap aktif`
        : "Hesap yok",
    },
    {
      name: "Bot Servisi",
      icon: <Bot className="w-4 h-4" />,
      active: health.botActive && isSearching,
      description: health.botActive && isSearching
        ? `Çalışıyor • IP: ${health.currentIp || "?"}`
        : isSearching
          ? "Yanıt bekleniyor..."
          : "Kapalı",
    },
  ];

  return (
    <Card className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Modül Durumları</h3>

      <div className="space-y-2.5">
        {modules.map((m) => (
          <div key={m.name} className="flex items-center gap-3">
            <div className={`p-1.5 rounded-md ${m.active ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"}`}>
              {m.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.name}</span>
                <Badge
                  variant={m.active ? "default" : "secondary"}
                  className={`text-[10px] px-1.5 py-0 h-4 ${
                    m.active
                      ? "bg-accent/15 text-accent border-accent/30 hover:bg-accent/15"
                      : "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/10"
                  }`}
                >
                  {m.active ? "Aktif" : "Kapalı"}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground truncate">{m.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-border">
        {isSearching ? (
          <Button onClick={onStop} variant="destructive" size="sm" className="w-full gap-1.5">
            <Square className="w-3.5 h-3.5" />
            Takibi Durdur
          </Button>
        ) : (
          <Button
            onClick={onStart}
            size="sm"
            className="w-full gap-1.5"
            disabled={!canStart}
          >
            {status === "searching" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Bot Servisini Başlat
          </Button>
        )}
      </div>
    </Card>
  );
}
