# Setup Server Produksi — Formz

Panduan menyiapkan server **Ubuntu 24.04 LTS** dari nol sampai Formz melayani di
tiga domain dengan HTTPS. Ditulis untuk dijalankan berurutan; setiap langkah bisa
disalin apa adanya ke terminal.

Tanpa CI/CD — deploy dilakukan manual lewat SSH dengan `./deploy.sh`.

**Perkiraan waktu:** 45–75 menit, sebagian besar menunggu build image pertama.

**Spesifikasi minimum:** 2 vCPU / 4 GB RAM / 40 GB disk. Disarankan 4 vCPU / 8 GB
untuk pemakaian sungguhan — build image pertama sendiri butuh RAM yang lapang,
dan PostgreSQL beserta worker adalah dua komponen yang paling cepat minta
tambahan begitu submission mulai ramai.

---

## Ringkasan yang akan terpasang

```
Ubuntu 24.04 LTS
│
├── UFW (hanya 22, 80, 443) + Fail2ban + SSH key-only + unattended-upgrades
│
├── Docker Engine + Compose plugin
│     └── docker compose -f docker-compose.prod.yml
│           ├── caddy       → satu-satunya yang membuka port ke internet (80/443)
│           ├── dashboard   → app.namadomain.com
│           ├── api         → api.namadomain.com
│           ├── embed       → embed.namadomain.com
│           ├── worker      → tanpa port
│           ├── postgres, redis, minio → tanpa port, hanya jaringan Docker
│           └── volume: pgdata, redisdata, miniodata, caddydata
│
├── Netdata (pemantauan resource, hanya lewat tunnel SSH)
│
└── cron: scripts/backup.sh harian → pg_dump + MinIO → rclone ke offsite
```

---

## Daftar isi

