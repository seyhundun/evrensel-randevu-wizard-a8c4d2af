import { useState, useCallback, useRef, useEffect } from "react";
import { TrackingStatus, Applicant, createEmptyApplicant } from "@/lib/constants";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useTracking() {
  const [status, setStatus] = useState<TrackingStatus>("idle");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [visaCategory, setVisaCategory] = useState("");
  const [visaSubcategory, setVisaSubcategory] = useState("");
  const [personCount, setPersonCount] = useState(1);
  const [interval, setIntervalValue] = useState(120);
  const [applicants, setApplicants] = useState<Applicant[]>([
    createEmptyApplicant("1"),
  ]);
  const [keepAlive, setKeepAlive] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [checksCount, setChecksCount] = useState(0);
  const [configId, setConfigId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load existing active config on mount
  useEffect(() => {
    loadActiveConfig();
  }, []);

  const loadActiveConfig = async () => {
    try {
      const { data: configs } = await supabase
        .from("tracking_configs")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);

      if (configs && configs.length > 0) {
        const cfg = configs[0];
        setConfigId(cfg.id);
        setCountry(cfg.country);
        setCity(cfg.city);
        setVisaCategory(cfg.visa_category ?? "");
        setVisaSubcategory(cfg.visa_subcategory ?? "");
        setPersonCount(cfg.person_count);
        setIntervalValue(cfg.check_interval);
        setKeepAlive(cfg.keep_alive);
        setStatus("searching");

        // Load applicants
        const { data: apps } = await supabase
          .from("applicants")
          .select("*")
          .eq("config_id", cfg.id)
          .order("sort_order", { ascending: true });

        if (apps && apps.length > 0) {
          setApplicants(
            apps.map((a) => ({
              id: a.id,
              firstName: a.first_name,
              lastName: a.last_name,
              gender: (a as any).gender || "",
              passport: a.passport,
              birthDate: a.birth_date,
              nationality: (a as any).nationality || "Turkey",
              passportExpiry: (a as any).passport_expiry || "",
            }))
          );
        }

        // Start elapsed timer
        elapsedRef.current = setInterval(() => {
          setElapsedSeconds((s) => s + 1);
        }, 1000);

        // Start polling for found status
        startPolling(cfg.id);

        // Load check count
        const { count } = await supabase
          .from("tracking_logs")
          .select("*", { count: "exact", head: true })
          .eq("config_id", cfg.id);
        setChecksCount(count ?? 0);
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  };

  // Sync applicants count with personCount
  useEffect(() => {
    const diff = personCount - applicants.length;
    if (diff > 0) {
      const newApplicants = Array.from({ length: diff }, (_, i) =>
        createEmptyApplicant(String(applicants.length + i + 1))
      );
      setApplicants((prev) => [...prev, ...newApplicants]);
    } else if (diff < 0) {
      setApplicants((prev) => prev.slice(0, personCount));
    }
  }, [personCount]);

  const updateApplicant = useCallback(
    (id: string, field: keyof Applicant, value: string) => {
      setApplicants((prev) =>
        prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
      );
    },
    []
  );

  const batchUpdateApplicants = useCallback(
    (updates: Applicant[]) => {
      setApplicants(updates);
    },
    []
  );

  const saveConfig = async () => {
    // Upsert tracking config
    const configData = {
      country,
      city,
      visa_category: visaCategory || null,
      visa_subcategory: visaSubcategory || null,
      person_count: personCount,
      check_interval: interval,
      keep_alive: keepAlive,
      is_active: true,
    };

    let id = configId;

    if (id) {
      await supabase.from("tracking_configs").update(configData).eq("id", id);
    } else {
      const { data } = await supabase
        .from("tracking_configs")
        .insert(configData)
        .select("id")
        .single();
      if (data) {
        id = data.id;
        setConfigId(data.id);
      }
    }

    if (!id) return null;

    // Delete old applicants and insert new
    await supabase.from("applicants").delete().eq("config_id", id);
    const applicantRows = applicants.map((a, i) => ({
      config_id: id!,
      first_name: a.firstName,
      last_name: a.lastName,
      passport: a.passport,
      birth_date: a.birthDate,
      phone: "",
      email: "",
      nationality: a.nationality || "Turkey",
      passport_expiry: a.passportExpiry || "",
      gender: a.gender || "",
      sort_order: i,
    } as any));
    await supabase.from("applicants").insert(applicantRows);

    return id;
  };

  const foundHandledRef = useRef(false);

  const startPolling = (cfgId: string) => {
    const pollingStartTime = new Date().toISOString();
    foundHandledRef.current = false;
    // Poll tracking_logs for "found" status — only logs after polling started
    pollRef.current = setInterval(async () => {
      // Already handled — skip
      if (foundHandledRef.current) return;

      const { data } = await supabase
        .from("tracking_logs")
        .select("*")
        .eq("config_id", cfgId)
        .eq("status", "found")
        .gte("created_at", pollingStartTime)
        .limit(1);

      if (data && data.length > 0 && !foundHandledRef.current) {
        foundHandledRef.current = true;
        handleFound();
      }

      // Update checks count
      const { count } = await supabase
        .from("tracking_logs")
        .select("*", { count: "exact", head: true })
        .eq("config_id", cfgId);
      setChecksCount(count ?? 0);
    }, 10000);
  };

  const startTracking = useCallback(async () => {
    if (!country || !city) return;

    const id = await saveConfig();
    if (!id) {
      toast.error("Konfigürasyon kaydedilemedi");
      return;
    }

    setStatus("searching");
    setElapsedSeconds(0);
    setChecksCount(0);

    toast.success("Takip başlatıldı", {
      description: "Ayarlar veritabanına kaydedildi. Bot API üzerinden kontrol yapılacak.",
    });

    elapsedRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    startPolling(id);
  }, [country, city, interval, visaCategory, visaSubcategory, personCount, keepAlive, applicants, configId]);

  const stopTracking = useCallback(async () => {
    setStatus("idle");
    if (timerRef.current) clearInterval(timerRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    timerRef.current = null;
    elapsedRef.current = null;
    pollRef.current = null;

    if (configId) {
      await supabase
        .from("tracking_configs")
        .update({ is_active: false })
        .eq("id", configId);
    }

    toast.info("Takip durduruldu");
  }, [configId]);

  const handleFound = useCallback(() => {
    setStatus("found");
    if (timerRef.current) clearInterval(timerRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    if (pollRef.current) clearInterval(pollRef.current);

    toast.success("🎉 Randevu Bulundu!", {
      description: "Uygun randevu slotu tespit edildi!",
      duration: 30000,
    });

    // Play sound
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {}
  }, []);

  const simulateFound = useCallback(async () => {
    if (configId) {
      await supabase.from("tracking_logs").insert({
        config_id: configId,
        status: "found",
        message: "Simüle edilmiş randevu",
        slots_available: 1,
      });
    }
    handleFound();
  }, [configId, handleFound]);

  return {
    status,
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
    applicants,
    updateApplicant,
    batchUpdateApplicants,
    keepAlive,
    setKeepAlive,
    startTracking,
    stopTracking,
    simulateFound,
    elapsedSeconds,
    checksCount,
    configId,
  };
}
