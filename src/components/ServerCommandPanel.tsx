import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Send, Loader2, Trash2, GitBranch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ServerCommand {
  id: string;
  command: string;
  output: string | null;
  status: string;
  created_at: string;
  executed_at: string | null;
  target: string;
}

const QUICK_COMMANDS = [
  { label: "PM2 Durum", cmd: "pm2 list" },
  { label: "PM2 Loglar", cmd: "pm2 logs --lines 30 --nostream" },
  { label: "VFS Restart", cmd: "pm2 restart vfs-bot" },
  { label: "iDATA Restart", cmd: "pm2 restart idata-bot" },
  { label: "Tümünü Restart", cmd: "pm2 restart all" },
  { label: "Disk", cmd: "df -h" },
  { label: "RAM", cmd: "free -h" },
  { label: "Uptime", cmd: "uptime" },
];

const REPO_PULL_CMD = "cd ~/vfs-bot && git fetch origin && git reset --hard origin/main && cd bot && npm install && pm2 restart all";

export default function ServerCommandPanel() {
  const [command, setCommand] = useState("");
  const [commands, setCommands] = useState<ServerCommand[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchCommands = async () => {
    const { data } = await supabase
      .from("server_commands")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setCommands(data as ServerCommand[]);
  };

  useEffect(() => {
    fetchCommands();
    const channel = supabase
      .channel("server_commands_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "server_commands" }, () => {
        fetchCommands();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const sendCommand = async (cmd?: string) => {
    const cmdText = (cmd || command).trim();
    if (!cmdText) return;
    setSending(true);
    try {
      const { error } = await supabase.from("server_commands").insert({
        command: cmdText,
        status: "pending",
        target: "vfs",
      } as any);
      if (error) throw error;
      if (!cmd) setCommand("");
      toast.success("Komut gönderildi");
    } catch (err: any) {
      toast.error("Komut gönderilemedi: " + err.message);
    } finally {
      setSending(false);
    }
  };

  const clearHistory = async () => {
    await supabase.from("server_commands").delete().neq("status", "pending");
    fetchCommands();
    toast.success("Geçmiş temizlendi");
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 text-[10px]">Bekliyor</Badge>;
      case "running": return <Badge variant="outline" className="text-blue-500 border-blue-500/30 text-[10px]">Çalışıyor</Badge>;
      case "done": return <Badge variant="outline" className="text-green-500 border-green-500/30 text-[10px]">Tamamlandı</Badge>;
      case "error": return <Badge variant="outline" className="text-red-500 border-red-500/30 text-[10px]">Hata</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-500" />
          Sunucu Komut Paneli
          <Button variant="ghost" size="sm" className="ml-auto h-6 text-[10px]" onClick={clearHistory}>
            <Trash2 className="w-3 h-3 mr-1" />
            Temizle
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Güncelle + Quick commands */}
        <div className="flex flex-wrap gap-1">
          <Button
            variant="default"
            size="sm"
            className="h-7 text-[11px] px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
            onClick={() => sendCommand(REPO_PULL_CMD)}
            disabled={sending}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Güncelle
          </Button>
          {QUICK_COMMANDS.map((q) => (
            <Button
              key={q.cmd}
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => sendCommand(q.cmd)}
              disabled={sending}
            >
              {q.label}
            </Button>
          ))}
        </div>

        {/* Command input */}
        <div className="flex gap-2">
          <Input
            placeholder="Komut girin... (örn: pm2 list)"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendCommand()}
            className="font-mono text-xs h-8"
            disabled={sending}
          />
          <Button size="sm" className="h-8 px-3" onClick={() => sendCommand()} disabled={sending || !command.trim()}>
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </Button>
        </div>

        {/* Command history */}
        <ScrollArea className="h-[300px]" ref={scrollRef}>
          <div className="space-y-2">
            {commands.map((cmd) => (
              <div key={cmd.id} className="rounded-lg border border-border/50 bg-muted/30 p-2 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <code className="font-mono text-green-400 text-[11px] flex-1 truncate">$ {cmd.command}</code>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {statusBadge(cmd.status)}
                    <span className="text-[9px] text-muted-foreground tabular-nums">
                      {new Date(cmd.created_at).toLocaleTimeString("tr-TR")}
                    </span>
                  </div>
                </div>
                {cmd.output && (
                  <pre className="font-mono text-[10px] text-muted-foreground whitespace-pre-wrap break-all mt-1 max-h-[200px] overflow-auto bg-background/50 rounded p-1.5">
                    {cmd.output}
                  </pre>
                )}
                {cmd.status === "pending" && (
                  <div className="flex items-center gap-1 text-yellow-500 mt-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span className="text-[10px]">Sunucu tarafından alınması bekleniyor...</span>
                  </div>
                )}
              </div>
            ))}
            {commands.length === 0 && (
              <p className="text-center text-muted-foreground text-xs py-8">Henüz komut gönderilmedi</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
