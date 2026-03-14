import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { LogOut, Clock, PanelLeftClose, PanelLeft, Network, Globe, Settings, BookOpen, Monitor } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import VncViewer from "@/components/VncViewer";
import { useTracking } from "@/hooks/useTracking";
import { ScrollArea } from "@/components/ui/scroll-area";

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <span className="font-mono text-sm tabular-nums text-muted-foreground flex items-center gap-1.5">
      <Clock className="w-3.5 h-3.5" />
      {time.toLocaleTimeString("tr-TR")}
    </span>
  );
}

function SidebarSection({ icon, title, defaultOpen = false, children }: { icon: React.ReactNode; title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-2 rounded-md hover:bg-secondary/60 transition-colors text-left">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-xs font-semibold text-foreground flex-1">{title}</span>
        <svg className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

const Index = () => {
  const t = useTracking();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </Button>
          <h1 className="text-base font-bold tracking-tight">🛂 Randevu Takip Sistemi</h1>
          <LiveClock />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigate("/guide")} className="gap-1.5 text-muted-foreground text-xs">
            <BookOpen className="w-3.5 h-3.5" />
            Kılavuz
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 text-muted-foreground text-xs">
            <LogOut className="w-3.5 h-3.5" />
            Çıkış
          </Button>
        </div>
      </header>

      <Tabs defaultValue="vfs" className="flex-1 flex flex-col min-h-0">
        <div className="border-b border-border bg-card px-4 shrink-0">
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
        <TabsContent value="vfs" className="mt-0 flex-1 min-h-0">
          <div className="flex h-[calc(100vh-105px)]">
            {/* LEFT SIDEBAR — Settings */}
            {sidebarOpen && (
              <aside className="w-[320px] shrink-0 border-r border-border bg-card/50">
                <ScrollArea className="h-full">
                  <div className="p-3 space-y-1">
                    <SidebarSection icon={<Network className="w-3.5 h-3.5" />} title="Proxy & Durum" defaultOpen>
                      <ProxySettings configId={t.configId} />
                    </SidebarSection>

                    <SidebarSection icon={<Globe className="w-3.5 h-3.5" />} title="Randevu Ayarları" defaultOpen>
                      <ControlPanel
                        country={t.country}
                        setCountry={t.setCountry}
                        city={t.city}
                        setCity={t.setCity}
                        visaCategory={t.visaCategory}
                        setVisaCategory={t.setVisaCategory}
                        visaSubcategory={t.visaSubcategory}
                        setVisaSubcategory={t.setVisaSubcategory}
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
                    </SidebarSection>

                    <SidebarSection icon={<Settings className="w-3.5 h-3.5" />} title="Bot & Ülke Ayarları">
                      <BotSettingsPanel />
                    </SidebarSection>
                  </div>
                </ScrollArea>
              </aside>
            )}

            {/* MAIN CONTENT */}
            <main className="flex-1 min-w-0">
              <ScrollArea className="h-full">
                <div className="p-4 md:p-6 space-y-5 max-w-[1400px]">
                  {/* VNC Canlı Ekranlar */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <VncViewer title="🌍 VFS Bot Ekranı" pathPrefix="/vfs" />
                    <VncViewer title="🇮🇹 iDATA Bot Ekranı" pathPrefix="/idata" />
                  </div>

                  {/* Top cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ModuleStatus
                      status={t.status}
                      configId={t.configId}
                      onStart={t.startTracking}
                      onStop={t.stopTracking}
                      canStart={!!t.country && !!t.city}
                    />
                    <BotActions
                      status={t.status}
                      configId={t.configId}
                      onStart={t.startTracking}
                      onStop={t.stopTracking}
                      onSimulateFound={t.simulateFound}
                      canStart={!!t.country && !!t.city}
                    />
                  </div>

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
                  <TrackingLogs configId={t.configId} />
                </div>
              </ScrollArea>
            </main>
          </div>
        </TabsContent>

        {/* ========== iDATA TAB ========== */}
        <TabsContent value="idata" className="mt-0 flex-1 min-h-0">
          <div className="flex h-[calc(100vh-105px)]">
            {/* LEFT SIDEBAR */}
            {sidebarOpen && (
              <aside className="w-[320px] shrink-0 border-r border-border bg-card/50">
                <ScrollArea className="h-full">
                  <div className="p-3 space-y-1">
                    <SidebarSection icon={<Settings className="w-3.5 h-3.5" />} title="iDATA Kontrol Paneli" defaultOpen>
                      <IdataControlPanel />
                    </SidebarSection>
                    <SidebarSection icon={<Globe className="w-3.5 h-3.5" />} title="Bot & Ülke Ayarları">
                      <BotSettingsPanel />
                    </SidebarSection>
                  </div>
                </ScrollArea>
              </aside>
            )}

            {/* MAIN CONTENT */}
            <main className="flex-1 min-w-0">
              <ScrollArea className="h-full">
                <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-6xl">
                  <IdataAccounts />
                  <IdataTrackingLogs />
                </div>
              </ScrollArea>
            </main>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Index;
