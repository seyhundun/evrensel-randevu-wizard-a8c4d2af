import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";

export default function IdataControlPanel() {
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
    const channel = supabase
      .channel("idata-config-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "idata_config" }, () => loadConfig())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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

  return (
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
      {isActive && (
        <span className="flex items-center gap-1.5 text-sm text-green-600">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          Çalışıyor
        </span>
      )}
    </div>
  );
}
