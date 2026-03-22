import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Eye, EyeOff, UserCheck, Ban, Clock, MessageSquare, Send, UserPlus, Mail, Phone, Loader2, RefreshCw, ShieldAlert, CheckCircle2, Users, Globe } from "lucide-react";

const VFS_PASSWORD_SPECIAL = "$@#!%*?";
const VFS_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[$@#!%*?])[A-Za-z\d$@#!%*?]{8,15}$/;

function validateVfsPassword(pw: string): string | null {
  if (pw.length < 8) return "En az 8 karakter olmalı";
  if (pw.length > 15) return "En fazla 15 karakter olmalı";
  if (!/[A-Z]/.test(pw)) return "En az 1 büyük harf gerekli";
  if (!/[a-z]/.test(pw)) return "En az 1 küçük harf gerekli";
  if (!/\d/.test(pw)) return "En az 1 sayı gerekli";
  if (!/[$@#!%*?]/.test(pw)) return "En az 1 özel karakter gerekli ( $ @ # ! % * ? )";
  if (/[^A-Za-z\d$@#!%*?]/.test(pw)) return "Sadece harf, rakam ve $ @ # ! % * ? kullanılabilir";
  return null;
}

function generateSecurePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const all = upper + lower + digits + VFS_PASSWORD_SPECIAL;

  // Length between 10-14 (safe range within 8-15)
  const length = 10 + Math.floor(Math.random() * 5);

  // Ensure at least one of each required type
  const required = [
    upper[Math.floor(Math.random() * upper.length)],
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    VFS_PASSWORD_SPECIAL[Math.floor(Math.random() * VFS_PASSWORD_SPECIAL.length)],
  ];

  const remaining = Array.from({ length: length - required.length }, () => all[Math.floor(Math.random() * all.length)]);
  const chars = [...required, ...remaining];
  // Shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

interface VfsAccount {
  id: string;
  email: string;
  password: string;
  phone: string | null;
  status: string;
  banned_until: string | null;
  last_used_at: string | null;
  fail_count: number;
  notes: string | null;
  imap_host: string | null;
  imap_password: string | null;
  manual_otp: string | null;
  otp_requested_at: string | null;
  registration_status: string | null;
  registration_otp_type: string | null;
  registration_otp: string | null;
  captcha_waiting_at: string | null;
  captcha_manual_approved: boolean;
  booking_enabled: boolean;
}

export default function VfsAccounts() {
  const [accounts, setAccounts] = useState<VfsAccount[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [smsOtpInputs, setSmsOtpInputs] = useState<Record<string, string>>({});
  const [regOtpInputs, setRegOtpInputs] = useState<Record<string, string>>({});
  const [addMode, setAddMode] = useState<"existing" | "register" | "bulk">("existing");
  const [editingImap, setEditingImap] = useState<Record<string, { host: string; password: string }>>({});
  const [manualBrowserLoading, setManualBrowserLoading] = useState(false);
  // Bulk Gmail alias state
  const [bulkBaseEmail, setBulkBaseEmail] = useState("");
  const [bulkPhone, setBulkPhone] = useState("");
  const [bulkCount, setBulkCount] = useState(5);
  const [bulkImapPassword, setBulkImapPassword] = useState("");
  const [bulkCreating, setBulkCreating] = useState(false);

  useEffect(() => {
    loadAccounts();
    const channel = supabase
      .channel('vfs-accounts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vfs_accounts' }, () => loadAccounts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const loadAccounts = async () => {
    const { data } = await supabase
      .from("vfs_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setAccounts(data as unknown as VfsAccount[]);
  };

  const addAccount = async () => {
    if (!newEmail || !newPassword) {
      toast.error("Email ve şifre gerekli");
      return;
    }
    const pwError = validateVfsPassword(newPassword);
    if (pwError) {
      toast.error("Şifre uygun değil: " + pwError);
      return;
    }
    setLoading(true);

    if (addMode === "register") {
      if (!newPhone) {
        toast.error("Kayıt için telefon numarası gerekli");
        setLoading(false);
        return;
      }
      const { error } = await supabase.from("vfs_accounts").insert({
        email: newEmail,
        password: newPassword,
        phone: newPhone,
        registration_status: "pending",
        status: "active",
      } as any);
      if (error) {
        toast.error("Hesap eklenemedi: " + error.message);
      } else {
        toast.success("Kayıt talebi oluşturuldu! Bot VFS'te hesap açacak.");
        setNewEmail("");
        setNewPassword("");
        setNewPhone("");
      }
    } else {
      const { error } = await supabase.from("vfs_accounts").insert({
        email: newEmail,
        password: newPassword,
        registration_status: "none",
      } as any);
      if (error) {
        toast.error("Hesap eklenemedi: " + error.message);
      } else {
        toast.success("VFS hesabı eklendi");
        setNewEmail("");
        setNewPassword("");
      }
    }
    setLoading(false);
  };

  const deleteAccount = async (id: string) => {
    await supabase.from("vfs_accounts").delete().eq("id", id);
    toast.info("Hesap silindi");
  };

  const bulkCreateAliasAccounts = async () => {
    if (!bulkBaseEmail || !bulkBaseEmail.includes("@")) {
      toast.error("Geçerli bir Gmail adresi girin");
      return;
    }
    if (!bulkPhone) {
      toast.error("Telefon numarası gerekli");
      return;
    }
    if (bulkCount < 1 || bulkCount > 50) {
      toast.error("1-50 arası hesap sayısı girin");
      return;
    }

    setBulkCreating(true);
    const [localPart, domain] = bulkBaseEmail.split("@");
    // Remove existing + suffix if any
    const cleanLocal = localPart.split("+")[0];
    
    // Find highest existing alias number
    const existingAliases = accounts
      .filter(a => a.email.startsWith(cleanLocal + "+vfs") && a.email.endsWith("@" + domain))
      .map(a => {
        const match = a.email.match(/\+vfs(\d+)@/);
        return match ? parseInt(match[1]) : 0;
      });
    const startNum = existingAliases.length > 0 ? Math.max(...existingAliases) + 1 : 1;

    let created = 0;
    for (let i = 0; i < bulkCount; i++) {
      const aliasEmail = `${cleanLocal}+vfs${startNum + i}@${domain}`;
      const password = generateSecurePassword();
      const { error } = await supabase.from("vfs_accounts").insert({
        email: aliasEmail,
        password,
        phone: bulkPhone,
        registration_status: "pending",
        status: "active",
        imap_host: "imap.gmail.com",
        imap_password: bulkImapPassword || null,
      } as any);
      if (!error) created++;
    }

    if (created > 0) {
      toast.success(`${created} Gmail alias hesabı oluşturuldu! Bot sırayla kayıt yapacak.`);
    } else {
      toast.error("Hesap oluşturulamadı");
    }
    setBulkCreating(false);
  };

  const submitManualOtp = async (id: string) => {
    const code = smsOtpInputs[id]?.trim();
    if (!code) { toast.error("OTP kodu girin"); return; }
    const { error } = await supabase
      .from("vfs_accounts")
      .update({ manual_otp: code } as any)
      .eq("id", id);
    if (error) {
      toast.error("OTP gönderilemedi: " + error.message);
    } else {
      toast.success("OTP kodu gönderildi, bot kullanacak");
      setSmsOtpInputs((prev) => ({ ...prev, [id]: "" }));
    }
  };

  const submitRegOtp = async (id: string) => {
    const code = regOtpInputs[id]?.trim();
    if (!code) { toast.error("Doğrulama kodu girin"); return; }
    const { error } = await supabase
      .from("vfs_accounts")
      .update({ registration_otp: code } as any)
      .eq("id", id);
    if (error) {
      toast.error("Kod gönderilemedi: " + error.message);
    } else {
      toast.success("Doğrulama kodu gönderildi");
      setRegOtpInputs((prev) => ({ ...prev, [id]: "" }));
    }
  };

  const reactivateAccount = async (id: string) => {
    await supabase
      .from("vfs_accounts")
      .update({ status: "active", fail_count: 0, banned_until: null })
      .eq("id", id);
    toast.success("Hesap tekrar aktif edildi");
  };

  const approveCaptchaManual = async (id: string) => {
    const { error } = await supabase
      .from("vfs_accounts")
      .update({ captcha_manual_approved: true } as any)
      .eq("id", id);
    if (error) {
      toast.error("Onay gönderilemedi: " + error.message);
    } else {
      toast.success("Manuel devralma onayı gönderildi! Bot devam edecek.");
    }
  };

  const toggleBooking = async (id: string, enabled: boolean) => {
    const { error } = await supabase
      .from("vfs_accounts")
      .update({ booking_enabled: enabled } as any)
      .eq("id", id);
    if (error) toast.error("Güncelleme hatası: " + error.message);
    else toast.success(enabled ? "Hesap aktif edildi" : "Hesap pasif edildi");
  };

  const saveImapSettings = async (id: string) => {
    const imap = editingImap[id];
    if (!imap) return;
    const { error } = await supabase
      .from("vfs_accounts")
      .update({ imap_host: imap.host || null, imap_password: imap.password || null } as any)
      .eq("id", id);
    if (error) toast.error("IMAP kayıt hatası: " + error.message);
    else {
      toast.success("IMAP ayarları kaydedildi");
      setEditingImap((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const togglePassword = (id: string) => {
    setShowPasswords((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const requestManualBrowser = async () => {
    setManualBrowserLoading(true);
    try {
      const { error } = await supabase.functions.invoke("bot-api", {
        body: { action: "request_manual_browser" },
      });
      if (error) throw error;
      toast.success("Manuel tarayıcı açma isteği gönderildi! Bot yeni IP ile VFS sayfasını açacak.");
    } catch (err: any) {
      toast.error("İstek gönderilemedi: " + (err?.message || "Bilinmeyen hata"));
    } finally {
      setManualBrowserLoading(false);
    }
  };

  const statusBadge = (account: VfsAccount) => {
    if (account.registration_status === "pending") {
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Kayıt Bekliyor</Badge>;
    }
    if (account.registration_status === "email_otp" || account.registration_status === "sms_otp") {
      return <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20"><MessageSquare className="w-3 h-3 mr-1 animate-pulse" /> {account.registration_otp_type === "email" ? "Email" : "SMS"} Doğrulama</Badge>;
    }
    if (account.registration_status === "failed") {
      return <Badge variant="destructive">Kayıt Başarısız</Badge>;
    }
    if (account.status === "active") {
      return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><UserCheck className="w-3 h-3 mr-1" /> Aktif</Badge>;
    }
    if (account.status === "banned") {
      return <Badge variant="destructive"><Ban className="w-3 h-3 mr-1" /> Banlı</Badge>;
    }
    if (account.status === "cooldown") {
      const until = account.banned_until ? new Date(account.banned_until).toLocaleString("tr-TR") : "";
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="w-3 h-3 mr-1" /> Bekleme ({until})</Badge>;
    }
    return <Badge variant="secondary">{account.status}</Badge>;
  };

  const isRegistering = (acc: VfsAccount) =>
    acc.registration_status && !["none", "completed", "failed"].includes(acc.registration_status);

  return (
    <div className="space-y-4">
      <h2 className="section-title flex items-center gap-2">
        <UserCheck className="w-5 h-5 text-primary" />
        VFS Hesapları
      </h2>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="helper-text flex-1">Bot bu hesapları sırayla kullanır. Yeni hesap kaydı için "Yeni Kayıt" seçin.</p>
        <Button 
          size="sm" 
          variant="outline" 
          onClick={requestManualBrowser} 
          disabled={manualBrowserLoading}
          className="gap-1.5 border-primary/30 hover:bg-primary/10"
        >
          {manualBrowserLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
          Manuel Giriş (Yeni IP)
        </Button>
      </div>

      {/* Add new account */}
      <Card className="p-4 space-y-3">
        <div className="flex gap-2 mb-2">
          <Button
            size="sm"
            variant={addMode === "existing" ? "default" : "outline"}
            onClick={() => setAddMode("existing")}
            className="gap-1"
          >
            <UserCheck className="w-3.5 h-3.5" /> Mevcut Hesap
          </Button>
          <Button
            size="sm"
            variant={addMode === "register" ? "default" : "outline"}
            onClick={() => { setAddMode("register"); if (!newPassword) setNewPassword(generateSecurePassword()); }}
            className="gap-1"
          >
            <UserPlus className="w-3.5 h-3.5" /> Yeni Kayıt
          </Button>
          <Button
            size="sm"
            variant={addMode === "bulk" ? "default" : "outline"}
            onClick={() => setAddMode("bulk")}
            className="gap-1"
          >
            <Users className="w-3.5 h-3.5" /> Toplu Gmail Alias
          </Button>
        </div>

        {addMode === "bulk" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Gmail +alias ile toplu hesap oluşturun. Örn: <code>user@gmail.com</code> → <code>user+vfs1@gmail.com</code>, <code>user+vfs2@gmail.com</code>...
              Tüm mailler aynı Gmail kutusuna düşer.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Gmail Adresi</Label>
                <Input
                  type="email"
                  placeholder="kullanici@gmail.com"
                  value={bulkBaseEmail}
                  onChange={(e) => setBulkBaseEmail(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Telefon Numarası</Label>
                <Input
                  type="tel"
                  placeholder="5xxxxxxxxx"
                  value={bulkPhone}
                  onChange={(e) => {
                    let val = e.target.value.replace(/\D/g, "");
                    val = val.replace(/^90/, "").replace(/^0+/, "");
                    setBulkPhone(val);
                  }}
                  maxLength={10}
                />
              </div>
              <div>
                <Label className="text-xs">Hesap Sayısı</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={bulkCount}
                  onChange={(e) => setBulkCount(parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label className="text-xs">Gmail Uygulama Şifresi (IMAP)</Label>
                <Input
                  type="password"
                  placeholder="xxxx xxxx xxxx xxxx"
                  value={bulkImapPassword}
                  onChange={(e) => setBulkImapPassword(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">OTP otomatik okuma için gerekli</p>
              </div>
            </div>
            <Button onClick={bulkCreateAliasAccounts} disabled={bulkCreating} size="sm" className="gap-1.5">
              {bulkCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              {bulkCreating ? "Oluşturuluyor..." : `${bulkCount} Hesap Oluştur`}
            </Button>
          </div>
        ) : (
        <>
        <div className={`grid grid-cols-1 ${addMode === "register" ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}>
          <div>
            <Label className="text-xs">VFS Email</Label>
            <Input
              type="email"
              placeholder="vfs@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs flex items-center justify-between">
              VFS Şifre
              {addMode === "register" && (
                <button
                  type="button"
                  onClick={() => setNewPassword(generateSecurePassword())}
                  className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  <RefreshCw className="w-3 h-3" /> Otomatik Oluştur
                </button>
              )}
            </Label>
            <Input
              type={newPassword && addMode === "register" ? "text" : "password"}
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => {
                const val = e.target.value.replace(/[^A-Za-z\d$@#!%*?]/g, "").slice(0, 15);
                setNewPassword(val);
              }}
              maxLength={15}
            />
            {newPassword && (() => {
              const err = validateVfsPassword(newPassword);
              return err ? (
                <p className="text-[10px] text-destructive mt-0.5">{err}</p>
              ) : (
                <p className="text-[10px] text-green-600 mt-0.5">✓ Şifre uygun</p>
              );
            })()}
          </div>
          {addMode === "register" && (
            <div>
              <Label className="text-xs">Telefon Numarası</Label>
              <Input
                type="tel"
                placeholder="5xxxxxxxxx"
                value={newPhone}
                onChange={(e) => {
                  let val = e.target.value.replace(/\D/g, "");
                  val = val.replace(/^90/, "").replace(/^0+/, "");
                  setNewPhone(val);
                }}
                maxLength={10}
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Başında 0 olmadan, ör: 5321234567</p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {addMode === "register"
            ? "Bot VFS'te otomatik hesap açacak. Email/SMS doğrulama kodlarını buradan gireceksiniz."
            : "Zaten var olan bir VFS hesabını ekleyin."}
        </p>
        <Button onClick={addAccount} disabled={loading} size="sm" className="gap-1.5">
          {addMode === "register" ? <UserPlus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {addMode === "register" ? "Kayıt Talebi Oluştur" : "Hesap Ekle"}
        </Button>
        </>
        )}
      </Card>

      {/* Account list */}
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Henüz VFS hesabı eklenmedi. Bot çalışması için en az bir hesap gerekli.
        </p>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <Card key={acc.id} className={`p-3 flex flex-col gap-2 ${!acc.booking_enabled ? 'opacity-60' : ''}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={acc.booking_enabled}
                    onCheckedChange={(v) => toggleBooking(acc.id, v)}
                    className="data-[state=checked]:bg-emerald-500"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm truncate">{acc.email}</span>
                    {statusBadge(acc)}
                    {acc.imap_password && (
                      <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">📧 IMAP</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground font-mono">
                      {showPasswords[acc.id] ? acc.password : "••••••••"}
                    </span>
                    <button onClick={() => togglePassword(acc.id)} className="text-muted-foreground hover:text-foreground">
                      {showPasswords[acc.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    {acc.phone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 ml-2">
                        <Phone className="w-3 h-3" /> {acc.phone}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {acc.status !== "active" && !isRegistering(acc) && (
                    <Button size="sm" variant="outline" onClick={() => reactivateAccount(acc.id)} className="gap-1">
                      <UserCheck className="w-3.5 h-3.5" /> Aktif Et
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => deleteAccount(acc.id)} className="text-destructive hover:text-destructive gap-1">
                    <Trash2 className="w-3.5 h-3.5" /> Sil
                  </Button>
                </div>
              </div>

              {/* CAPTCHA Manuel Devral */}
              {acc.captcha_waiting_at && !acc.captcha_manual_approved && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3 animate-pulse">
                  <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-red-700 dark:text-red-400">CAPTCHA'da takıldı — Manuel devralma bekleniyor!</span>
                    <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">
                      Bot CAPTCHA'yı çözemedi. Onay verirsen zorla devam edecek.
                      <span className="ml-1 text-muted-foreground">({new Date(acc.captcha_waiting_at).toLocaleTimeString("tr-TR")})</span>
                    </p>
                  </div>
                  <Button size="sm" variant="default" className="gap-1.5 bg-red-600 hover:bg-red-700 text-white shrink-0" onClick={() => approveCaptchaManual(acc.id)}>
                    <CheckCircle2 className="w-4 h-4" /> Devam Et Onayla
                  </Button>
                </div>
              )}
              {acc.captcha_waiting_at && acc.captcha_manual_approved && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Manuel devralma onayı gönderildi, bot devam ediyor...
                </span>
              )}

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
                    type="text"
                    placeholder="Kodu girin"
                    maxLength={8}
                    className="h-7 w-24 text-xs font-mono"
                    value={regOtpInputs[acc.id] || ""}
                    onChange={(e) => setRegOtpInputs((prev) => ({ ...prev, [acc.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && submitRegOtp(acc.id)}
                  />
                  <Button size="sm" variant="default" className="h-7 px-2 gap-1" onClick={() => submitRegOtp(acc.id)}>
                    <Send className="w-3 h-3" /> Gönder
                  </Button>
                </div>
              )}
              {isRegistering(acc) && acc.registration_otp && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Kod gönderildi: {acc.registration_otp}
                </span>
              )}

              {/* Login OTP input — iDATA tarzı belirgin kutu */}
              {!isRegistering(acc) && acc.otp_requested_at && !acc.manual_otp && (
                <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 animate-pulse">
                  <MessageSquare className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Giriş OTP kodu bekleniyor!</span>
                    <p className="text-[10px] text-amber-600/70 dark:text-amber-400/70">
                      E-posta veya SMS ile gelen kodu girin
                      {acc.otp_requested_at && (
                        <span className="ml-1">({new Date(acc.otp_requested_at).toLocaleTimeString("tr-TR")})</span>
                      )}
                    </p>
                  </div>
                  <Input
                    type="text"
                    placeholder="OTP kodu"
                    maxLength={8}
                    className="h-7 w-24 text-xs font-mono"
                    value={smsOtpInputs[acc.id] || ""}
                    onChange={(e) => setSmsOtpInputs((prev) => ({ ...prev, [acc.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && submitManualOtp(acc.id)}
                  />
                  <Button size="sm" variant="default" className="h-7 px-2 gap-1" onClick={() => submitManualOtp(acc.id)}>
                    <Send className="w-3 h-3" /> Gönder
                  </Button>
                </div>
              )}
              {!isRegistering(acc) && acc.manual_otp && (
                <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-xs font-medium text-emerald-600">OTP gönderildi: <span className="font-mono">{acc.manual_otp}</span></span>
                </div>
              )}

              {/* IMAP OTP Ayarları */}
              <div className="border-t pt-2 mt-1">
                {editingImap[acc.id] ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <Label className="text-[10px]">IMAP Host</Label>
                      <Input
                        className="h-7 w-40 text-xs"
                        placeholder="imap.gmail.com"
                        value={editingImap[acc.id].host}
                        onChange={(e) => setEditingImap((prev) => ({ ...prev, [acc.id]: { ...prev[acc.id], host: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">IMAP Şifre (App Password)</Label>
                      <Input
                        className="h-7 w-40 text-xs"
                        type="password"
                        placeholder="uygulama şifresi"
                        value={editingImap[acc.id].password}
                        onChange={(e) => setEditingImap((prev) => ({ ...prev, [acc.id]: { ...prev[acc.id], password: e.target.value } }))}
                      />
                    </div>
                    <Button size="sm" className="h-7 gap-1" onClick={() => saveImapSettings(acc.id)}>
                      <CheckCircle2 className="w-3 h-3" /> Kaydet
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditingImap((prev) => { const n = { ...prev }; delete n[acc.id]; return n; })}>
                      İptal
                    </Button>
                  </div>
                ) : (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    onClick={() => setEditingImap((prev) => ({
                      ...prev,
                      [acc.id]: { host: acc.imap_host || "imap.gmail.com", password: acc.imap_password || "" }
                    }))}
                  >
                    <Mail className="w-3 h-3" />
                    {acc.imap_password ? "📧 IMAP ayarlandı — düzenle" : "📧 IMAP OTP ekle (otomatik kod okuma)"}
                  </button>
                )}
              </div>

              {acc.fail_count > 0 && (
                <span className="text-xs text-destructive">Başarısız giriş: {acc.fail_count}</span>
              )}
              {acc.last_used_at && (
                <span className="text-xs text-muted-foreground">
                  Son kullanım: {new Date(acc.last_used_at).toLocaleString("tr-TR")}
                </span>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
