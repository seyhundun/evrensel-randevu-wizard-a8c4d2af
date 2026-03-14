import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { Settings, Globe, Plus, Trash2, Save, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
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
  const [savingSettings, setSavingSettings] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showCaptchaKey, setShowCaptchaKey] = useState(false);
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [lastIpReset, setLastIpReset] = useState<string | null>(null);
  const [evomiRegions, setEvomiRegions] = useState<string[]>([]);
  const [evomiCities, setEvomiCities] = useState<{ name: string; region?: string }[]>([]);
  const [loadingRegions, setLoadingRegions] = useState(false);

  // Local draft state for editable fields
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

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
    if (data) {
      setSettings(data);
      // Initialize draft from DB values (only if not dirty)
      setDraft(prev => {
        const dbMap = Object.fromEntries(data.map(s => [s.key, s.value]));
        // Keep user edits if dirty, otherwise use DB values
        if (Object.keys(prev).length === 0) return dbMap;
        return prev;
      });
    }
  };

  const loadCurrentIp = async () => {
    const { data } = await supabase
      .from("tracking_logs")
      .select("message, created_at")
      .eq("status", "ip_change")
      .order("created_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      const match = data[0].message?.match(/Aktif IP:\\s*([^\s|]+)/);
      if (match) {
        setCurrentIp(match[1]);
        setLastIpReset(data[0].created_at);
      }
    }
  };

  const getDraft = (key: string) => draft[key] ?? settings.find(s => s.key === key)?.value ?? "";

  const fetchEvomiRegions = async () => {
    setLoadingRegions(true);
    try {
      const { data, error } = await supabase.functions.invoke("evomi-regions", {
        body: { country: getDraft("proxy_country") || "TR" },
      });
      if (error) throw error;
      if (data?.ok) {
        setEvomiRegions(data.regions || []);
        setEvomiCities(data.cities || []);
        toast.success(`${(data.regions || []).length} bölge, ${(data.cities || []).length} şehir yüklendi`);
      } else {
        toast.error(data?.error || "Bölge listesi alınamadı");
      }
    } catch (err: any) {
      toast.error("Evomi API hatası: " + err.message);
    }
    setLoadingRegions(false);
  };

  const setDraftValue = (key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const saveAllSettings = async () => {
    setSavingSettings(true);
    const keys = [
      { key: "proxy_host", label: "Proxy Host" },
      { key: "proxy_port", label: "Proxy Port" },
      { key: "proxy_user", label: "Proxy Kullanıcı" },
      { key: "proxy_pass", label: "Proxy Şifre" },
      { key: "proxy_region", label: "Proxy Bölge" },
      { key: "proxy_country", label: "Proxy Ülke" },
      { key: "captcha_provider", label: "Captcha Provider" },
      { key: "capsolver_api_key", label: "Capsolver API Key" },
      { key: "captcha_api_key", label: "2Captcha API Key" },
      { key: "ip_rotation_interval", label: "IP Rotasyon Süresi (dk)" },
      { key: "evomi_api_key", label: "Evomi API Key" },
    ];

    for (const { key, label } of keys) {
      const value = draft[key];
      if (value === undefined) continue;
      const existing = settings.find(s => s.key === key);
      if (existing) {
        if (existing.value !== value) {
          await supabase.from("bot_settings").update({ value }).eq("key", key);
        }
      } else if (value) {
        await supabase.from("bot_settings").insert({ key, value, label });
      }
    }

    toast.success("Ayarlar kaydedildi");
    setDirty(false);
    setSavingSettings(false);
    loadSettings();
  };

  const updateProxyCountry = (code: string) => {
    setDraftValue("proxy_country", code);
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
          <Input className="h-8 text-xs font-mono bg-muted/50" value={currentIp || "—"} readOnly />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Reset Tarihi</Label>
          <Input
            className="h-8 text-xs font-mono bg-muted/50"
            value={lastIpReset ? new Date(lastIpReset).toLocaleString("tr-TR") : "—"}
            readOnly
          />
        </div>
      </div>

      {/* Captcha Solver */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Captcha Solver</Label>
          <Select
            value={getDraft("captcha_provider") || "capsolver"}
            onValueChange={v => setDraftValue("captcha_provider", v)}
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
          <Label className="text-[11px] text-muted-foreground">Capsolver API Key</Label>
          <div className="relative">
            <Input
              className="h-8 text-xs font-mono pr-8"
              type={showCaptchaKey ? "text" : "password"}
              value={getDraft("capsolver_api_key")}
              onChange={e => setDraftValue("capsolver_api_key", e.target.value)}
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

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">2Captcha API Key</Label>
          <div className="relative">
            <Input
              className="h-8 text-xs font-mono pr-8"
              type={showCaptchaKey ? "text" : "password"}
              value={getDraft("captcha_api_key")}
              onChange={e => setDraftValue("captcha_api_key", e.target.value)}
              placeholder="2captcha key..."
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

      {/* IP Rotation Interval */}
      <div className="space-y-2 border-t border-border pt-4">
        <Label className="text-[11px] text-muted-foreground">IP Otomatik Yenileme Süresi (dakika)</Label>
        <div className="flex items-center gap-3">
          <Input
            className="h-8 text-xs font-mono w-20"
            type="number"
            min={0}
            value={getDraft("ip_rotation_interval") || "0"}
            onChange={e => setDraftValue("ip_rotation_interval", e.target.value)}
            placeholder="0"
          />
          <span className="text-[10px] text-muted-foreground">
            {Number(getDraft("ip_rotation_interval") || 0) === 0
              ? "Devre dışı — sadece hata/engel durumunda değişir"
              : `Her ${getDraft("ip_rotation_interval")} dakikada IP otomatik yenilenir`}
          </span>
        </div>
      </div>

      {/* Proxy Settings */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Proxy IP (Host)</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={getDraft("proxy_host")}
            onChange={e => setDraftValue("proxy_host", e.target.value)}
            placeholder="core-residential.evomi-proxy.com"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Port</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={getDraft("proxy_port")}
            onChange={e => setDraftValue("proxy_port", e.target.value)}
            placeholder="1000"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Kullanıcı Adı</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={getDraft("proxy_user")}
            onChange={e => setDraftValue("proxy_user", e.target.value)}
            placeholder="kullanici_adi"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Şifre</Label>
          <div className="relative">
            <Input
              className="h-8 text-xs font-mono pr-8"
              type={showPass ? "text" : "password"}
              value={getDraft("proxy_pass")}
              onChange={e => setDraftValue("proxy_pass", e.target.value)}
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
          <div className="flex items-center justify-between">
            <Label className="text-[11px] text-muted-foreground">Proxy Bölge (Region)</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] gap-1 px-1.5"
              onClick={fetchEvomiRegions}
              disabled={loadingRegions}
            >
              {loadingRegions ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              API'den Çek
            </Button>
          </div>
          {evomiRegions.length > 0 ? (
            <Select
              value={getDraft("proxy_region") || "__none__"}
              onValueChange={v => setDraftValue("proxy_region", v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Bölge seçin..." />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                <SelectItem value="__none__">Yok (rastgele)</SelectItem>
                {evomiRegions.map((r, i) => {
                  const val = typeof r === "string" ? r : (r as any).name || (r as any).id || String(i);
                  const label = typeof r === "string" ? r : (r as any).name || JSON.stringify(r);
                  return <SelectItem key={val + i} value={val}>{label}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-8 text-xs font-mono"
              value={getDraft("proxy_region")}
              onChange={e => setDraftValue("proxy_region", e.target.value)}
              placeholder="ankara (API'den çekmek için butona tıklayın)"
            />
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Evomi API Key</Label>
          <div className="relative">
            <Input
              className="h-8 text-xs font-mono pr-8"
              type={showPass ? "text" : "password"}
              value={getDraft("evomi_api_key")}
              onChange={e => setDraftValue("evomi_api_key", e.target.value)}
              placeholder="Evomi dashboard'dan alın"
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
              onClick={() => updateProxyCountry(pc.code)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                getDraft("proxy_country") === pc.code
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary text-foreground hover:bg-secondary/80"
              }`}
            >
              {pc.label}
            </button>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <Button
        onClick={saveAllSettings}
        disabled={!dirty || savingSettings}
        className="w-full gap-2"
        size="sm"
      >
        {savingSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {savingSettings ? "Kaydediliyor..." : "Ayarları Kaydet"}
      </Button>

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
            <div key={c.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-secondary/50">
              <div className="flex items-center gap-2">
                <span className="text-sm">{c.flag}</span>
                <span className="text-xs font-medium">{c.label}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">{c.code}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={c.is_active} onCheckedChange={v => toggleCountry(c.id, v)} className="scale-75" />
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
                <Input className="h-7 text-xs" value={newCountry.value} onChange={e => setNewCountry(p => ({ ...p, value: e.target.value }))} placeholder="germany" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">İsim (ör: Almanya)</Label>
                <Input className="h-7 text-xs" value={newCountry.label} onChange={e => setNewCountry(p => ({ ...p, label: e.target.value }))} placeholder="Almanya" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">VFS Kodu (ör: deu)</Label>
                <Input className="h-7 text-xs font-mono" value={newCountry.code} onChange={e => setNewCountry(p => ({ ...p, code: e.target.value }))} placeholder="deu" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Bayrak Emoji</Label>
                <Input className="h-7 text-xs" value={newCountry.flag} onChange={e => setNewCountry(p => ({ ...p, flag: e.target.value }))} placeholder="🇩🇪" />
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
