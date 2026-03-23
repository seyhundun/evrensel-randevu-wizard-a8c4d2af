import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Trash2, Play, ExternalLink, RefreshCw, Eye, EyeOff,
  Link2, Loader2, CheckCircle2, AlertCircle, Brain, History,
  Maximize2, Clock, Mail
} from "lucide-react";
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

interface Analysis {
  id: string;
  url: string;
  page_title: string | null;
  ai_answer: string | null;
  status: string;
  created_at: string;
}

export default function QuizBotPanel() {
  const [accounts, setAccounts] = useState<QuizAccount[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [urls, setUrls] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
    loadAnalyses();
    const ch = supabase
      .channel("quiz-analyses-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "link_analyses" }, () => loadAnalyses())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function fetchAccounts() {
    const { data } = await supabase.from("quiz_accounts").select("*").order("created_at", { ascending: false });
    if (data) setAccounts(data);
  }

  async function loadAnalyses() {
    const { data } = await supabase
      .from("link_analyses")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setAnalyses(data as unknown as Analysis[]);
  }

  async function addAccount() {
    if (!newEmail || !newPassword) {
      toast.error("Email ve şifre gerekli");
      return;
    }
    const { error } = await supabase.from("quiz_accounts").insert({ email: newEmail, password: newPassword, platform: "email" });
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

  const startAnalysis = async (mode: "analyze" | "quiz" = "analyze") => {
    const urlList = urls.split("\n").map(u => u.trim()).filter(u => u.length > 0);
    if (urlList.length === 0) { toast.error("En az bir URL girin"); return; }
    setProcessing(true);
    for (const url of urlList) {
      const status = mode === "quiz" ? "quiz_pending" : "scraping";
      const { data: record, error: insertErr } = await supabase
        .from("link_analyses")
        .insert({ url, status } as any)
        .select()
        .single();
      if (insertErr) { toast.error(`Kayıt hatası: ${insertErr.message}`); continue; }
      if (mode === "analyze") {
        supabase.functions.invoke("analyze-link", {
          body: { url, analysisId: (record as any).id },
        }).then(({ error }) => {
          if (error) toast.error(`Hata (${url}): ${error.message}`);
        });
      }
      if (urlList.length > 1) await new Promise(r => setTimeout(r, 1500));
    }
    setUrls("");
    setProcessing(false);
    toast.success(mode === "quiz" ? `${urlList.length} link quiz kuyruğuna eklendi` : `${urlList.length} link analiz ediliyor...`);
  };

  const deleteAnalysis = async (id: string) => {
    await supabase.from("link_analyses").delete().eq("id", id);
  };

  const clearAll = async () => {
    await supabase.from("link_analyses").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    toast.info("Tüm geçmiş temizlendi");
  };

  const openInNewTab = (a: Analysis) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${a.page_title || a.url}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#222;background:#fafafa}h1{font-size:1.3rem;color:#1a1a2e;border-bottom:2px solid #e0e0e0;padding-bottom:12px}a{color:#2563eb}.meta{color:#888;font-size:0.85rem;margin-bottom:20px}.answer{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;white-space:pre-wrap;font-size:0.95rem;box-shadow:0 1px 3px rgba(0,0,0,0.06)}</style></head><body><h1>🧠 AI Analiz Sonucu</h1><p class="meta">Kaynak: <a href="${a.url}" target="_blank">${a.url}</a><br>${new Date(a.created_at).toLocaleString("tr-TR")}</p><div class="answer">${a.ai_answer || "Cevap bulunamadı"}</div></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending": case "scraping":
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Çekiliyor</Badge>;
      case "analyzing":
        return <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 gap-1"><Brain className="w-3 h-3 animate-pulse" /> Analiz</Badge>;
      case "completed":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1"><CheckCircle2 className="w-3 h-3" /> Tamamlandı</Badge>;
      case "quiz_pending":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1"><Clock className="w-3 h-3 animate-pulse" /> Bot Bekliyor</Badge>;
      case "quiz_running":
        return <Badge className="bg-indigo-500/10 text-indigo-600 border-indigo-500/20 gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Bot Çözüyor</Badge>;
      case "quiz_done":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1"><CheckCircle2 className="w-3 h-3" /> Quiz Çözüldü</Badge>;
      case "error":
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" /> Hata</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Link Analiz & Quiz Input */}
      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          Link Analiz & Quiz Çöz
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link2 className="w-3.5 h-3.5" />
          Analiz edilecek veya quiz çözülecek linkleri girin (her satıra bir link)
        </div>
        <Textarea
          placeholder={"https://example.com/soru1\nhttps://example.com/soru2"}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={3}
          className="text-sm font-mono"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => startAnalysis("analyze")} disabled={processing || !urls.trim()} size="sm" className="gap-1.5">
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            {processing ? "İşleniyor..." : "Analiz Et"}
          </Button>
          <Button onClick={() => startAnalysis("quiz")} disabled={processing || !urls.trim()} size="sm" variant="secondary" className="gap-1.5">
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Quiz Çöz (Bot)
          </Button>
          {analyses.length > 0 && (
            <Button onClick={clearAll} variant="ghost" size="sm" className="gap-1 text-muted-foreground text-xs">
              <Trash2 className="w-3.5 h-3.5" /> Geçmişi Temizle
            </Button>
          )}
        </div>
      </Card>

      {/* Login Hesapları (Email/Şifre) */}
      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" />
          Giriş Hesapları (Email / Şifre)
        </h2>
        <div className="flex gap-2">
          <Input placeholder="Email adresi" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="flex-1" />
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
                  {acc.fail_count > 0 && (
                    <span className="text-[10px] text-destructive">({acc.fail_count} hata)</span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteAccount(acc.id)} className="h-6 w-6 p-0 text-destructive">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Analiz Geçmişi */}
      {analyses.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">Analiz Geçmişi ({analyses.length})</span>
          </div>
          <ScrollArea className="max-h-[500px]">
            <div className="divide-y divide-border">
              {analyses.map((a) => (
                <div key={a.id} className="p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {statusBadge(a.status)}
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {new Date(a.created_at).toLocaleString("tr-TR")}
                        </span>
                      </div>
                      <a href={a.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline truncate max-w-[400px] flex items-center gap-1">
                        {a.page_title || a.url}
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                      {a.status === "completed" && a.ai_answer && (
                        <div className="mt-2">
                          <div className="flex items-center gap-3">
                            <button onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                              className="text-[11px] text-primary hover:underline">
                              {expandedId === a.id ? "Cevabı Gizle ▲" : "Cevabı Göster ▼"}
                            </button>
                            <button onClick={() => openInNewTab(a)}
                              className="text-[11px] text-primary hover:underline flex items-center gap-1">
                              <Maximize2 className="w-3 h-3" /> Yeni Sekmede Aç
                            </button>
                          </div>
                          {expandedId === a.id && (
                            <div className="mt-2 p-3 rounded-lg bg-muted/50 text-xs whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                              {a.ai_answer}
                            </div>
                          )}
                        </div>
                      )}
                      {a.status === "error" && a.ai_answer && (
                        <p className="text-xs text-destructive mt-1">{a.ai_answer}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground"
                      onClick={() => deleteAnalysis(a.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
