import { COUNTRIES, CITIES, VISA_CATEGORIES } from "@/lib/constants";
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
import { Button } from "@/components/ui/button";
import { Play, Square, Shield, Clock, Users, MapPin, Globe } from "lucide-react";
import type { TrackingStatus } from "@/lib/constants";

interface ControlPanelProps {
  country: string;
  setCountry: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  visaCategory: string;
  setVisaCategory: (v: string) => void;
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
  personCount,
  setPersonCount,
  interval,
  setIntervalValue,
  keepAlive,
  setKeepAlive,
  status,
  onStart,
  onStop,
}: ControlPanelProps) {
  const isActive = status === "searching";

  return (
    <aside className="bg-secondary p-4 md:p-5 flex flex-col gap-5 md:min-h-screen md:max-h-screen md:overflow-y-auto border-r border-border/50">
      <div>
        <h1 className="section-title text-foreground flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          Vize Randevu Asistanı
        </h1>
        <p className="helper-text mt-1">VFS Global Otomasyon Paneli</p>
      </div>

      {/* Country */}
      <div className="flex flex-col gap-2">
        <Label className="body-text font-medium flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
          Hedef Ülke
        </Label>
        <Select value={country} onValueChange={setCountry} disabled={isActive}>
          <SelectTrigger className="bg-card shadow-card">
            <SelectValue placeholder="Ülke seçin" />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
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
      <div className="flex flex-col gap-2">
        <Label className="body-text font-medium flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
          Vize Merkezi
        </Label>
        <Select value={city} onValueChange={setCity} disabled={isActive}>
          <SelectTrigger className="bg-card shadow-card">
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
      <div className="flex flex-col gap-2">
        <Label className="body-text font-medium">Vize Kategorisi</Label>
        <Select value={visaCategory} onValueChange={setVisaCategory} disabled={isActive}>
          <SelectTrigger className="bg-card shadow-card">
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

      {/* Person Count */}
      <div className="flex flex-col gap-2">
        <Label className="body-text font-medium flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-muted-foreground" />
          Kişi Sayısı
        </Label>
        <div className="flex items-center gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => !isActive && setPersonCount(n)}
              disabled={isActive}
              className={`w-9 h-9 rounded-lg text-sm font-medium transition-all duration-150 ${
                personCount === n
                  ? "bg-primary text-primary-foreground shadow-card"
                  : "bg-card text-foreground shadow-card hover:shadow-card-hover"
              } disabled:opacity-50`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Interval */}
      <div className="flex flex-col gap-3">
        <Label className="body-text font-medium flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          Kontrol Aralığı
          <span className="ml-auto tabular-nums text-primary font-semibold">
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
        <div className="flex justify-between helper-text">
          <span>60s</span>
          <span>300s</span>
        </div>
      </div>

      {/* Keep Alive */}
      <div className="flex items-center justify-between gap-2 py-2">
        <Label className="body-text font-medium flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          Oturumu Canlı Tut
        </Label>
        <Switch checked={keepAlive} onCheckedChange={setKeepAlive} />
      </div>

      {/* Start/Stop */}
      <div className="mt-auto">
        {isActive ? (
          <Button
            onClick={onStop}
            variant="destructive"
            className="w-full gap-2 transition-all duration-150 active:scale-[0.98]"
            size="lg"
          >
            <Square className="w-4 h-4" />
            Takibi Durdur
          </Button>
        ) : (
          <Button
            onClick={onStart}
            className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-150 active:scale-[0.98]"
            size="lg"
            disabled={!country || !city}
          >
            <Play className="w-4 h-4" />
            Takibi Başlat
          </Button>
        )}
      </div>
    </aside>
  );
}
