import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Activity, HeartPulse, ShieldAlert, Ban, CheckCircle2, Clock,
  AlertTriangle, RefreshCw, TrendingUp, TrendingDown, Zap, Users
} from "lucide-react";

interface AccountSummary {
  total: number;
  active: number;
  banned: number;
  cooldown: number;
  registering: number;
  bookingEnabled: number;
  totalFailCount: number;
  avgFailCount: number;
  highFailAccounts: string[];
}

interface ErrorPattern {
  status: string;
  count: number;
  lastSeen: string;
}

export default function AccountHealthPanel({ configId }: { configId: string | null }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const ch1 = supabase
      .channel("health-accounts")
      .on("postgres_changes", { event: "*", schema: "public", table: "vfs_accounts" }, () => loadData())
      .subscribe();
    const ch2 = supabase
      .channel("health-logs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tracking_logs" }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [configId]);

  const loadData = async () => {
    const [accRes, logRes] = await Promise.all([
      supabase.from("vfs_accounts").select("*").order("created_at", { ascending: true }),
      supabase.from("tracking_logs")
        .select("status, message, created_at")
        .in("status", [
          "login_fail", "ip_blocked", "error", "account_banned",
          "account_cooldown", "login_captcha_retry", "cf_blocked",
          "login_success", "checking", "found", "not_found"
        ])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (accRes.data) setAccounts(accRes.data);
    if (logRes.data) setRecentLogs(logRes.data);
    setLoading(false);
  };

  const summary = useMemo<AccountSummary>(() => {
    const total = accounts.length;
    const active = accounts.filter(a => a.status === "active" && (!a.registration_status || ["none", "completed"].includes(a.registration_status))).length;
    const banned = accounts.filter(a => a.status === "banned").length;
    const cooldown = accounts.filter(a => a.status === "cooldown").length;
    const registering = accounts.filter(a => a.registration_status && !["none", "completed", "failed"].includes(a.registration_status)).length;
    const bookingEnabled = accounts.filter(a => a.booking_enabled).length;
    const totalFailCount = accounts.reduce((s, a) => s + (a.fail_count || 0), 0);
    const avgFailCount = total > 0 ? totalFailCount / total : 0;
    const highFailAccounts = accounts.filter(a => a.fail_count >= 3).map(a => a.email);
    return { total, active, banned, cooldown, registering, bookingEnabled, totalFailCount, avgFailCount, highFailAccounts };
  }, [accounts]);

  const errorPatterns = useMemo<ErrorPattern[]>(() => {
    const errorStatuses = ["login_fail", "ip_blocked", "error", "account_banned", "account_cooldown", "login_captcha_retry", "cf_blocked"];
    const map = new Map<string, { count: number; lastSeen: string }>();
    recentLogs.filter(l => errorStatuses.includes(l.status)).forEach(l => {
      const existing = map.get(l.status);
      if (existing) {
        existing.count++;
      } else {
        map.set(l.status, { count: 1, lastSeen: l.created_at });
      }
    });
    return Array.from(map.entries())
      .map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [recentLogs]);

  const successRate = useMemo(() => {
    const successes = recentLogs.filter(l => ["login_success", "checking", "found", "not_found"].includes(l.status)).length;
    const failures = recentLogs.filter(l => ["login_fail", "error", "account_banned"].includes(l.status)).length;
    const total = successes + failures;
    return total > 0 ? Math.round((successes / total) * 100) : 100;
  }, [recentLogs]);

  const healthScore = useMemo(() => {
    let score = 100;
    // Penalize for banned accounts
    if (summary.total > 0) {
      score -= (summary.banned / summary.total) * 40;
      score -= (summary.cooldown / summary.total) * 15;
    }
    // Penalize for high fail counts
    if (summary.avgFailCount > 2) score -= 15;
    if (summary.avgFailCount > 5) score -= 15;
    // Penalize for low success rate
    if (successRate < 80) score -= 15;
    if (successRate < 50) score -= 15;
    // No active booking accounts
    if (summary.bookingEnabled === 0 && summary.total > 0) score -= 20;
    return Math.max(0, Math.round(score));
  }, [summary, successRate]);

  const healthColor = healthScore >= 80 ? "text-emerald-500" : healthScore >= 50 ? "text-amber-500" : "text-destructive";
  const healthBg = healthScore >= 80 ? "bg-emerald-500" : healthScore >= 50 ? "bg-amber-500" : "bg-destructive";

  const resetAllFailCounts = async () => {
    const { error } = await supabase.from("vfs_accounts").update({ fail_count: 0 }).gt("fail_count", 0);
    if (error) toast.error("Hata: " + error.message);
    else toast.success("Tüm hata sayaçları sıfırlandı");
  };

  const reactivateAllBanned = async () => {
    const { error } = await supabase.from("vfs_accounts")
      .update({ status: "active", fail_count: 0, banned_until: null })
      .eq("status", "banned");
    if (error) toast.error("Hata: " + error.message);
    else toast.success("Tüm banlı hesaplar aktif edildi");
  };

  const errorLabel: Record<string, string> = {
    login_fail: "Giriş Başarısız",
    ip_blocked: "IP Engeli",
    error: "Genel Hata",
    account_banned: "Hesap Banı",
    account_cooldown: "Cooldown",
    login_captcha_retry: "CAPTCHA Retry",
    cf_blocked: "Cloudflare Engeli",
  };

  if (loading) return null;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-primary" />
          Sistem Sağlığı
        </h3>
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-bold tabular-nums ${healthColor}`}>{healthScore}</span>
          <span className="text-xs text-muted-foreground">/100</span>
        </div>
      </div>

      {/* Health Progress */}
      <Progress value={healthScore} className={`h-2 [&>[role=progressbar]]:${healthBg}`} />

      {/* Account Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-border p-2.5 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-lg font-bold tabular-nums">{summary.total}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Toplam</p>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-lg font-bold tabular-nums text-emerald-600">{summary.active}</span>
          </div>
          <p className="text-[10px] text-emerald-600/70">Aktif</p>
        </div>
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Ban className="w-3.5 h-3.5 text-destructive" />
            <span className="text-lg font-bold tabular-nums text-destructive">{summary.banned}</span>
          </div>
          <p className="text-[10px] text-destructive/70">Banlı</p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-lg font-bold tabular-nums text-amber-600">{summary.cooldown}</span>
          </div>
          <p className="text-[10px] text-amber-600/70">Bekleme</p>
        </div>
      </div>

      {/* Success Rate & Error Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Başarı Oranı
            </span>
            <span className={`text-sm font-bold ${successRate >= 80 ? "text-emerald-500" : successRate >= 50 ? "text-amber-500" : "text-destructive"}`}>
              %{successRate}
            </span>
          </div>
          <Progress value={successRate} className="h-1.5" />
          <p className="text-[10px] text-muted-foreground mt-1.5">Son 200 işlem bazında</p>
        </div>

        <div className="rounded-lg border border-border p-3">
          <span className="text-xs font-medium flex items-center gap-1.5 mb-2">
            <Zap className="w-3.5 h-3.5" /> Randevu Havuzu
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold tabular-nums">{summary.bookingEnabled}</span>
            <span className="text-xs text-muted-foreground">/ {summary.total} hesap aktif</span>
          </div>
          {summary.registering > 0 && (
            <p className="text-[10px] text-blue-500 mt-1">{summary.registering} hesap kayıt aşamasında</p>
          )}
        </div>
      </div>

      {/* Error Patterns */}
      {errorPatterns.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Son Hata Dağılımı
          </span>
          <div className="space-y-1">
            {errorPatterns.slice(0, 5).map((ep) => (
              <div key={ep.status} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-muted/50">
                <span className="text-muted-foreground">{errorLabel[ep.status] || ep.status}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{ep.count}×</Badge>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {new Date(ep.lastSeen).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High Fail Accounts Warning */}
      {summary.highFailAccounts.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Yüksek Hata Sayılı Hesaplar ({summary.highFailAccounts.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {summary.highFailAccounts.slice(0, 5).map((email) => (
              <Badge key={email} variant="outline" className="text-[10px] border-amber-500/30 text-amber-600">
                {email.split("@")[0]}
              </Badge>
            ))}
            {summary.highFailAccounts.length > 5 && (
              <Badge variant="outline" className="text-[10px]">+{summary.highFailAccounts.length - 5}</Badge>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        {summary.banned > 0 && (
          <Button size="sm" variant="outline" onClick={reactivateAllBanned} className="gap-1.5 text-xs border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10">
            <RefreshCw className="w-3.5 h-3.5" />
            Tümünü Aktif Et ({summary.banned})
          </Button>
        )}
        {summary.totalFailCount > 0 && (
          <Button size="sm" variant="outline" onClick={resetAllFailCounts} className="gap-1.5 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Hata Sayaçlarını Sıfırla
          </Button>
        )}
      </div>
    </Card>
  );
}
