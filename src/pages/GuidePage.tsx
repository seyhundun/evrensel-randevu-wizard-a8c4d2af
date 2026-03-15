import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Copy, Check, Terminal, Play, Square, RotateCcw, Trash2, Eye, Server, Shield, HardDrive, Monitor } from "lucide-react";
import { toast } from "sonner";

function CopyBlock({ label, command, description }: { label?: string; command: string; description?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    toast.success("Panoya kopyalandı");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      {label && <p className="text-sm font-medium text-foreground">{label}</p>}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="relative group">
        <pre className="bg-black/80 text-green-400 text-xs font-mono p-3 pr-12 rounded-lg overflow-x-auto whitespace-pre-wrap break-all border border-border/50">
          {command}
        </pre>
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-1.5 right-1.5 h-7 w-7 opacity-60 group-hover:opacity-100 text-green-400 hover:text-green-300 hover:bg-white/10"
          onClick={handleCopy}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, badge, children }: { icon: any; title: string; badge?: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">{title}</CardTitle>
          {badge && <Badge variant="outline" className="text-xs">{badge}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
      </CardContent>
    </Card>
  );
}

export default function GuidePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Terminal className="w-5 h-5 text-primary" />
              Sunucu Yönetim Kılavuzu
            </h1>
            <p className="text-xs text-muted-foreground">VFS & iDATA Bot — Başlatma, Durdurma, Güncelleme</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-16">

        {/* ===== DURDURMA ===== */}
        <Section icon={Square} title="Tüm Servisleri Durdur" badge="Durdurma">
          <CardDescription>PM2 süreçlerini, Xvfb ekranlarını, Chrome işlemlerini ve VNC/noVNC servislerini temizler.</CardDescription>
          <CopyBlock
            label="Tek komut ile tümünü durdur"
            command={`pm2 stop all && pm2 delete all
pkill -f "Xvfb :99" 2>/dev/null; pkill -f "Xvfb :98" 2>/dev/null
pkill -f chromium 2>/dev/null; pkill -f chrome 2>/dev/null
pkill -f x11vnc 2>/dev/null; pkill -f websockify 2>/dev/null
echo "✅ Tüm servisler durduruldu"`}
          />
        </Section>

        {/* ===== BAŞLATMA ===== */}
        <Section icon={Play} title="Tüm Servisleri Başlat" badge="Başlatma">
          <CardDescription>Xvfb sanal ekranları, VNC/noVNC servisleri ve botları ecosystem.config.cjs ile başlatır.</CardDescription>
          <CopyBlock
            label="1. Sanal ekranları başlat"
            description="VFS → :99 (1920x1080), iDATA → :98 (1920x1080)"
            command={`Xvfb :99 -screen 0 1920x1080x24 &
Xvfb :98 -screen 0 1920x1080x24 &
sleep 1
echo "✅ Xvfb ekranları başlatıldı"`}
          />
          <CopyBlock
            label="2. VNC & noVNC başlat"
            description="x11vnc → websockify → noVNC (VFS: 6080, iDATA: 6081)"
            command={`x11vnc -display :99 -forever -shared -rfbport 5900 -rfbauth /root/.vnc/passwd -noxdamage -bg -o /dev/null
x11vnc -display :98 -forever -shared -rfbport 5901 -rfbauth /root/.vnc/passwd -noxdamage -bg -o /dev/null
websockify --daemon --web /usr/share/novnc 6080 localhost:5900
websockify --daemon --web /usr/share/novnc 6081 localhost:5901
echo "✅ VNC/noVNC başlatıldı"`}
          />
          <CopyBlock
            label="3. ecosystem.config.cjs oluştur"
            description="PM2 ecosystem dosyası — DISPLAY değişkenlerini garanti eder"
            command={`cat > /root/vfs-bot/bot/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: "vfs-bot",
      script: "index.js",
      cwd: "/root/vfs-bot/bot",
      env: { DISPLAY: ":99" }
    },
    {
      name: "idata-bot",
      script: "idata.js",
      cwd: "/root/vfs-bot/bot",
      env: { DISPLAY: ":98" }
    }
  ]
};
EOF
echo "✅ ecosystem.config.cjs oluşturuldu"`}
          />
          <CopyBlock
            label="4. Botları başlat (ecosystem ile)"
            command={`cd /root/vfs-bot/bot && pm2 start ecosystem.config.cjs
pm2 save
echo "✅ Botlar başlatıldı"`}
          />
          <Separator />
          <CopyBlock
            label="⚡ Hepsini tek seferde (Tam Başlatma)"
            description="Sanal ekranlar + VNC + ecosystem + Botlar — tek kopyala-yapıştır"
            command={`# Xvfb sanal ekranlar
Xvfb :99 -screen 0 1920x1080x24 &
Xvfb :98 -screen 0 1920x1080x24 &
sleep 1

# VNC & noVNC
x11vnc -display :99 -forever -shared -rfbport 5900 -rfbauth /root/.vnc/passwd -noxdamage -bg -o /dev/null
x11vnc -display :98 -forever -shared -rfbport 5901 -rfbauth /root/.vnc/passwd -noxdamage -bg -o /dev/null
websockify --daemon --web /usr/share/novnc 6080 localhost:5900
websockify --daemon --web /usr/share/novnc 6081 localhost:5901

# ecosystem.config.cjs oluştur
cat > /root/vfs-bot/bot/ecosystem.config.cjs << 'EOFCONFIG'
module.exports = {
  apps: [
    {
      name: "vfs-bot",
      script: "index.js",
      cwd: "/root/vfs-bot/bot",
      env: { DISPLAY: ":99" }
    },
    {
      name: "idata-bot",
      script: "idata.js",
      cwd: "/root/vfs-bot/bot",
      env: { DISPLAY: ":98" }
    }
  ]
};
EOFCONFIG

# Botları başlat
cd /root/vfs-bot/bot && pm2 start ecosystem.config.cjs
pm2 save
echo "✅ Tüm servisler başlatıldı"`}
          />
        </Section>

        {/* ===== TEK BOT ===== */}
        <Section icon={RotateCcw} title="Tek Bot Yeniden Başlat" badge="Restart">
          <CopyBlock
            label="VFS Bot"
            command={`pm2 delete vfs-bot 2>/dev/null
cd /root/vfs-bot/bot && pm2 start ecosystem.config.cjs --only vfs-bot
pm2 logs vfs-bot --lines 20`}
          />
          <CopyBlock
            label="iDATA Bot"
            command={`pm2 delete idata-bot 2>/dev/null
cd /root/vfs-bot/bot && pm2 start ecosystem.config.cjs --only idata-bot
pm2 logs idata-bot --lines 20`}
          />
        </Section>

        {/* ===== GÜNCELLEME ===== */}
        <Section icon={HardDrive} title="Kodu Güncelle (Git Pull)" badge="Güncelleme">
          <CardDescription>GitHub'dan en son kodu çekip botları yeniden başlatır.</CardDescription>
          <CopyBlock
            label="Güncelle ve yeniden başlat"
            command={`cd /root/vfs-bot
git checkout -- bot/index.js bot/idata.js 2>/dev/null
git pull
cd bot && npm install

pm2 delete vfs-bot idata-bot 2>/dev/null
pm2 start ecosystem.config.cjs
pm2 save
echo "✅ Güncelleme tamamlandı"`}
          />
        </Section>

        {/* ===== İZLEME ===== */}
        <Section icon={Eye} title="İzleme & Loglar" badge="Monitoring">
          <CopyBlock label="PM2 durumu" command="pm2 status" />
          <CopyBlock label="VFS logları (canlı)" command="pm2 logs vfs-bot --lines 50" />
          <CopyBlock label="iDATA logları (canlı)" command="pm2 logs idata-bot --lines 50" />
          <CopyBlock label="Tüm loglar" command="pm2 logs --lines 100" />
          <CopyBlock label="Hata logları" command="cat /root/.pm2/logs/vfs-bot-error.log | tail -50" />
          <Separator />
          <CopyBlock
            label="📧 IMAP OTP Test Logları"
            description="iDATA botunun IMAP ile otomatik OTP okumasını kontrol et"
            command="pm2 logs idata-bot --lines 50 | grep -i imap"
          />
          <Separator />
          <CopyBlock
            label="noVNC erişim adresleri"
            description="Dashboard üzerinden veya doğrudan tarayıcıdan canlı izleme"
            command={`# Dashboard (HTTPS — önerilen):
# VFS:   https://vnc.fipacomputer.online/vfs/vnc.html
# iDATA: https://vnc.fipacomputer.online/idata/vnc.html

# Doğrudan HTTP (sunucu IP ile):
# VFS:   http://187.77.161.201:6080/vnc.html
# iDATA: http://187.77.161.201:6081/vnc.html`}
          />
          />
        </Section>

        {/* ===== VNC EKRAN SORUNLARI ===== */}
        <Section icon={Monitor} title="VNC Ekran Ayarları" badge="Ekran">
          <CardDescription>Ekranlar küçük görünüyorsa veya Chrome penceresi düzgün açılmıyorsa.</CardDescription>
          <CopyBlock
            label="Xvfb ekranını yeniden başlat (iDATA örneği)"
            description="Çözünürlüğü sıfırlamak için"
            command={`pkill -f "Xvfb :98" 2>/dev/null
pkill -f "x11vnc.*:98" 2>/dev/null
pkill -f "websockify.*6081" 2>/dev/null
sleep 2

Xvfb :98 -screen 0 1920x1080x24 &
sleep 1
x11vnc -display :98 -forever -shared -rfbport 5901 -rfbauth /root/.vnc/passwd -noxdamage -bg -o /dev/null
websockify --daemon --web /usr/share/novnc 6081 localhost:5901

pm2 restart idata-bot
echo "✅ iDATA ekranı yeniden başlatıldı"`}
          />
          <CopyBlock
            label="Chrome'u tam ekran yap"
            description="wmctrl gereklidir: apt install -y wmctrl"
            command={`# VFS ekranında:
DISPLAY=:99 wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz

# iDATA ekranında:
DISPLAY=:98 wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`}
          />
        </Section>

        {/* ===== TEMİZLİK ===== */}
        <Section icon={Trash2} title="Temizlik" badge="Maintenance">
          <CopyBlock
            label="Chrome geçici dosyalarını temizle"
            command={`rm -rf /tmp/vfs-chrome-* /tmp/puppeteer-* /tmp/.org.chromium.*
echo "✅ Geçici dosyalar temizlendi"`}
          />
          <CopyBlock
            label="PM2 loglarını temizle"
            command={`pm2 flush
echo "✅ PM2 logları temizlendi"`}
          />
        </Section>

        {/* ===== SORUN GİDERME ===== */}
        <Section icon={Shield} title="Sorun Giderme" badge="Troubleshooting">
          <CopyBlock
            label="Xvfb çalışıyor mu?"
            command={`ps aux | grep Xvfb | grep -v grep`}
          />
          <CopyBlock
            label="Chrome/Chromium süreçleri"
            command={`ps aux | grep -E "chrom" | grep -v grep | wc -l`}
          />
          <CopyBlock
            label="DISPLAY değişkeni kontrolü (PM2)"
            description="Botların doğru ekrana bağlı olduğunu kontrol et"
            command={`pm2 describe vfs-bot | grep -A5 "env"
pm2 describe idata-bot | grep -A5 "env"`}
          />
          <CopyBlock
            label="Port kontrolü (VNC/noVNC)"
            command={`ss -tlnp | grep -E "5900|5901|6080|6081"`}
          />
          <CopyBlock
            label="Sunucu IP kontrolü"
            command={`curl -s https://ip.evomi.com/s && echo ""`}
          />
          <CopyBlock
            label="Disk kullanımı"
            command={`df -h / && echo "" && du -sh /tmp/vfs-chrome-* 2>/dev/null | tail -5`}
          />
          <CopyBlock
            label="Nginx VNC proxy kontrolü"
            description="HTTPS üzerinden noVNC erişimi"
            command={`curl -I https://vnc.fipacomputer.online/vfs/vnc.html
curl -I https://vnc.fipacomputer.online/idata/vnc.html`}
          />
        </Section>

        {/* ===== SUNUCU KURULUMU ===== */}
        <Section icon={Server} title="Sıfırdan Sunucu Kurulumu" badge="İlk Kurulum">
          <CardDescription>Yeni bir VPS'e sıfırdan kurulum yapmak için gereken komutlar.</CardDescription>
          <CopyBlock
            label="1. Sistem bağımlılıkları"
            command={`apt update && apt install -y curl git xvfb x11vnc novnc websockify wmctrl fonts-liberation libatk-bridge2.0-0 libgtk-3-0 libasound2 libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libcups2 libdrm2 libxss1`}
          />
          <CopyBlock
            label="2. Node.js 20 + PM2"
            command={`curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2`}
          />
          <CopyBlock
            label="3. Google Chrome"
            command={`wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
dpkg -i google-chrome-stable_current_amd64.deb || apt --fix-broken install -y
rm google-chrome-stable_current_amd64.deb
echo "CHROME_PATH=/usr/bin/google-chrome-stable" >> /etc/environment`}
          />
          <CopyBlock
            label="4. Projeyi klonla ve bağımlılıkları kur"
            command={`cd /root
git clone https://github.com/seyhundun/evrensel-randevu-wizard-da53f8e7.git vfs-bot
cd vfs-bot/bot
npm install`}
          />
          <CopyBlock
            label="5. .env dosyasını oluştur"
            description="Gerekli ortam değişkenleri (DB üzerinden de yönetilir)"
            command={`cat > /root/vfs-bot/bot/.env << 'EOF'
SUPABASE_URL=https://ocrpzwrsyiprfuzsyivf.supabase.co
SUPABASE_KEY=YOUR_ANON_KEY
CHROME_PATH=/usr/bin/google-chrome-stable
PROXY_MODE=residential
CAPTCHA_PROVIDER=auto
EOF`}
          />
          <CopyBlock
            label="6. Tam Başlatma + PM2 Startup"
            description="Yukarıdaki 'Hepsini tek seferde' komutunu çalıştırdıktan sonra"
            command={`pm2 startup
pm2 save
echo "✅ Reboot sonrası otomatik başlatma ayarlandı"`}
          />
        </Section>
      </div>
    </div>
  );
}
