import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import {
  Network, Globe, Wifi, MapPin, Activity, Shield, Loader2,
  Clock, RefreshCw, Save
} from "lucide-react";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}sn önce`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}sa önce`;
  return `${Math.floor(hr / 24)}g önce`;
}

async function upsertSetting(key: string, value: string, label?: string) {
  const { data: existing } = await supabase.from("bot_settings").select("id").eq("key", key).limit(1);
  if (existing && existing.length > 0) {
    await supabase.from("bot_settings").update({ value }).eq("key", key);
  } else {
    await supabase.from("bot_settings").insert({ key, value, label: label || key });
  }
}

export default function QuizSidebarContent() {
  const [proxyHost, setProxyHost] = useState("—");
  const [proxyPort, setProxyPort] = useState("1000");
  const [proxyCountry, setProxyCountry] = useState("US");
  const [proxyRegion, setProxyRegion] = useState("");
  const [quizProxyEnabled, setQuizProxyEnabled] = useState(true);
  const [captchaProvider, setCaptchaProvider] = useState("—");
  const [captchaApiKey, setCaptchaApiKey] = useState(false);
  const [browserUseApiKey, setBrowserUseApiKey] = useState(false);
  const [quizStatus, setQuizStatus] = useState<"idle" | "running">("idle");
  const [lastLog, setLastLog] = useState<{ message: string; time: string; status: string } | null>(null);
  const [stats, setStats] = useState({ total: 0, success: 0, error: 0, successRate: 100 });

  // Evomi API data
  const [evomiCountries, setEvomiCountries] = useState<{ code: string; name: string }[]>([]);
  const [evomiCities, setEvomiCities] = useState<{ name: string; region?: string }[]>([]);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [countryPopoverOpen, setCountryPopoverOpen] = useState(false);
  const [regionPopoverOpen, setRegionPopoverOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from("bot_settings").select("key, value");
    if (data) {
      const map = Object.fromEntries(data.map(d => [d.key, d.value]));
      setProxyHost(map.proxy_host || "core-residential.evomi-proxy.com");
      setProxyPort(map.proxy_port || "1000");
      setProxyCountry(map.quiz_proxy_country || map.proxy_country || "US");
      setProxyRegion(map.quiz_proxy_region || "");
      setQuizProxyEnabled(map.quiz_proxy_enabled !== "false");
      setCaptchaProvider(map.captcha_provider || "2captcha");
      setCaptchaApiKey(!!(map.captcha_api_key));
    }
  }, []);

  const loadLogs = useCallback(async () => {
    const { data: logs } = await supabase
      .from("quiz_tracking_logs")
      .select("message, created_at, status")
      .order("created_at", { ascending: false })
      .limit(1);
    if (logs && logs.length > 0) {
      setLastLog({ message: logs[0].message || "", time: logs[0].created_at, status: logs[0].status });
    }

    const { data: recentLogs } = await supabase
      .from("quiz_tracking_logs")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(50);
    const total = recentLogs?.length || 0;
    const errors = recentLogs?.filter(l => l.status === "error").length || 0;
    const successes = recentLogs?.filter(l => l.status === "success").length || 0;
    const rate = total > 0 ? Math.round(((total - errors) / total) * 100) : 100;
    setStats({ total, success: successes, error: errors, successRate: rate });

    const { data: running } = await supabase
      .from("link_analyses")
      .select("id")
      .eq("status", "quiz_running")
      .limit(1);
    setQuizStatus(running && running.length > 0 ? "running" : "idle");
  }, []);

  useEffect(() => {
    loadSettings();
    loadLogs();
    const ch = supabase
      .channel("quiz-sidebar-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_settings" }, () => loadSettings())
      .on("postgres_changes", { event: "*", schema: "public", table: "quiz_tracking_logs" }, () => loadLogs())
      .on("postgres_changes", { event: "*", schema: "public", table: "link_analyses" }, () => loadLogs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadSettings, loadLogs]);

  const fetchEvomiRegions = async (country?: string) => {
    setLoadingRegions(true);
    try {
      const { data, error } = await supabase.functions.invoke("evomi-regions", {
        body: { country: country || proxyCountry || "US" },
      });
      if (error) throw error;
      if (data?.ok) {
        setEvomiCities(
          (data.cities || []).map((c: any) => typeof c === "string" ? { name: c } : { name: c.name || c.city, region: c.region })
        );
        // Countries
        const countriesObj = data.countries || {};
        const countryList = Object.entries(countriesObj).map(([code, name]) => ({
          code: code.toUpperCase(),
          name: String(name),
        }));
        countryList.sort((a, b) => a.name.localeCompare(b.name));
        if (countryList.length > 0) setEvomiCountries(countryList);
      }
    } catch (err: any) {
      toast.error("Evomi API hatası: " + err.message);
    }
    setLoadingRegions(false);
  };

  // Fetch regions on first open or country change
  useEffect(() => {
    if (quizProxyEnabled && proxyCountry && proxyCountry !== "—") {
      fetchEvomiRegions(proxyCountry);
    }
  }, [proxyCountry, quizProxyEnabled]);

  const toggleQuizProxy = async () => {
    const newVal = !quizProxyEnabled;
    setQuizProxyEnabled(newVal);
    await upsertSetting("quiz_proxy_enabled", newVal ? "true" : "false", "Quiz Proxy Aktif");
    toast.success(newVal ? "Quiz proxy aktif" : "Quiz proxy kapalı");
  };

  const handleCountryChange = (code: string) => {
    setProxyCountry(code);
    setProxyRegion(""); // Reset region on country change
    setDirty(true);
    setCountryPopoverOpen(false);
  };

  const handleRegionChange = (city: string) => {
    setProxyRegion(city);
    setDirty(true);
    setRegionPopoverOpen(false);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await upsertSetting("quiz_proxy_country", proxyCountry, "Quiz Proxy Ülke");
      await upsertSetting("quiz_proxy_region", proxyRegion, "Quiz Proxy Bölge");
      setDirty(false);
      toast.success("Quiz proxy ayarları kaydedildi");
    } catch (err: any) {
      toast.error("Kaydetme hatası: " + err.message);
    }
    setSaving(false);
  };

  const healthColor = stats.successRate >= 80 ? "text-emerald-500" : stats.successRate >= 50 ? "text-amber-500" : "text-destructive";

  const selectedCountryName = evomiCountries.find(c => c.code === proxyCountry)?.name || proxyCountry;

  return (
    <div className="p-3 space-y-3">
      {/* Bot Status */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${quizStatus === "running" ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
            <h3 className="text-xs font-semibold text-foreground">Quiz Bot Durumu</h3>
          </div>
          <Badge className={`text-[10px] ${quizStatus === "running" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-secondary text-muted-foreground"}`}>
            {quizStatus === "running" ? "Çalışıyor" : "Bekliyor"}
          </Badge>
        </div>

        {lastLog && (
          <div className="rounded-md border bg-card p-2 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Son Aktivite
              </span>
              <span className="text-[10px] text-foreground/70 tabular-nums">
                {timeAgo(lastLog.time)}
              </span>
            </div>
            <p className="text-[10px] text-foreground/80 truncate">
              {lastLog.message?.replace("[QUIZ] ", "").slice(0, 80)}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Activity className="w-3 h-3" />
              Başarı Oranı (son 50)
            </span>
            <span className={`text-xs font-bold tabular-nums ${healthColor}`}>
              %{stats.successRate}
            </span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                stats.successRate >= 80 ? "bg-emerald-500" :
                stats.successRate >= 50 ? "bg-amber-500" : "bg-destructive"
              }`}
              style={{ width: `${stats.successRate}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{stats.success} başarılı</span>
            <span>{stats.error} hata</span>
          </div>
        </div>
      </Card>

      {/* Proxy Settings */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5 text-muted-foreground" />
            Proxy Ayarları
          </h3>
          <Switch checked={quizProxyEnabled} onCheckedChange={toggleQuizProxy} />
        </div>

        {quizProxyEnabled && (
          <>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />
                Proxy Türü
              </Label>
              <div className="flex h-7 items-center justify-between rounded-md border bg-secondary/40 px-2.5 text-[11px]">
                <span className="font-medium text-foreground">🏠 Core Residential</span>
                <span className="font-mono text-muted-foreground">Port {proxyPort}</span>
              </div>
            </div>

            {/* Host info */}
            <div className="rounded-md border bg-card p-2 space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Wifi className="w-3 h-3" />
                <span className="text-[10px]">Host</span>
              </div>
              <p className="text-[10px] font-mono font-semibold text-foreground truncate">
                {proxyHost}
              </p>
            </div>

            {/* Country Picker (Evomi API) */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />
                Proxy Ülke
              </Label>
              <Popover open={countryPopoverOpen} onOpenChange={setCountryPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between h-8 text-xs"
                    onClick={() => {
                      if (evomiCountries.length === 0) fetchEvomiRegions(proxyCountry);
                      setCountryPopoverOpen(!countryPopoverOpen);
                    }}
                  >
                    <span className="truncate">{selectedCountryName} ({proxyCountry})</span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Ülke ara..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>
                        {loadingRegions ? (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground py-2">
                            <Loader2 className="w-3 h-3 animate-spin" /> Yükleniyor...
                          </span>
                        ) : "Ülke bulunamadı"}
                      </CommandEmpty>
                      <CommandGroup>
                        {evomiCountries.map((c) => (
                          <CommandItem
                            key={c.code}
                            value={c.name + " " + c.code}
                            onSelect={() => handleCountryChange(c.code)}
                            className="text-xs"
                          >
                            <Check className={`mr-1.5 h-3 w-3 ${proxyCountry === c.code ? "opacity-100" : "opacity-0"}`} />
                            {c.name} <span className="ml-auto text-muted-foreground font-mono text-[10px]">{c.code}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Region / City Picker (Evomi API) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  Proxy Bölge (Şehir)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => fetchEvomiRegions(proxyCountry)}
                  disabled={loadingRegions}
                >
                  {loadingRegions ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                </Button>
              </div>
              <Popover open={regionPopoverOpen} onOpenChange={setRegionPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between h-8 text-xs"
                  >
                    <span className="truncate capitalize">{proxyRegion || "Tüm bölgeler (rastgele)"}</span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Şehir ara..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>
                        {loadingRegions ? (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground py-2">
                            <Loader2 className="w-3 h-3 animate-spin" /> Yükleniyor...
                          </span>
                        ) : "Şehir bulunamadı"}
                      </CommandEmpty>
                      <CommandGroup>
                        {/* "All regions" option */}
                        <CommandItem
                          value="__all__"
                          onSelect={() => handleRegionChange("")}
                          className="text-xs"
                        >
                          <Check className={`mr-1.5 h-3 w-3 ${!proxyRegion ? "opacity-100" : "opacity-0"}`} />
                          Tüm bölgeler (rastgele)
                        </CommandItem>
                        {evomiCities.map((c, i) => (
                          <CommandItem
                            key={c.name + i}
                            value={c.name}
                            onSelect={() => handleRegionChange(c.name.toLowerCase())}
                            className="text-xs"
                          >
                            <Check className={`mr-1.5 h-3 w-3 ${proxyRegion === c.name.toLowerCase() ? "opacity-100" : "opacity-0"}`} />
                            <span className="capitalize">{c.name}</span>
                            {c.region && <span className="ml-auto text-muted-foreground text-[10px]">{c.region}</span>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Save Button */}
            {dirty && (
              <Button
                onClick={saveSettings}
                disabled={saving}
                size="sm"
                className="w-full h-7 text-xs gap-1.5"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {saving ? "Kaydediliyor..." : "Ayarları Kaydet"}
              </Button>
            )}
          </>
        )}
      </Card>

      {/* CAPTCHA Settings */}
      <Card className="p-3 space-y-2">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          CAPTCHA Ayarları
        </h3>
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1">
            <span className="text-muted-foreground">Sağlayıcı</span>
            <span className="font-medium text-foreground">{captchaProvider}</span>
          </div>
          <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1">
            <span className="text-muted-foreground">API Key</span>
            <span className={`font-medium ${captchaApiKey ? "text-emerald-600" : "text-destructive"}`}>
              {captchaApiKey ? "✓ Tanımlı" : "✗ Eksik"}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
