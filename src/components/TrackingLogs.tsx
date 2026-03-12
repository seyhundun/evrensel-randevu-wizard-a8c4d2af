import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Search, AlertCircle, Clock, Image as ImageIcon, X } from "lucide-react";

interface LogEntry {
  id: string;
  status: string;
  message: string | null;
  slots_available: number | null;
  screenshot_url: string | null;
  created_at: string;
}

interface TrackingLogsProps {
  configId: string | null;
}

const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  checking: {
    icon: <Search className="w-4 h-4" />,
    label: "Kontrol",
    color: "text-primary bg-primary/10",
  },
  found: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: "Bulundu",
    color: "text-accent bg-accent/10",
  },
  error: {
    icon: <AlertCircle className="w-4 h-4" />,
    label: "Hata",
    color: "text-destructive bg-destructive/10",
  },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Az önce";
  if (mins < 60) return `${mins}dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}sa önce`;
  return `${Math.floor(hours / 24)}g önce`;
}

export default function TrackingLogs({ configId }: TrackingLogsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const fetchLogs = async () => {
    if (!configId) return;
    setLoading(true);
    const { data } = await supabase
      .from("tracking_logs")
      .select("*")
      .eq("config_id", configId)
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs((data as LogEntry[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    if (!configId) return;

    const channel = supabase
      .channel("tracking-logs-" + configId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tracking_logs", filter: `config_id=eq.${configId}` },
        (payload) => {
          setLogs((prev) => [payload.new as LogEntry, ...prev].slice(0, 50));
        }
      )
      .subscribe();

    const interval = setInterval(fetchLogs, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [configId]);

  if (!configId) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          Son Kontroller
        </h3>
        <span className="text-xs text-muted-foreground">{logs.length} kayıt</span>
      </div>

      {loading && logs.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">Yükleniyor...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm rounded-lg bg-secondary/50">
          Henüz kontrol kaydı yok. Bot çalışmaya başladığında burada görünecek.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {logs.map((log) => {
            const cfg = statusConfig[log.status] ?? statusConfig.checking;
            return (
              <div
                key={log.id}
                className="flex items-start gap-3 rounded-lg bg-card border border-border/50 px-3 py-2.5 text-sm transition-colors hover:bg-secondary/30"
              >
                <span className={`mt-0.5 flex items-center justify-center rounded-md p-1 ${cfg.color}`}>
                  {cfg.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{cfg.label}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(log.created_at)}</span>
                  </div>
                  {log.message && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{log.message}</p>
                  )}
                  {log.screenshot_url && (
                    <button
                      onClick={() => setLightboxUrl(log.screenshot_url)}
                      className="mt-1.5 flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
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
