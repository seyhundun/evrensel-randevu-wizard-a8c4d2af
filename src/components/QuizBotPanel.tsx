import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus, Trash2, Play, Eye, EyeOff,
  Link2, Loader2, CheckCircle2, AlertCircle,
  Clock, Mail, Power, Square, Globe, RotateCcw
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import QuizTrackingLogs from "@/components/QuizTrackingLogs";

type QuizAccount = {
  id: string;
  email: string;
  password: string;
  platform: string;
  status: string;
  notes: string | null;
  last_used_at: string | null;
  fail_count: number;
};

interface QuizLink {
  id: string;
  url: string;
  status: string;
  created_at: string;
}

export default function QuizBotPanel() {
  const [accounts, setAccounts] = useState<QuizAccount[]>([]);
  const [quizLinks, setQuizLinks] = useState<QuizLink[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchAccounts();
    loadQuizLinks();
    const ch = supabase
      .channel("quiz-panel-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "link_analyses" }, () => loadQuizLinks())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function fetchAccounts() {
    const { data } = await supabase.from("quiz_accounts").select("*").order("created_at", { ascending: false });
    if (data) setAccounts(data);
  }

  async function loadQuizLinks() {
    const { data } = await supabase
      .from("link_analyses")
      .select("id, url, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setQuizLinks(data as QuizLink[]);
  }

  async function addAccount() {
    if (!newEmail || !newPassword) { toast.error("Email ve şifre gerekli"); return; }
    const { error } = await supabase.from("quiz_accounts").insert({ email: newEmail, password: newPassword, platform: "email" });
    if (error) { toast.error("Hata: " + error.message); } else {
      toast.success("Hesap eklendi");
      setNewEmail(""); setNewPassword("");
      fetchAccounts();
    }
  }

  async function deleteAccount(id: string) {
    await supabase.from("quiz_accounts").delete().eq("id", id);
    toast.success("Hesap silindi");
    fetchAccounts();
  }

  async function addQuizLink() {
    const url = newUrl.trim();
    if (!url) { toast.error("URL girin"); return; }
    const { error } = await supabase.from("link_analyses").insert({ url, status: "idle" } as any);
    if (error) { toast.error("Hata: " + error.message); } else {
      toast.success("Link eklendi");
      setNewUrl("");
    }
  }

  async function deleteQuizLink(id: string) {
    setQuizLinks(prev => prev.filter(l => l.id !== id));
    await supabase.from("link_analyses").delete().eq("id", id);
    toast.success("Link silindi");
  }

  async function toggleLinkActive(link: QuizLink) {
    const newStatus = link.status === "idle" || link.status === "quiz_done" || link.status === "error" ? "active" : "idle";
    setQuizLinks(prev => prev.map(l => l.id === link.id ? { ...l, status: newStatus } : l));
    await supabase.from("link_analyses").update({ status: newStatus }).eq("id", link.id);
    toast.success(newStatus === "active" ? "Link aktif" : "Link pasif");
  }

  async function startQuiz(link: QuizLink) {
    setQuizLinks(prev => prev.map(l => l.id === link.id ? { ...l, status: "quiz_pending" } : l));
    await supabase.from("link_analyses").update({ status: "quiz_pending" }).eq("id", link.id);
    toast.success("Quiz başlatıldı: " + link.url.slice(0, 40));
  }

  async function startAllActive() {
    const activeLinks = quizLinks.filter(l => l.status === "active");
    if (activeLinks.length === 0) { toast.error("Aktif link yok"); return; }
    setQuizLinks(prev => prev.map(l => l.status === "active" ? { ...l, status: "quiz_pending" } : l));
    for (const link of activeLinks) {
      await supabase.from("link_analyses").update({ status: "quiz_pending" }).eq("id", link.id);
    }
    toast.success(`${activeLinks.length} link quiz kuyruğuna eklendi`);
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "idle":
        return <Badge variant="secondary" className="text-[10px] gap-1">Pasif</Badge>;
      case "active":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] gap-1"><Power className="w-3 h-3" /> Aktif</Badge>;
      case "quiz_pending":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] gap-1"><Clock className="w-3 h-3 animate-pulse" /> Bekliyor</Badge>;
      case "quiz_running":
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Çalışıyor</Badge>;
      case "quiz_done":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] gap-1"><CheckCircle2 className="w-3 h-3" /> Tamamlandı</Badge>;
      case "error":
        return <Badge variant="destructive" className="text-[10px] gap-1"><AlertCircle className="w-3 h-3" /> Hata</Badge>;
      default:
        return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
    }
  };

  const activeCount = quizLinks.filter(l => l.status === "active").length;
  const runningCount = quizLinks.filter(l => l.status === "quiz_pending" || l.status === "quiz_running").length;

  return (
    <div className="space-y-4">
      {/* Quiz Linkleri */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Quiz Linkleri
          </h2>
          <div className="flex items-center gap-2">
            {activeCount > 0 && (
              <Button onClick={startAllActive} size="sm" className="h-7 text-xs gap-1.5">
                <Play className="w-3.5 h-3.5" />
                Tümünü Başlat ({activeCount})
              </Button>
            )}
          </div>
        </div>

        {/* Yeni link ekle */}
        <div className="flex gap-2">
          <Input
            placeholder="https://www.swagbucks.com/"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addQuizLink()}
            className="flex-1 text-sm font-mono"
          />
          <Button onClick={addQuizLink} size="sm" variant="outline" className="gap-1">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Durum özeti */}
        {quizLinks.length > 0 && (
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{quizLinks.length} link</span>
            <span className="text-emerald-600">{activeCount} aktif</span>
            {runningCount > 0 && <span className="text-blue-600">{runningCount} çalışıyor</span>}
          </div>
        )}

        {/* Link listesi */}
        {quizLinks.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Henüz link eklenmemiş</p>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-1.5">
              {quizLinks.map((link) => (
                <div key={link.id} className="flex items-center gap-2 bg-secondary/30 rounded-md px-3 py-2">
                  {/* Aktif/Pasif toggle */}
                  <Switch
                    checked={link.status === "active" || link.status === "quiz_pending" || link.status === "quiz_running"}
                    onCheckedChange={() => toggleLinkActive(link)}
                    disabled={link.status === "quiz_pending" || link.status === "quiz_running"}
                    className="scale-75"
                  />

                  {/* URL */}
                  <div className="flex-1 min-w-0">
                    <a href={link.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-mono text-foreground hover:text-primary truncate block">
                      {link.url}
                    </a>
                  </div>

                  {/* Status */}
                  {statusBadge(link.status)}

                  {/* Start button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700"
                    onClick={() => startQuiz(link)}
                    disabled={link.status === "quiz_pending" || link.status === "quiz_running"}
                    title="Quiz Başlat"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </Button>

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-destructive"
                    onClick={() => deleteQuizLink(link.id)}
                    disabled={link.status === "quiz_running"}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </Card>

      {/* Login Hesapları */}
      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" />
          Giriş Hesapları
        </h2>
        <div className="flex gap-2">
          <Input placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="flex-1" />
          <Input placeholder="Şifre" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="flex-1" />
          <Button onClick={addAccount} size="sm" variant="outline"><Plus className="w-4 h-4" /></Button>
        </div>
        {accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Henüz hesap eklenmemiş</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between bg-secondary/30 rounded-md px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono truncate">{acc.email}</span>
                  <button onClick={() => setShowPasswords((p) => ({ ...p, [acc.id]: !p[acc.id] }))} className="text-muted-foreground hover:text-foreground">
                    {showPasswords[acc.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                  {showPasswords[acc.id] && <span className="text-xs text-muted-foreground font-mono">{acc.password}</span>}
                  <Badge variant={acc.status === "active" ? "secondary" : "destructive"} className="text-[10px]">{acc.status}</Badge>
                  {acc.fail_count > 0 && <span className="text-[10px] text-destructive">({acc.fail_count} hata)</span>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteAccount(acc.id)} className="h-6 w-6 p-0 text-destructive">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Quiz Bot Logları */}
      <QuizTrackingLogs />
    </div>
  );
}
