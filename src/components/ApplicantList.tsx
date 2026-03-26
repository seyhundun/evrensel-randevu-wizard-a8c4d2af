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
  personCount: number;
  setPersonCount: (n: number) => void;
  configId?: string | null;
}

export default function ApplicantList({
  applicants,
  onUpdate,
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
        return;
      }

      // Fill each applicant's fields from DB
      for (let i = 0; i < Math.min(data.length, applicants.length); i++) {
        const db = data[i];
        const local = applicants[i];
        if (db.first_name) onUpdate(local.id, "firstName", db.first_name);
        if (db.last_name) onUpdate(local.id, "lastName", db.last_name);
        if (db.gender) onUpdate(local.id, "gender", db.gender);
        if (db.birth_date) onUpdate(local.id, "birthDate", db.birth_date);
        if (db.nationality) onUpdate(local.id, "nationality", db.nationality);
        if (db.passport) onUpdate(local.id, "passport", db.passport);
        if (db.passport_expiry) onUpdate(local.id, "passportExpiry", db.passport_expiry);
      }

      toast.success(`${Math.min(data.length, applicants.length)} başvuru sahibinin bilgileri dolduruldu!`);
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
          className="gap-2 shadow-card hover:shadow-card-hover transition-shadow"
        >
          <ClipboardCheck className="w-4 h-4" />
          Tümünü Doldur
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
