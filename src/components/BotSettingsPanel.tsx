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
  const [evomiRegions, setEvomiRegions] = useState<{ id: string; name: string }[]>([]);
  const [evomiCities, setEvomiCities] = useState<{ name: string; region?: string }[]>([]);
  const [evomiCountries, setEvomiCountries] = useState<{ code: string; name: string }[]>([]);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [regionPopoverOpen, setRegionPopoverOpen] = useState(false);
  const [countryPopoverOpen, setCountryPopoverOpen] = useState(false);
  const [idataRegionPopoverOpen, setIdataRegionPopoverOpen] = useState(false);
  const [idataCountryPopoverOpen, setIdataCountryPopoverOpen] = useState(false);

  // Local draft state for editable fields
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadData();
    const ch = supabase
      .channel("bot-settings-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "vfs_countries" }, () => loadCountries())
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_settings" }, () => loadSettings())
      
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const loadData = () => { loadCountries(); loadSettings(); };

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
        dbMap.proxy_port = "1000";
        dbMap.proxy_type = "core";
        // Keep user edits if dirty, otherwise use DB values
        if (Object.keys(prev).length === 0) return dbMap;
        return prev;
      });
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
        setEvomiRegions((data.regions || []).map((r: any) => typeof r === "string" ? { id: r, name: r } : { id: r.id || r.name, name: r.name || r.id }));
        setEvomiCities(data.cities || []);
        // Parse countries object { "TR": "Turkey", "DE": "Germany", ... }
        const countriesObj = data.countries || {};
        const countriesList = Object.entries(countriesObj).map(([code, name]) => ({ code, name: String(name) })).sort((a, b) => a.name.localeCompare(b.name));
        setEvomiCountries(countriesList);
        toast.success(`${(data.regions || []).length} bölge, ${countriesList.length} ülke yüklendi`);
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
      { key: "proxy_enabled", label: "Proxy Aktif" },
      { key: "proxy_host", label: "Proxy Host" },
      { key: "proxy_port", label: "Proxy Port" },
      { key: "proxy_user", label: "Proxy Kullanıcı" },
      { key: "proxy_pass", label: "Proxy Şifre" },
      { key: "proxy_region", label: "VFS Proxy Bölge" },
      { key: "proxy_country", label: "VFS Proxy Ülke" },
      { key: "idata_proxy_country", label: "iDATA Proxy Ülke" },
      { key: "idata_proxy_region", label: "iDATA Proxy Bölge" },
      { key: "captcha_provider", label: "Captcha Provider" },
      { key: "capsolver_api_key", label: "Capsolver API Key" },
      { key: "captcha_api_key", label: "2Captcha API Key" },
      { key: "ip_rotation_interval", label: "IP Rotasyon Süresi (dk)" },
      { key: "evomi_api_key", label: "Evomi API Key" },
      { key: "twilio_from_number", label: "Twilio Gönderen Numara" },
      { key: "twilio_to_numbers", label: "SMS Alıcı Numaralar" },
    ];

    for (const { key, label } of keys) {
      const value = draft[key];
      if (value === undefined) continue;
      const normalizedValue = key === "proxy_port"
        ? "1000"
        : key === "proxy_type"
          ? "core"
          : value;
      const existing = settings.find(s => s.key === key);
      if (existing) {
        if (existing.value !== normalizedValue) {
          await supabase.from("bot_settings").update({ value: normalizedValue }).eq("key", key);
        }
      } else if (normalizedValue) {
        await supabase.from("bot_settings").insert({ key, value: normalizedValue, label });
      }
    }

    toast.success("Ayarlar kaydedildi");
    setDirty(false);
    setSavingSettings(false);
    loadSettings();
  };

  const updateProxyCountry = (code: string) => {
    setDraftValue("proxy_country", code);
    // Ülke değiştiğinde bölgeyi sıfırla (eski ülkenin bölgesi kalmasın)
    setDraftValue("proxy_region", "");
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

  const defaultProxyCountries = [
    { code: "TR", name: "Türkiye" },
    { code: "PL", name: "Polonya" },
    { code: "DE", name: "Almanya" },
    { code: "NL", name: "Hollanda" },
    { code: "FR", name: "Fransa" },
    { code: "GB", name: "İngiltere" },
    { code: "US", name: "ABD" },
  ];
  const activeProxyCountries = evomiCountries.length > 0 ? evomiCountries : defaultProxyCountries;

  return (
    <Card className="p-4 space-y-5">
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Panel ve Hesap Bot Proxy Ayarları</h3>
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

      {/* Proxy Toggle */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs font-medium">Proxy Kullan</Label>
            <p className="text-[10px] text-muted-foreground">
              {getDraft("proxy_enabled") === "false" 
                ? "Kapalı — sunucu kendi IP'si ile çıkıyor" 
                : "Açık — Evomi residential proxy üzerinden çıkıyor"}
            </p>
          </div>
          <Switch
            checked={getDraft("proxy_enabled") !== "false"}
            onCheckedChange={(checked) => setDraftValue("proxy_enabled", checked ? "true" : "false")}
          />
        </div>
      </div>

      {/* Proxy Settings */}
      <div className={`space-y-3 border-t border-border pt-4 ${getDraft("proxy_enabled") === "false" ? "opacity-40 pointer-events-none" : ""}`}>
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
            value="1000"
            readOnly
            disabled
            placeholder="1000"
          />
          <p className="text-[10px] text-muted-foreground">VFS için port sabit: 1000</p>
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

        {/* VFS Proxy Region */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] text-muted-foreground">VFS Proxy Bölge (Region)</Label>
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
            <Popover open={regionPopoverOpen} onOpenChange={setRegionPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="h-8 text-xs justify-between w-full font-mono">
                  {getDraft("proxy_region") || "Yok (rastgele)"}
                  <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Bölge ara..." className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty>Sonuç bulunamadı</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__none__" onSelect={() => { setDraftValue("proxy_region", ""); setRegionPopoverOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${!getDraft("proxy_region") ? "opacity-100" : "opacity-0"}`} />
                        Yok (rastgele)
                      </CommandItem>
                      {evomiRegions.map((r) => (
                          <CommandItem key={r.id} value={`${r.id} ${r.name}`} onSelect={() => { setDraftValue("proxy_region", r.id); setRegionPopoverOpen(false); }}>
                            <Check className={`mr-2 h-3 w-3 ${getDraft("proxy_region") === r.id ? "opacity-100" : "opacity-0"}`} />
                            {r.name}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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

      {/* VFS Proxy Country */}
      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <Globe className="w-3 h-3 text-blue-400" />
            VFS Proxy Ülkesi
          </Label>
          {evomiCountries.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{evomiCountries.length} ülke (API)</span>
          )}
        </div>
        {evomiCountries.length > 0 ? (
          <Popover open={countryPopoverOpen} onOpenChange={setCountryPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="h-8 text-xs justify-between w-full font-mono">
                {getDraft("proxy_country") ? `${getDraft("proxy_country")} — ${evomiCountries.find(c => c.code === getDraft("proxy_country"))?.name || getDraft("proxy_country")}` : "Ülke seçin..."}
                <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Ülke ara..." className="h-8 text-xs" />
                <CommandList>
                  <CommandEmpty>Sonuç bulunamadı</CommandEmpty>
                  <CommandGroup>
                    {activeProxyCountries.map(pc => (
                      <CommandItem key={pc.code} value={`${pc.code} ${pc.name}`} onSelect={() => { updateProxyCountry(pc.code); setCountryPopoverOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${getDraft("proxy_country") === pc.code ? "opacity-100" : "opacity-0"}`} />
                        {pc.code} — {pc.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {defaultProxyCountries.map(pc => (
              <button
                key={pc.code}
                onClick={() => updateProxyCountry(pc.code)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  getDraft("proxy_country") === pc.code
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-secondary text-foreground hover:bg-secondary/80"
                }`}
              >
                {pc.code} — {pc.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* iDATA Proxy Country */}
      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <Globe className="w-3 h-3 text-green-400" />
            iDATA Proxy Ülkesi
          </Label>
          {evomiCountries.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{evomiCountries.length} ülke (API)</span>
          )}
        </div>
        {evomiCountries.length > 0 ? (
          <Popover open={idataCountryPopoverOpen} onOpenChange={setIdataCountryPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="h-8 text-xs justify-between w-full font-mono">
                {getDraft("idata_proxy_country") ? `${getDraft("idata_proxy_country")} — ${evomiCountries.find(c => c.code === getDraft("idata_proxy_country"))?.name || getDraft("idata_proxy_country")}` : "Ülke seçin..."}
                <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Ülke ara..." className="h-8 text-xs" />
                <CommandList>
                  <CommandEmpty>Sonuç bulunamadı</CommandEmpty>
                  <CommandGroup>
                    {activeProxyCountries.map(pc => (
                      <CommandItem key={pc.code} value={`${pc.code} ${pc.name}`} onSelect={() => { setDraftValue("idata_proxy_country", pc.code); setDraftValue("idata_proxy_region", ""); setIdataCountryPopoverOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${getDraft("idata_proxy_country") === pc.code ? "opacity-100" : "opacity-0"}`} />
                        {pc.code} — {pc.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {defaultProxyCountries.map(pc => (
              <button
                key={pc.code}
                onClick={() => { setDraftValue("idata_proxy_country", pc.code); setDraftValue("idata_proxy_region", ""); }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  getDraft("idata_proxy_country") === pc.code
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-secondary text-foreground hover:bg-secondary/80"
                }`}
              >
                {pc.code} — {pc.name}
              </button>
            ))}
          </div>
        )}
        {/* iDATA Region */}
        <div className="space-y-1 mt-2">
          <Label className="text-[11px] text-muted-foreground">iDATA Proxy Bölge (Region)</Label>
          {evomiRegions.length > 0 ? (
            <Popover open={idataRegionPopoverOpen} onOpenChange={setIdataRegionPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="h-8 text-xs justify-between w-full font-mono">
                  {getDraft("idata_proxy_region") || "Yok (rastgele)"}
                  <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Bölge ara..." className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty>Sonuç bulunamadı</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__none__idata" onSelect={() => { setDraftValue("idata_proxy_region", ""); setIdataRegionPopoverOpen(false); }}>
                        <Check className={`mr-2 h-3 w-3 ${!getDraft("idata_proxy_region") ? "opacity-100" : "opacity-0"}`} />
                        Yok (rastgele)
                      </CommandItem>
                      {evomiRegions.map((r) => (
                          <CommandItem key={`idata-${r.id}`} value={`idata-${r.id} ${r.name}`} onSelect={() => { setDraftValue("idata_proxy_region", r.id); setIdataRegionPopoverOpen(false); }}>
                            <Check className={`mr-2 h-3 w-3 ${getDraft("idata_proxy_region") === r.id ? "opacity-100" : "opacity-0"}`} />
                            {r.name}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          ) : (
            <Input
              className="h-8 text-xs font-mono"
              value={getDraft("idata_proxy_region")}
              onChange={e => setDraftValue("idata_proxy_region", e.target.value)}
              placeholder="ankara (API'den çekmek için butona tıklayın)"
            />
          )}
        </div>
      </div>

      {/* Mutlucell SMS Bildirimleri */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <span className="text-sm">📱</span>
          <Label className="text-xs font-medium">SMS Bildirimleri (Mutlucell)</Label>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Randevu bulununca size SMS gelir. Gönderen: HotsBOX. Birden fazla numara virgülle ayırın.
        </p>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Alıcı Numaralar</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={getDraft("twilio_to_numbers")}
            onChange={e => setDraftValue("twilio_to_numbers", e.target.value)}
            placeholder="+905xxxxxxxxx, +905xxxxxxxxx"
          />
          <p className="text-[9px] text-muted-foreground">
            Birden fazla numara virgülle ayırın. Ör: +905551234567, +905559876543
          </p>
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
