export const COUNTRIES = [
  { value: "france", label: "Fransa", flag: "🇫🇷", code: "fra" },
  { value: "netherlands", label: "Hollanda", flag: "🇳🇱", code: "nld" },
  { value: "denmark", label: "Danimarka", flag: "🇩🇰", code: "dnk" },
] as const;

// Country code'a göre VFS URL üret
export function getVfsLoginUrl(countryCode: string): string {
  const country = COUNTRIES.find(c => c.value === countryCode);
  const code = country?.code || "fra";
  return `https://visa.vfsglobal.com/tur/tr/${code}/login`;
}

export function getVfsRegisterUrl(countryCode: string): string {
  const country = COUNTRIES.find(c => c.value === countryCode);
  const code = country?.code || "fra";
  return `https://visa.vfsglobal.com/tur/tr/${code}/register`;
}

export const CITIES = [
  { value: "ankara", label: "Ankara" },
  { value: "istanbul-beyoglu", label: "İstanbul (Beyoğlu)" },
  { value: "istanbul-altunizade", label: "İstanbul (Altunizade)" },
  { value: "izmir", label: "İzmir" },
  { value: "antalya", label: "Antalya" },
  { value: "bursa", label: "Bursa" },
  { value: "gaziantep", label: "Gaziantep" },
] as const;

export const VISA_CATEGORIES = [
  "Turist Vizesi",
  "İş Vizesi",
  "Öğrenci Vizesi",
  "Aile Birleşimi",
  "Transit Vize",
  "Kısa Süreli (Schengen)",
] as const;

export const VISA_SUBCATEGORIES: Record<string, string[]> = {
  "Turist Vizesi": ["Tourism", "Short Stay Tourism", "Visit Family/Friends"],
  "İş Vizesi": ["Business", "Short Stay Business", "Conference/Seminar"],
  "Öğrenci Vizesi": ["Student", "Long Stay Student", "Research/Study"],
  "Aile Birleşimi": ["Family Reunification", "Spouse Visa", "Dependent Child"],
  "Transit Vize": ["Airport Transit", "Transit"],
  "Kısa Süreli (Schengen)": ["Short Stay", "Schengen Visa", "Multiple Entry"],
};

export type TrackingStatus = "idle" | "searching" | "found" | "error";

export interface Applicant {
  id: string;
  firstName: string;
  lastName: string;
  passport: string;
  birthDate: string;
  nationality: string;
  passportExpiry: string;
}

export const createEmptyApplicant = (id: string): Applicant => ({
  id,
  firstName: "",
  lastName: "",
  passport: "",
  birthDate: "",
  nationality: "Turkey",
  passportExpiry: "",
});
