#!/bin/bash
echo "=================================================="
echo "   SISTEM RUNNER OTOMATIS: WHATSAPP REUNI BOT      "
echo "=================================================="

# Check if node_modules directory exists
if [ ! -d "node_modules" ]; then
    echo "⏳ Paket dependensi (node_modules) tidak ditemukan."
    echo "📦 Menginstal dependensi secara otomatis..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Instalasi dependensi gagal. Pastikan koneksi internet aktif."
        exit 1
    fi
    echo "✅ Instalasi dependensi berhasil!"
fi

echo "🚀 Memulai WhatsApp Bot..."
npm start
