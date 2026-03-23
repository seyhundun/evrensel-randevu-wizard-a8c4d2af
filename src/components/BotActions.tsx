import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Play, OctagonX, Camera, TestTube, ShieldAlert,
  Loader2, RefreshCw, Monitor
} from "lucide-react";
import type { TrackingStatus } from "@/lib/constants";

interface BotActionsProps {
  status: TrackingStatus;
  configId: string | null;
  onStart: () => void;
  onStop: () => void;
  onSimulateFound: () => void;
  canStart: boolean;
}

export default function BotActions({
  status,
  configId,
  onStart,
  onStop,
  onSimulateFound,
  canStart,
}: BotActionsProps) {
  const [requesting, setRequesting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [changingIp, setChangingIp] = useState(false);
  const [manualNoProxy, setManualNoProxy] = useState(false);
  const isActive = status === "searching";

  const requestScreenshot = async () => {
    if (!configId) { toast.error("Aktif görev yok"); return; }
    setRequesting(true);
    await supabase
      .from("tracking_configs")
      .update({ screenshot_requested: true } as any)
      .eq("id", configId);
    toast.success("📸 Screenshot talebi gönderildi");
    setTimeout(() => setRequesting(false), 3000);
  };

  const retryCf = async () => {
    if (!configId) return;
    setRetrying(true);
    await supabase
      .from("tracking_configs")
      .update({ cf_retry_requested: true, cf_blocked_since: null, cf_blocked_ip: null } as any)
      .eq("id", configId);
    toast.success("Captcha Reset gönderildi, yeni IP ile denenecek");
    setTimeout(() => setRetrying(false), 3000);
  };

  const changeIp = async () => {
    if (!configId) { toast.error("Aktif görev yok"); return; }
    setChangingIp(true);
    await supabase
      .from("tracking_configs")
      .update({ cf_retry_requested: true, cf_blocked_since: null, cf_blocked_ip: null } as any)
      .eq("id", configId);
    toast.success("🔄 IP değiştirme talebi gönderildi, bot yeni IP ile devam edecek");
    setTimeout(() => setChangingIp(false), 3000);
  };

  const requestManualNoProxy = async () => {
    setManualNoProxy(true);
    try {
      await supabase.functions.invoke("bot-api", {
        body: { action: "request_manual_noproxy" },
      });
      toast.success("🖥️ Proxy'siz Chrome açılıyor, VNC'den kontrol edebilirsiniz");
    } catch {
      toast.error("İstek gönderilemedi");
    }
    setTimeout(() => setManualNoProxy(false), 5000);
  };

  const actions = [
    {
      label: "Başlat",
      icon: <Play className="w-4 h-4" />,
      onClick: onStart,
      disabled: isActive || !canStart,
      className: "bg-accent text-accent-foreground hover:bg-accent/90",
    },
    {
      label: "Acil Durdur",
      icon: <OctagonX className="w-4 h-4" />,
      onClick: onStop,
      disabled: !isActive,
      className: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    },
    {
      label: "Manuel Giriş (Proxy'siz)",
      icon: manualNoProxy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Monitor className="w-4 h-4" />,
      onClick: requestManualNoProxy,
      disabled: manualNoProxy,
      className: "bg-emerald-600 text-white hover:bg-emerald-700",
    },
    {
      label: "Captcha Reset",
      icon: retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />,
      onClick: retryCf,
      disabled: !isActive || retrying,
      className: "bg-amber-500 text-white hover:bg-amber-600",
    },
    {
      label: "IP Değiştir",
      icon: changingIp ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />,
      onClick: changeIp,
      disabled: !isActive || changingIp,
      className: "bg-cyan-600 text-white hover:bg-cyan-700",
    },
    {
      label: "Screenshot Al",
      icon: requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />,
      onClick: requestScreenshot,
      disabled: !isActive || requesting,
      className: "bg-primary text-primary-foreground hover:bg-primary/90",
    },
    {
      label: "Randevu Testi",
      icon: <TestTube className="w-4 h-4" />,
      onClick: onSimulateFound,
      disabled: !isActive,
      className: "bg-violet-500 text-white hover:bg-violet-600",
    },
  ];

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Bot İşlemleri</h3>
      <div className="grid grid-cols-2 md:grid-cols-1 gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
            size="sm"
            className={`w-full justify-start gap-2 text-xs font-medium ${action.className}`}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
