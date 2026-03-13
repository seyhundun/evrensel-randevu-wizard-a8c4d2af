import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, CheckCircle2, Clock, AlertCircle, Camera, Loader2 } from "lucide-react";
import { COUNTRIES, CITIES, TrackingStatus } from "@/lib/constants";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface StatusPanelProps {
  status: TrackingStatus;
  country: string;
  city: string;
  elapsedSeconds: number;
  checksCount: number;
  onSimulateFound: () => void;
  configId: string | null;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function StatusPanel({
  status,
  country,
  city,
  elapsedSeconds,
  checksCount,
  onSimulateFound,
  configId,
}: StatusPanelProps) {
  const [requesting, setRequesting] = useState(false);
  const countryLabel = COUNTRIES.find((c) => c.value === country);
  const cityLabel = CITIES.find((c) => c.value === city);

  const requestScreenshot = async () => {
    if (!configId) {
      toast.error("Aktif görev yok");
      return;
    }
    setRequesting(true);
    try {
      await supabase
        .from("tracking_configs")
        .update({ screenshot_requested: true } as any)
        .eq("id", configId);
      toast.success("📸 Screenshot talebi gönderildi", {
        description: "Bot bir sonraki döngüde ekran görüntüsü alacak.",
      });
    } catch {
      toast.error("Talep gönderilemedi");
    } finally {
      setTimeout(() => setRequesting(false), 3000);
    }
  };

  const config = {
    idle: {
      bg: "bg-secondary",
      icon: <Clock className="w-10 h-10 text-muted-foreground" />,
      title: "Beklemede",
      subtitle: "Takibi başlatmak için sol panelden ayarlarınızı yapın.",
    },
    searching: {
      bg: "bg-primary/5",
      icon: <Search className="w-10 h-10 text-primary animate-pulse" />,
      title: "Aranıyor...",
      subtitle: `${countryLabel?.flag ?? ""} ${countryLabel?.label ?? ""} – ${cityLabel?.label ?? ""} için randevu aranıyor.`,
    },
    found: {
      bg: "bg-accent/10",
      icon: <CheckCircle2 className="w-10 h-10 text-accent" />,
      title: "Randevu Bulundu!",
      subtitle: "Uygun randevu slotu tespit edildi. Hemen harekete geçin!",
    },
    error: {
      bg: "bg-destructive/5",
      icon: <AlertCircle className="w-10 h-10 text-destructive" />,
      title: "Hata",
      subtitle: "Oturum sonlandı. Lütfen tekrar giriş yapın.",
    },
  };

  const c = config[status];

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={status}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className={`${c.bg} rounded-xl p-8 text-center shadow-card transition-colors duration-300`}
        >
          <div className="flex justify-center mb-4">{c.icon}</div>
          <h2 className="display-text text-foreground">{c.title}</h2>
          <p className="body-text text-muted-foreground mt-2">{c.subtitle}</p>

          {status === "searching" && (
            <div className="mt-6 flex items-center justify-center gap-6">
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {formatTime(elapsedSeconds)}
                </p>
                <p className="helper-text">Geçen Süre</p>
              </div>
              <div className="w-px h-10 bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {checksCount}
                </p>
                <p className="helper-text">Kontrol</p>
              </div>
              <div className="w-px h-10 bg-border" />
              <div className="text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={requestScreenshot}
                  disabled={requesting}
                  className="gap-1.5"
                >
                  {requesting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4" />
                  )}
                  {requesting ? "Bekleniyor..." : "📸 Ekran Görüntüsü"}
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Demo button - simulates finding */}
      {status === "searching" && (
        <button
          onClick={onSimulateFound}
          className="helper-text underline text-muted-foreground hover:text-foreground transition-colors"
        >
          (Demo: Randevu bulundu simüle et)
        </button>
      )}
    </div>
  );
}
