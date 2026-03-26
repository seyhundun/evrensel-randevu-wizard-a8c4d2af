import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Loader2 } from "lucide-react";
import ApplicantCard from "./ApplicantCard";
import type { Applicant } from "@/lib/constants";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ApplicantListProps {
  applicants: Applicant[];
  onUpdate: (id: string, field: keyof Applicant, value: string) => void;
  onBatchUpdate: (applicants: Applicant[]) => void;
  personCount: number;
  setPersonCount: (n: number) => void;
  configId?: string | null;
}

export default function ApplicantList({
  applicants,
  onUpdate,
  onBatchUpdate,
  personCount,
  setPersonCount,
  configId,
}: ApplicantListProps) {
  const [filling, setFilling] = useState(false);

  const handleAutoFill = async () => {
    if (!configId) {
      toast.error("Önce takip başlatın veya config seçin");
      return;
    }
    setFilling(true);
    try {
      const { data, error } = await supabase
        .from("applicants")
        .select("*")
        .eq("config_id", configId)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Veritabanında başvuru sahibi bulunamadı");
        setFilling(false);
        return;
      }

      // Update person count if needed
      if (data.length !== personCount) {
        setPersonCount(data.length);
      }

      // Build complete applicant array from DB data in one shot
      const newApplicants: Applicant[] = data.map((db, i) => ({
        id: applicants[i]?.id || String(i + 1),
        firstName: db.first_name || "",
        lastName: db.last_name || "",
        gender: db.gender || "",
        birthDate: db.birth_date || "",
        nationality: db.nationality || "Turkey",
        passport: db.passport || "",
        passportExpiry: db.passport_expiry || "",
      }));

      // Single atomic state update
      onBatchUpdate(newApplicants);

      toast.success(`${data.length} başvuru sahibinin bilgileri dolduruldu!`);
    } catch (err: any) {
      toast.error("Bilgiler yüklenemedi: " + (err.message || "Bilinmeyen hata"));
    } finally {
      setFilling(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="section-title text-foreground">Başvuru Sahipleri</h2>
        <Button
          onClick={handleAutoFill}
          variant="outline"
          disabled={filling}
          className="gap-2 shadow-card hover:shadow-card-hover transition-shadow"
        >
          {filling ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
          {filling ? "Dolduruluyor..." : "Tümünü Doldur"}
        </Button>
      </div>

      <AnimatePresence mode="popLayout">
        {applicants.map((a, i) => (
          <ApplicantCard
            key={a.id}
            applicant={a}
            index={i}
            total={applicants.length}
            onUpdate={onUpdate}
            configId={configId}
            onRemove={
              applicants.length > 1
                ? () => setPersonCount(personCount - 1)
                : undefined
            }
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
