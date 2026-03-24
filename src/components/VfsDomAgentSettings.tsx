import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Save } from "lucide-react";
import { toast } from "sonner";

async function upsertSetting(key: string, value: string, label?: string) {
  const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", key).limit(1);
  if (existing && existing.length > 0) {
    await supabase.from("bot_settings").update({ value }).eq("key", key);
  } else {
    await supabase.from("bot_settings").insert({ key, value, label: label || key });
  }
}

export default function VfsDomAgentSettings() {
  const [stepTimeout, setStepTimeout] = useState("30");
  const [maxSteps, setMaxSteps] = useState("50");
  const [aiModel, setAiModel] = useState("google/gemini-2.5-flash");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("bot_settings").select("key, value").in("key", [
        "vfs_step_timeout", "vfs_max_steps", "vfs_ai_model"
      ]);
      if (data) {
        const map = Object.fromEntries(data.map(r => [r.key, r.value]));
        setStepTimeout(map.vfs_step_timeout || "30");
        setMaxSteps(map.vfs_max_steps || "50");
        setAiModel(map.vfs_ai_model || "google/gemini-2.5-flash");
      }
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return null;

  return (
    <div className="space-y-4 p-2">
      {/* Step Timeout */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] text-muted-foreground">Adım Zaman Aşımı</Label>
          <span className="text-[11px] font-mono text-foreground">{stepTimeout}s</span>
        </div>
        <Slider
          value={[Number(stepTimeout)]}
          onValueChange={([v]) => setStepTimeout(String(v))}
          min={10}
          max={120}
          step={5}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>10s</span>
          <span>120s</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] w-full"
          onClick={async () => {
            await upsertSetting("vfs_step_timeout", stepTimeout, "VFS Adım Zaman Aşımı (sn)");
            toast.success("VFS zaman aşımı: " + stepTimeout + "s");
          }}
        >
          <Save className="w-3 h-3 mr-1" /> Kaydet
        </Button>
      </div>

      {/* Max Steps */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] text-muted-foreground">Maks. Adım Sayısı</Label>
          <span className="text-[11px] font-mono text-foreground">{maxSteps}</span>
        </div>
        <Input
          className="h-7 text-xs font-mono"
          type="number"
          min={10}
          max={200}
          value={maxSteps}
          onChange={e => setMaxSteps(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] w-full"
          onClick={async () => {
            await upsertSetting("vfs_max_steps", maxSteps, "VFS Maks Adım");
            toast.success("VFS maks adım: " + maxSteps);
          }}
        >
          <Save className="w-3 h-3 mr-1" /> Kaydet
        </Button>
      </div>

      {/* AI Model */}
      <div className="space-y-2">
        <Label className="text-[11px] text-muted-foreground">AI Motor</Label>
        <Select value={aiModel} onValueChange={setAiModel}>
          <SelectTrigger className="h-7 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="google/gemini-2.5-flash">Gemini 2.5 Flash (Hızlı)</SelectItem>
            <SelectItem value="google/gemini-2.5-pro">Gemini 2.5 Pro (Güçlü)</SelectItem>
            <SelectItem value="openai/gpt-5-mini">GPT-5 Mini</SelectItem>
            <SelectItem value="openai/gpt-5">GPT-5 (En Güçlü)</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] w-full"
          onClick={async () => {
            await upsertSetting("vfs_ai_model", aiModel, "VFS AI Motor");
            toast.success("VFS AI motor: " + aiModel.split("/")[1]);
          }}
        >
          <Save className="w-3 h-3 mr-1" /> Kaydet
        </Button>
      </div>
    </div>
  );
}
