import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, User } from "lucide-react";
import type { Applicant } from "@/lib/constants";

interface ApplicantCardProps {
  applicant: Applicant;
  index: number;
  total: number;
  onUpdate: (id: string, field: keyof Applicant, value: string) => void;
  onRemove?: () => void;
}

const fields: { key: keyof Applicant; label: string; placeholder: string; type?: string }[] = [
  { key: "firstName", label: "Ad", placeholder: "Can" },
  { key: "lastName", label: "Soyad", placeholder: "Yılmaz" },
  { key: "passport", label: "Pasaport No", placeholder: "U12345678" },
  { key: "birthDate", label: "Doğum Tarihi", placeholder: "15.08.1992", type: "text" },
  { key: "nationality", label: "Uyruk", placeholder: "Turkey" },
  { key: "passportExpiry", label: "Pasaport Son Kullanma", placeholder: "15.08.2030" },
];

export default function ApplicantCard({
  applicant,
  index,
  total,
  onUpdate,
  onRemove,
}: ApplicantCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1], delay: index * 0.05 }}
      className="bg-card rounded-xl p-6 shadow-card"
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="section-title text-foreground flex items-center gap-2">
          <User className="w-4 h-4 text-primary" />
          {index + 1}. Başvuru Sahibi
        </h3>
        {total > 1 && onRemove && (
          <button
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive transition-colors p-1"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: 0.03 } },
        }}
      >
        {fields.map((f) => (
          <motion.div
            key={f.key}
            variants={{
              hidden: { opacity: 0, y: 5 },
              visible: { opacity: 1, y: 0 },
            }}
            className="flex flex-col gap-1.5"
          >
            <Label className="helper-text font-medium">{f.label}</Label>
            <Input
              type={f.type ?? "text"}
              placeholder={f.placeholder}
              value={applicant[f.key]}
              onChange={(e) => onUpdate(applicant.id, f.key, e.target.value)}
              className="bg-background shadow-card focus:shadow-card-hover transition-shadow"
            />
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
