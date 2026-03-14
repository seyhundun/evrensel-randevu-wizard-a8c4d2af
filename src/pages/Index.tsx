import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { LogOut, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ControlPanel from "@/components/ControlPanel";
import ModuleStatus from "@/components/ModuleStatus";
import BotActions from "@/components/BotActions";
import ProxySettings from "@/components/ProxySettings";
import StatusPanel from "@/components/StatusPanel";
import ApplicantList from "@/components/ApplicantList";
import TrackingLogs from "@/components/TrackingLogs";
import VfsAccounts from "@/components/VfsAccounts";
import IdataControlPanel from "@/components/IdataControlPanel";
import IdataAccounts from "@/components/IdataAccounts";
import IdataTrackingLogs from "@/components/IdataTrackingLogs";
import BotSettingsPanel from "@/components/BotSettingsPanel";
import { useTracking } from "@/hooks/useTracking";

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useState(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  });
  return (
    <span className="font-mono text-sm tabular-nums text-muted-foreground flex items-center gap-1.5">
      <Clock className="w-3.5 h-3.5" />
      {time.toLocaleTimeString("tr-TR")}
    </span>
  );
}

const Index = () => {
  const t = useTracking();
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight">🛂 Randevu Takip Sistemi</h1>
          <LiveClock />
        </div>
        <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 text-muted-foreground text-xs">
          <LogOut className="w-3.5 h-3.5" />
          Hesaptan Çıkış Yap
        </Button>
      </header>

      <Tabs defaultValue="vfs" className="w-full">
        <div className="border-b border-border bg-card px-4">
          <TabsList className="h-10 bg-transparent p-0 gap-4">
            <TabsTrigger value="vfs" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-2 text-sm">
              🌍 VFS Global
            </TabsTrigger>
            <TabsTrigger value="idata" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-2 text-sm">
              🇮🇹 iDATA İtalya
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ========== VFS TAB ========== */}
        <TabsContent value="vfs" className="mt-0">
          <div className="p-4 md:p-6 space-y-5 max-w-[1600px] mx-auto">
            
            {/* Row 1: Dashboard Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Left: Proxy & Bot Settings */}
              <ProxySettings configId={t.configId} />

              {/* Center: Module Status */}
              <ModuleStatus
                status={t.status}
                configId={t.configId}
                onStart={t.startTracking}
                onStop={t.stopTracking}
                canStart={!!t.country && !!t.city}
              />

              {/* Right: Bot Actions */}
              <BotActions
                status={t.status}
                configId={t.configId}
                onStart={t.startTracking}
                onStop={t.stopTracking}
                onSimulateFound={t.simulateFound}
                canStart={!!t.country && !!t.city}
              />
            </div>

            {/* Row 2: Control Panel + Status */}
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
              {/* Left: Tracking Config */}
              <div className="space-y-4">
                <ControlPanel
                  country={t.country}
                  setCountry={t.setCountry}
                  city={t.city}
                  setCity={t.setCity}
                  visaCategory={t.visaCategory}
                  setVisaCategory={t.setVisaCategory}
                  personCount={t.personCount}
                  setPersonCount={t.setPersonCount}
                  interval={t.interval}
                  setIntervalValue={t.setIntervalValue}
                  keepAlive={t.keepAlive}
                  setKeepAlive={t.setKeepAlive}
                  status={t.status}
                  onStart={t.startTracking}
                  onStop={t.stopTracking}
                />
              </div>

              {/* Right: Main content */}
              <div className="space-y-5">
                <StatusPanel
                  status={t.status}
                  country={t.country}
                  city={t.city}
                  elapsedSeconds={t.elapsedSeconds}
                  checksCount={t.checksCount}
                  onSimulateFound={t.simulateFound}
                  configId={t.configId}
                />
                <ApplicantList
                  applicants={t.applicants}
                  onUpdate={t.updateApplicant}
                  personCount={t.personCount}
                  setPersonCount={t.setPersonCount}
                />
                <VfsAccounts />
                <BotSettingsPanel />
                <TrackingLogs configId={t.configId} />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ========== iDATA TAB ========== */}
        <TabsContent value="idata" className="mt-0">
          <main className="p-4 md:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
            <IdataControlPanel />
            <IdataAccounts />
            <IdataTrackingLogs />
          </main>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Index;
