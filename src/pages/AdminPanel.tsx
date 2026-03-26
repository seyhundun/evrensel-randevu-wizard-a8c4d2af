import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Shield, Users, FileText, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface AuthLog {
  id: string;
  user_email: string;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface UserWithRole {
  id: string;
  email: string;
  created_at: string;
  role: string | null;
}

const AdminPanel = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [authLogs, setAuthLogs] = useState<AuthLog[]>([]);
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [activeTab, setActiveTab] = useState<"logs" | "users">("logs");

  // Check admin role
  useEffect(() => {
    if (!session?.user?.id) return;
    const checkAdmin = async () => {
      const { data } = await supabase
        .rpc("has_role", { _user_id: session.user.id, _role: "admin" }) as { data: boolean | null };
      setIsAdmin(data === true);
    };
    checkAdmin();
  }, [session?.user?.id]);

  // Fetch auth logs
  const fetchLogs = async () => {
    const { data } = await supabase
      .from("auth_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data) setAuthLogs(data);
  };

  // Fetch users with roles
  const fetchUsers = async () => {
    // Get users from auth_logs (unique emails) + roles
    const { data: roles } = await supabase.from("user_roles").select("*");
    const { data: logs } = await supabase
      .from("auth_logs")
      .select("user_email, user_id, created_at")
      .order("created_at", { ascending: false });

    // Build unique user list from logs
    const userMap = new Map<string, UserWithRole>();
    if (logs) {
      for (const log of logs) {
        if (!userMap.has(log.user_email)) {
          const role = roles?.find(r => r.user_id === log.user_id);
          userMap.set(log.user_email, {
            id: log.user_id || "",
            email: log.user_email,
            created_at: log.created_at,
            role: role ? String(role.role) : "user",
          });
        }
      }
    }
    setUsers(Array.from(userMap.values()));
  };

  useEffect(() => {
    if (isAdmin) {
      fetchLogs();
      fetchUsers();
    }
  }, [isAdmin]);

  // Create new user via edge function
  const handleCreateUser = async () => {
    if (!newEmail || !newPassword) {
      toast.error("E-posta ve şifre gerekli");
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("create-user", {
        body: { email: newEmail, password: newPassword },
      });
      if (error) throw error;
      toast.success(`Kullanıcı oluşturuldu: ${newEmail}`);
      setNewEmail("");
      setNewPassword("");
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Kullanıcı oluşturulamadı");
    }
  };

  // Delete user via edge function
  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`${email} kullanıcısını silmek istediğinize emin misiniz?`)) return;
    try {
      const { error } = await supabase.functions.invoke("delete-user", {
        body: { user_id: userId },
      });
      if (error) throw error;
      toast.success(`Kullanıcı silindi: ${email}`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Silinemedi");
    }
  };

  // Toggle role
  const handleToggleRole = async (userId: string, currentRole: string | null) => {
    const newRole = currentRole === "admin" ? "user" : "admin";
    try {
      if (newRole === "admin") {
        await supabase.from("user_roles").upsert({ user_id: userId, role: "admin" as any }, { onConflict: "user_id,role" });
      } else {
        await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", "admin" as any);
        await supabase.from("user_roles").upsert({ user_id: userId, role: "user" as any }, { onConflict: "user_id,role" });
      }
      toast.success(`Rol güncellendi: ${newRole}`);
      fetchUsers();
    } catch (err: any) {
      toast.error("Rol güncellenemedi");
    }
  };

  if (loading || isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Yükleniyor...
      </div>
    );
  }

  if (!session || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-[400px]">
          <CardContent className="pt-6 text-center text-destructive">
            <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-semibold text-lg">Erişim Reddedildi</p>
            <p className="text-sm text-muted-foreground mt-1">Bu panele erişim yetkiniz yok.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>
              Ana Sayfa
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Geri
          </Button>
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="text-base font-bold">Yönetim Paneli</h1>
        </div>
        <Badge variant="outline" className="text-xs">
          {session.user.email}
        </Badge>
      </header>

      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
        {/* Tab buttons */}
        <div className="flex gap-2">
          <Button
            variant={activeTab === "logs" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("logs")}
            className="gap-1.5"
          >
            <FileText className="w-3.5 h-3.5" /> Giriş Logları
          </Button>
          <Button
            variant={activeTab === "users" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("users")}
            className="gap-1.5"
          >
            <Users className="w-3.5 h-3.5" /> Kullanıcılar
          </Button>
        </div>

        {/* Logs Tab */}
        {activeTab === "logs" && (
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" /> Giriş Kayıtları
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={fetchLogs}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Zaman</TableHead>
                      <TableHead className="text-xs">E-posta</TableHead>
                      <TableHead className="text-xs">Olay</TableHead>
                      <TableHead className="text-xs">IP</TableHead>
                      <TableHead className="text-xs">Tarayıcı</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {authLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">
                          Henüz giriş kaydı yok
                        </TableCell>
                      </TableRow>
                    ) : (
                      authLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs font-mono whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString("tr-TR")}
                          </TableCell>
                          <TableCell className="text-xs">{log.user_email}</TableCell>
                          <TableCell>
                            <Badge
                              variant={log.event_type === "sign_in" ? "default" : log.event_type === "sign_out" ? "secondary" : "destructive"}
                              className="text-[10px]"
                            >
                              {log.event_type === "sign_in" ? "Giriş" : log.event_type === "sign_out" ? "Çıkış" : log.event_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{log.ip_address || "-"}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{log.user_agent || "-"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="space-y-4">
            {/* Create user */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Yeni Kullanıcı Ekle
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="E-posta"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="text-sm"
                  />
                  <Input
                    placeholder="Şifre"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="text-sm"
                  />
                  <Button size="sm" onClick={handleCreateUser} className="shrink-0">
                    <Plus className="w-3.5 h-3.5 mr-1" /> Ekle
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* User list */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" /> Kullanıcılar
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={fetchUsers}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">E-posta</TableHead>
                      <TableHead className="text-xs">Rol</TableHead>
                      <TableHead className="text-xs">Son Giriş</TableHead>
                      <TableHead className="text-xs text-right">İşlem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id || user.email}>
                        <TableCell className="text-xs">{user.email}</TableCell>
                        <TableCell>
                          <Badge
                            variant={user.role === "admin" ? "default" : "secondary"}
                            className="text-[10px] cursor-pointer"
                            onClick={() => user.id && handleToggleRole(user.id, user.role)}
                          >
                            {user.role === "admin" ? "👑 Admin" : "👤 Kullanıcı"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {new Date(user.created_at).toLocaleString("tr-TR")}
                        </TableCell>
                        <TableCell className="text-right">
                          {user.email !== session.user.email && user.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteUser(user.id, user.email)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;
