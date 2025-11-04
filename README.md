# Membit Auto Bot

Bot otomatis untuk scraping dan submit post Twitter/X ke Membit AI menggunakan Puppeteer.

📸 Bot in Action
![image](https://github.com/user-attachments/assets/eaa221ba-b186-479b-acde-39884175f7ee)


## Fitur

- 🤖 Auto scraping post dari timeline Twitter/X
- 📊 Multi-account support
- 🔄 Auto refresh cookie untuk menjaga sesi tetap aktif
- 🌐 Proxy support dengan auto failover
- 📈 Real-time tracking poin dan eligible posts
- 🎯 Auto submit engagement (likes, retweets, replies)
- 🛡️ Anti-stall mechanism dengan auto reload
- 🎨 Colorful logging dengan timestamp WIB

## Prasyarat

- Node.js v16 atau lebih tinggi
- NPM atau Yarn
- Akun Twitter/X yang sudah login
- Token autentikasi Membit

## Instalasi

1. Clone repository ini:
```bash
git clone https://github.com/febriyan9346/Membit-Auto-Bot.git
cd Membit-Auto-Bot
```

2. Install dependencies:
```bash
npm install
```

3. Buat folder `X` untuk menyimpan cookies:
```bash
mkdir X
```

## Konfigurasi

### 1. Setup Cookies Twitter/X

Buat file `X/cookies.json` dengan format berikut:

```json
[
  {
    "name": "auth_token",
    "value": "your_auth_token_here",
    "domain": ".x.com",
    "path": "/",
    "secure": true,
    "httpOnly": true,
    "sameSite": "no_restriction",
    "expirationDate": 1234567000
  },
  {
    "name": "ct0",
    "value": "your_ct0_token_here",
    "domain": ".x.com",
    "path": "/"
  }
]
```

**Cara mendapatkan cookies:**
1. Login ke Twitter/X di browser
2. Buka Developer Tools (F12)
3. Pergi ke tab Application/Storage → Cookies → https://x.com
4. Copy nilai `auth_token` dan `ct0`

### 2. Setup Akun Membit

Edit file `accounts.json`:

```json
[
  {
    "auth_token": "Bearer your_membit_token_here",
    "cookie": ""
  }
]
```

**Catatan:** 
- Jika field `cookie` kosong (`""`), bot akan generate dummy cookie otomatis
- Untuk multiple accounts, tambahkan objek baru dalam array

### 3. Setup Proxy (Opsional)

Buat file `proxy.txt` dengan format:

```
http://username:password@proxy1.com:8080
http://username:password@proxy2.com:8080
socks5://proxy3.com:1080
```

Satu proxy per baris. Bot akan otomatis assign proxy ke setiap akun.

## Menjalankan Bot

```bash
npm start
```

atau

```bash
node bot.js
```

## Environment Variables

Anda bisa set timeout navigasi dengan environment variable:

```bash
NAV_TIMEOUT_MS=300000 npm start
```

Default timeout adalah 300000ms (5 menit).

## Struktur File

```
Membit-Auto-Bot/
├── bot.js              # File utama bot
├── package.json        # Dependencies
├── accounts.json       # Konfigurasi akun Membit
├── proxy.txt          # Daftar proxy (opsional)
├── X/
│   └── cookies.json   # Cookies Twitter/X
└── README.md
```

## Cara Kerja

1. Bot memuat cookies Twitter/X dan login otomatis
2. Scrape post teratas dari timeline
3. Submit post ke Membit API untuk setiap akun
4. Kirim data engagement (likes, retweets, replies)
5. Log statistik poin dan eligible posts
6. Reload timeline dan ulangi proses

## Fitur Auto Recovery

- **Auto Cookie Refresh**: Refresh cookie setiap 4 jam
- **Feed Stall Guard**: Deteksi timeline stuck dan auto reload
- **Proxy Failover**: Otomatis ganti proxy jika gagal
- **Error Detection**: Deteksi halaman error dan auto reload

## Logging

Bot menggunakan color-coded logging:
- 🟢 **Hijau**: Operasi berhasil
- 🔴 **Merah**: Error
- 🔵 **Biru**: Informasi umum
- 🔵 **Cyan Bold**: Info akun
- 🔵 **Biru**: Separator

Format: `[HH:mm:ss WIB] pesan`

## Troubleshooting

### Bot tidak bisa scrape post
- Pastikan cookies Twitter/X masih valid
- Cek koneksi internet
- Pastikan timeline tidak kosong

### Error "KRITIKAL: File tidak ditemukan"
- Pastikan file `accounts.json` dan `X/cookies.json` ada
- Cek struktur folder

### Proxy error
- Cek format proxy di `proxy.txt`
- Pastikan proxy masih aktif
- Bot akan otomatis skip proxy yang gagal

### UUID tidak muncul
- Cek token Membit masih valid
- Cek format `accounts.json`
- Pastikan API Membit tidak sedang maintenance

## Keamanan

⚠️ **PENTING:**
- Jangan share `accounts.json` dan `cookies.json`
- Jangan commit file config ke repository public
- Gunakan `.gitignore` untuk exclude file sensitive

## Contributing

Pull requests are welcome! Untuk perubahan besar, buka issue terlebih dahulu.

## Disclaimer

Bot ini dibuat untuk tujuan edukasi. Gunakan dengan bijak dan patuhi Terms of Service Twitter/X dan Membit AI. Author tidak bertanggung jawab atas penyalahgunaan bot ini.

---

⭐ Jangan lupa star repository ini jika bermanfaat!
