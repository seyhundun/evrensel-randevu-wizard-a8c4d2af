import ControlPanel from "@/components/ControlPanel";
import StatusPanel from "@/components/StatusPanel";
import ApplicantList from "@/components/ApplicantList";
import TrackingLogs from "@/components/TrackingLogs";
import { useTracking } from "@/hooks/useTracking";

const Index = () => {
  const t = useTracking();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] min-h-screen">
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

      <main className="p-6 md:p-10 lg:p-12 space-y-8 max-w-4xl">
        <StatusPanel
          status={t.status}
          country={t.country}
          city={t.city}
          elapsedSeconds={t.elapsedSeconds}
          checksCount={t.checksCount}
          onSimulateFound={t.simulateFound}
        />

        <ApplicantList
          applicants={t.applicants}
          onUpdate={t.updateApplicant}
          personCount={t.personCount}
          setPersonCount={t.setPersonCount}
        />
      </main>
    </div>
  );
};

export default Index;
