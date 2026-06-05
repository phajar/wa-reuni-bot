# WhatsApp Bot & API Gateway - Alumni PP Al-Fatah

Repositori ini berisi server WhatsApp Gateway mandiri yang dibangun menggunakan Node.js dan library [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys). Bot ini terintegrasi langsung dengan database Firebase Firestore untuk menyinkronkan konfigurasi, memproses antrean notifikasi (donasi, registrasi alumni, log audit), dan mempublikasikan status WhatsApp secara otomatis.

---

## Fitur Utama

1.  **Multi-Sesi & Multi-Bot**: Mendukung pengelolaan beberapa akun bot secara dinamis melalui sesi lokal.
2.  **API Gateway Pengiriman Pesan**: Endpoint untuk mengirimkan teks, gambar, video, dan dokumen PDF (seperti laporan keuangan).
3.  **Posting Status WhatsApp**: Mempublikasikan WhatsApp Story (status teks atau gambar) langsung dari admin panel ke daftar kontak alumni terverifikasi.
4.  **Penautan Perangkat Fleksibel**: Mendukung tautan cepat menggunakan pemindaian **Kode QR** atau **Kode Tautan (Pairing Code)** lewat nomor telepon.
5.  **Sinkronisasi Sesi Cloud**: Mengamankan data sesi enkripsi ke Google Drive/Firestore agar koneksi tidak terputus saat bot dipindahkan atau dimulai ulang.

---

## Persyaratan Sistem

Sebelum memulai instalasi, pastikan perangkat Anda telah terpasang:
*   [Node.js](https://nodejs.org/) (Versi 16 atau lebih baru direkomendasikan)
*   [npm](https://www.npmjs.com/) (Biasanya terpasang otomatis bersama Node.js)
*   Koneksi Internet (untuk sinkronisasi Firestore)

---

## Panduan Instalasi & Penggunaan

### Langkah 1: Persiapan Folder
Buka terminal atau command prompt, lalu masuk ke direktori bot:
```bash
cd whatsapp-bot
```

### Langkah 2: Pasang Dependency
Jalankan perintah berikut untuk memasang seluruh library yang diperlukan:
```bash
npm install
```

### Langkah 3: Konfigurasi Firebase
Server bot menggunakan konfigurasi Firebase yang sama dengan aplikasi web. Berkas konfigurasi berada di `server.js` pada baris 33-40. Jika Anda memindahkan database, perbarui kunci API Firebase Anda di bagian tersebut:
```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    // ...
};
```

### Langkah 4: Menjalankan Server Bot
Untuk memulai server bot gateway, jalankan perintah:
```bash
npm start
```
Secara default, server akan berjalan di port `7860` (atau port yang disetel pada environment variable `PORT`).

*Catatan: Dari folder root aplikasi utama, Anda juga dapat menjalankan bot ini cukup dengan mengeklik dua kali berkas pintasan **`jalankan-whatsapp.bat`**.*

---

## Integrasi dengan Admin Panel Web

Setelah server bot aktif, Anda harus mendaftarkan URL server bot di Admin Panel Web:
1.  Masuk ke halaman **WhatsApp Center** di Web Admin.
2.  Pilih tab **Cloud API Gateway** di kolom kiri.
3.  Isi kolom **URL API WhatsApp Lokal** dengan alamat server bot Anda (contoh: `http://localhost:7860`). Jika menggunakan kunci keamanan API, tambahkan pemisah pipa (contoh: `http://localhost:7860|kunci_api_anda`).
4.  Klik **Simpan Pengaturan Gateway**.
5.    Kembali ke tab **Local Bot Server** di kolom kiri, lalu klik **Muat Ulang QR** untuk menautkan WhatsApp Anda.

---

## Panduan Uninstall & Pembersihan Sesi

Jika Anda ingin menghentikan penggunaan, membersihkan data sesi koneksi WhatsApp, atau menghapus total modul bot ini dari sistem Anda:

### 1. Menghentikan Bot & Memutuskan Sesi
*   **Melalui Admin Panel**: Buka halaman **WhatsApp Center** &rarr; tab **Local Bot Server** &rarr; klik tombol **Reset Sesi** pada panel Danger Zone. Langkah ini akan menghapus sesi pada server bot secara aman dan memutuskan tautan WhatsApp.
*   **Melalui Terminal**: Tekan tombol `Ctrl + C` pada jendela command prompt tempat bot berjalan untuk mematikan server.

### 2. Membersihkan Data Kredensial WhatsApp Lokal
Jika Anda ingin menghapus seluruh data sesi lokal agar dapat masuk dengan akun WhatsApp lain dari awal:
```bash
# Masuk ke direktori bot
cd whatsapp-bot

# Hapus folder kredensial enkripsi sesi
rmdir /s /q auth_info
```

### 3. Membersihkan Modul Dependensi (Penyimpanan)
Untuk menghapus library modul pihak ketiga yang sebelumnya terpasang:
```bash
# Hapus folder modul library pihak ketiga
rmdir /s /q node_modules
```

### 4. Menghapus Bot Secara Total
Setelah menghentikan proses dan menghapus data di atas, Anda dapat menghapus seluruh direktori `whatsapp-bot` secara langsung melalui File Explorer atau perintah:
```bash
cd ..
rmdir /s /q whatsapp-bot
```

---

## Endpoint API yang Tersedia

Seluruh request API wajib menyertakan Authorization Header jika API Key dikonfigurasi:
`Authorization: Bearer <API_KEY_ANDA>`

### 1. Mengirim Pesan / Media (`POST /send-message`)
Mengirim pesan teks atau berkas dokumen/gambar ke nomor tujuan atau grup.
*   **Payload**:
    ```json
    {
      "phone": "628123456789", 
      "message": "Halo ini uji coba pesan",
      "fileUrl": "https://example.com/document.pdf", // Opsional (bisa berupa URL atau Base64 DataURI)
      "fileType": "pdf" // Opsional (pdf, png, jpg)
    }
    ```

### 2. Memposting Status/Story (`POST /send-status`)
Mempublikasikan update status WhatsApp teks atau gambar.
*   **Payload**:
    ```json
    {
      "message": "Pengumuman reuni akbar!", // Teks status atau caption media
      "fileUrl": "data:image/png;base64,...", // Opsional (Gambar berformat Base64 DataURI)
      "fileType": "png" // Opsional
    }
    ```

### 3. Tautkan Nomor Telepon (`POST /api/pair`)
Meminta pairing code untuk penautan perangkat tanpa scan QR.
*   **Payload**: `{ "phone": "628123456789" }`

### 4. Health Check (`GET /ping`)
Memeriksa status koneksi bot.

---

## Struktur Berkas
*   `server.js`: Logika utama server express, penanganan koneksi Baileys WhatsApp, dan listener Firestore.
*   `auth_info/`: Folder penyimpanan sesi enkripsi WhatsApp (dibuat otomatis setelah terhubung). Jangan membagikan folder ini karena berisi kredensial akses WhatsApp Anda.
*   `package.json`: Informasi proyek dan daftar dependency.
