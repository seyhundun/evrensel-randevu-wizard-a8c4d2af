import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Link2, Play, Loader2, CheckCircle2, AlertCircle, Trash2,
  Plus, Clock, ExternalLink, Brain, History
} from "lucide-react";

interface Analysis {
  id: string;
  url: string;
  page_title: string | null;
  ai_answer: string | null;
  status: string;
  created_at: string;
}

export default function LinkAnalyzer() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [urls, setUrls] = useState("");
  const [processing, setProcessing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadAnalyses();
    const ch = supabase
      .channel("link-analyses-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "link_analyses" }, () => loadAnalyses())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const loadAnalyses = async () => {
    const { data } = await supabase
      .from("link_analyses")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setAnalyses(data as unknown as Analysis[]);
  };

  const startAnalysis = async () => {
    const urlList = urls
      .split("\n")
      .map(u => u.trim())
      .filter(u => u.length > 0);

    if (urlList.length === 0) {
      toast.error("En az bir URL girin");
      return;
    }

    setProcessing(true);

    for (const url of urlList) {
      // Create DB record first
      const { data: record, error: insertErr } = await supabase
        .from("link_analyses")
        .insert({ url, status: "scraping" } as any)
        .select()
        .single();

      if (insertErr) {
        toast.error(`Kayıt hatası: ${insertErr.message}`);
        continue;
      }

      // Fire and forget - the edge function will update the record
      supabase.functions.invoke("analyze-link", {
        body: { url, analysisId: (record as any).id },
      }).then(({ error }) => {
        if (error) {
          console.error("Analysis error for", url, error);
          toast.error(`Hata (${url}): ${error.message}`);
        }
      });

      // Small delay between requests
      if (urlList.length > 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    setUrls("");
    setProcessing(false);
    toast.success(`${urlList.length} link analiz ediliyor...`);
  };

  const deleteAnalysis = async (id: string) => {
    await supabase.from("link_analyses").delete().eq("id", id);
  };

  const clearAll = async () => {
    await supabase.from("link_analyses").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    toast.info("Tüm geçmiş temizlendi");
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
      case "scraping":
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Çekiliyor</Badge>;
      case "analyzing":
        return <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 gap-1"><Brain className="w-3 h-3 animate-pulse" /> Analiz</Badge>;
      case "completed":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1"><CheckCircle2 className="w-3 h-3" /> Tamamlandı</Badge>;
      case "error":
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" /> Hata</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Brain className="w-5 h-5 text-primary" />
        Link Analiz & AI Cevap
      </h2>

      {/* Input Area */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link2 className="w-3.5 h-3.5" />
          Analiz edilecek linkleri girin (her satıra bir link)
        </div>
        <Textarea
          placeholder={"https://example.com/soru1\nhttps://example.com/soru2"}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={3}
          className="text-sm font-mono"
        />
        <div className="flex items-center gap-2">
          <Button
            onClick={startAnalysis}
            disabled={processing || !urls.trim()}
            size="sm"
            className="gap-1.5"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {processing ? "İşleniyor..." : "Analiz Et"}
          </Button>
          {analyses.length > 0 && (
            <Button onClick={clearAll} variant="ghost" size="sm" className="gap-1 text-muted-foreground text-xs">
              <Trash2 className="w-3.5 h-3.5" /> Geçmişi Temizle
            </Button>
          )}
        </div>
      </Card>

      {/* Results */}
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
                      <div className="flex items-center gap-1.5">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline truncate max-w-[400px] flex items-center gap-1"
                        >
                          {a.page_title || a.url}
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      </div>

                      {a.status === "completed" && a.ai_answer && (
                        <div className="mt-2">
                          <button
                            onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                            className="text-[11px] text-primary hover:underline"
                          >
                            {expandedId === a.id ? "Cevabı Gizle ▲" : "Cevabı Göster ▼"}
                          </button>
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

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground"
                      onClick={() => deleteAnalysis(a.id)}
                    >
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
