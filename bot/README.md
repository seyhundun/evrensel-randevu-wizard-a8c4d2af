# VFS Global Randevu Takip Botu v8.1

Bu bot, VFS Global sitesinde randevu kontrol eder ve IP rotasyonu ile engelleri aşar.

## Kurulum

```bash
cd bot
npm install
```

## Proxy Yapılandırması

### Seçenek 1: Evomi Residential Proxy (Önerilen)

Evomi residential proxy ile gerçek kullanıcı IP'leri kullanılır. Cloudflare ve VFS engelleri için en etkili yöntemdir.

```bash
# .env dosyasına ekleyin:
PROXY_MODE=residential
EVOMI_PROXY_HOST=rp.evomi.com
EVOMI_PROXY_PORT=1000
EVOMI_PROXY_USER=kullanici_adiniz
EVOMI_PROXY_PASS=sifreniz
EVOMI_PROXY_COUNTRY=TR
```

> **EVOMI_PROXY_COUNTRY** örnekleri: `TR` (Türkiye), `PL` (Polonya), `DE` (Almanya)
>
> Bot her bağlantıda otomatik olarak yeni bir oturum (session) oluşturur ve farklı bir residential IP alır.

### Seçenek 2: Datacenter IP Rotasyonu (microsocks)

Kendi VDS IP'leriniz üzerinden SOCKS5 proxy.

```bash
# .env dosyasına ekleyin:
PROXY_MODE=datacenter
IP_LIST=1.2.3.4,1.2.3.5,1.2.3.6
```

#### microsocks Kurulumu

```bash
sudo apt install -y build-essential git
git clone https://github.com/rofl0r/microsocks.git
cd microsocks && make && sudo cp microsocks /usr/local/bin/

# Her IP için microsocks başlat
IPS=("1.2.3.4" "1.2.3.5" "1.2.3.6")
PORT=10800

for i in "${!IPS[@]}"; do
  P=$((PORT + i))
  microsocks -i 127.0.0.1 -p $P -b ${IPS[$i]} &
  echo "microsocks: 127.0.0.1:$P -> ${IPS[$i]}"
done
```

## PM2 ile Kalıcı Yapma

```bash
pm2 start index.js --name vfs-bot
pm2 start idata.js --name idata-bot
pm2 save && pm2 startup
```

## Ortam Değişkenleri (.env)

```bash
# === Proxy ===
PROXY_MODE=residential          # residential veya datacenter
EVOMI_PROXY_HOST=rp.evomi.com   # Evomi host
EVOMI_PROXY_PORT=1000           # Evomi port
EVOMI_PROXY_USER=kullanici      # Evomi kullanıcı adı
EVOMI_PROXY_PASS=sifre          # Evomi şifre
EVOMI_PROXY_COUNTRY=TR          # Hedef ülke kodu

# === Datacenter (alternatif) ===
IP_LIST=1.2.3.4,1.2.3.5        # Virgülle ayrılmış VDS IP'leri
IP_BAN_DURATION_MS=1800000      # IP ban süresi (ms)

# === CAPTCHA ===
CAPTCHA_PROVIDER=auto           # auto, capsolver, 2captcha
CAPSOLVER_API_KEY=CAP-xxx       # Capsolver API anahtarı
CAPTCHA_API_KEY=xxx             # 2captcha API anahtarı
```

> **CAPTCHA_PROVIDER** seçenekleri:
> - `auto` (varsayılan): Önce capsolver dener, başarısız olursa 2captcha'ya düşer
> - `capsolver`: Yalnızca capsolver kullanır
> - `2captcha`: Yalnızca 2captcha kullanır
