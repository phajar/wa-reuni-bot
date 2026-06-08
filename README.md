# 🟢 WhatsApp Bot & API Gateway — Panduan Instalasi Lengkap (PC, VPS, & Android Termux)

Dokumen ini berisi panduan langkah demi langkah untuk menginstal, mengonfigurasi, dan menjalankan **WhatsApp Gateway & Bot Interaktif** PP Al-Fatah dari awal (clean install) pada perangkat Windows/Linux VPS, serta panduan khusus instalasi di **HP Android menggunakan Termux**.

---

## 📋 Daftar Isi
1. [Prasyarat Sistem](#1-prasyarat-sistem)
2. [Langkah Instalasi di HP Android (Termux)](#2-langkah-instalasi-di-hp-android-termux)
3. [Langkah Instalasi di PC / Server VPS](#3-langkah-instalasi-di-pc--server-vps)
4. [Konfigurasi File Environment (.env)](#4-konfigurasi-file-environment-env)
5. [Menghubungkan Akun WhatsApp (Scan QR / Pairing Code)](#5-menghubungkan-akun-whatsapp)
6. [Sinkronisasi dengan Admin Panel Web](#6-sinkronisasi-dengan-admin-panel-web)
7. [🛠️ Troubleshooting & Solusi Error](#-troubleshooting--solusi-error)

---

## 1. Prasyarat Sistem

Sebelum melakukan instalasi, pastikan perangkat Anda memenuhi persyaratan minimum berikut:
*   **PC/Server**: Windows 10/11, macOS, atau Linux VPS (Ubuntu 20.04 LTS atau lebih baru).
*   **Android (Termux)**: Android versi 7.0 atau lebih baru dengan ruang penyimpanan kosong minimal 1GB.
*   **Node.js**: Versi **16.x**, **18.x**, atau **20.x** (LTS terbaru direkomendasikan).
*   **WhatsApp Active**: Akun WhatsApp aktif di smartphone untuk ditautkan sebagai host API.

---

## 2. Langkah Instalasi di HP Android (Termux)

Panduan ini ditujukan bagi Anda yang ingin menjalankan server WhatsApp Bot langsung dari HP Android secara mandiri menggunakan emulator terminal **Termux**.

> [!IMPORTANT]
> **PENTING**: Jangan unduh Termux dari Google Play Store karena versinya sudah usang dan repositorinya rusak. Unduh Termux versi terbaru melalui link resmi [F-Droid Termux](https://f-droid.org/en/packages/termux/).

### Langkah 1: Update & Upgrade Sistem Termux
Buka aplikasi Termux baru di HP Anda, lalu jalankan perintah berikut secara berurutan:
```bash
pkg update -y && pkg upgrade -y
```
*Jika muncul konfirmasi pilihan `[Y/n]`, ketik `y` lalu tekan Enter.*

### Langkah 2: Berikan Izin Akses Penyimpanan (Storage)
Jalankan perintah berikut agar Termux dapat membaca file di HP Anda:
```bash
termux-setup-storage
```
*Ketuk **Izinkan** pada jendela pop-up android yang muncul.*

### Langkah 3: Pasang Paket Pendukung & NodeJS
Pasang Git, NodeJS, Python, dan kompilator C++ (diperlukan untuk mengompilasi modul kompresi gambar `sharp` di arsitektur prosesor ARM HP Android):
```bash
pkg install git nodejs-lts build-essential python binutils -y
```

### Langkah 4: Kloning Repositori Bot
Unduh file proyek bot dari GitHub ke penyimpanan lokal Termux Anda:
```bash
git clone https://github.com/phajar/wa-reuni-bot.git
cd wa-reuni-bot
```

### Langkah 5: Pasang Modul Dependencies
Jalankan perintah ini untuk memasang modul nodejs:
```bash
npm install
```
> [!TIP]
> Jika instalasi modul `sharp` mengalami error saat kompilasi di Termux, jalankan perintah pemasangan library pembantu berikut terlebih dahulu:
> `pkg install libvips -y`
> Kemudian jalankan ulang `npm install`.

### Langkah 6: Membuat File Konfigurasi `.env`
Pasang teks editor `nano` untuk membuat berkas pengaturan:
```bash
pkg install nano -y
nano .env
```
Salin dan tempel konfigurasi Firebase/Cloudinary Anda di bawah ini ke dalam nano editor (sesuaikan nilainya):
```env
PORT=7860
FIREBASE_API_KEY=AIzaSyCfZ9zV6DOuSZoFoFvkW8NCSaxNlmn8R8k
FIREBASE_AUTH_DOMAIN=reuniakbar.firebaseapp.com
FIREBASE_PROJECT_ID=reuniakbar
FIREBASE_STORAGE_BUCKET=reuniakbar.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=542951643652
FIREBASE_APP_ID=1:542951643652:web:1b4b7dac6c676a5d6c3351
CLOUDINARY_CLOUD_NAME=dowih3wr7
CLOUDINARY_UPLOAD_PRESET=Reuniakbar
```
*Untuk menyimpan di nano editor: Tekan tombol volume bawah HP + O secara bersamaan, lalu Enter. Untuk keluar editor: Tekan tombol volume bawah HP + X.*

### Langkah 7: Menjalankan WhatsApp Bot
Jalankan server utama:
```bash
node server.js
```
Server bot Anda sekarang aktif di HP pada port `7860`.

> [!NOTE]
> **🚀 Fitur Auto-Tunneling (Otomatis Online / Dual-Mode)**:
> Saat Anda menjalankan `node server.js`, bot akan **otomatis membuat tunneling publik** secara mandiri dengan urutan:
> 1. Mencoba membuat SSH tunnel stabil via **`serveo.net`** (memerlukan paket `openssh` terpasang di HP).
> 2. Jika SSH gagal atau tidak terpasang, sistem otomatis beralih (*fallback*) ke **`localtunnel`** (WebAssembly).
> Setelah terowongan terbentuk, sistem akan otomatis memperbarui URL baru tersebut ke dokumen Firestore (`settings/whatsapp_api` -> `local_api_url`) beserta kunci keamanan API Anda. Anda tidak perlu menyalin-tempel link baru apa pun!

---

## 3. Langkah Instalasi di PC / Server VPS

Jika Anda ingin memasang di Windows PC atau Linux VPS:

1.  Masuk ke direktori bot:
    ```bash
    cd c:/Users/Ahmad/Downloads/alumni web/whatsapp-bot
    ```
2.  Pastikan Node.js sudah terpasang, lalu instal dependencies:
    ```bash
    npm install
    ```
3.  Buat berkas `.env` di folder ini seperti contoh di bagian [Konfigurasi `.env`](#4-konfigurasi-file-environment-env).
4.  Jalankan server:
    *   **Via Terminal**: `npm start`
    *   **Via Windows Shortcut (Double Click)**: Jalankan berkas **`jalankan-whatsapp.bat`** di folder root proyek utama.

---

## 4. Konfigurasi File Environment (`.env`)

Kredensial Firebase & Cloudinary yang diletakkan di berkas `.env`:

```env
PORT=7860
FIREBASE_API_KEY=AIzaSyCfZ9zV6DOuSZoFoFvkW8NCSaxNlmn8R8k
FIREBASE_AUTH_DOMAIN=reuniakbar.firebaseapp.com
FIREBASE_PROJECT_ID=reuniakbar
FIREBASE_STORAGE_BUCKET=reuniakbar.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=542951643652
FIREBASE_APP_ID=1:542951643652:web:1b4b7dac6c676a5d6c3351
CLOUDINARY_CLOUD_NAME=dowih3wr7
CLOUDINARY_UPLOAD_PRESET=Reuniakbar
```

---

## 5. Menghubungkan Akun WhatsApp

1.  Buka web browser di HP/PC Anda dan akses dashboard web bot:
    👉 **`http://localhost:7860`**
2.  **Scan QR Code**: Jika status menampilkan **`qr`**, buka WhatsApp di smartphone Anda &rarr; Ketuk tiga titik di kanan atas &rarr; **Perangkat Tertaut** &rarr; Ketuk **Tautkan Perangkat** &rarr; Scan kode QR yang tampil di browser.
3.  **Tautkan Menggunakan Pairing Code (Tanpa Scan QR)**:
    Kirim request API menggunakan Postman, cURL, atau terminal Termux tab baru:
    *   **Endpoint**: `POST http://localhost:7860/api/pair`
    *   **Payload**: `{ "phone": "628123456789" }`
    *   Masukkan kode alphanumeric yang diterima di HP Anda pada menu tautkan perangkat WhatsApp.

---

## 6. Sinkronisasi dengan Admin Panel Web

1.  Masuk ke halaman **Admin Panel Web** alumni (`http://localhost:3000` atau domain hosting Anda).
2.  Buka menu **WhatsApp Center** &rarr; tab **Cloud API Gateway**.
3.  Isi kolom **URL API WhatsApp Lokal** dengan alamat server bot Anda (misal: `http://localhost:7860` atau IP HP Anda di jaringan lokal).
4.  Klik **Simpan Pengaturan Gateway**.

---

## 🛠️ Troubleshooting & Solusi Error

### 1. Termux Mati Saat Layar HP Mati (Sleep Mode)
*   **Sebab**: Android secara agresif mematikan proses latar belakang untuk menghemat baterai.
*   **Solusi**:
    1. Tarik bar notifikasi atas HP Anda, temukan notifikasi Termux, lalu klik **"Acquire wake lock"**.
    2. Masuk ke Pengaturan Baterai HP Anda &rarr; **Optimasi Baterai** &rarr; Cari **Termux** &rarr; Setel ke **"Jangan Optimalkan"** (Don't Optimize / Unrestricted).

### 2. Menjaga Bot Tetap Hidup Terus-Menerus di Latar Belakang (PM2)
Pasang package manager proses PM2 agar bot dapat terus berjalan otomatis meskipun terjadi error/crash:
```bash
npm install -g pm2
pm2 start server.js --name wa-bot
pm2 save
pm2 startup
```
*Untuk melihat status: `pm2 status` | Untuk melihat logs: `pm2 logs wa-bot`*

### 3. Error: `Cannot find module '@whiskeysockets/baileys'`
*   **Sebab**: Instalasi NPM terputus.
*   **Solusi**: Hapus folder `node_modules` lalu jalankan kembali `npm install`.
    ```bash
    rm -rf node_modules
    npm install
    ```

### 4. Error: `Could not load the "sharp" module using the android-arm runtime` atau `EBADPLATFORM` (Termux)
*   **Sebab**: Modul pengolah gambar `sharp` gagal memuat addon native C++ karena perbedaan arsitektur CPU HP Android (`arm/arm64`), atau proses kompilasi native terhambat karena meminta dependensi `node-addon-api` / `node-gyp`.
*   **Solusi**: Paksa instalasi menggunakan modul **WebAssembly** yang tidak memerlukan kompilasi lokal di HP dengan mengabaikan pembatasan platform (`--force`):
    ```bash
    # Cara A: Paksa pasang modul WebAssembly
    npm install @img/sharp-wasm32 --force
    
    # Cara B: Jalankan manual instruksi spesifik CPU dari sharp
    npm install --cpu=wasm32 sharp
    ```

