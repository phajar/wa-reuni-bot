# 🟢 WhatsApp Bot & API Gateway — Panduan Instalasi Lengkap

Dokumen ini berisi panduan langkah demi langkah untuk menginstal, mengonfigurasi, dan menjalankan **WhatsApp Gateway & Bot Interaktif** PP Al-Fatah dari awal (clean install) pada perangkat Windows atau server VPS.

---

## 📋 Daftar Isi
1. [Prasyarat Sistem](#1-prasyarat-sistem)
2. [Langkah 1: Persiapan Direktori & Kloning](#2-langkah-1-persiapan-direktori)
3. [Langkah 2: Instalasi NodeJS & NPM](#3-langkah-2-instalasi-nodejs)
4. [Langkah 3: Instalasi Dependencies](#4-langkah-3-instalasi-dependencies)
5. [Langkah 4: Konfigurasi File Environment (.env)](#5-langkah-4-konfigurasi-file-env)
6. [Langkah 5: Menjalankan Server Bot](#6-langkah-5-menjalankan-server-bot)
7. [Langkah 6: Menghubungkan Akun WhatsApp (Scan QR / Pairing Code)](#7-langkah-6-menghubungkan-akun-whatsapp)
8. [Langkah 7: Sinkronisasi dengan Admin Panel Web](#8-langkah-7-sinkronisasi-dengan-admin-panel-web)
9. [🛠️ Troubleshooting & Solusi Error](#-troubleshooting--solusi-error)

---

## 1. Prasyarat Sistem

Sebelum melakukan instalasi, pastikan perangkat Anda memenuhi persyaratan minimum berikut:
*   **Operating System**: Windows 10/11, macOS, atau Linux (Ubuntu 20.04 LTS atau lebih baru sangat direkomendasikan untuk VPS).
*   **Node.js**: Versi **16.x** atau **18.x** atau **20.x** (LTS terbaru direkomendasikan).
*   **Git**: Untuk sinkronisasi kode dari repositori GitHub (opsional, bisa unduh zip).
*   **WhatsApp Active**: Akun WhatsApp aktif di smartphone untuk ditautkan sebagai host API.

---

## 2. Langkah 1: Persiapan Direktori

Buka Terminal (Terminal macOS/Linux atau CMD/PowerShell di Windows), lalu masuk to folder proyek bot:

```bash
# Jika Anda mengunduh seluruh proyek alumni-web, masuk ke sub-folder bot:
cd c:/Users/Ahmad/Downloads/alumni web/whatsapp-bot

# Atau jika Anda baru saja mengkloning repositori ini secara terpisah:
git clone https://github.com/phajar/wa-reuni-bot.git
cd wa-reuni-bot
```

---

## 3. Langkah 2: Instalasi NodeJS

Jika Anda belum memiliki Node.js, silakan unduh dan instal terlebih dahulu:
1. Buka situs resmi [Node.js Downloads](https://nodejs.org/).
2. Unduh versi **LTS** (Recommended for Most Users).
3. Jalankan installer dan ikuti wizard instalasi sampai selesai.
4. Verifikasi instalasi di terminal dengan menjalankan:
   ```bash
   node -v
   npm -v
   ```
   *Jika versi Node muncul (misal `v18.16.0`), maka Node.js sudah terpasang dengan benar.*

---

## 4. Langkah 3: Instalasi Dependencies

Jalankan perintah berikut di dalam terminal untuk mengunduh dan memasang library modul yang dibutuhkan oleh server WhatsApp Baileys:

```bash
npm install
```

> [!TIP]
> Perintah di atas akan membaca file `package.json` dan otomatis memasang library penting seperti:
> *   `@whiskeysockets/baileys` (Konektor WhatsApp Web API)
> *   `express` & `cors` (Server HTTP API Gateway)
> *   `firebase` (Sinkronisasi database Firestore)
> *   `sharp` (Pemroses/kompresi gambar bukti transfer)
> *   `tesseract.js` (AI OCR untuk scan nominal struk)

---

## 5. Langkah 4: Konfigurasi File Env (`.env`)

Buat berkas baru bernama **`.env`** di dalam folder root `whatsapp-bot/` (satu tingkat dengan `server.js`). Isi file tersebut dengan kredensial Firebase dan Cloudinary Anda:

```env
# Port tempat server WhatsApp Bot berjalan (Default: 7860)
PORT=7860

# Konfigurasi Firebase Firestore (Dapatkan dari Console Firebase Anda)
FIREBASE_API_KEY=AIzaSyCfZ9zV6DOuSZoFoFvkW8NCSaxNlmn8R8k
FIREBASE_AUTH_DOMAIN=reuniakbar.firebaseapp.com
FIREBASE_PROJECT_ID=reuniakbar
FIREBASE_STORAGE_BUCKET=reuniakbar.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=542951643652
FIREBASE_APP_ID=1:542951643652:web:1b4b7dac6c676a5d6c3351

# Konfigurasi Cloudinary (Untuk menyimpan file bukti struk verifikasi)
CLOUDINARY_CLOUD_NAME=dowih3wr7
CLOUDINARY_UPLOAD_PRESET=Reuniakbar
```

> [!WARNING]
> Jangan pernah mengunggah file `.env` ini ke repositori publik GitHub Anda karena berisi kunci rahasia API database Anda. File ini sudah otomatis dimasukkan ke dalam `.gitignore`.

---

## 6. Langkah 5: Menjalankan Server Bot

Setelah dependencies terpasang dan `.env` selesai dikonfigurasi, Anda dapat menyalakan server dengan salah satu cara berikut:

### Opsi A: Jalankan langsung dari Terminal
```bash
npm start
```

### Opsi B: Jalankan menggunakan pintasan Windows Shortcut (Double Click)
Di folder root aplikasi utama, Anda cukup mengeklik ganda file pintasan berikut:
*   **`jalankan-whatsapp.bat`**

Saat pertama kali berjalan, server akan:
1. Membuka koneksi DNS dan memeriksa port `7860`.
2. Mencoba mengunduh file sesi cadangan dari Firestore document `/settings/wa_session` (jika ada).
3. Menampilkan status koneksi awal di konsol log.

---

## 7. Langkah 6: Menghubungkan Akun WhatsApp

Untuk mengaitkan WhatsApp Anda sebagai host pengirim pesan:

1. Buka browser di komputer Anda dan akses URL panel kontrol lokal bot:
   👉 **`http://localhost:7860`**
2. Anda akan melihat halaman dashboard utama server WhatsApp Gateway.
3. **Scan Kode QR**: Jika status menampilkan **`qr`**, sebuah Kode QR akan muncul di layar. Buka WhatsApp di HP Anda &rarr; Klik **Perangkat Tertaut** &rarr; Ketuk **Tautkan Perangkat** &rarr; Scan QR Code di browser.
4. **Gunakan Pairing Code (Alternatif)**: Jika Anda ingin menautkan perangkat dari jarak jauh menggunakan nomor HP tanpa scan QR, gunakan API endpoint berikut melalui client API (seperti Postman atau cURL):
   *   **Endpoint**: `POST http://localhost:7860/api/pair`
   *   **Payload**: `{ "phone": "628123456789" }`
   *   **Response**: `{ "success": true, "code": "ABC-123-XYZ" }` (Masukkan kode ini di WhatsApp HP Anda).

Setelah berhasil masuk, status di dashboard akan berubah menjadi **`open`** dan menampilkan nomor WhatsApp yang aktif terhubung.

---

## 8. Langkah 7: Sinkronisasi dengan Admin Panel Web

Langkah terakhir adalah mendaftarkan URL server bot lokal Anda ke aplikasi web admin utama:

1. Masuk ke **Admin Panel Web** alumni (`http://localhost:3000` atau URL hosting web admin).
2. Buka menu **WhatsApp Center** &rarr; tab **Cloud API Gateway**.
3. Di bidang input **URL API WhatsApp Lokal**, masukkan alamat server bot Anda:
   *   **Format**: `http://localhost:7860`
   *   *Catatan: Jika Anda menyetel pengaman kunci API (Bearer Token), gunakan format: `http://localhost:7860|kunci_keamanan_anda`.*
4. Klik **Simpan Pengaturan Gateway**.
5. Buka tab **Local Bot Server** di menu kiri WhatsApp Center untuk melihat status real-time, grafik ram/cpu bot, log pengiriman pesan, atau melakukan restart sesi/logout dari admin panel secara langsung.

---

## 🛠️ Troubleshooting & Solusi Error

### 1. Error: `Cannot find module '@whiskeysockets/baileys'` atau Modul Lainnya
*   **Sebab**: Proses instalasi dependencies gagal tengah jalan atau belum dilakukan.
*   **Solusi**: Hapus folder `node_modules` dan jalankan ulang perintah `npm install` dalam kondisi koneksi internet yang stabil.
    ```bash
    rmdir /s /q node_modules
    npm install
    ```

### 2. Error: `EADDRINUSE: address already in use :::7860`
*   **Sebab**: Port `7860` sedang digunakan oleh proses node lain atau aplikasi lain di komputer Anda.
*   **Solusi**: Ubah nilai `PORT` di file `.env` menjadi port lain (misal: `PORT=7865`), lalu restart server. Jangan lupa perbarui juga alamat gateway di Admin Panel Web menjadi `http://localhost:7865`.

### 3. Masalah: Sesi WhatsApp Sering Terputus (Log Out Sendiri)
*   **Sebab**: Folder `auth_info` terhapus secara tidak sengaja, atau memori server VPS terlalu penuh sehingga mematikan thread Baileys.
*   **Solusi**: Bot ini sudah dilengkapi fitur **Cloud Sync Firestore**. Sesi akan otomatis dicadangkan setiap 10 detik ke Firestore. Jika bot dimulai ulang atau dipindahkan ke server baru, sesi akan otomatis terunduh kembali secara aman asalkan dokumen Firestore `/settings/wa_session` tidak dihapus.

### 4. Error saat Memproses Gambar pada Server Linux VPS (`sharp` / image processing crash)
*   **Sebab**: VPS Linux memerlukan library OS tambahan untuk menjalankan plugin kompresi gambar `sharp`.
*   **Solusi**: Jalankan perintah berikut di server VPS Anda sebelum menjalankan `npm install`:
    ```bash
    sudo apt-get update
    sudo apt-get install -y build-essential libvips-dev
    ```

---

## 📂 Struktur Berkas Penting
*   `server.js`: Logika utama server gateway, pendaftaran listener Firestore (donasi masuk, verifikasi manual), dan routing REST API.
*   `.env`: Berkas konfigurasi Firebase dan Cloudinary (dibuat manual).
*   `auth_info/`: Folder kredensial sesi WhatsApp host (dibuat otomatis oleh Baileys). **Dilarang membagikan isi folder ini!**
*   `package.json`: Manifes proyek dan versi dependencies library.
