import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Eye, EyeOff, UserCircle, Mail, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface AccountInfo {
  id: string;
  email: string;
  password: string;
  status: string;
  last_used_at: string | null;
}

export default function VfsManualTakeover() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const load = async () => {
    const { data } = await supabase
      .from("vfs_accounts")
      .select("id, email, password, status, last_used_at")
      .order("last_used_at", { ascending: false, nullsFirst: false });
    if (data) setAccounts(data);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("vfs-takeover-accounts")
      .on("postgres_changes", { event: "*", schema: "public", table: "vfs_accounts" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} kopyalandı`);
  };

  const activeAccounts = accounts.filter(a => a.status === "active");
  const displayAccounts = activeAccounts.length > 0 ? activeAccounts : accounts.slice(0, 3);

  return (
    <Card className="border-dashed border-primary/30">
      <CardHeader className="py-2.5 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <UserCircle className="w-3.5 h-3.5 text-primary" />
            Manuel Giriş Bilgileri
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={load}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-2.5 space-y-2">
        {displayAccounts.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-2">Hesap bulunamadı</p>
        )}
        {displayAccounts.map((acc) => (
          <div key={acc.id} className="rounded-md border bg-muted/30 p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <Badge variant={acc.status === "active" ? "default" : "secondary"} className="text-[9px] h-4">
                {acc.status}
              </Badge>
            </div>
            {/* Email */}
            <div className="flex items-center gap-1.5 group">
              <Mail className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-mono flex-1 truncate">{acc.email}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => copyToClipboard(acc.email, "E-posta")}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
            {/* Password */}
            <div className="flex items-center gap-1.5 group">
              <KeyRound className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-mono flex-1 truncate">
                {showPasswords[acc.id] ? acc.password : "••••••••"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 opacity-60 hover:opacity-100"
                onClick={() => setShowPasswords(p => ({ ...p, [acc.id]: !p[acc.id] }))}
              >
                {showPasswords[acc.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => copyToClipboard(acc.password, "Şifre")}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ))}
        <p className="text-[9px] text-muted-foreground text-center">
          VNC ekranında alanları tıklayıp bilgileri yapıştırın
        </p>
      </CardContent>
    </Card>
  );
}