1. [Sebelum mulai](#1-sebelum-mulai)
2. [Update sistem & unattended-upgrades](#2-update-sistem--unattended-upgrades)
3. [User non-root](#3-user-non-root)
4. [SSH key-only](#4-ssh-key-only)
5. [Firewall UFW](#5-firewall-ufw)
6. [Fail2ban](#6-fail2ban)
7. [Docker Engine + Compose](#7-docker-engine--compose)
8. [DNS](#8-dns)
9. [Ambil kode & isi konfigurasi](#9-ambil-kode--isi-konfigurasi)
10. [Deploy pertama](#10-deploy-pertama)
11. [Auto-start setelah reboot](#11-auto-start-setelah-reboot)
12. [Backup terjadwal](#12-backup-terjadwal)
13. [Uji restore](#13-uji-restore)
14. [Monitoring (Netdata)](#14-monitoring-netdata)
15. [Checklist akhir](#15-checklist-akhir)
16. [Operasional sehari-hari](#16-operasional-sehari-hari)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Sebelum mulai

Yang perlu disiapkan lebih dulu:

- [ ] Server Ubuntu 24.04 LTS dengan akses root (SSH password atau kunci)
- [ ] Satu domain yang bisa diatur DNS-nya
- [ ] Kunci SSH di komputer Anda. Kalau belum punya:
      `ssh-keygen -t ed25519 -C "formz-admin"`
- [ ] Akun storage offsite untuk backup (Backblaze B2, S3, atau server SFTP lain)
- [ ] Akun SMTP relay kalau ingin notifikasi email benar-benar terkirim
      (Postmark, Amazon SES, SendGrid)

Masuk ke server sebagai root:

```bash
ssh root@IP_SERVER
```

---

## 2. Update sistem & unattended-upgrades

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades apt-listchanges
```

Nyalakan pembaruan keamanan otomatis:

```bash
dpkg-reconfigure -plow unattended-upgrades      # pilih "Yes"
```

Periksa hasilnya:

```bash
systemctl status unattended-upgrades --no-pager
unattended-upgrades --dry-run --debug 2>&1 | tail -20
```

> Server yang diurus sendiri tidak punya siapa pun yang memasang patch kernel
> untuk Anda. Ini langkah paling murah dengan hasil paling besar di seluruh
> panduan ini, dan justru yang paling sering dilewati.

Reboot kalau ada pembaruan kernel:

```bash
[ -f /var/run/reboot-required ] && reboot
```

---

## 3. User non-root

Semua yang berkaitan dengan Formz dijalankan sebagai user biasa, bukan root.

```bash
adduser --gecos "" formz
usermod -aG sudo formz

# Salin kunci SSH root ke user baru supaya tidak terkunci di luar
mkdir -p /home/formz/.ssh
cp /root/.ssh/authorized_keys /home/formz/.ssh/ 2>/dev/null || true
chown -R formz:formz /home/formz/.ssh
chmod 700 /home/formz/.ssh
chmod 600 /home/formz/.ssh/authorized_keys 2>/dev/null || true
```

Kalau `/root/.ssh/authorized_keys` belum ada (Anda masuk dengan password),
tambahkan kunci publik Anda sekarang:

```bash
nano /home/formz/.ssh/authorized_keys     # tempel isi ~/.ssh/id_ed25519.pub
chmod 600 /home/formz/.ssh/authorized_keys
chown formz:formz /home/formz/.ssh/authorized_keys
```

**Dari terminal komputer Anda** (jangan tutup sesi root dulu), buktikan login
user baru benar-benar bekerja:

```bash
ssh formz@IP_SERVER 'sudo -n true 2>/dev/null || sudo true; echo "login & sudo OK"'
```

> Langkah 4 mematikan login root dan login password. Kalau login user baru
> ternyata belum jalan dan sesi root sudah tertutup, satu-satunya jalan masuk
> adalah konsol darurat penyedia server. Pastikan perintah di atas berhasil
> **sebelum** melanjutkan.

---

## 4. SSH key-only

Masih sebagai root:

```bash
cat > /etc/ssh/sshd_config.d/99-formz.conf <<'EOF'
# Hanya autentikasi kunci — password SSH adalah target utama brute-force.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
# Batasi siapa yang boleh masuk sama sekali.
AllowUsers formz
EOF

sshd -t && systemctl restart ssh
```

Uji dari komputer Anda **di terminal baru** (sesi lama biarkan terbuka):

```bash
ssh formz@IP_SERVER
```

Sisa panduan ini dijalankan sebagai user `formz`.

---

## 5. Firewall UFW

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP - redirect & ACME'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw allow 443/udp comment 'HTTP/3'
sudo ufw --force enable
sudo ufw status verbose
```

Port 80 wajib terbuka meski semua trafik dialihkan ke HTTPS: Let's Encrypt
memakainya untuk memverifikasi kepemilikan domain. Menutupnya berarti sertifikat
tidak akan pernah terbit.

> **Docker menembus UFW.** Container yang mem-publish port menulis aturan iptables
> sendiri dan tidak tunduk pada UFW. Itulah sebabnya `docker-compose.prod.yml`
> tidak memberi `ports:` pada postgres, redis, dan minio sama sekali — bukan
> mengandalkan firewall untuk menutupnya. Jangan menambahkan `ports:` ke ketiganya
> "sekadar untuk mengecek": database Anda akan langsung terbuka ke internet
> tanpa peringatan apa pun.

---

## 6. Fail2ban

```bash
sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
EOF

sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

---

## 7. Docker Engine + Compose

Repositori resmi Docker, bukan paket bawaan Ubuntu (versinya jauh tertinggal):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker formz
sudo systemctl enable --now docker
```

Keluar dan masuk lagi supaya keanggotaan grup `docker` berlaku:

```bash
exit
ssh formz@IP_SERVER
docker run --rm hello-world
docker compose version
```

Batasi ukuran log Docker di tingkat daemon — ini pengaman kedua di luar
`logging:` yang sudah ada di compose:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
EOF
sudo systemctl restart docker
```

---

## 8. DNS

Arahkan **tiga** subdomain ke IP server, di panel DNS penyedia domain Anda:

| Tipe | Nama    | Nilai     | TTL |
| ---- | ------- | --------- | --- |
| A    | `app`   | IP_SERVER | 300 |
| A    | `api`   | IP_SERVER | 300 |
| A    | `embed` | IP_SERVER | 300 |

Kalau memakai Cloudflare, **matikan dulu mode proxy (awan oranye → abu-abu)**
sampai sertifikat pertama terbit. Cloudflare yang aktif memutus tantangan
HTTP-01 Let's Encrypt dan penerbitan akan gagal berulang kali.

Tunggu propagasi, lalu pastikan ketiganya benar-benar menunjuk ke server:

```bash
for h in app api embed; do
  printf '%-8s ' "$h"; dig +short "$h.namadomain.com"
done
curl -4 -s ifconfig.me; echo    # bandingkan: harus sama dengan hasil di atas
```

> Jangan lanjut ke langkah 10 sebelum ketiganya cocok. Caddy meminta sertifikat
> saat start pertama; percobaan yang gagal berulang kali bisa menabrak batas
> penerbitan Let's Encrypt dan mengunci domain itu selama berjam-jam.

---

## 9. Ambil kode & isi konfigurasi

```bash
cd ~
git clone https://github.com/IlyasaAliadjrun/formz.git
cd formz

cp .env.production.example .env.production
chmod 600 .env.production
```

Generate secret — jalankan tiap perintah sekali, salin hasilnya:

```bash
openssl rand -hex 32     # JWT_SECRET
openssl rand -hex 32     # JWT_REFRESH_SECRET (harus berbeda)
openssl rand -hex 24     # POSTGRES_PASSWORD
openssl rand -hex 24     # REDIS_PASSWORD
openssl rand -hex 24     # MINIO_ROOT_PASSWORD
openssl rand -hex 16     # QUEUE_DASHBOARD_PASSWORD
openssl rand -hex 12     # ADMIN_PASSWORD (diganti lewat dashboard setelah login pertama)
```

```bash
nano .env.production
```

Yang **wajib** diisi sebelum deploy:

| Variabel                                   | Isi                                   |
| ------------------------------------------ | ------------------------------------- |
| `APP_DOMAIN`, `API_DOMAIN`, `EMBED_DOMAIN` | Tiga subdomain dari langkah 8         |
| `ACME_EMAIL`                               | Alamat email yang benar-benar dibaca  |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`      | Hasil `openssl rand`                  |
| `MINIO_ROOT_PASSWORD`                      | Hasil `openssl rand`                  |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`         | Dua nilai acak yang **berbeda**       |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`            | Akun admin pertama                    |
| `TRUST_PROXY`                              | `true` (API berada di belakang Caddy) |

Opsional, boleh dikosongkan dan diisi belakangan:
`SMTP_*` dan `MAIL_FROM` (notifikasi email), `GOOGLE_*` (integrasi spreadsheet),
`QUEUE_DASHBOARD_*` (Bull Board — kalau dikosongkan halamannya tidak dipasang
sama sekali).

Terakhir, pastikan tidak ada nilai contoh yang tertinggal:

```bash
grep -v '^[[:space:]]*#' .env.production | grep 'ganti-dengan-' && echo "^ masih ada yang belum diisi" || echo "Semua nilai contoh sudah diganti"
```

---

## 10. Deploy pertama

```bash
./deploy.sh
```

Skrip ini menjalankan: git pull → build image → migrasi database → naikkan stack
→ verifikasi `/health`. Build pertama memakan **10–20 menit** karena seluruh
dependency diunduh dan keempat aplikasi dikompilasi; deploy berikutnya jauh lebih
cepat karena lapisannya ter-cache.

Pantau penerbitan sertifikat di jendela lain:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
```

Yang ditunggu: `certificate obtained successfully` untuk ketiga domain.

Buka `https://app.namadomain.com`, login dengan `ADMIN_EMAIL` + `ADMIN_PASSWORD`,
lalu **segera ganti password admin** lewat `/settings/users`.

### Verifikasi cepat

```bash
curl -s https://api.namadomain.com/health | head -c 200; echo
curl -sI https://app.namadomain.com | head -3
curl -sI https://embed.namadomain.com | head -3
curl -sI http://app.namadomain.com | grep -i location    # harus 308 ke https
```

---

## 11. Auto-start setelah reboot

`restart: unless-stopped` plus `systemctl enable docker` sebenarnya sudah cukup:
Docker menyalakan ulang container-nya sendiri setiap boot.

```bash
systemctl is-enabled docker      # harus "enabled"
```

Unit systemd di bawah menambahkan satu hal yang tidak dilakukan restart policy —
menjalankan `docker compose up -d` sehingga **container yang belum pernah dibuat**
(misalnya service baru yang ditambahkan setelah deploy terakhir) ikut naik, dan
memberi satu tempat berhenti/menyala yang eksplisit: `systemctl stop formz`.

```bash
sudo tee /etc/systemd/system/formz.service >/dev/null <<'EOF'
[Unit]
Description=Formz — form builder self-hosted
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=formz
WorkingDirectory=/home/formz/formz
ExecStart=/usr/bin/docker compose --env-file .env.production -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose --env-file .env.production -f docker-compose.prod.yml stop
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable formz.service
sudo systemctl start formz.service
systemctl status formz --no-pager
```

> Unit ini sengaja **tidak** menjalankan migrasi. Perubahan skema database harus
> jadi langkah yang disengaja dan terbaca hasilnya, bukan sesuatu yang terjadi
> diam-diam saat server kebetulan reboot jam tiga pagi.

Uji sungguhan:

```bash
sudo reboot
# tunggu ~1 menit
ssh formz@IP_SERVER 'cd formz && docker compose --env-file .env.production -f docker-compose.prod.yml ps'
```

---

## 12. Backup terjadwal

### Pasang rclone

```bash
sudo -v ; curl https://rclone.org/install.sh | sudo bash
rclone version
```

### Konfigurasi tujuan offsite

```bash
cd ~/formz
rclone config --config ~/formz/scripts/rclone.conf
```

Beri nama remote-nya **`offsite`** supaya cocok dengan `RCLONE_REMOTE` di
`.env.production`. Contoh dan catatan per penyedia ada di
[scripts/rclone.conf.example](./scripts/rclone.conf.example).

```bash
chmod 600 ~/formz/scripts/rclone.conf
rclone --config ~/formz/scripts/rclone.conf lsd offsite:    # harus berhasil
```

### Siapkan folder & jalankan sekali secara manual

```bash
sudo mkdir -p /var/backups/formz
sudo chown formz:formz /var/backups/formz
chmod 700 /var/backups/formz

sudo touch /var/log/formz-backup.log
sudo chown formz:formz /var/log/formz-backup.log

./scripts/backup.sh
```

Keluarannya harus berakhir dengan `=== Backup selesai ===` dan menyebutkan
`Unggahan selesai dan terverifikasi`.

### Jadwalkan lewat cron

```bash
crontab -e
```

```cron
# Backup Formz tiap hari pukul 02:15 waktu server
15 2 * * * /home/formz/formz/scripts/backup.sh >> /var/log/formz-backup.log 2>&1
```

Rotasi lognya supaya tidak tumbuh tanpa batas:

```bash
sudo tee /etc/logrotate.d/formz >/dev/null <<'EOF'
/var/log/formz-backup.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
EOF
```

### Pantau backup-nya

Isi `BACKUP_PING_URL` di `.env.production` dengan URL dari
[healthchecks.io](https://healthchecks.io) (gratis) atau Uptime Kuma milik
sendiri. Skripnya mengirim ping setiap kali selesai, dan pemantau akan berteriak
kalau suatu malam ping-nya tidak datang.

> Backup yang berhenti berjalan tidak menimbulkan gejala apa pun sampai datanya
> benar-benar dibutuhkan. Pemberitahuan inilah yang membedakan "punya backup"
> dari "mengira punya backup".

---

## 13. Uji restore

**Wajib dilakukan sekarang, bukan nanti.** Backup yang belum pernah dicoba
dipulihkan adalah asumsi, bukan cadangan.

```bash
cd ~/formz
DUMP=$(ls -t /var/backups/formz/formz-db-*.sql.gz | head -1)
C="docker compose --env-file .env.production -f docker-compose.prod.yml"

# Restore ke database terpisah — data produksi tidak disentuh sama sekali
$C exec -T postgres psql -U formz -d postgres -c "DROP DATABASE IF EXISTS formz_restore_test;"
$C exec -T postgres psql -U formz -d postgres -c "CREATE DATABASE formz_restore_test OWNER formz;"
zcat "$DUMP" | $C exec -T postgres psql -U formz -d formz_restore_test -q

# Bandingkan isinya dengan database sungguhan
echo "produksi:"; $C exec -T postgres psql -U formz -d formz -tAc \
  "SELECT (SELECT count(*) FROM forms) forms, (SELECT count(*) FROM submissions) submissions, (SELECT count(*) FROM users) users;"
echo "restore :"; $C exec -T postgres psql -U formz -d formz_restore_test -tAc \
  "SELECT (SELECT count(*) FROM forms) forms, (SELECT count(*) FROM submissions) submissions, (SELECT count(*) FROM users) users;"

# Materialized view laporan harus ikut terbawa (keempatnya)
$C exec -T postgres psql -U formz -d formz_restore_test -tAc \
  "SELECT count(*) FROM pg_matviews WHERE matviewname LIKE 'report_%';"

# Bersihkan
$C exec -T postgres psql -U formz -d postgres -c "DROP DATABASE formz_restore_test;"
```

Angka produksi dan restore harus sama persis, dan jumlah materialized view harus
**4**. Ulangi uji ini setiap beberapa bulan, dan setelah setiap upgrade PostgreSQL.

### Pemulihan sungguhan (kalau server hilang)

```bash
# Di server baru: ulangi langkah 1–9, lalu SEBELUM deploy pertama —
rclone --config scripts/rclone.conf copy offsite:formz/2026/08 /var/backups/formz --include 'formz-*20260809*'

./deploy.sh                                # bikin skema kosong lebih dulu
C="docker compose --env-file .env.production -f docker-compose.prod.yml"
$C stop api worker                         # jangan ada yang menulis saat restore
zcat /var/backups/formz/formz-db-*.sql.gz | $C exec -T postgres psql -U formz -d formz -q
docker run --rm -v formz_miniodata:/data -v /var/backups/formz:/backup:ro alpine:3 \
  sh -c 'cd /data && tar -xzf /backup/formz-minio-*.tar.gz'
$C start api worker
```

---

## 14. Monitoring (Netdata)

```bash
curl -fsSL https://get.netdata.cloud/kickstart.sh |
  sh -s -- --dont-wait --stable-channel --disable-telemetry
```

**Jangan buka port 19999 di firewall.** Netdata mengekspos rincian sistem yang
sangat lengkap tanpa autentikasi bawaan. Aksesnya lewat tunnel SSH dari komputer
Anda:

```bash
ssh -N -L 19999:localhost:19999 formz@IP_SERVER
# lalu buka http://localhost:19999
```

Pastikan ia memang hanya mendengarkan di localhost:

```bash
sudo tee -a /etc/netdata/netdata.conf >/dev/null <<'EOF'

[web]
    bind to = 127.0.0.1
EOF
sudo systemctl restart netdata
sudo ss -tlnp | grep 19999      # harus 127.0.0.1:19999, bukan 0.0.0.0
```

Cara yang sama berlaku untuk **MinIO console** (port 9001) yang sengaja tidak
di-publish di compose:

```bash
ssh -N -L 9001:localhost:9001 formz@IP_SERVER   # setelah menambahkan ports sementara
```

### Yang perlu dipasang alarm-nya

Netdata sudah punya alarm bawaan; tiga yang paling penting di sini:

- **Disk penuh** — PostgreSQL berhenti menulis dan submission mulai ditolak
- **RAM habis** — OOM killer biasanya memilih PostgreSQL atau worker
- **Load tinggi berkepanjangan** — tanda saatnya menaikkan resource

Selain itu, pantau juga antrean lewat **Bull Board** di
`https://api.namadomain.com/queues`: job yang menumpuk di `failed` berarti
integrasi spreadsheet atau relay email sedang bermasalah, dan itu tidak terlihat
sama sekali dari grafik CPU.

---

## 15. Checklist akhir

Salin dan centang:

```
[ ] Ubuntu ter-update, unattended-upgrades aktif
[ ] User non-root `formz` bisa login dengan kunci SSH + sudo
[ ] PermitRootLogin no, PasswordAuthentication no
[ ] UFW aktif: hanya 22, 80, 443 terbuka
[ ] Fail2ban aktif untuk sshd
[ ] Docker + Compose plugin terpasang, log dibatasi
[ ] DNS app./api./embed. mengarah ke IP server
[ ] .env.production terisi, chmod 600, tanpa nilai "ganti-dengan-"
[ ] ./deploy.sh selesai, /health mengembalikan status ok
[ ] Sertifikat HTTPS terbit untuk ketiga domain
[ ] Password admin sudah diganti lewat dashboard
[ ] Stack otomatis naik setelah reboot (sudah diuji dengan reboot sungguhan)
[ ] rclone terkonfigurasi, backup manual berhasil terunggah
[ ] cron backup harian terpasang + logrotate
[ ] Uji restore berhasil, jumlah baris cocok, 4 materialized view kembali
[ ] Netdata terpasang, hanya mendengarkan di localhost
[ ] Pemantauan backup (healthchecks.io / Uptime Kuma) aktif
[ ] Cloudflare proxy dinyalakan lagi kalau memang dipakai (setelah sertifikat terbit)
```

---

## 16. Operasional sehari-hari

Semua perintah dijalankan dari `~/formz`.

```bash
# Alias yang memudahkan (tambahkan ke ~/.bashrc)
alias fz='docker compose --env-file .env.production -f docker-compose.prod.yml'
```

| Kebutuhan              | Perintah                                  |
| ---------------------- | ----------------------------------------- |
| Rilis versi baru       | `./deploy.sh`                             |
| Status container       | `fz ps`                                   |
| Log satu service       | `fz logs -f api`                          |
| Restart satu service   | `fz restart worker`                       |
| Hentikan seluruh stack | `sudo systemctl stop formz`               |
| Backup manual          | `./scripts/backup.sh`                     |
| Masuk ke database      | `fz exec postgres psql -U formz -d formz` |
| Pemakaian disk         | `df -h && docker system df`               |
| Bersihkan image lama   | `docker image prune -a -f`                |

### Mengganti domain

Domain tertanam di bundle browser saat build (`NEXT_PUBLIC_*`, `VITE_*`), jadi
mengubahnya bukan sekadar mengedit `.env.production` lalu restart:

```bash
nano .env.production        # ubah APP_DOMAIN / API_DOMAIN / EMBED_DOMAIN
./deploy.sh                 # build ulang WAJIB, bukan opsional
```

Jangan lupa memperbarui DNS lebih dulu, dan mengganti whitelist domain per form
di `/forms/:id/embed` kalau domain embed ikut berubah.

### Kembali ke versi sebelumnya

```bash
git log --oneline -10
git checkout <commit-sebelumnya>
./deploy.sh --no-pull
```

Kalau rilis yang bermasalah membawa migrasi database, kembali ke kode lama saja
belum tentu cukup — Prisma tidak menjalankan migrasi mundur. Restore dump dari
`/var/backups/formz` yang dibuat sebelum deploy tersebut.

> Karena itu, biasakan menjalankan `./scripts/backup.sh` **sebelum** deploy yang
> membawa migrasi.

---

## 17. Troubleshooting

**Sertifikat tidak terbit / `could not get certificate`**

```bash
fz logs caddy | grep -i 'error\|challenge'
dig +short app.namadomain.com          # harus IP server
sudo ufw status | grep 80              # port 80 harus terbuka
```

Penyebab paling umum: DNS belum menunjuk ke server, atau Cloudflare proxy masih
menyala. Kalau sudah mencoba berkali-kali dan terkena rate limit Let's Encrypt,
buka baris `acme_ca` staging di [docker/Caddyfile](./docker/Caddyfile), perbaiki
masalahnya sampai berhasil, baru tutup lagi barisnya dan `fz restart caddy`.

**API restart terus**

```bash
fz logs --tail 50 api
```

Biasanya konfigurasi environment: pesan errornya menyebut variabel mana yang
bermasalah. Perbaiki `.env.production` lalu `fz up -d api`.

**Dashboard memanggil `localhost:4000`, bukan domain API**

Image dashboard dibangun dengan `NEXT_PUBLIC_API_URL` yang salah. Pastikan
`API_DOMAIN` sudah benar di `.env.production` lalu `./deploy.sh` (build ulang).

**Submission tercatat dengan IP gateway Docker (172.x.x.x) yang sama semua**

`TRUST_PROXY` belum `true`. Perbaiki lalu `fz up -d api`. Efek sampingnya
serius: rate limit per IP berubah jadi rate limit global.

**Disk penuh**

```bash
docker system df
docker image prune -a -f
du -sh /var/backups/formz /var/lib/docker
```

Turunkan `BACKUP_RETENTION_DAYS` kalau salinan lokal yang memenuhi disk.

**Job antre menumpuk / email tidak terkirim**

Buka Bull Board di `https://api.namadomain.com/queues`, lihat pesan error job
yang gagal. Untuk email, periksa `MAIL_PROVIDER` — kalau masih `console`,
emailnya memang sengaja tidak dikirim ke mana pun.

**Lupa password admin**

```bash
fz exec postgres psql -U formz -d formz -c "SELECT email FROM users;"
```

Lalu isi ulang `ADMIN_EMAIL`/`ADMIN_PASSWORD` di `.env.production` **dengan email
yang belum pernah ada**, jalankan `fz run --rm migrator`, login dengan akun baru
itu, dan atur ulang password akun lama dari `/settings/users`. Seed sengaja tidak
menimpa password user yang sudah ada.
