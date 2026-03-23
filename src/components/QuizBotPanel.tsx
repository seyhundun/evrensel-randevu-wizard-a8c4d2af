import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Play, ExternalLink, RefreshCw, Eye, EyeOff } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

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

type LinkAnalysis = {
  id: string;
  url: string;
  status: string;
  page_title: string | null;
  ai_answer: string | null;
  created_at: string;
};

export default function QuizBotPanel() {
  const [accounts, setAccounts] = useState<QuizAccount[]>([]);
  const [analyses, setAnalyses] = useState<LinkAnalysis[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [quizUrl, setQuizUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchAccounts();
    fetchAnalyses();
    const interval = setInterval(fetchAnalyses, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchAccounts() {
    const { data } = await supabase.from("quiz_accounts").select("*").order("created_at", { ascending: false });
    if (data) setAccounts(data);
  }

  async function fetchAnalyses() {
    const { data } = await supabase
      .from("link_analyses")
      .select("*")
      .in("status", ["quiz_pending", "quiz_running", "quiz_done", "completed", "pending", "analyzing", "error"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setAnalyses(data);
  }

  async function addAccount() {
    if (!newEmail || !newPassword) {
      toast.error("Email ve şifre gerekli");
      return;
    }
    const { error } = await supabase.from("quiz_accounts").insert({ email: newEmail, password: newPassword });
    if (error) {
      toast.error("Hesap eklenemedi: " + error.message);
    } else {
      toast.success("Hesap eklendi");
      setNewEmail("");
      setNewPassword("");
      fetchAccounts();
    }
  }

  async function deleteAccount(id: string) {
    await supabase.from("quiz_accounts").delete().eq("id", id);
    toast.success("Hesap silindi");
    fetchAccounts();
  }

  async function startQuiz() {
    if (!quizUrl) {
      toast.error("Quiz URL gerekli");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from("link_analyses").insert({
        url: quizUrl,
        status: "quiz_pending",
      });
      if (error) throw error;
      toast.success("Quiz görevi oluşturuldu - bot alacak");
      setQuizUrl("");
      fetchAnalyses();
    } catch (err: any) {
      toast.error("Hata: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function analyzeOnly() {
    if (!quizUrl) {
      toast.error("URL gerekli");
      return;
    }
    setLoading(true);
    try {
      const { data: inserted, error: insertErr } = await supabase
        .from("link_analyses")
        .insert({ url: quizUrl, status: "pending" })
        .select()
        .single();
      if (insertErr) throw insertErr;

      const { data, error } = await supabase.functions.invoke("analyze-link", {
        body: { url: quizUrl, analysisId: inserted.id, mode: "bot" },
      });
      if (error) throw error;
      toast.success("Analiz tamamlandı");
      setQuizUrl("");
      fetchAnalyses();
    } catch (err: any) {
      toast.error("Hata: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function getStatusBadge(status: string) {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      quiz_pending: { label: "Bot Bekliyor", variant: "outline" },
      quiz_running: { label: "Bot Çözüyor", variant: "default" },
      quiz_done: { label: "Quiz Çözüldü", variant: "secondary" },
      completed: { label: "Analiz Tamam", variant: "secondary" },
      pending: { label: "Bekliyor", variant: "outline" },
      analyzing: { label: "Analiz Ediliyor", variant: "default" },
      error: { label: "Hata", variant: "destructive" },
    };
    const info = map[status] || { label: status, variant: "outline" as const };
    return <Badge variant={info.variant}>{info.label}</Badge>;
  }

  function openAnswerInTab(analysis: LinkAnalysis) {
    if (!analysis.ai_answer) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${analysis.page_title || analysis.url}</title>
    <style>body{font-family:system-ui;max-width:800px;margin:40px auto;padding:20px;line-height:1.6;background:#0a0a0a;color:#e5e5e5}
    pre{background:#1a1a2e;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px}
    code{background:#1a1a2e;padding:2px 6px;border-radius:4px;font-size:13px}
    h1,h2,h3{color:#60a5fa}</style></head>
    <body><h1>${analysis.page_title || "Quiz Analizi"}</h1><p style="color:#888">${analysis.url}</p><hr style="border-color:#333">
    <pre>${analysis.ai_answer}</pre></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  return (
    <div className="space-y-4">
      {/* Quiz URL Input */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">🧩 Quiz / Anket Çöz</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Quiz/anket URL yapıştırın..."
              value={quizUrl}
              onChange={(e) => setQuizUrl(e.target.value)}
              className="flex-1"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={startQuiz} disabled={loading} className="gap-1.5" size="sm">
              <Play className="w-3.5 h-3.5" />
              Quiz Çöz (Bot)
            </Button>
            <Button onClick={analyzeOnly} disabled={loading} variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              Sadece Analiz Et
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Google Accounts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">🔑 Google Hesapları</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Google email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="flex-1" />
            <Input placeholder="Şifre" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="flex-1" />
            <Button onClick={addAccount} size="sm" variant="outline">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Henüz hesap eklenmemiş</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc) => (
                <div key={acc.id} className="flex items-center justify-between bg-secondary/30 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono truncate">{acc.email}</span>
                    <button
                      onClick={() => setShowPasswords((p) => ({ ...p, [acc.id]: !p[acc.id] }))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {showPasswords[acc.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                    {showPasswords[acc.id] && <span className="text-xs text-muted-foreground font-mono">{acc.password}</span>}
                    <Badge variant={acc.status === "active" ? "secondary" : "destructive"} className="text-[10px]">
                      {acc.status}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteAccount(acc.id)} className="h-6 w-6 p-0 text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Analyses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">📋 İşlem Geçmişi</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            {analyses.length === 0 ? (
              <p className="text-xs text-muted-foreground">Henüz işlem yok</p>
            ) : (
              <div className="space-y-2">
                {analyses.map((a) => (
                  <div key={a.id} className="flex items-center justify-between bg-secondary/20 rounded-md px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono truncate">{a.url}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {getStatusBadge(a.status)}
                        {a.page_title && <span className="text-[10px] text-muted-foreground truncate">{a.page_title}</span>}
                      </div>
                    </div>
                    {a.ai_answer && (
                      <Button variant="ghost" size="sm" onClick={() => openAnswerInTab(a)} className="h-6 w-6 p-0">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
