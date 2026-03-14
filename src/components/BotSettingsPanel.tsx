import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Globe, Plus, Trash2, Save, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

interface VfsCountry {
  id: string;
  value: string;
  label: string;
  flag: string;
  code: string;
  sort_order: number;
  is_active: boolean;
}

interface BotSetting {
  id: string;
  key: string;
  value: string;
  label: string | null;
}

export default function BotSettingsPanel() {
  const [countries, setCountries] = useState<VfsCountry[]>([]);
  const [settings, setSettings] = useState<BotSetting[]>([]);
  const [newCountry, setNewCountry] = useState({ value: "", label: "", flag: "", code: "" });
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showCaptchaKey, setShowCaptchaKey] = useState(false);
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [lastIpReset, setLastIpReset] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const ch = supabase
      .channel("bot-settings-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "vfs_countries" }, () => loadCountries())
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_settings" }, () => loadSettings())
      .on("postgres_changes", { event: "*", schema: "public", table: "tracking_logs" }, () => loadCurrentIp())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const loadData = () => { loadCountries(); loadSettings(); loadCurrentIp(); };

  const loadCountries = async () => {
    const { data } = await supabase.from("vfs_countries").select("*").order("sort_order");
    if (data) setCountries(data);
  };

  const loadSettings = async () => {
    const { data } = await supabase.from("bot_settings").select("*");
    if (data) setSettings(data);
  };

  const loadCurrentIp = async () => {
    const { data } = await supabase
      .from("tracking_logs")
      .select("message, created_at")
      .eq("status", "ip_change")
      .order("created_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      const match = data[0].message?.match(/Aktif IP:\s*([^\s|]+)/);
      if (match) {
        setCurrentIp(match[1]);
        setLastIpReset(data[0].created_at);
      }
    }
  };

  const getSetting = (key: string) => settings.find(s => s.key === key)?.value || "";

  const updateSetting = async (key: string, value: string, label?: string) => {
    const existing = settings.find(s => s.key === key);
    if (existing) {
      await supabase.from("bot_settings").update({ value }).eq("key", key);
      setSettings(prev => prev.map(s => s.key === key ? { ...s, value } : s));
    } else {
      const { data } = await supabase.from("bot_settings").insert({ key, value, label: label || key }).select().single();
      if (data) setSettings(prev => [...prev, data]);
    }
  };

  const addCountry = async () => {
    if (!newCountry.value || !newCountry.label || !newCountry.code) {
      toast.error("Değer, isim ve VFS kodu zorunlu");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("vfs_countries").insert({
      ...newCountry,
      sort_order: countries.length + 1,
    });
    if (error) {
      toast.error("Eklenemedi: " + error.message);
    } else {
      toast.success(`${newCountry.label} eklendi`);
      setNewCountry({ value: "", label: "", flag: "", code: "" });
      setShowAddForm(false);
    }
    setSaving(false);
  };

  const toggleCountry = async (id: string, active: boolean) => {
    await supabase.from("vfs_countries").update({ is_active: active }).eq("id", id);
  };

  const deleteCountry = async (id: string, label: string) => {
    await supabase.from("vfs_countries").delete().eq("id", id);
    toast.info(`${label} silindi`);
  };

  const proxyCountries = [
    { code: "TR", label: "🇹🇷 Türkiye" },
    { code: "PL", label: "🇵🇱 Polonya" },
    { code: "DE", label: "🇩🇪 Almanya" },
    { code: "NL", label: "🇳🇱 Hollanda" },
    { code: "FR", label: "🇫🇷 Fransa" },
    { code: "GB", label: "🇬🇧 İngiltere" },
    { code: "US", label: "🇺🇸 ABD" },
  ];

  return (
    <Card className="p-4 space-y-5">
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Panel ve Hesap Bot Proxy Ayarları</h3>
      </div>

      {/* Current IP & Reset Date (read-only) */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">IP</Label>
          <Input
            className="h-8 text-xs font-mono bg-muted/50"
            value={currentIp || "—"}
            readOnly
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Reset Tarihi</Label>
          <Input
            className="h-8 text-xs font-mono bg-muted/50"
            value={lastIpReset || "—"}
            readOnly
          />
        </div>
      </div>

      {/* Captcha Solver */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Captcha Solver</Label>
          <Select
            value={getSetting("captcha_provider") || "capsolver"}
            onValueChange={v => updateSetting("captcha_provider", v, "Captcha Provider")}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="capsolver">capsolver.com</SelectItem>
              <SelectItem value="2captcha">2captcha.com</SelectItem>
              <SelectItem value="auto">Otomatik (önce capsolver)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Captcha Solver Token</Label>
          <div className="relative">
            <Input
              className="h-8 text-xs font-mono pr-8"
              type={showCaptchaKey ? "text" : "password"}
              value={getSetting("capsolver_api_key")}
              onChange={e => updateSetting("capsolver_api_key", e.target.value, "Capsolver API Key")}
              placeholder="CAP-XXXX..."
            />
            <button
              type="button"
              onClick={() => setShowCaptchaKey(!showCaptchaKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showCaptchaKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Proxy Settings */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Proxy IP (Host)</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={getSetting("proxy_host")}
            onChange={e => updateSetting("proxy_host", e.target.value)}
            placeholder="core-residential.evomi-proxy.com"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Port</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={getSetting("proxy_port")}
            onChange={e => updateSetting("proxy_port", e.target.value)}
            placeholder="1000"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Kullanıcı Adı</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={getSetting("proxy_user")}
            onChange={e => updateSetting("proxy_user", e.target.value, "Proxy Kullanıcı")}
            placeholder="kullanici_adi"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Şifre</Label>
          <div className="relative">
            <Input
              className="h-8 text-xs font-mono pr-8"
              type={showPass ? "text" : "password"}
              value={getSetting("proxy_pass")}
              onChange={e => updateSetting("proxy_pass", e.target.value, "Proxy Şifre")}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Proxy Bölge (Region)</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={getSetting("proxy_region")}
            onChange={e => updateSetting("proxy_region", e.target.value, "Proxy Bölge")}
            placeholder="ankara"
          />
        </div>
      </div>

      {/* Proxy Country */}
      <div className="space-y-2 border-t border-border pt-4">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Globe className="w-3 h-3 text-muted-foreground" />
          Proxy Ülkesi (Evomi IP Lokasyonu)
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {proxyCountries.map(pc => (
            <button
              key={pc.code}
              onClick={() => updateSetting("proxy_country", pc.code)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                getSetting("proxy_country") === pc.code
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary text-foreground hover:bg-secondary/80"
              }`}
            >
              {pc.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Bot bu ülkeden residential IP alacak. Değişiklik anında sunucuya iletilir.
        </p>
      </div>

      {/* VFS Countries */}
      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">VFS Hedef Ülkeleri</Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] gap-1"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus className="w-3 h-3" />
            Ülke Ekle
          </Button>
        </div>

        <div className="space-y-1.5">
          {countries.map(c => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 p-2 rounded-md bg-secondary/50"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{c.flag}</span>
                <span className="text-xs font-medium">{c.label}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">
                  {c.code}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={c.is_active}
                  onCheckedChange={v => toggleCountry(c.id, v)}
                  className="scale-75"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => deleteCountry(c.id, c.label)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {showAddForm && (
          <div className="space-y-2 p-3 rounded-md border border-border bg-card">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Değer (ör: germany)</Label>
                <Input
                  className="h-7 text-xs"
                  value={newCountry.value}
                  onChange={e => setNewCountry(p => ({ ...p, value: e.target.value }))}
                  placeholder="germany"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">İsim (ör: Almanya)</Label>
                <Input
                  className="h-7 text-xs"
                  value={newCountry.label}
                  onChange={e => setNewCountry(p => ({ ...p, label: e.target.value }))}
                  placeholder="Almanya"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">VFS Kodu (ör: deu)</Label>
                <Input
                  className="h-7 text-xs font-mono"
                  value={newCountry.code}
                  onChange={e => setNewCountry(p => ({ ...p, code: e.target.value }))}
                  placeholder="deu"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Bayrak Emoji</Label>
                <Input
                  className="h-7 text-xs"
                  value={newCountry.flag}
                  onChange={e => setNewCountry(p => ({ ...p, flag: e.target.value }))}
                  placeholder="🇩🇪"
                />
              </div>
            </div>
            <Button size="sm" className="h-7 text-xs gap-1 w-full" onClick={addCountry} disabled={saving}>
              <Save className="w-3 h-3" />
              Kaydet
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
