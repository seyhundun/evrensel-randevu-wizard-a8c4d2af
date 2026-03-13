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

export type TrackingStatus = "idle" | "searching" | "found" | "error";

export interface Applicant {
  id: string;
  firstName: string;
  lastName: string;
  passport: string;
  birthDate: string;
  phone: string;
  email: string;
}

export const createEmptyApplicant = (id: string): Applicant => ({
  id,
  firstName: "",
  lastName: "",
  passport: "",
  birthDate: "",
  phone: "",
  email: "",
});
