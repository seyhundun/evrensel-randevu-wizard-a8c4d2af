import { useState } from "react";
import ControlPanel from "@/components/ControlPanel";
import StatusPanel from "@/components/StatusPanel";
import ApplicantList from "@/components/ApplicantList";
import TrackingLogs from "@/components/TrackingLogs";
import VfsAccounts from "@/components/VfsAccounts";
import IdataAccounts from "@/components/IdataAccounts";
import IdataTrackingLogs from "@/components/IdataTrackingLogs";
import IdataControlPanel from "@/components/IdataControlPanel";
import { useTracking } from "@/hooks/useTracking";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Index = () => {
  const t = useTracking();
  const [activeTab, setActiveTab] = useState("vfs");

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] min-h-screen">
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

      <main className="p-4 md:p-6 lg:p-8 space-y-6 overflow-y-auto max-h-screen">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="vfs" className="gap-1.5">
              🌍 VFS Global
            </TabsTrigger>
            <TabsTrigger value="idata" className="gap-1.5">
              🇮🇹 iDATA İtalya
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vfs" className="space-y-8 mt-6">
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
          </TabsContent>

          <TabsContent value="idata" className="space-y-8 mt-6">
            <IdataControlPanel />
            <IdataAccounts />
            <IdataTrackingLogs />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
