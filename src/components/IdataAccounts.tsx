import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2, Eye, EyeOff, UserCheck, Ban, Clock, UserPlus, Loader2, RefreshCw, Pencil, Mail, Phone, MessageSquare, Send } from "lucide-react";

const IDATA_PASSWORD_SPECIAL = "@$!%*#?&";

function generateSecurePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const all = upper + lower + digits + IDATA_PASSWORD_SPECIAL;
  const length = 10 + Math.floor(Math.random() * 4);
  const required = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    IDATA_PASSWORD_SPECIAL[Math.floor(Math.random() * IDATA_PASSWORD_SPECIAL.length)],
  ];
  const remaining = Array.from({ length: length - required.length }, () => all[Math.floor(Math.random() * all.length)]);
  const chars = [...required, ...remaining];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

interface IdataAccount {
  id: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  passport_no: string;
  phone: string | null;
  birth_day: string;
  birth_month: string;
  birth_year: string;
  residence_city: string | null;
  idata_office: string | null;
  travel_purpose: string | null;
  invoice_type: string;
  invoice_city: string | null;
  invoice_district: string | null;
  invoice_address: string | null;
  status: string;
  registration_status: string | null;
  banned_until: string | null;
  last_used_at: string | null;
  fail_count: number;
  notes: string | null;
  manual_otp: string | null;
  otp_requested_at: string | null;
  registration_otp: string | null;
  registration_otp_type: string | null;
}

interface CityOffice {
  city: string;
  office_name: string;
  office_value: string;
}

