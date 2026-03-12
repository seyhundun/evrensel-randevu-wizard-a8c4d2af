import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2, Eye, EyeOff, UserCheck, Ban, Clock, Mail } from "lucide-react";

interface VfsAccount {
  id: string;
  email: string;
  password: string;
  status: string;
  banned_until: string | null;
  last_used_at: string | null;
  fail_count: number;
  notes: string | null;
  imap_host: string | null;
  imap_password: string | null;
}

export default function VfsAccounts() {
  const [accounts, setAccounts] = useState<VfsAccount[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newImapHost, setNewImapHost] = useState("imap.gmail.com");
  const [newImapPassword, setNewImapPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [showImapPasswords, setShowImapPasswords] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    const { data } = await supabase
      .from("vfs_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setAccounts(data as VfsAccount[]);
  };

  const addAccount = async () => {
    if (!newEmail || !newPassword) {
      toast.error("Email ve şifre gerekli");
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("vfs_accounts").insert({
      email: newEmail,
      password: newPassword,
    });
    if (error) {
      toast.error("Hesap eklenemedi: " + error.message);
    } else {
      toast.success("VFS hesabı eklendi");
      setNewEmail("");
      setNewPassword("");
      loadAccounts();
    }
    setLoading(false);
  };

  const deleteAccount = async (id: string) => {
    await supabase.from("vfs_accounts").delete().eq("id", id);
    toast.info("Hesap silindi");
    loadAccounts();
  };

  const reactivateAccount = async (id: string) => {
    await supabase
      .from("vfs_accounts")
      .update({ status: "active", fail_count: 0, banned_until: null })
      .eq("id", id);
    toast.success("Hesap tekrar aktif edildi");
    loadAccounts();
  };

  const togglePassword = (id: string) => {
    setShowPasswords((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const statusBadge = (account: VfsAccount) => {
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

  return (
    <div className="space-y-4">
      <h2 className="section-title flex items-center gap-2">
        <UserCheck className="w-5 h-5 text-primary" />
        VFS Hesapları
      </h2>
      <p className="helper-text">Bot bu hesapları sırayla kullanır. Banlanan hesap otomatik beklemeye alınır.</p>

      {/* Add new account */}
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <Label className="text-xs">VFS Şifre</Label>
            <Input
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
        </div>
        <Button onClick={addAccount} disabled={loading} size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" /> Hesap Ekle
        </Button>
      </Card>

      {/* Account list */}
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Henüz VFS hesabı eklenmedi. Bot çalışması için en az bir hesap gerekli.
        </p>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <Card key={acc.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm truncate">{acc.email}</span>
                  {statusBadge(acc)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground font-mono">
                    {showPasswords[acc.id] ? acc.password : "••••••••"}
                  </span>
                  <button onClick={() => togglePassword(acc.id)} className="text-muted-foreground hover:text-foreground">
                    {showPasswords[acc.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {acc.fail_count > 0 && (
                  <span className="text-xs text-destructive">Başarısız giriş: {acc.fail_count}</span>
                )}
                {acc.last_used_at && (
                  <span className="text-xs text-muted-foreground ml-2">
                    Son kullanım: {new Date(acc.last_used_at).toLocaleString("tr-TR")}
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 shrink-0">
                {acc.status !== "active" && (
                  <Button size="sm" variant="outline" onClick={() => reactivateAccount(acc.id)} className="gap-1">
                    <UserCheck className="w-3.5 h-3.5" /> Aktif Et
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => deleteAccount(acc.id)} className="text-destructive hover:text-destructive gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Sil
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
