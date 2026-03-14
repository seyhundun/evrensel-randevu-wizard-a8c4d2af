import { useEffect, useState } from "react";
import { CITIES, VISA_CATEGORIES, VISA_SUBCATEGORIES } from "@/lib/constants";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Shield, Clock, Users, MapPin, Globe } from "lucide-react";
import type { TrackingStatus } from "@/lib/constants";

interface DynCountry {
  value: string;
  label: string;
  flag: string;
  code: string;
}

interface ControlPanelProps {
  country: string;
  setCountry: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  visaCategory: string;
  setVisaCategory: (v: string) => void;
  visaSubcategory: string;
  setVisaSubcategory: (v: string) => void;
  personCount: number;
  setPersonCount: (v: number) => void;
  interval: number;
  setIntervalValue: (v: number) => void;
  keepAlive: boolean;
  setKeepAlive: (v: boolean) => void;
  status: TrackingStatus;
  onStart: () => void;
  onStop: () => void;
}

export default function ControlPanel({
  country,
  setCountry,
  city,
  setCity,
  visaCategory,
  setVisaCategory,
  visaSubcategory,
  setVisaSubcategory,
  personCount,
  setPersonCount,
  interval,
  setIntervalValue,
  keepAlive,
  setKeepAlive,
  status,
}: ControlPanelProps) {
  const isActive = status === "searching";

  const [dynCountries, setDynCountries] = useState<DynCountry[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("vfs_countries")
        .select("value, label, flag, code")
        .eq("is_active", true)
        .order("sort_order");
      if (data) setDynCountries(data);
    };
    load();
    const ch = supabase
      .channel("countries-ctrl")
      .on("postgres_changes", { event: "*", schema: "public", table: "vfs_countries" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          Randevu Ayarları
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">VFS Global hedef yapılandırma</p>
      </div>

      {/* Country */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <MapPin className="w-3 h-3 text-muted-foreground" />
          Hedef Ülke
        </Label>
        <Select value={country} onValueChange={setCountry} disabled={isActive}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Ülke seçin" />
          </SelectTrigger>
          <SelectContent>
            {dynCountries.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                <span className="flex items-center gap-2">
                  <span>{c.flag}</span>
                  <span>{c.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* City */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <MapPin className="w-3 h-3 text-muted-foreground" />
          Vize Merkezi
        </Label>
        <Select value={city} onValueChange={setCity} disabled={isActive}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Şehir seçin" />
          </SelectTrigger>
          <SelectContent>
            {CITIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Visa Category */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">Vize Kategorisi</Label>
        <Select value={visaCategory} onValueChange={(v) => { setVisaCategory(v); setVisaSubcategory(""); }} disabled={isActive}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Kategori seçin" />
          </SelectTrigger>
          <SelectContent>
            {VISA_CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Visa Subcategory */}
      {visaCategory && VISA_SUBCATEGORIES[visaCategory] && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">Alt Kategori</Label>
          <Select value={visaSubcategory} onValueChange={setVisaSubcategory} disabled={isActive}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Alt kategori seçin" />
            </SelectTrigger>
            <SelectContent>
              {VISA_SUBCATEGORIES[visaCategory].map((sub) => (
                <SelectItem key={sub} value={sub}>
                  {sub}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Person Count */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Users className="w-3 h-3 text-muted-foreground" />
          Kişi Sayısı
        </Label>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => !isActive && setPersonCount(n)}
              disabled={isActive}
              className={`w-8 h-8 rounded-md text-xs font-medium transition-all ${
                personCount === n
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary text-foreground hover:bg-secondary/80"
              } disabled:opacity-50`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Interval */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-muted-foreground" />
          Kontrol Aralığı
          <span className="ml-auto tabular-nums text-primary font-semibold text-xs">
            {interval}s
          </span>
        </Label>
        <Slider
          value={[interval]}
          onValueChange={([v]) => setIntervalValue(v)}
          min={60}
          max={300}
          step={10}
          disabled={isActive}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>60s</span>
          <span>300s</span>
        </div>
      </div>

      {/* Keep Alive */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Shield className="w-3 h-3 text-muted-foreground" />
          Oturumu Canlı Tut
        </Label>
        <Switch checked={keepAlive} onCheckedChange={setKeepAlive} />
      </div>
    </Card>
  );
}