export default function IdataAccounts() {
  const [accounts, setAccounts] = useState<IdataAccount[]>([]);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [regOtpInputs, setRegOtpInputs] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cityOffices, setCityOffices] = useState<CityOffice[]>([]);
  const [availableCities, setAvailableCities] = useState<string[]>([]);
  const [filteredOffices, setFilteredOffices] = useState<CityOffice[]>([]);

  const [form, setForm] = useState({
    email: "", password: generateSecurePassword(),
    first_name: "", last_name: "", passport_no: "",
    phone: "", birth_day: "01", birth_month: "01", birth_year: "1990",
    residence_city: "", idata_office: "", travel_purpose: "",
    invoice_city: "", invoice_district: "", invoice_address: "",
  });

  useEffect(() => {
    loadAccounts();
    loadCityOffices();
    const channel = supabase
      .channel('idata-accounts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'idata_accounts' }, () => loadAccounts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'idata_city_offices' }, () => loadCityOffices())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Update filtered offices when city changes
  useEffect(() => {
    if (form.residence_city) {
      const offices = cityOffices.filter(co => co.city.toLowerCase() === form.residence_city.toLowerCase());
      setFilteredOffices(offices);
      // Auto-clear office if not in new list
      if (offices.length > 0 && !offices.find(o => o.office_name === form.idata_office)) {
        setForm(prev => ({ ...prev, idata_office: "" }));
      }
    } else {
      setFilteredOffices([]);
    }
  }, [form.residence_city, cityOffices]);

  const loadAccounts = async () => {
    const { data } = await supabase
      .from("idata_accounts" as any)
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setAccounts(data as unknown as IdataAccount[]);
  };

  const loadCityOffices = async () => {
    const { data } = await supabase
      .from("idata_city_offices" as any)
      .select("*")
      .order("city", { ascending: true });
    if (data) {
      const offices = data as unknown as CityOffice[];
      setCityOffices(offices);
      const cities = [...new Set(offices.map(o => o.city))].sort();
      setAvailableCities(cities);
    }
  };

  const updateForm = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const loadToForm = (acc: IdataAccount) => {
    setForm({
      email: acc.email || "",
      password: acc.password || "",
      first_name: acc.first_name || "",
      last_name: acc.last_name || "",
      passport_no: acc.passport_no || "",
      phone: acc.phone || "",
      birth_day: acc.birth_day || "01",
      birth_month: acc.birth_month || "01",
      birth_year: acc.birth_year || "1990",
      residence_city: acc.residence_city || "",
      idata_office: acc.idata_office || "",
      travel_purpose: acc.travel_purpose || "",
      invoice_city: acc.invoice_city || "",
      invoice_district: acc.invoice_district || "",
      invoice_address: acc.invoice_address || "",
    });
    setEditingId(acc.id);
    setShowForm(true);
  };

  const resetForm = () => {
    setForm({
      email: "", password: generateSecurePassword(),
      first_name: "", last_name: "", passport_no: "",
      phone: "", birth_day: "01", birth_month: "01", birth_year: "1990",
      residence_city: "", idata_office: "", travel_purpose: "",
      invoice_city: "", invoice_district: "", invoice_address: "",
    });
    setEditingId(null);
    setShowForm(false);
  };

  const saveAccount = async () => {
    if (!form.first_name || !form.last_name) {
      toast.error("İsim ve soyisim gerekli");
      return;
    }
    setLoading(true);

    if (editingId) {
      const { error } = await supabase.from("idata_accounts" as any)
        .update(form as any)
        .eq("id", editingId);
      if (error) {
        toast.error("Güncelleme başarısız: " + error.message);
      } else {
        toast.success("Hesap güncellendi!");
        resetForm();
      }
    } else {
      if (!form.email || !form.password) {
        toast.error("Email ve şifre gerekli");
        setLoading(false);
        return;
      }
      const { error } = await supabase.from("idata_accounts" as any).insert({
        ...form,
        registration_status: "pending",
        status: "active",
      } as any);
      if (error) {
        toast.error("Hesap eklenemedi: " + error.message);
      } else {
        toast.success("iDATA kayıt talebi oluşturuldu!");
        resetForm();
      }
    }
    setLoading(false);
  };

  const deleteAccount = async (id: string) => {
    await supabase.from("idata_accounts" as any).delete().eq("id", id);
    toast.info("Hesap silindi");
  };

  const reactivateAccount = async (id: string) => {
    await supabase.from("idata_accounts" as any)
      .update({ status: "active", fail_count: 0, banned_until: null } as any)
      .eq("id", id);
    toast.success("Hesap tekrar aktif edildi");
  };

  const isRegistering = (acc: IdataAccount) =>
    acc.registration_status === "pending" || acc.registration_status === "email_otp" || acc.registration_status === "sms_otp";

  const submitManualOtp = async (id: string) => {
    const code = otpInputs[id]?.trim();
    if (!code) { toast.error("OTP kodu girin"); return; }
    const { error } = await supabase.from("idata_accounts" as any)
      .update({ manual_otp: code } as any).eq("id", id);
    if (error) { toast.error("OTP gönderilemedi: " + error.message); }
    else { toast.success("OTP kodu gönderildi"); setOtpInputs(prev => ({ ...prev, [id]: "" })); }
  };

  const submitRegOtp = async (id: string) => {
    const code = regOtpInputs[id]?.trim();
    if (!code) { toast.error("Doğrulama kodu girin"); return; }
    const { error } = await supabase.from("idata_accounts" as any)
      .update({ registration_otp: code } as any).eq("id", id);
    if (error) { toast.error("Kod gönderilemedi: " + error.message); }
    else { toast.success("Doğrulama kodu gönderildi"); setRegOtpInputs(prev => ({ ...prev, [id]: "" })); }
  };

  const statusBadge = (acc: IdataAccount) => {
    if (acc.registration_status === "pending") {
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Kayıt Bekliyor</Badge>;
    }
    if (acc.registration_status === "email_otp" || acc.registration_status === "sms_otp") {
      return <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20"><MessageSquare className="w-3 h-3 mr-1 animate-pulse" /> {acc.registration_otp_type === "email" ? "Email" : "SMS"} Doğrulama</Badge>;
    }
    if (acc.registration_status === "failed") {
      return <Badge variant="destructive">Kayıt Başarısız</Badge>;
    }
    if (acc.status === "active") {
      return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><UserCheck className="w-3 h-3 mr-1" /> Aktif</Badge>;
    }
    if (acc.status === "banned") {
      return <Badge variant="destructive"><Ban className="w-3 h-3 mr-1" /> Banlı</Badge>;
    }
    if (acc.status === "cooldown") {
      const until = acc.banned_until ? new Date(acc.banned_until).toLocaleString("tr-TR") : "";
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="w-3 h-3 mr-1" /> Bekleme ({until})</Badge>;
    }
    return <Badge variant="secondary">{acc.status}</Badge>;
  };

  const TURKEY_CITIES = [
    "Adana","Adıyaman","Afyonkarahisar","Ağrı","Aksaray","Amasya","Ankara","Antalya","Ardahan","Artvin",
    "Aydın","Balıkesir","Bartın","Batman","Bayburt","Bilecik","Bingöl","Bitlis","Bolu","Burdur",
    "Bursa","Çanakkale","Çankırı","Çorum","Denizli","Diyarbakır","Düzce","Edirne","Elazığ","Erzincan",
    "Erzurum","Eskişehir","Gaziantep","Giresun","Gümüşhane","Hakkari","Hatay","Iğdır","Isparta","İstanbul",
    "İzmir","Kahramanmaraş","Karabük","Karaman","Kars","Kastamonu","Kayseri","Kırıkkale","Kırklareli","Kırşehir",
    "Kilis","Kocaeli","Konya","Kütahya","Malatya","Manisa","Mardin","Mersin","Muğla","Muş",
    "Nevşehir","Niğde","Ordu","Osmaniye","Rize","Sakarya","Samsun","Şanlıurfa","Siirt","Sinop",
    "Sivas","Şırnak","Tekirdağ","Tokat","Trabzon","Tunceli","Uşak","Van","Yalova","Yozgat","Zonguldak"
  ];

  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => String(currentYear - i));

  return (
    <div className="space-y-4">
      <h2 className="section-title flex items-center gap-2">
        🇮🇹 iDATA İtalya Hesapları
      </h2>
      <p className="helper-text">iDATA İtalya platformu için hesap yönetimi. Bot otomatik kayıt ve randevu kontrol yapar.</p>

      {availableCities.length > 0 && (
        <p className="text-xs text-muted-foreground">
          📍 Bilinen şehirler: {availableCities.join(", ")} — Bot çalıştıkça yeni şehir/ofis verileri otomatik güncellenir.
        </p>
      )}

      <Button
        size="sm"
        variant={showForm ? "secondary" : "default"}
        onClick={() => { if (showForm) { resetForm(); } else { setEditingId(null); setShowForm(true); } }}
        className="gap-1.5"
      >
        <UserPlus className="w-4 h-4" />
        {showForm ? "Formu Kapat" : "Yeni Hesap Kaydı"}
      </Button>

      {showForm && (
        <Card className="p-4 space-y-4">
          <h3 className="text-sm font-semibold">Kişisel Bilgiler</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">İsim *</Label>
              <Input placeholder="SEYHUN" value={form.first_name} onChange={e => updateForm("first_name", e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label className="text-xs">Soyisim *</Label>
              <Input placeholder="OGUZ" value={form.last_name} onChange={e => updateForm("last_name", e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label className="text-xs">Pasaport No</Label>
              <Input placeholder="U12345678" value={form.passport_no} onChange={e => updateForm("passport_no", e.target.value.toUpperCase())} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Doğum Günü</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.birth_day} onChange={e => updateForm("birth_day", e.target.value)}>
                {days.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Doğum Ayı</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.birth_month} onChange={e => updateForm("birth_month", e.target.value)}>
                {months.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Doğum Yılı</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.birth_year} onChange={e => updateForm("birth_year", e.target.value)}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Telefon</Label>
              <Input placeholder="5321234567" value={form.phone} onChange={e => updateForm("phone", e.target.value.replace(/\D/g, "").replace(/^90/, "").replace(/^0+/, ""))} maxLength={10} />
            </div>
            <div>
              <Label className="text-xs">Email *</Label>
              <Input type="email" placeholder="ornek@gmail.com" value={form.email} onChange={e => updateForm("email", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs flex items-center justify-between">
                Şifre *
                <button type="button" onClick={() => updateForm("password", generateSecurePassword())} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                  <RefreshCw className="w-3 h-3" /> Yenile
                </button>
              </Label>
              <Input type="text" value={form.password} onChange={e => updateForm("password", e.target.value)} />
            </div>
          </div>

          <h3 className="text-sm font-semibold pt-2">Başvuru Bilgileri</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">İkametgah Şehri</Label>
              <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.residence_city}
                  onChange={e => updateForm("residence_city", e.target.value)}
                >
                  <option value="">Şehir Seçiniz</option>
                  {TURKEY_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div>
              <Label className="text-xs">iDATA Ofisi</Label>
              {filteredOffices.length > 0 ? (
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.idata_office}
                  onChange={e => updateForm("idata_office", e.target.value)}
                >
                  <option value="">iDATA Ofisi Seçiniz</option>
                  {filteredOffices.map(o => <option key={o.office_value} value={o.office_name}>{o.office_name}</option>)}
                </select>
              ) : (
                <Input placeholder="İstanbul" value={form.idata_office} onChange={e => updateForm("idata_office", e.target.value)} />
              )}
            </div>
            <div>
              <Label className="text-xs">Gidiş Amacı</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.travel_purpose}
                onChange={e => updateForm("travel_purpose", e.target.value)}
              >
                <option value="">Gidiş amacı seçin</option>
                <option value="Ticari">Ticari</option>
                <option value="Eğitim">Eğitim</option>
                <option value="Lojistik">Lojistik</option>
                <option value="Diğer">Diğer</option>
              </select>
            </div>
          </div>

          <h3 className="text-sm font-semibold pt-2">Fatura Bilgileri</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Şehir</Label>
              <Input placeholder="İstanbul" value={form.invoice_city} onChange={e => updateForm("invoice_city", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">İlçe</Label>
              <Input placeholder="Beyoğlu" value={form.invoice_district} onChange={e => updateForm("invoice_district", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Adres</Label>
              <Input placeholder="Adres" value={form.invoice_address} onChange={e => updateForm("invoice_address", e.target.value)} />
            </div>
          </div>

          <Button onClick={saveAccount} disabled={loading} size="sm" className="gap-1.5">
            <UserPlus className="w-4 h-4" /> {editingId ? "Güncelle" : "Kayıt Talebi Oluştur"}
          </Button>
          {editingId && (
            <Button onClick={resetForm} size="sm" variant="outline" className="gap-1.5 ml-2">
              İptal
            </Button>
          )}
        </Card>
      )}

      {/* Account list */}
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Henüz iDATA hesabı eklenmedi.
        </p>
      ) : (
        <div className="space-y-2">
          {accounts.map(acc => (
            <Card key={acc.id} className="p-3 flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm truncate">{acc.email}</span>
                    {statusBadge(acc)}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">{acc.first_name} {acc.last_name}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {showPasswords[acc.id] ? acc.password : "••••••••"}
                    </span>
                    <button onClick={() => setShowPasswords(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))} className="text-muted-foreground hover:text-foreground">
                      {showPasswords[acc.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    {acc.passport_no && <span className="text-xs text-muted-foreground">🛂 {acc.passport_no}</span>}
                    {acc.idata_office && <span className="text-xs text-muted-foreground">🏢 {acc.idata_office}</span>}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => loadToForm(acc)} className="gap-1">
                    <Pencil className="w-3.5 h-3.5" /> Düzenle
                  </Button>
                  {acc.status !== "active" && (
                    <Button size="sm" variant="outline" onClick={() => reactivateAccount(acc.id)} className="gap-1">
                      <UserCheck className="w-3.5 h-3.5" /> Aktif Et
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => deleteAccount(acc.id)} className="text-destructive hover:text-destructive gap-1">
                    <Trash2 className="w-3.5 h-3.5" /> Sil
                  </Button>
                </div>
              </div>

              {/* Registration OTP input */}
              {isRegistering(acc) && acc.registration_otp_type && !acc.registration_otp && (
                <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-950/20 rounded-lg p-2">
                  {acc.registration_otp_type === "email" ? (
                    <Mail className="w-4 h-4 text-orange-500 animate-pulse shrink-0" />
                  ) : (
                    <Phone className="w-4 h-4 text-orange-500 animate-pulse shrink-0" />
                  )}
                  <span className="text-xs font-medium text-orange-600">
                    {acc.registration_otp_type === "email" ? "Email doğrulama kodu bekleniyor!" : "SMS doğrulama kodu bekleniyor!"}
                  </span>
                  <Input
                    placeholder="Kodu girin"
                    maxLength={8}
                    className="h-7 w-24 text-xs font-mono"
                    value={regOtpInputs[acc.id] || ""}
                    onChange={(e) => setRegOtpInputs(prev => ({ ...prev, [acc.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1" onClick={() => submitRegOtp(acc.id)}>
                    <Send className="w-3 h-3" /> Gönder
                  </Button>
                </div>
              )}

              {/* Login OTP input (manual_otp) */}
              {acc.otp_requested_at && !acc.manual_otp && acc.status === "active" && !isRegistering(acc) && (
                <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-2">
                  <MessageSquare className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
                  <span className="text-xs font-medium text-amber-600">Giriş OTP kodu bekleniyor!</span>
                  <Input
                    placeholder="OTP kodu"
                    maxLength={8}
                    className="h-7 w-24 text-xs font-mono"
                    value={otpInputs[acc.id] || ""}
                    onChange={(e) => setOtpInputs(prev => ({ ...prev, [acc.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1" onClick={() => submitManualOtp(acc.id)}>
                    <Send className="w-3 h-3" /> Gönder
                  </Button>
                </div>
              )}

              {acc.notes && (
                <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">{acc.notes}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
