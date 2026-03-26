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
  { value: "France Visa Application Center - Gaziantep", label: "Gaziantep" },
  { value: "France Visa Application Centre - Ankara", label: "Ankara" },
  { value: "France Visa Application Centre - Istanbul Beyoglu", label: "İstanbul Beyoğlu" },
  { value: "France visa application center -Izmir", label: "İzmir" },
] as const;

export const VISA_CATEGORIES = [
  "Kısa Süreli Vizeler",
  "Uzun Süreli Vizeler",
] as const;

export const VISA_SUBCATEGORIES: Record<string, string[]> = {
  "Kısa Süreli Vizeler": [
    "Turistik / Çoklu Giriş",
    "Turistik / Tek Giriş",
    "İş / Çoklu Giriş",
    "İş / Tek Giriş",
    "Aile Ziyareti",
    "Transit",
  ],
  "Uzun Süreli Vizeler": [
    "Öğrenci",
    "Aile Birleşimi",
    "Çalışma Vizesi",
  ],
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
