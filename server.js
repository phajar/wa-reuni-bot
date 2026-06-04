const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const dns = require('dns');

// Force IPv4 resolution first to bypass IPv6 handshake timeouts on Hugging Face Spaces
dns.setDefaultResultOrder('ipv4first');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, collection, getDocs, onSnapshot, query, where, addDoc } = require('firebase/firestore');
const cron = require('node-cron');

const botStartupTime = new Date().toISOString();
console.log(`[WA BOT] Bot started at ISO timestamp: ${botStartupTime}`);

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Firebase Configuration (Same as Client Side)
const firebaseConfig = {
    apiKey: "AIzaSyCfZ9zV6DOuSZoFoFvkW8NCSaxNlmn8R8k",
    authDomain: "reuniakbar.firebaseapp.com",
    projectId: "reuniakbar",
    storageBucket: "reuniakbar.firebasestorage.app",
    messagingSenderId: "542951643652",
    appId: "1:542951643652:web:1b4b7dac6c676a5d6c3351"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const AUTH_DIR = path.join(__dirname, 'auth_info');
let sock = null;
let qrCode = null;
let connectionStatus = 'connecting'; // 'connecting', 'qr', 'open', 'close'
let connectionUser = null;
let lastSyncHash = '';

// Helper to download session from Firestore
async function downloadSession(db) {
    if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    try {
        console.log('[FIRESTORE] Downloading session files...');
        const docRef = doc(db, 'settings', 'wa_session');
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            for (const [filename, content] of Object.entries(data)) {
                // Sanitize filename to prevent directory traversal
                const safeFilename = path.basename(filename);
                const filePath = path.join(AUTH_DIR, safeFilename);
                fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
            }
            console.log('[FIRESTORE] Session downloaded successfully.');
        } else {
            console.log('[FIRESTORE] No session found, starting fresh.');
        }
    } catch (e) {
        console.error('[FIRESTORE] Error downloading session:', e);
    }
}

// Helper to upload session to Firestore
async function uploadSession(db) {
    if (!fs.existsSync(AUTH_DIR)) return;
    try {
        console.log('[FIRESTORE] Uploading session files...');
        const files = fs.readdirSync(AUTH_DIR);
        const data = {};
        for (const file of files) {
            const filePath = path.join(AUTH_DIR, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
                const content = fs.readFileSync(filePath);
                data[file] = content.toString('base64');
            }
        }
        
        if (Object.keys(data).length > 0) {
            const docRef = doc(db, 'settings', 'wa_session');
            await setDoc(docRef, data);
            console.log('[FIRESTORE] Session uploaded successfully.');
        }
    } catch (e) {
        console.error('[FIRESTORE] Error uploading session:', e);
    }
}

// Generate directory file hash to monitor modifications
function getFolderHash() {
    if (!fs.existsSync(AUTH_DIR)) return '';
    try {
        const files = fs.readdirSync(AUTH_DIR);
        let hash = '';
        for (const file of files) {
            const filePath = path.join(AUTH_DIR, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
                hash += file + stat.mtimeMs + stat.size;
            }
        }
        return hash;
    } catch (e) {
        return '';
    }
}

// Start auto sync background task
function startAutoSync(db) {
    setInterval(async () => {
        const currentHash = getFolderHash();
        if (currentHash && currentHash !== lastSyncHash) {
            lastSyncHash = currentHash;
            await uploadSession(db);
        }
    }, 10000); // Sync every 10 seconds if files changed
}

let isAutoSyncStarted = false;

// Network Diagnostics to debug connection and DNS issues in Hugging Face Spaces
function runNetworkDiagnostics() {
    console.log('[DIAGNOSTIC] Running network diagnostics...');
    
    // Test direct IP resolutions and TCP connects
    const hosts = ['web.whatsapp.com', 'wabi-ws.whatsapp.com'];
    const net = require('net');
    
    hosts.forEach(host => {
        dns.resolve(host, (err, addresses) => {
            if (err) {
                console.error(`[DIAGNOSTIC] DNS resolution failed for ${host}:`, err.message);
            } else {
                console.log(`[DIAGNOSTIC] DNS resolved for ${host}:`, addresses);
                if (addresses && addresses.length > 0) {
                    const ip = addresses[0];
                    console.log(`[DIAGNOSTIC] Attempting TCP connection to ${host} (${ip}):443...`);
                    const client = net.connect({ host: ip, port: 443 }, () => {
                        console.log(`[DIAGNOSTIC] TCP connection successful to ${host} (${ip}):443!`);
                        client.end();
                    });
                    client.on('error', (connectErr) => {
                        console.error(`[DIAGNOSTIC] TCP connection failed to ${host} (${ip}):443:`, connectErr.message);
                    });
                    client.setTimeout(10000, () => {
                        console.error(`[DIAGNOSTIC] TCP connection timed out for ${host} (${ip}):443`);
                        client.destroy();
                    });
                }
            }
        });
    });
}

async function connectToWhatsApp() {
    console.log('[WA] Connecting to WhatsApp...');
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Fetch the latest version dynamically with a robust fallback
    let waVersion = [2, 3000, 1017588726]; // Fallback version array
    try {
        const { version: latestVersion, isLatest } = await fetchLatestBaileysVersion();
        console.log(`[WA] Fetched WhatsApp Web v${latestVersion.join('.')}, isLatest: ${isLatest}`);
        waVersion = latestVersion;
    } catch (err) {
        console.error('[WA] Failed to fetch latest WhatsApp version from server, using stable fallback version:', err.message);
    }

    sock = makeWASocket({
        auth: state,
        version: waVersion,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 60000, // Extend timeout to 60 seconds
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    // Wrap sock.sendMessage with a queue to implement randomized delay (anti-ban protection)
    const originalSendMessage = sock.sendMessage.bind(sock);
    const messageQueue = [];
    let isProcessingQueue = false;

    async function processMessageQueue() {
        if (isProcessingQueue) return;
        isProcessingQueue = true;
        
        while (messageQueue.length > 0) {
            const { resolve, reject, jid, content, options } = messageQueue.shift();
            try {
                // Randomized delay between 2000ms and 5000ms
                const delay = Math.floor(Math.random() * 3000) + 2000;
                await new Promise(res => setTimeout(res, delay));
                
                const res = await originalSendMessage(jid, content, options);
                resolve(res);
            } catch (err) {
                console.error('[QUEUE] Gagal mengirim pesan antrean:', err.message);
                reject(err);
            }
        }
        
        isProcessingQueue = false;
    }

    sock.sendMessage = function(jid, content, options = {}) {
        return new Promise((resolve, reject) => {
            console.log(`[QUEUE] Menambahkan pesan untuk ${jid} ke antrean. Sisa antrean: ${messageQueue.length + 1}`);
            messageQueue.push({ resolve, reject, jid, content, options });
            processMessageQueue();
        });
    };

    sock.ev.on('creds.update', saveCreds);

    // Handler pesan masuk (Bot Interaktif)
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;
            if (m.key.fromMe) return; // Abaikan pesan dari bot sendiri
            
            const jid = m.key.remoteJid;
            const messageType = Object.keys(m.message)[0];
            let msgText = '';
            if (messageType === 'conversation') {
                msgText = m.message.conversation;
            } else if (messageType === 'extendedTextMessage') {
                msgText = m.message.extendedTextMessage.text;
            } else if (messageType === 'imageMessage') {
                msgText = m.message.imageMessage.caption;
            }
            
            if (!msgText) return;
            const cleanMsg = msgText.trim();
            const command = cleanMsg.toLowerCase();
            
            if (command === '!saldo') {
                console.log(`[WA BOT] Perintah !saldo dari ${jid}`);
                await handleSaldoCommand(jid);
            } else if (command === '!laporan') {
                console.log(`[WA BOT] Perintah !laporan dari ${jid}`);
                await handleLaporanCommand(jid);
            } else if (command === '!iuran') {
                console.log(`[WA BOT] Perintah !iuran dari ${jid}`);
                await handleIuranCommand(jid);
            } else if (command.startsWith('!konfirmasi')) {
                console.log(`[WA BOT] Perintah !konfirmasi dari ${jid}`);
                await handleKonfirmasiCommand(jid, m, cleanMsg);
            } else if (command.startsWith('!setuju-alumni') || command.startsWith('!approve-alumni')) {
                console.log(`[WA BOT] Perintah !setuju-alumni/!approve-alumni dari ${jid}`);
                await handleApproveAlumniCommand(jid, m, cleanMsg);
            } else if (command.startsWith('!setuju') || command.startsWith('!approve')) {
                console.log(`[WA BOT] Perintah !setuju/!approve dari ${jid}`);
                await handleApproveCommand(jid, m, cleanMsg);
            } else if (command === '!backup-db') {
                console.log(`[WA BOT] Perintah !backup-db dari ${jid}`);
                await handleBackupDbCommand(jid, m);
            } else if (command === '!menu') {
                console.log(`[WA BOT] Perintah !menu dari ${jid}`);
                await handleMenuCommand(jid, m);
            } else if (command === '!help') {
                console.log(`[WA BOT] Perintah !help dari ${jid}`);
                await handleHelpCommand(jid, m);
            }
        } catch (err) {
            console.error('[WA BOT] Gagal memproses pesan masuk:', err);
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCode = qr;
            connectionStatus = 'qr';
            console.log('New QR Code generated.');
        }

        if (connection === 'close') {
            qrCode = null;
            const error = lastDisconnect.error;
            const statusCode = error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`Connection closed: ${error?.message || error}. StatusCode: ${statusCode}. Reconnecting: ${shouldReconnect}`);
            connectionStatus = 'close';
            
            if (shouldReconnect) {
                console.log('[WA] Reconnecting in 5 seconds...');
                setTimeout(connectToWhatsApp, 5000);
            } else {
                console.log('Logged out from WhatsApp. Resetting session...');
                if (fs.existsSync(AUTH_DIR)) {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                }
                try {
                    const docRef = doc(db, 'settings', 'wa_session');
                    await setDoc(docRef, {});
                    console.log('Firestore session cleared.');
                } catch (e) {
                    console.error('Failed to clear Firestore session:', e);
                }
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            qrCode = null;
            connectionStatus = 'open';
            connectionUser = sock.user.id.split(':')[0];
            console.log('Connected to WhatsApp: ' + connectionUser);
            // Sync session immediately on successful login
            await uploadSession(db);
        }
    });
}

async function startServer() {
    // Run diagnostics
    runNetworkDiagnostics();

    // 1. Download session ONCE at startup
    await downloadSession(db);
    
    // 2. Start WhatsApp Connection
    await connectToWhatsApp();
    
    // 3. Start Auto Sync to Firestore ONCE
    if (!isAutoSyncStarted) {
        startAutoSync(db);
        isAutoSyncStarted = true;
    }
    
    // 4. Initialize Scheduled Reports
    initScheduledReports(db);
    
    // 5. Initialize Alumni Registration Listener
    initAlumniRegistrationListener(db);
    
    // 6. Initialize Audit Log Listener
    initAuditLogListener(db);
}

// Start Baileys WhatsApp Connection
startServer();

// --- HTTP ROUTES ---

// Render simple control webpage
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <title>WhatsApp Gateway - Reuni Akbar Ponpes AL-FATAH</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800;900&display=swap');
            body { font-family: 'Plus Jakarta Sans', sans-serif; background: #060813; color: #e2e8f0; }
            .glass { background: rgba(14, 18, 37, 0.65); backdrop-filter: blur(24px); border: 1px solid rgba(255, 255, 255, 0.06); }
        </style>
    </head>
    <body class="min-h-screen flex items-center justify-center p-4">
        <div class="glass w-full max-w-md p-8 rounded-[2.5rem] text-center shadow-2xl border border-indigo-500/20">
            <h1 class="text-2xl font-black text-white uppercase tracking-wider mb-2">WhatsApp Gateway</h1>
            <p class="text-xs text-slate-400 mb-6">Status Server: <span class="text-emerald-400 font-bold uppercase" id="status">${connectionStatus}</span></p>
            
            <div id="qr-container" class="bg-white p-5 rounded-3xl w-fit mx-auto mb-6 hidden border-4 border-indigo-500/20">
                <div id="qrcode" class="mx-auto"></div>
                <p class="text-[10px] text-indigo-900 mt-3 font-black uppercase tracking-wider">PENTING: Scan menggunakan WhatsApp HP Anda</p>
            </div>
            
            <div id="connected-container" class="hidden py-6">
                <div class="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 border border-emerald-500/20">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h2 class="text-lg font-black text-white mb-1">WhatsApp Terhubung!</h2>
                <p class="text-xs text-slate-400">Siap mengirim pesan otomatis.</p>
                <p class="text-sm text-emerald-400 font-black font-mono mt-3 bg-emerald-950/40 py-1.5 px-4 rounded-full border border-emerald-500/20 w-fit mx-auto" id="phone-number"></p>
            </div>
            
            <div id="connecting-container" class="py-6">
                <div class="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p class="text-xs text-slate-400">Menghubungkan ke WhatsApp...</p>
            </div>
        </div>
        
        <script>
            let lastStatus = '';
            function checkStatus() {
                fetch('/api/status')
                    .then(res => res.json())
                    .then(data => {
                        document.getElementById('status').innerText = data.status;
                        
                        if (data.status === 'qr' && data.qr) {
                            document.getElementById('connecting-container').classList.add('hidden');
                            document.getElementById('connected-container').classList.add('hidden');
                            document.getElementById('qr-container').classList.remove('hidden');
                            
                            if (lastStatus !== 'qr' || document.getElementById('qrcode').innerHTML === '') {
                                document.getElementById('qrcode').innerHTML = '';
                                new QRCode(document.getElementById('qrcode'), {
                                    text: data.qr,
                                    width: 200,
                                    height: 200,
                                    colorDark: "#0c112b",
                                    colorLight: "#ffffff"
                                });
                            }
                        } else if (data.status === 'open') {
                            document.getElementById('connecting-container').classList.add('hidden');
                            document.getElementById('qr-container').classList.add('hidden');
                            document.getElementById('connected-container').classList.remove('hidden');
                            document.getElementById('phone-number').innerText = '+' + data.user;
                        } else {
                            document.getElementById('qr-container').classList.add('hidden');
                            document.getElementById('connected-container').classList.add('hidden');
                            document.getElementById('connecting-container').classList.remove('hidden');
                        }
                        
                        lastStatus = data.status;
                    })
                    .catch(err => console.error(err));
            }
            setInterval(checkStatus, 3000);
            checkStatus();
        </script>
    </body>
    </html>
    `);
});

// GET Endpoint for status check
app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: qrCode,
        user: connectionUser
    });
});

// GET Endpoint to fetch participating groups
app.get('/api/groups', async (req, res) => {
    if (connectionStatus !== 'open' || !sock) {
        return res.status(503).json({ success: false, error: 'WhatsApp bot is not connected.' });
    }
    
    try {
        console.log('[WA] Fetching participating groups...');
        const rawGroups = await sock.groupFetchAllParticipating();
        
        // Format to list
        const groups = Object.values(rawGroups).map(g => ({
            jid: g.id,
            name: g.subject || 'Grup Tanpa Nama'
        }));
        
        console.log(`[WA] Successfully fetched ${groups.length} groups.`);
        return res.json({ success: true, groups: groups });
    } catch (err) {
        console.error('[WA] Failed to fetch groups:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET Endpoint to fetch subscribed newsletters (channels)
app.get('/api/channels', async (req, res) => {
    if (connectionStatus !== 'open' || !sock) {
        return res.status(503).json({ success: false, error: 'WhatsApp bot is not connected.' });
    }
    
    try {
        console.log('[WA] Fetching subscribed channels/newsletters...');
        const result = await sock.query({
            tag: 'iq',
            attrs: {
                id: sock.generateMessageTag(),
                type: 'get',
                to: 's.whatsapp.net',
                xmlns: 'w:mex'
            },
            content: [
                {
                    tag: 'query',
                    attrs: { query_id: '6388546374527196' },
                    content: Buffer.from(JSON.stringify({ variables: {} }), 'utf-8')
                }
            ]
        });
        
        const child = Array.isArray(result.content) ? result.content.find(n => n.tag === 'result') : null;
        if (child && child.content) {
            const data = JSON.parse(child.content.toString());
            if (data.errors && data.errors.length > 0) {
                const errMsg = data.errors.map(e => e.message).join(', ');
                return res.status(500).json({ success: false, error: errMsg });
            }
            
            const rawList = data?.data?.xwa2_newsletter_subscribed || [];
            
            // Format to a clean list matching groups list format
            const channels = rawList.map(item => {
                const meta = item.thread_metadata || {};
                return {
                    jid: item.id || '',
                    name: meta.name?.text || 'Channel Tanpa Nama',
                    description: meta.description?.text || '',
                    subscribers: parseInt(meta.subscribers_count || '0', 10),
                    role: item.viewer_metadata?.role || 'follower'
                };
            });
            
            console.log(`[WA] Successfully fetched ${channels.length} channels.`);
            return res.json({ success: true, channels: channels });
        }
        
        return res.status(500).json({ success: false, error: 'Unexpected response from WhatsApp server.' });
    } catch (err) {
        console.error('[WA] Failed to fetch subscribed channels:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST Endpoint for phone pairing code request
app.post('/api/pair', async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }
    
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('08')) {
        cleanPhone = '628' + cleanPhone.substring(2);
    }
    
    if (!sock) {
        return res.status(503).json({ success: false, error: 'WhatsApp bot is not connected.' });
    }
    
    try {
        console.log(`[WA] Generating pairing code for ${cleanPhone}...`);
        const code = await sock.requestPairingCode(cleanPhone);
        res.json({ success: true, code: code });
    } catch (err) {
        console.error('[WA] Failed to generate pairing code:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST Endpoint to send message
app.post('/send-message', async (req, res) => {
    const { phone, message, fileUrl, fileType } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Phone number and message are required.' });
    }

    if (connectionStatus !== 'open' || !sock) {
        return res.status(503).json({ success: false, error: 'WhatsApp bot is not connected.' });
    }

    try {
        let jid;
        let cleanPhone = phone;
        if (phone.includes('@')) {
            jid = phone;
        } else {
            cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone.startsWith('08')) {
                cleanPhone = '628' + cleanPhone.substring(2);
            }
            jid = `${cleanPhone}@s.whatsapp.net`;
        }
        
        if (fileUrl) {
            console.log(`[WA BOT] Sending media to ${cleanPhone}: URL=${fileUrl.startsWith('data:') ? 'base64_data' : fileUrl}, Type=${fileType}`);
            let isImage = false;
            let mediaContent;
            let mimeType;
            let fileName = 'document';

            if (fileUrl.startsWith('data:')) {
                const matches = fileUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    mimeType = matches[1];
                    const base64Data = matches[2];
                    mediaContent = Buffer.from(base64Data, 'base64');
                    isImage = mimeType.startsWith('image/');
                    
                    const ext = mimeType.split('/')[1] || 'bin';
                    fileName = `Laporan_Keuangan_Reuni.${ext}`;
                } else {
                    return res.status(400).json({ success: false, error: 'Invalid data URI format.' });
                }
            } else {
                if (fileType) {
                    isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fileType.toLowerCase());
                } else {
                    const ext = fileUrl.split('.').pop().toLowerCase();
                    isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
                }
                
                if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
                    mediaContent = { url: fileUrl };
                } else {
                    let localPath = fileUrl;
                    if (localPath.startsWith('file://')) {
                        localPath = decodeURIComponent(localPath.replace(/^file:\/\/\/?/, ''));
                    }
                    if (fs.existsSync(localPath)) {
                        mediaContent = fs.readFileSync(localPath);
                    } else {
                        mediaContent = { url: fileUrl };
                    }
                }
                mimeType = (fileType === 'pdf' || fileUrl.endsWith('.pdf')) ? 'application/pdf' : 'application/octet-stream';
                fileName = fileUrl.split('/').pop() || 'document';
            }

            if (isImage) {
                await sock.sendMessage(jid, {
                    image: mediaContent,
                    caption: message
                });
            } else {
                await sock.sendMessage(jid, {
                    document: mediaContent,
                    mimetype: mimeType,
                    fileName: fileName,
                    caption: message
                });
            }
        } else {
            await sock.sendMessage(jid, { text: message });
        }
        
        console.log(`[WA BOT] Message sent successfully to ${cleanPhone}`);
        return res.json({ success: true });
    } catch (error) {
        console.error('[WA BOT] Failed to send message:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Keep Alive / Wake Up Endpoint
app.get('/ping', (req, res) => {
    res.json({ success: true, status: connectionStatus });
});

// Listen on environment port or 7860 for Hugging Face
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// --- HELPER FUNCTIONS FOR INTERACTIVE BOT & CRON SCHEDULER ---

function formatRupiah(angka) {
    if (angka === undefined || angka === null) return 'Rp 0';
    const number_string = String(angka).replace(/[^,\d]/g, '').toString();
    const split = number_string.split(',');
    const sisa = split[0].length % 3;
    let rupiah = split[0].substr(0, sisa);
    const ribuan = split[0].substr(sisa).match(/\d{3}/gi);

    if (ribuan) {
        const separator = sisa ? '.' : '';
        rupiah += separator + ribuan.join('.');
    }

    rupiah = split[1] !== undefined ? rupiah + ',' + split[1] : rupiah;
    return 'Rp ' + rupiah;
}

function getMimeType(buffer) {
    if (buffer.length > 4) {
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return 'image/png';
        }
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
            return 'image/jpeg';
        }
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
            return 'image/gif';
        }
    }
    return 'image/png';
}

async function handleSaldoCommand(jid) {
    try {
        const financeCol = collection(db, 'finance');
        const querySnapshot = await getDocs(financeCol);
        
        let inC = 0, outC = 0;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const kategori = data.kategori || '';
            const status = String(data.status || '').toLowerCase().trim();
            const nominal = Number(data.nominal) || 0;
            
            const isRAB = kategori === 'RAB';
            const isPending = status === 'pending_payment';
            const isValid = (!isRAB && !isPending) || (isRAB && status === 'pengeluaran');
            
            if (isValid) {
                if (status === 'pengeluaran') {
                    outC += nominal;
                } else {
                    inC += nominal;
                }
            }
        });
        
        const saldo = inC - outC;
        const msg = `*📊 RINGKASAN SALDO KAS REUNI AL-FATAH*\n\n` +
                    `• *Total Pemasukan* : ${formatRupiah(inC)}\n` +
                    `• *Total Pengeluaran*: ${formatRupiah(outC)}\n` +
                    `• *Saldo Kas Riil*  : *${formatRupiah(saldo)}*\n\n` +
                    `_Data di-update secara real-time dari Ledger Keuangan Portal._`;
                    
        await sock.sendMessage(jid, { text: msg });
    } catch (err) {
        console.error('[WA BOT] Gagal memproses perintah !saldo:', err);
        await sock.sendMessage(jid, { text: 'Maaf, terjadi kesalahan saat mengambil data saldo keuangan.' });
    }
}

async function handleLaporanCommand(jid) {
    try {
        const financeCol = collection(db, 'finance');
        const querySnapshot = await getDocs(financeCol);
        
        const listData = [];
        let inC = 0, outC = 0;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const kategori = data.kategori || '';
            const status = String(data.status || '').toLowerCase().trim();
            const nominal = Number(data.nominal) || 0;
            
            const isRAB = kategori === 'RAB';
            const isPending = status === 'pending_payment';
            const isValid = (!isRAB && !isPending) || (isRAB && status === 'pengeluaran');
            
            if (isValid) {
                if (status === 'pengeluaran') {
                    outC += nominal;
                } else {
                    inC += nominal;
                }
                listData.push({
                    tanggal: data.tanggal || '',
                    keterangan: data.nama || data.keterangan || data.nama_pembayar || '-',
                    kategori: data.kategori || '-',
                    status: status,
                    nominal: nominal
                });
            }
        });
        
        const saldo = inC - outC;
        const latestTrans = listData.slice(-5).reverse();
        
        let transMsg = '';
        latestTrans.forEach((t, idx) => {
            const dateStr = String(t.tanggal).split(',')[0] || '-';
            const tipe = t.status === 'pengeluaran' ? '🔴 Keluar' : '🟢 Masuk';
            const sign = t.status === 'pengeluaran' ? '-' : '+';
            transMsg += `${idx + 1}. *[${dateStr}]* ${t.keterangan}\n` +
                        `   _${t.kategori}_ | *${tipe}*: ${sign}${formatRupiah(t.nominal)}\n\n`;
        });
        
        const msg = `*📄 LAPORAN KEUANGAN REUNI AL-FATAH*\n` +
                    `----------------------------------------\n\n` +
                    `*RINGKASAN DANA:*\n` +
                    `• Realisasi Pemasukan : ${formatRupiah(inC)}\n` +
                    `• Realisasi Pengeluaran: ${formatRupiah(outC)}\n` +
                    `• Saldo Kas Riil Saat Ini: *${formatRupiah(saldo)}*\n\n` +
                    `*5 TRANSAKSI TERAKHIR:*\n` +
                    `----------------------------------------\n` +
                    (transMsg || '_Belum ada transaksi recorded._\n\n') +
                    `----------------------------------------\n` +
                    `Untuk melihat laporan resmi PDF/PNG lengkap silakan kunjungi:\n` +
                    `👉 https://phajar.github.io/Reuni/keuangan.html\n\n` +
                    `_Pesan otomatis dikirim oleh Bot Portal Alumni PP Al-Fatah_`;
                    
        let hasImage = false;
        try {
            const sharp = require('sharp');
            
            // 1. Load dynamic letterhead logo from filesystem
            let logoBase64 = '';
            try {
                const logoPath = path.join(__dirname, '..', 'img', 'logo.png');
                if (fs.existsSync(logoPath)) {
                    const logoBuffer = fs.readFileSync(logoPath);
                    logoBase64 = `data:${getMimeType(logoBuffer)};base64,${logoBuffer.toString('base64')}`;
                }
            } catch (logoErr) {
                console.error('[WA BOT] Gagal membaca logo.png:', logoErr.message);
            }

            // 2. Query panitia collection from Firestore
            let ketuaData = { nama: 'Tatang Firmansyah', jabatan: 'Ketua Panitia', tanda_tangan: null };
            let bendaharaData = { nama: 'Ahmad Pajar Bahri', jabatan: 'Bendahara', tanda_tangan: null };

            try {
                const panitiaCol = collection(db, 'panitia');
                const panitiaSnapshot = await getDocs(panitiaCol);
                panitiaSnapshot.forEach((doc) => {
                    const data = doc.data();
                    const jabatan = String(data.jabatan || '').toLowerCase();
                    if (jabatan.includes('ketua')) {
                        ketuaData = {
                            nama: data.nama || 'Tatang Firmansyah',
                            jabatan: data.jabatan || 'Ketua Panitia',
                            tanda_tangan: data.tanda_tangan || null
                        };
                    } else if (jabatan.includes('bendahara')) {
                        bendaharaData = {
                            nama: data.nama || 'Ahmad Pajar Bahri',
                            jabatan: data.jabatan || 'Bendahara',
                            tanda_tangan: data.tanda_tangan || null
                        };
                    }
                });
            } catch (panitiaErr) {
                console.error('[WA BOT] Gagal memuat data panitia dari Firestore:', panitiaErr.message);
            }

            const svgString = generateVisualReportSvg(inC, outC, saldo, latestTrans, logoBase64, ketuaData, bendaharaData);
            const imageBuffer = await sharp(Buffer.from(svgString)).png().toBuffer();
            
            await sock.sendMessage(jid, {
                image: imageBuffer,
                caption: msg
            });
            hasImage = true;
            console.log(`[WA BOT] Visual reports sent as image to ${jid}`);
        } catch (imgErr) {
            console.error('[WA BOT] Gagal membuat/mengirim visual report PNG, fallback ke teks:', imgErr.message);
        }
        
        if (!hasImage) {
            await sock.sendMessage(jid, { text: msg });
        }
    } catch (err) {
        console.error('[WA BOT] Gagal memproses perintah !laporan:', err);
        await sock.sendMessage(jid, { text: 'Maaf, terjadi kesalahan saat memproses laporan keuangan.' });
    }
}

async function handleIuranCommand(jid) {
    try {
        const configDocRef = doc(db, 'settings', 'wa_bot_config');
        const configSnap = await getDoc(configDocRef);
        
        let iuranMsg = '';
        if (configSnap.exists()) {
            const data = configSnap.data();
            iuranMsg = data.iuran_info || '';
        }
        
        let qrisImageUrl = null;

        // If there's no custom iuran_info set by the admin, build it dynamically from payment_accounts
        if (!iuranMsg.trim()) {
            const accountsCol = collection(db, 'payment_accounts');
            const accountsSnap = await getDocs(accountsCol);
            let accountsText = '';
            let qrisAcc = null;
            
            accountsSnap.forEach((doc) => {
                const acc = doc.data();
                const bank = (acc.bank || '').toUpperCase().trim();
                const norek = acc.norek || '';
                const nama = acc.nama_rek || acc.nama || '';
                
                if (bank === 'QRIS') {
                    qrisAcc = acc;
                    accountsText += `💳 *QRIS (${nama})*\n• Status: *Aktif (Scan QR Code)*\n\n`;
                } else if (norek && norek !== 'QRIS Otomatis') {
                    accountsText += `💳 *BANK ${bank}*\n• No. Rekening: *${norek}*\n• Atas Nama: *${nama}*\n\n`;
                }
            });
            
            if (qrisAcc) {
                if (qrisAcc.qris_url && qrisAcc.qris_url.trim() !== '') {
                    qrisImageUrl = qrisAcc.qris_url;
                } else if (qrisAcc.qris_data) {
                    qrisImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrisAcc.qris_data)}`;
                }
            }
            
            if (!accountsText.trim()) {
                accountsText = `💳 *BANK MANDIRI*\n• No. Rekening: *1360012345678*\n• Atas Nama: *Bendahara Reuni Al-Fatah*\n\n`;
            }
            
            iuranMsg = `*✨ INFO METODE PEMBAYARAN IURAN REUNI ✨*\n\n` +
                       `Halo Rekan Alumni/Panitia, berikut adalah metode pembayaran resmi yang terdaftar di sistem kami:\n\n` +
                       accountsText +
                       `Setelah melakukan transfer/scan, mohon konfirmasi & unggah bukti transfer Anda melalui link resmi berikut:\n` +
                       `👉 https://phajar.github.io/Reuni/pembayaran.html\n\n` +
                       `Terima kasih atas partisipasi dan dukungan Anda!`;
        } else {
            // If custom iuran_info is set, we still try to attach QRIS if it exists in payment_accounts
            try {
                const accountsCol = collection(db, 'payment_accounts');
                const accountsSnap = await getDocs(accountsCol);
                let qrisAcc = null;
                accountsSnap.forEach((doc) => {
                    const acc = doc.data();
                    const bank = (acc.bank || '').toUpperCase().trim();
                    if (bank === 'QRIS') {
                        qrisAcc = acc;
                    }
                });
                
                if (qrisAcc) {
                    if (qrisAcc.qris_url && qrisAcc.qris_url.trim() !== '') {
                        qrisImageUrl = qrisAcc.qris_url;
                    } else if (qrisAcc.qris_data) {
                        qrisImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrisAcc.qris_data)}`;
                    }
                }
            } catch (err) {
                console.warn('[WA BOT] Gagal memuat QRIS untuk template iuran custom:', err.message);
            }
        }
        
        if (qrisImageUrl) {
            try {
                console.log(`[WA BOT] Sending QRIS image from URL: ${qrisImageUrl}`);
                await sock.sendMessage(jid, {
                    image: { url: qrisImageUrl },
                    caption: iuranMsg
                });
                return;
            } catch (mediaErr) {
                console.error('[WA BOT] Gagal mengirim QRIS sebagai gambar, fallback ke teks:', mediaErr.message);
            }
        }
        
        await sock.sendMessage(jid, { text: iuranMsg });
    } catch (err) {
        console.error('[WA BOT] Gagal memproses perintah !iuran:', err);
        await sock.sendMessage(jid, { text: 'Maaf, terjadi kesalahan saat mengambil informasi iuran.' });
    }
}

async function uploadBufferToCloudinary(buffer) {
    try {
        const formData = new FormData();
        const fileBlob = new Blob([buffer], { type: 'image/jpeg' });
        formData.append('file', fileBlob, 'receipt.jpg');
        formData.append('upload_preset', 'Reuniakbar');
        
        const response = await fetch('https://api.cloudinary.com/v1_1/dowih3wr7/image/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Cloudinary upload returned HTTP status ${response.status}`);
        }
        
        const data = await response.json();
        return data.secure_url || null;
    } catch (err) {
        console.error('[Cloudinary Upload Error]', err);
        return null;
    }
}

async function handleKonfirmasiCommand(jid, m, msgText) {
    try {
        // Extract sender JID prioritizing phone number (Pn) fields over LID fields
        let senderJid = '';
        if (jid && jid.endsWith('@g.us')) {
            senderJid = m.key.participantPn || m.key.participant || '';
        } else {
            senderJid = m.key.senderPn || jid || '';
        }
        
        const senderNumber = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        
        if (!senderNumber) {
            await sock.sendMessage(jid, { text: 'Gagal mendeteksi nomor pengirim.' });
            return;
        }
        
        function normalizeWA(raw) {
            if (!raw) return "";
            let num = raw.replace(/\D/g, '');
            if (num.startsWith('620')) {
                num = '62' + num.slice(3);
            }
            if (num.startsWith('0')) {
                num = '62' + num.slice(1);
            } else if (num.startsWith('8')) {
                num = '62' + num;
            }
            return num;
        }
        
        const cleanPhone = normalizeWA(senderNumber);
        const isLid = senderJid.endsWith('@lid');
        
        let snapEmpty = true;
        let snap = null;
        
        if (!isLid) {
            const phoneFormats = [
                cleanPhone,
                '0' + cleanPhone.slice(2),
                cleanPhone.slice(2)
            ];
            
            const alumniCol = collection(db, 'alumni');
            const q = query(alumniCol, where('nowa', 'in', phoneFormats));
            snap = await getDocs(q);
            snapEmpty = snap.empty;
        }
        
        if (snapEmpty) {
            const displayPhone = isLid ? '' : ` (*+${cleanPhone}*)`;
            const msgNotRegistered = `*⚠️ NOMOR ANDA BELUM TERDAFTAR ⚠️*\n\n` +
                                     `Mohon maaf, nomor WhatsApp Anda${displayPhone} belum terdaftar di database alumni kami.\n\n` +
                                     `Silakan lakukan pendaftaran terlebih dahulu melalui link formulir pendaftaran resmi berikut:\n` +
                                     `👉 https://phajar.github.io/Reuni/pendaftaran.html\n\n` +
                                     `Setelah mendaftar dan disetujui oleh admin, Anda dapat melakukan konfirmasi donasi kembali. Terima kasih!`;
            await sock.sendMessage(jid, { text: msgNotRegistered });
            return;
        }
        
        let alumnusDoc = null;
        let alumnusData = null;
        snap.forEach(d => {
            const data = d.data();
            if (data.status === 'approved') {
                alumnusDoc = d;
                alumnusData = data;
            }
        });
        
        if (!alumnusDoc) {
            alumnusDoc = snap.docs[0];
            alumnusData = alumnusDoc.data();
        }
        
        let nominal = 0;
        const cleanMsg = msgText.trim();
        const commandPart = cleanMsg.split(/\s+/)[0];
        const contentPart = cleanMsg.substring(commandPart.length).trim();
        if (contentPart) {
            const rawNominal = contentPart.replace(/\D/g, '');
            nominal = Number(rawNominal);
        }
        
        if (!nominal || isNaN(nominal) || nominal <= 0) {
            const msgInvalidNominal = `*Format Konfirmasi Donasi salah.*\n\n` +
                                      `Silakan gunakan format berikut:\n` +
                                      `👉 *!konfirmasi [nominal]* sambil melampirkan foto struk/bukti transfer.\n\n` +
                                      `*Contoh:* \n` +
                                      `Kirim foto bukti transfer dengan caption: \n` +
                                      `*!konfirmasi 100000*`;
            await sock.sendMessage(jid, { text: msgInvalidNominal });
            return;
        }
        
        let buktiUrl = '';
        const messageType = Object.keys(m.message)[0];
        let imageMsg = null;
        if (messageType === 'imageMessage') {
            imageMsg = m.message.imageMessage;
        } else if (m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.quotedMessage && m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage) {
            imageMsg = m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
        }
        
        if (!imageMsg) {
            const msgNoReceipt = `*⚠️ FOTO BUKTI TRANSFER WAJIB DILAMPIRKAN ⚠️*\n\n` +
                                 `Mohon maaf *${alumnusData.nama}*, konfirmasi donasi Anda tidak dapat kami proses karena Anda tidak melampirkan foto bukti transfer.\n\n` +
                                 `Silakan lakukan konfirmasi ulang dengan cara mengirimkan/melampirkan foto struk/bukti transfer Anda dan menuliskan caption:\n` +
                                 `👉 *!konfirmasi [nominal]*\n\n` +
                                 `*Contoh caption:* \n` +
                                 `*!konfirmasi 100000*`;
            await sock.sendMessage(jid, { text: msgNoReceipt });
            return;
        }
        
        await sock.sendMessage(jid, { text: '⏳ Sedang mengunduh dan memproses bukti transfer Anda...' });
        try {
            const stream = await downloadContentFromMessage(imageMsg, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            if (buffer.length > 0) {
                console.log(`[WA BOT] Ukuran bukti transfer asli: ${buffer.length} bytes`);
                try {
                    const sharp = require('sharp');
                    // Mengompresi resolusi gambar ke max 800px dan kualitas JPEG 75%
                    buffer = await sharp(buffer)
                        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 75 })
                        .toBuffer();
                    console.log(`[WA BOT] Bukti transfer dikompresi menjadi: ${buffer.length} bytes`);
                } catch (sharpErr) {
                    console.warn('[WA BOT] Gagal mengompresi bukti transfer dengan sharp, menggunakan file asli:', sharpErr.message);
                }

                console.log(`[WA BOT] Mengunggah bukti transfer sebesar ${buffer.length} bytes ke Cloudinary...`);
                const uploadRes = await uploadBufferToCloudinary(buffer);
                if (uploadRes) {
                    buktiUrl = uploadRes;
                    console.log(`[WA BOT] Bukti transfer berhasil diunggah: ${buktiUrl}`);
                }
            }
        } catch (mediaErr) {
            console.error('[WA BOT] Gagal memproses bukti transfer:', mediaErr.message);
        }
        
        const transactionData = {
            ref_alumni_id: alumnusDoc.id,
            nama_pembayar: alumnusData.nama,
            angkatan_pembayar: String(alumnusData.angkatan || ''),
            lembaga_pembayar: alumnusData.lembaga || '',
            nominal: nominal,
            nominal_original: nominal,
            mdr_fee: 0,
            status: "pending_payment",
            kategori: "Donasi",
            payment_method: "Transfer Bank",
            bukti_url: buktiUrl || "",
            bukti_hash: "",
            tanggal: new Date().toLocaleString('id-ID'),
            created_at: new Date().toISOString()
        };
        
        const financeCol = collection(db, 'finance');
        const docRef = await addDoc(financeCol, transactionData);
        
        try {
            const syncRef = doc(db, 'settings', 'sync_state');
            await setDoc(syncRef, { finance_version: Date.now().toString() }, { merge: true });
        } catch (syncErr) {
            console.error('[WA BOT] Gagal mengupdate sync_state:', syncErr);
        }
        
        // Forward to approval group if configured in settings
        let approvalGroupJid = '';
        try {
            const configSnap = await getDoc(doc(db, 'settings', 'wa_bot_config'));
            if (configSnap.exists()) {
                const configData = configSnap.data();
                approvalGroupJid = configData.approval_group_jid || '';
            }
        } catch (configErr) {
            console.error('[WA BOT] Gagal membaca wa_bot_config:', configErr);
        }
        
        if (approvalGroupJid && approvalGroupJid.endsWith('@g.us')) {
            const captionText = `*📢 KONFIRMASI DONASI BARU MASUK 📢*\n\n` +
                                `Telah diterima konfirmasi donasi dari alumnus berikut:\n\n` +
                                `• *Nama Pembayar* : ${alumnusData.nama}\n` +
                                `• *Angkatan*      : ${alumnusData.angkatan || '-'}\n` +
                                `• *Lembaga*       : ${alumnusData.lembaga || '-'}\n` +
                                `• *Nominal*       : *${formatRupiah(nominal)}*\n` +
                                `• *Tanggal*       : ${transactionData.tanggal}\n\n` +
                                `*ID Transaksi:* \`${docRef.id}\`\n\n` +
                                `----------------------------------------\n` +
                                `Reply pesan ini dengan *!setuju* atau *!approve* untuk memverifikasi donasi.\n` +
                                `Atau kirim pesan: *!setuju ${docRef.id}*`;
            
            try {
                if (buktiUrl) {
                    await sock.sendMessage(approvalGroupJid, {
                        image: { url: buktiUrl },
                        caption: captionText
                    });
                    console.log(`[WA BOT] Forwarded confirmation receipt to approval group: ${approvalGroupJid}`);
                } else {
                    await sock.sendMessage(approvalGroupJid, { text: captionText });
                }
            } catch (forwardErr) {
                console.error('[WA BOT] Gagal meneruskan ke grup persetujuan:', forwardErr);
            }
        }
        
        const msgSuccess = `*✅ KONFIRMASI DONASI BERHASIL 📄*\n\n` +
                           `Halo *${alumnusData.nama}* (Tahun Lulus ${alumnusData.angkatan}),\n` +
                           `Konfirmasi donasi Anda sebesar *${formatRupiah(nominal)}* telah kami terima di sistem.\n\n` +
                           `• Status: *Menunggu Verifikasi Bendahara*\n` +
                           `• Bukti Transfer: ${buktiUrl ? 'Terunggah 🟢' : 'Tidak Ada / Kosong ⚠️'}\n\n` +
                           `Mohon tunggu proses verifikasi oleh Bendahara. Anda dapat memantau status secara berkala melalui link berikut:\n` +
                           `👉 https://phajar.github.io/Reuni/cek-status.html\n\n` +
                           `Jazakumullahu khairan katsiran atas partisipasi Anda! 🙏`;
        await sock.sendMessage(jid, { text: msgSuccess });
        
    } catch (err) {
        console.error('[WA BOT] Gagal memproses perintah !konfirmasi:', err);
        await sock.sendMessage(jid, { text: 'Maaf, terjadi kesalahan saat memproses konfirmasi donasi Anda.' });
    }
}

async function handleApproveCommand(jid, m, msgText) {
    try {
        // Extract sender JID prioritizing phone number (Pn) fields
        let senderJid = '';
        if (jid && jid.endsWith('@g.us')) {
            senderJid = m.key.participantPn || m.key.participant || '';
        } else {
            senderJid = m.key.senderPn || jid || '';
        }
        
        const senderNumber = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        
        if (!senderNumber) {
            await sock.sendMessage(jid, { text: '❌ Gagal mendeteksi nomor pengirim.' });
            return;
        }
        
        // Fetch config to check if the sender is an authorized admin
        let approvalAdmins = '';
        let approvalGroupJid = '';
        try {
            const configSnap = await getDoc(doc(db, 'settings', 'wa_bot_config'));
            if (configSnap.exists()) {
                const configData = configSnap.data();
                approvalAdmins = configData.approval_admins || '';
                approvalGroupJid = configData.approval_group_jid || '';
            }
        } catch (err) {
            console.error('[WA BOT] Gagal membaca wa_bot_config untuk persetujuan:', err);
        }
        
        const adminList = approvalAdmins.split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
        const isAuthorized = adminList.includes(senderNumber);
        
        if (!isAuthorized) {
            await sock.sendMessage(jid, { text: '❌ Anda tidak memiliki wewenang untuk menyetujui donasi.' });
            return;
        }
        
        let transactionId = '';
        
        // 1. Check if the message is a reply (quoted message)
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const quotedText = quotedMsg.conversation || 
                               quotedMsg.extendedTextMessage?.text || 
                               quotedMsg.imageMessage?.caption || '';
            
            // Clean markdown formatting (asterisks, backticks) that might interfere with regex
            const cleanText = quotedText.replace(/[\*`]/g, '');
            // Search for transaction ID (pattern: ID Transaksi: [ID])
            const match = cleanText.match(/id transaksi:\s*([A-Za-z0-9_-]+)/i);
            if (match) {
                transactionId = match[1];
            }
        }
        
        // 2. If not found in reply, check the text command arguments
        if (!transactionId) {
            const parts = msgText.trim().split(/\s+/);
            if (parts.length > 1) {
                transactionId = parts[1];
            }
        }
        
        if (!transactionId) {
            await sock.sendMessage(jid, { 
                text: '❌ Gagal mendeteksi ID Transaksi.\n\n' +
                      '• Jika Anda membalas/me-reply pesan bukti transfer, pastikan pesan terusan bot tersebut dikutip dan ketik *!setuju*.\n' +
                      '• Atau, Anda dapat menyertakan ID Transaksi secara manual: *!setuju [ID_Transaksi]*\n' +
                      '_(Contoh: !setuju Z28eLNogfYyENhY70NY6)_' 
            });
            return;
        }
        
        // Load transaction from Firestore
        const docRef = doc(db, 'finance', transactionId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            await sock.sendMessage(jid, { text: `❌ Transaksi dengan ID *${transactionId}* tidak ditemukan di database.` });
            return;
        }
        
        const txData = docSnap.data();
        if (txData.status !== 'pending_payment') {
            await sock.sendMessage(jid, { 
                text: `⚠️ Transaksi ini sudah diproses sebelumnya (Status saat ini: *${txData.status === 'pemasukan' ? 'Lunas / Berhasil' : txData.status}*).` 
            });
            return;
        }
        
        // Fetch token_keuangan to authorize the update in firestore rules
        let tokenKeuangan = '';
        try {
            const waConfigSnap = await getDoc(doc(db, 'settings', 'whatsapp_api'));
            if (waConfigSnap.exists()) {
                tokenKeuangan = waConfigSnap.data().token_keuangan || '';
            }
        } catch (err) {
            console.error('[WA BOT] Gagal membaca token_keuangan untuk otorisasi:', err);
        }

        // Update transaction status in Firestore
        await setDoc(docRef, { 
            status: 'pemasukan',
            bot_token: tokenKeuangan,
            updated_at: new Date().toISOString()
        }, { merge: true });
        
        // Update sync_state version to invalidate cache on Web UI dashboard
        try {
            const syncRef = doc(db, 'settings', 'sync_state');
            await setDoc(syncRef, { finance_version: Date.now().toString() }, { merge: true });
        } catch (syncErr) {
            console.error('[WA BOT] Gagal mengupdate sync_state:', syncErr);
        }
        
        // Send success message to group
        const approvalMsg = `*✅ DONASI DISETUJUI VIA WHATSAPP ✅*\n\n` +
                            `Donasi dari *${txData.nama_pembayar}* sebesar *${formatRupiah(txData.nominal)}* telah diverifikasi dan disetujui oleh admin *+${senderNumber}*.\n\n` +
                            `Status di sistem telah diperbarui menjadi *Lunas / Berhasil*.\n` +
                            `Kuitansi digital otomatis dikirimkan ke donatur.`;
        await sock.sendMessage(jid, { text: approvalMsg });
        
        // Send auto-receipt to the alumnus/donor
        if (txData.ref_alumni_id) {
            const alumnusRef = doc(db, 'alumni', txData.ref_alumni_id);
            const alumnusSnap = await getDoc(alumnusRef);
            if (alumnusSnap.exists()) {
                const alumnusData = alumnusSnap.data();
                if (alumnusData.nowa) {
                    // Normalize phone number to send JID
                    let rawWa = alumnusData.nowa.replace(/\D/g, '');
                    if (rawWa.startsWith('0')) {
                        rawWa = '62' + rawWa.slice(1);
                    } else if (rawWa.startsWith('8')) {
                        rawWa = '62' + rawWa;
                    }
                    const donorJid = rawWa + '@s.whatsapp.net';
                    const formattedNominal = formatRupiah(txData.nominal);
                    const dateStr = txData.tanggal || new Date().toLocaleString("id-ID");
                    
                    const receiptMsg = `*BUKTI PEMBAYARAN REUNI AL-FATAH* ✨\n\n` +
                                       `Halo *${alumnusData.nama}* (Angkatan ${alumnusData.angkatan || "-"}),\n\n` +
                                       `Terima kasih, pembayaran donasi Anda sebesar *${formattedNominal}* telah berhasil diverifikasi dan dicatat oleh Bendahara Reuni Al-Fatah.\n\n` +
                                       `*Rincian Transaksi:*\n` +
                                       `- Kategori: *Donasi*\n` +
                                       `- Jumlah: *${formattedNominal}*\n` +
                                       `- Tanggal: *${dateStr}*\n` +
                                       `- Status: *Lunas / Berhasil*\n\n` +
                                       `Unduh kuitansi resmi Anda di sini:\n` +
                                       `👉 https://phajar.github.io/Reuni/pembayaran.html?wa=${encodeURIComponent(alumnusData.nowa)}\n\n` +
                                       `Semoga menjadi amal ibadah dan membawa keberkahan bagi kita semua. Sampai jumpa di hari H reuni! 🤝\n\n` +
                                       `_Pesan ini dikirim otomatis oleh Sistem Reuni Al-Fatah._`;
                                       
                    await sock.sendMessage(donorJid, { text: receiptMsg });
                    console.log(`[WA BOT] Auto-receipt sent to alumnus: ${alumnusData.nowa}`);
                }
            }
        }
    } catch (err) {
        console.error('[WA BOT] Gagal memproses persetujuan via WA:', err);
        await sock.sendMessage(jid, { text: '❌ Terjadi kesalahan saat memproses persetujuan donasi.' });
    }
}

let activeCronJob = null;
let currentBotConfig = {};

function initScheduledReports(db) {
    console.log('[CRON] Initializing real-time listener for Scheduled Reports...');
    
    const configDocRef = doc(db, 'settings', 'wa_bot_config');
    onSnapshot(configDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            currentBotConfig = data;
            
            console.log('[CRON] Configuration updated from Firestore:', {
                schedule_enabled: data.schedule_enabled,
                schedule_frequency: data.schedule_frequency,
                schedule_time: data.schedule_time,
                targets: data.schedule_targets ? JSON.parse(data.schedule_targets).length : 0
            });
            
            setupCronJob(data);
        } else {
            console.log('[CRON] No wa_bot_config document found in Firestore.');
        }
    }, (err) => {
        console.error('[CRON] Error listening to wa_bot_config:', err);
    });
}

function setupCronJob(config) {
    if (activeCronJob) {
        console.log('[CRON] Stopping previous active cron job...');
        activeCronJob.stop();
        activeCronJob = null;
    }
    
    if (config.schedule_enabled !== true || !config.schedule_frequency || config.schedule_frequency === 'off') {
        console.log('[CRON] Scheduled reports are disabled.');
        return;
    }
    
    const timeStr = config.schedule_time || '08:00';
    const [hourStr, minuteStr] = timeStr.split(':');
    const hour = parseInt(hourStr, 10) || 8;
    const minute = parseInt(minuteStr, 10) || 0;
    
    let cronExpr = '';
    if (config.schedule_frequency === 'friday') {
        cronExpr = `${minute} ${hour} * * 5`;
        console.log(`[CRON] Scheduling weekly report: Friday at ${timeStr} (Cron: ${cronExpr})`);
    } else if (config.schedule_frequency === 'monthly') {
        cronExpr = `${minute} ${hour} 1 * *`;
        console.log(`[CRON] Scheduling monthly report: 1st day of month at ${timeStr} (Cron: ${cronExpr})`);
    } else if (config.schedule_frequency === 'daily') {
        cronExpr = `${minute} ${hour} * * *`;
        console.log(`[CRON] Scheduling daily report at ${timeStr} (Cron: ${cronExpr})`);
    } else {
        console.log(`[CRON] Unknown frequency: ${config.schedule_frequency}. Skipping.`);
        return;
    }
    
    activeCronJob = cron.schedule(cronExpr, async () => {
        console.log('[CRON] Scheduled report trigger fired! Processing report...');
        try {
            await triggerScheduledReport();
        } catch (e) {
            console.error('[CRON] Error during scheduled report execution:', e);
        }
    });
}

async function triggerScheduledReport() {
    if (!sock || connectionStatus !== 'open') {
        console.warn('[CRON] Bot is not open/connected. Scheduled report skipped.');
        return;
    }
    
    let targets = [];
    try {
        targets = currentBotConfig.schedule_targets ? JSON.parse(currentBotConfig.schedule_targets) : [];
    } catch (e) {
        console.error('[CRON] Failed to parse schedule targets:', e);
        return;
    }
    
    if (targets.length === 0) {
        console.log('[CRON] No targets configured for scheduled report.');
        return;
    }
    
    const financeCol = collection(db, 'finance');
    const querySnapshot = await getDocs(financeCol);
    
    let inC = 0, outC = 0;
    const listData = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        const kategori = data.kategori || '';
        const status = String(data.status || '').toLowerCase().trim();
        const nominal = Number(data.nominal) || 0;
        
        const isRAB = kategori === 'RAB';
        const isPending = status === 'pending_payment';
        const isValid = (!isRAB && !isPending) || (isRAB && status === 'pengeluaran');
        
        if (isValid) {
            if (status === 'pengeluaran') {
                outC += nominal;
            } else {
                inC += nominal;
            }
            listData.push({
                tanggal: data.tanggal || '',
                keterangan: data.nama || data.keterangan || data.nama_pembayar || '-',
                kategori: data.kategori || '-',
                status: status,
                nominal: nominal
            });
        }
    });
    
    const saldo = inC - outC;
    const currentMonthStr = new Date().toLocaleDateString("id-ID", {
        month: "long",
        year: "numeric"
    });
    
    let template = currentBotConfig.report_template || '';
    if (!template.trim()) {
        template = `Assalamu'alaikum wr. wb.\n\nBerikut kami lampirkan Laporan Keuangan Reuni Akbar AL-FATAH (Periode {bulan}).\n\nTotal Pemasukan: *{pemasukan}*\nTotal Pengeluaran: *{pengeluaran}*\nSaldo Kas Saat Ini: *{saldo}*\n\nTerima kasih atas transparansi dan dukungan semua pihak.`;
    }
    
    let messageText = template
        .replace(/{bulan}/g, currentMonthStr)
        .replace(/{pemasukan}/g, formatRupiah(inC))
        .replace(/{pengeluaran}/g, formatRupiah(outC))
        .replace(/{saldo}/g, formatRupiah(saldo));
        
    const latestTrans = listData.slice(-5).reverse();
    let transMsg = '\n\n*5 TRANSAKSI TERAKHIR:*\n----------------------------------------\n';
    latestTrans.forEach((t, idx) => {
        const dateStr = String(t.tanggal).split(',')[0] || '-';
        const tipe = t.status === 'pengeluaran' ? '🔴 Keluar' : '🟢 Masuk';
        const sign = t.status === 'pengeluaran' ? '-' : '+';
        transMsg += `${idx + 1}. *[${dateStr}]* ${t.keterangan}\n` +
                    `   _${t.kategori}_ | *${tipe}*: ${sign}${formatRupiah(t.nominal)}\n`;
    });
    transMsg += '----------------------------------------\n';
    transMsg += `Unduh Laporan Lengkap PDF/PNG:\n👉 https://phajar.github.io/Reuni/keuangan.html\n\n`;
    transMsg += `_Laporan otomatis terjadwal dikirim oleh Bot Reuni Al-Fatah._`;
    
    messageText += transMsg;
    
    console.log(`[CRON] Sending scheduled report to ${targets.length} targets...`);
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    for (let i = 0; i < targets.length; i++) {
        const targetJid = targets[i];
        if (i > 0) {
            const randomDelay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
            await sleep(randomDelay);
        }
        
        try {
            console.log(`[CRON] Sending report to ${targetJid}...`);
            await sock.sendMessage(targetJid, { text: messageText });
            console.log(`[CRON] Successfully sent scheduled report to ${targetJid}`);
        } catch (err) {
            console.error(`[CRON] Failed to send scheduled report to ${targetJid}:`, err.message);
        }
    }
    console.log('[CRON] Scheduled report loop finished.');
}

function initAlumniRegistrationListener(db) {
    console.log('[WA BOT] Initializing real-time listener for new alumni registrations...');
    const alumniCol = collection(db, 'alumni');
    const q = query(alumniCol, where('status', '==', 'pending'));
    
    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                const data = change.doc.data();
                const alumniId = change.doc.id;
                
                // Only process if created_at is after bot startup
                if (data.created_at && data.created_at >= botStartupTime) {
                    console.log(`[WA BOT] New pending alumnus detected: ${data.nama} (ID: ${alumniId})`);
                    
                    const groupJid = currentBotConfig.approval_group_jid;
                    if (groupJid && groupJid.endsWith('@g.us')) {
                        const message = `*📢 PENDAFTARAN ALUMNI BARU 📢*\n\n` +
                                        `Telah terdaftar alumni baru yang memerlukan persetujuan:\n\n` +
                                        `• *Nama Lengkap* : ${data.nama}\n` +
                                        `• *Angkatan*     : ${data.angkatan || '-'}\n` +
                                        `• *Lembaga*      : ${data.lembaga || '-'}\n` +
                                        `• *No. WhatsApp* : +${data.nowa || '-'}\n` +
                                        `• *Alamat*       : ${data.alamat || '-'}\n` +
                                        `• *Wilayah*      : ${data.desa || '-'}, ${data.kecamatan || '-'}, ${data.kabupaten || '-'}, ${data.provinsi || '-'}\n\n` +
                                        `*ID Alumni:* \`${alumniId}\`\n\n` +
                                        `----------------------------------------\n` +
                                        `Reply pesan ini dengan *!setuju-alumni* atau *!approve-alumni* untuk menyetujui pendaftaran.\n` +
                                        `Atau kirim pesan: *!setuju-alumni ${alumniId}*`;
                        
                        try {
                            if (sock && connectionStatus === 'open') {
                                await sock.sendMessage(groupJid, { text: message });
                                console.log(`[WA BOT] Forwarded registration notification to group ${groupJid}`);
                            }
                        } catch (err) {
                            console.error('[WA BOT] Gagal mengirim notifikasi registrasi alumni baru ke grup:', err);
                        }
                    } else {
                        console.warn('[WA BOT] approval_group_jid belum diatur atau bukan JID grup WA valid.');
                    }
                }
            }
        });
    }, (err) => {
        console.error('[WA BOT] Error listening to alumni registrations:', err);
    });
}

function initAuditLogListener(db) {
    console.log('[WA BOT] Initializing real-time listener for audit logs...');
    const auditCol = collection(db, 'audit_logs');
    const q = query(auditCol);
    
    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                const data = change.doc.data();
                
                // Process only logs created after bot startup
                if (data.timestamp && data.timestamp >= botStartupTime) {
                    console.log(`[WA BOT] New audit log detected: ${data.action} by ${data.operator_name}`);
                    
                    const groupJid = currentBotConfig.approval_group_jid;
                    if (groupJid && groupJid.endsWith('@g.us')) {
                        const dateStr = new Date(data.timestamp).toLocaleString('id-ID');
                        const message = `*🛡️ AUDIT LOG: AKTIVITAS OPERATOR 🛡️*\n\n` +
                                        `• *Nama Operator* : ${data.operator_name}\n` +
                                        `• *Email*         : ${data.operator_email}\n` +
                                        `• *Aksi*          : ${data.action}\n` +
                                        `• *Detail*        : ${data.details}\n` +
                                        `• *Waktu*         : ${dateStr}`;
                        
                        try {
                            if (sock && connectionStatus === 'open') {
                                await sock.sendMessage(groupJid, { text: message });
                                console.log(`[WA BOT] Forwarded audit log to group ${groupJid}`);
                            }
                        } catch (err) {
                            console.error('[WA BOT] Gagal mengirim audit log ke grup:', err);
                        }
                    }
                }
            }
        });
    }, (err) => {
        console.error('[WA BOT] Error listening to audit logs:', err);
    });
}

async function handleApproveAlumniCommand(jid, m, msgText) {
    try {
        let senderJid = '';
        if (jid && jid.endsWith('@g.us')) {
            senderJid = m.key.participantPn || m.key.participant || '';
        } else {
            senderJid = m.key.senderPn || jid || '';
        }
        
        const senderNumber = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (!senderNumber) {
            await sock.sendMessage(jid, { text: '❌ Gagal mendeteksi nomor pengirim.' });
            return;
        }
        
        const adminList = (currentBotConfig.approval_admins || '').split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
        const isAuthorized = adminList.includes(senderNumber);
        if (!isAuthorized) {
            await sock.sendMessage(jid, { text: '❌ Anda tidak memiliki wewenang untuk menyetujui alumni.' });
            return;
        }
        
        let alumniId = '';
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const quotedText = quotedMsg.conversation || 
                               quotedMsg.extendedTextMessage?.text || 
                               quotedMsg.imageMessage?.caption || '';
            const cleanText = quotedText.replace(/[\*`]/g, '');
            const match = cleanText.match(/id alumni:\s*([A-Za-z0-9_-]+)/i);
            if (match) {
                alumniId = match[1];
            }
        }
        
        if (!alumniId) {
            const parts = msgText.trim().split(/\s+/);
            if (parts.length > 1) {
                alumniId = parts[1];
            }
        }
        
        if (!alumniId) {
            await sock.sendMessage(jid, { 
                text: '❌ Gagal mendeteksi ID Alumni.\n\n' +
                      '• Jika Anda membalas/me-reply pesan pendaftaran, pastikan pesan terusan bot tersebut dikutip dan ketik *!setuju-alumni*.\n' +
                      '• Atau, Anda dapat menyertakan ID Alumni secara manual: *!setuju-alumni [ID_Alumni]*\n' +
                      '_(Contoh: !setuju-alumni Z28eLNogfYyENhY70NY6)_' 
            });
            return;
        }
        
        const docRef = doc(db, 'alumni', alumniId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            await sock.sendMessage(jid, { text: `❌ Alumni dengan ID *${alumniId}* tidak ditemukan di database.` });
            return;
        }
        
        const alumniData = docSnap.data();
        if (alumniData.status === 'approved') {
            await sock.sendMessage(jid, { text: `⚠️ Alumni ini sudah disetujui sebelumnya.` });
            return;
        }
        
        let tokenKeuangan = '';
        try {
            const waConfigSnap = await getDoc(doc(db, 'settings', 'whatsapp_api'));
            if (waConfigSnap.exists()) {
                tokenKeuangan = waConfigSnap.data().token_keuangan || '';
            }
        } catch (err) {
            console.error('[WA BOT] Gagal membaca token_keuangan untuk otorisasi:', err);
        }

        await setDoc(docRef, { 
            status: 'approved',
            bot_token: tokenKeuangan,
            updated_at: new Date().toISOString()
        }, { merge: true });
        
        try {
            const syncRef = doc(db, 'settings', 'sync_state');
            await setDoc(syncRef, { alumni_version: Date.now().toString() }, { merge: true });
        } catch (syncErr) {
            console.error('[WA BOT] Gagal mengupdate sync_state:', syncErr);
        }
        
        const approvalMsg = `*✅ PENDAFTARAN ALUMNI DISETUJUI VIA WHATSAPP ✅*\n\n` +
                            `Pendaftaran alumni *${alumniData.nama}* (Angkatan ${alumniData.angkatan || '-'}) telah disetujui oleh admin *+${senderNumber}*.\n\n` +
                            `Status alumni telah aktif di sistem dan welcome message telah dikirim ke yang bersangkutan.`;
        await sock.sendMessage(jid, { text: approvalMsg });
        
        if (alumniData.nowa) {
            let rawWa = alumniData.nowa.replace(/\D/g, '');
            if (rawWa.startsWith('0')) {
                rawWa = '62' + rawWa.slice(1);
            } else if (rawWa.startsWith('8')) {
                rawWa = '62' + rawWa;
            }
            const alumnusJid = rawWa + '@s.whatsapp.net';
            
            const welcomeMsg = `*SELAMAT DATANG DI PORTAL ALUMNI PP AL-FATAH* 🎉\n\n` +
                               `Halo *${alumniData.nama}* (Angkatan ${alumniData.angkatan || '-'}),\n` +
                               `Pendaftaran Anda telah disetujui oleh admin. Selamat bergabung!\n\n` +
                               `Sekarang Kakak sudah terdaftar resmi di database Reuni Akbar Ponpes AL-FATAH. Kakak juga dapat berkontribusi/berdonasi untuk menyukseskan acara kita melalui menu keuangan atau tautan berikut:\n` +
                               `👉 https://phajar.github.io/Reuni/pembayaran.html?wa=${encodeURIComponent(alumniData.nowa)}\n\n` +
                               `Terima kasih dan sampai jumpa di acara Reuni Akbar PP AL-FATAH! 🤝`;
                               
            await sock.sendMessage(alumnusJid, { text: welcomeMsg });
            console.log(`[WA BOT] Welcome message sent to alumnus: ${alumniData.nowa}`);
        }
    } catch (err) {
        console.error('[WA BOT] Gagal memproses persetujuan alumni via WA:', err);
        await sock.sendMessage(jid, { text: '❌ Terjadi kesalahan saat memproses persetujuan alumni.' });
    }
}

async function handleBackupDbCommand(jid, m) {
    try {
        let senderJid = '';
        if (jid && jid.endsWith('@g.us')) {
            senderJid = m.key.participantPn || m.key.participant || '';
        } else {
            senderJid = m.key.senderPn || jid || '';
        }
        
        const senderNumber = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (!senderNumber) {
            await sock.sendMessage(jid, { text: '❌ Gagal mendeteksi nomor pengirim.' });
            return;
        }
        
        const adminList = (currentBotConfig.approval_admins || '').split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
        const isAuthorized = adminList.includes(senderNumber);
        if (!isAuthorized) {
            await sock.sendMessage(jid, { text: '❌ Anda tidak memiliki wewenang untuk meminta backup database.' });
            return;
        }
        
        await sock.sendMessage(jid, { text: '⏳ Sedang mengumpulkan data database Firestore. Mohon tunggu...' });
        
        const collectionsList = ['alumni', 'finance', 'panitia', 'rab', 'tugas', 'logistik', 'absensi', 'users'];
        const backupData = {};
        
        for (const colName of collectionsList) {
            try {
                const colRef = collection(db, colName);
                const colSnap = await getDocs(colRef);
                backupData[colName] = [];
                colSnap.forEach(docSnap => {
                    backupData[colName].push({
                        id: docSnap.id,
                        ...docSnap.data()
                    });
                });
                console.log(`[BACKUP] Collected ${backupData[colName].length} documents from "${colName}"`);
            } catch (colErr) {
                console.error(`[BACKUP] Failed to back up collection "${colName}":`, colErr.message);
                backupData[colName] = { error: colErr.message };
            }
        }
        
        const finalBackup = {
            metadata: {
                timestamp: new Date().toISOString(),
                backed_up_by: senderNumber,
                database_id: "reuniakbar (default)"
            },
            data: backupData
        };
        
        const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
        const tempFilename = `Backup_Database_Reuni_${timestampStr}.json`;
        const tempFilePath = path.join(__dirname, tempFilename);
        
        fs.writeFileSync(tempFilePath, JSON.stringify(finalBackup, null, 2));
        console.log(`[BACKUP] Backup JSON written to temporary file: ${tempFilePath}`);
        
        await sock.sendMessage(jid, {
            document: fs.readFileSync(tempFilePath),
            mimetype: 'application/json',
            fileName: tempFilename,
            caption: `📊 *BACKUP DATABASE REUNI PP AL-FATAH*\n\n• Waktu Backup: *${new Date().toLocaleString('id-ID')}*\n• Koleksi Berhasil Di-backup: *${collectionsList.join(', ')}*\n• Triggered by Admin: *+${senderNumber}*`
        });
        
        console.log(`[BACKUP] Backup file sent successfully.`);
        
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`[BACKUP] Temporary file cleaned up: ${tempFilePath}`);
        }
        
    } catch (err) {
        console.error('[WA BOT] Gagal memproses backup database:', err);
        await sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat memproses backup database: ${err.message}` });
    }
}

async function handleMenuCommand(jid, m) {
    try {
        let senderJid = '';
        if (jid && jid.endsWith('@g.us')) {
            senderJid = m.key.participantPn || m.key.participant || '';
        } else {
            senderJid = m.key.senderPn || jid || '';
        }
        
        const senderNumber = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        const adminList = (currentBotConfig.approval_admins || '').split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
        const isAuthorized = adminList.includes(senderNumber);
        
        let menuMsg = `*✨ DAFTAR MENU PERINTAH VALID ✨*\n\n` +
                      `Berikut adalah perintah-perintah yang dapat Anda kirimkan ke bot ini:\n\n` +
                      `*🌐 PERINTAH ALUMNI:*\n` +
                      `• *!saldo*\n` +
                      `• *!laporan*\n` +
                      `• *!iuran*\n` +
                      `• *!konfirmasi [nominal]*\n` +
                      `• *!menu*\n` +
                      `• *!help*\n\n`;
                      
        if (isAuthorized) {
            menuMsg += `*🛡️ PERINTAH KHUSUS ADMIN:*\n` +
                       `• *!setuju [ID]*\n` +
                       `• *!setuju-alumni [ID]*\n` +
                       `• *!backup-db*\n\n`;
        }
        
        menuMsg += `Ketik *!help* untuk melihat penjelasan detail cara menggunakan setiap perintah.`;
        
        await sock.sendMessage(jid, { text: menuMsg });
    } catch (err) {
        console.error('[WA BOT] Gagal memproses perintah !menu:', err);
        await sock.sendMessage(jid, { text: 'Maaf, terjadi kesalahan saat memproses perintah menu.' });
    }
}

async function handleHelpCommand(jid, m) {
    try {
        let senderJid = '';
        if (jid && jid.endsWith('@g.us')) {
            senderJid = m.key.participantPn || m.key.participant || '';
        } else {
            senderJid = m.key.senderPn || jid || '';
        }
        
        const senderNumber = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        
        const adminList = (currentBotConfig.approval_admins || '').split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
        const isAuthorized = adminList.includes(senderNumber);
        
        let helpMsg = `*✨ PANDUAN BANTUAN BOT REUNI ✨*\n\n` +
                      `Berikut penjelasan cara menggunakan perintah bot Reuni AL-FATAH:\n\n` +
                      `*🌐 UNTUK ALUMNI:*\n` +
                      `• *!saldo* : Menampilkan total pemasukan, pengeluaran, dan saldo kas riil saat ini secara real-time.\n` +
                      `• *!laporan* : Menampilkan ringkasan dana beserta detail 5 transaksi kas terakhir.\n` +
                      `• *!iuran* : Menampilkan rekening bank resmi panitia beserta QRIS dinamis untuk pembayaran.\n` +
                      `• *!konfirmasi [nominal]* : Melaporkan donasi/pembayaran iuran secara instan sambil melampirkan foto struk/bukti transfer. Contoh: kirim foto struk dengan caption *!konfirmasi 150000*.\n` +
                      `• *!menu* : Menampilkan daftar ringkas semua perintah valid.\n` +
                      `• *!help* : Menampilkan halaman bantuan ini.\n\n`;
                      
        if (isAuthorized) {
            helpMsg += `*🛡️ UNTUK ADMIN (TEROTORISASI):*\n` +
                       `• *!setuju [ID]* : Menyetujui transaksi donasi (atau reply pesan bukti transfer terusan dari bot dengan ketik *!setuju*).\n` +
                       `• *!setuju-alumni [ID]* : Menyetujui pendaftaran alumni baru (atau reply pesan pendaftaran terusan dari bot dengan ketik *!setuju-alumni*).\n` +
                       `• *!backup-db* : Mengunduh cadangan lengkap seluruh koleksi database Firestore dalam format JSON.\n\n`;
        }
        
        helpMsg += `_Sistem Bot Reuni Akbar Pondok Pesantren AL-FATAH_`;
        
        await sock.sendMessage(jid, { text: helpMsg });
    } catch (err) {
        console.error('[WA BOT] Gagal memproses perintah !help:', err);
        await sock.sendMessage(jid, { text: 'Maaf, terjadi kesalahan saat memproses perintah bantuan.' });
    }
}

function generateVisualReportSvg(inC, outC, saldo, transactions, logoBase64 = '', ketuaData = null, bendaharaData = null) {
    const formatRupiahSvg = (val) => {
        return formatRupiah(val);
    };

    const defaultKetua = { nama: 'Tatang Firmansyah', jabatan: 'Ketua Panitia', tanda_tangan: null };
    const defaultBendahara = { nama: 'Ahmad Pajar Bahri', jabatan: 'Bendahara', tanda_tangan: null };
    
    const ketua = ketuaData || defaultKetua;
    const bendahara = bendaharaData || defaultBendahara;

    const currentMonthStr = new Date().toLocaleDateString("id-ID", {
        month: "long",
        year: "numeric"
    });

    let rowY = 380;
    let transactionRowsSvg = '';
    transactions.forEach((tx, idx) => {
        const dateStr = String(tx.tanggal).split(',')[0] || '-';
        const rawDesc = tx.keterangan || '-';
        const desc = rawDesc.length > 25 ? rawDesc.substring(0, 22) + '...' : rawDesc;
        const nominalStr = formatRupiahSvg(tx.nominal);
        const isKeluar = tx.status === 'pengeluaran';
        const typeStr = isKeluar ? 'Keluar' : 'Masuk';
        const typeColor = isKeluar ? '#dc2626' : '#16a34a';
        
        const bgFill = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
        
        transactionRowsSvg += `
    <rect x="35" y="${rowY}" width="530" height="40" fill="${bgFill}" rx="4"/>
    <text x="50" y="${rowY + 24}" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" fill="#334155">${dateStr}</text>
    <text x="140" y="${rowY + 24}" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="bold" fill="#1e293b">${desc}</text>
    <text x="360" y="${rowY + 24}" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="bold" fill="${typeColor}">${typeStr}</text>
    <text x="440" y="${rowY + 24}" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="bold" fill="#1e293b" text-anchor="start">${nominalStr}</text>
        `;
        rowY += 45;
    });

    if (transactions.length === 0) {
        transactionRowsSvg = `
    <text x="300" y="450" font-family="'Plus Jakarta Sans', sans-serif" font-size="14" fill="#64748b" text-anchor="middle" font-style="italic">Belum ada transaksi recorded</text>
        `;
    }

    const svg = `
<svg width="600" height="850" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="logoClip">
      <circle cx="85" cy="80" r="32"/>
    </clipPath>
  </defs>

  <rect width="600" height="850" fill="#ffffff" stroke="#1e3a8a" stroke-width="6" rx="16"/>
  <rect x="10" y="10" width="580" height="830" fill="none" stroke="#e2e8f0" stroke-width="2" rx="12"/>

  ${logoBase64 ? `
  <image href="${logoBase64}" x="53" y="48" width="64" height="64" clip-path="url(#logoClip)" preserveAspectRatio="xMidYMid slice" />
  <circle cx="85" cy="80" r="32" fill="none" stroke="#1e3a8a" stroke-width="1" />
  ` : `
  <circle cx="85" cy="80" r="32" fill="#1e3a8a" opacity="0.1"/>
  <path d="M 68 85 C 75 80 82 85 85 87 C 88 85 95 80 102 85 L 102 73 C 95 68 88 73 85 75 C 82 73 75 68 68 73 Z" fill="#1e3a8a"/>
  <path d="M 85 75 L 85 87" stroke="#ffffff" stroke-width="1.5"/>
  `}

  <text x="135" y="62" font-family="'Plus Jakarta Sans', sans-serif" font-size="13" font-weight="900" fill="#0f172a" letter-spacing="0.5">ALUMNI PONDOK PESANTREN</text>
  <text x="135" y="82" font-family="'Plus Jakarta Sans', sans-serif" font-size="15" font-weight="900" fill="#1e3a8a" letter-spacing="0.5">AL-FATAH TEGALWARU PURWAKARTA</text>
  <text x="135" y="100" font-family="'Plus Jakarta Sans', sans-serif" font-size="9" font-weight="bold" fill="#64748b" font-style="italic">Jl. BBI Cirata Kp. Cilangkap Rt. 10 Rw.05 Cadassari Tegalwaru Purwakarta 41165</text>

  <line x1="35" y1="125" x2="565" y2="125" stroke="#0f172a" stroke-width="3"/>
  <line x1="35" y1="131" x2="565" y2="131" stroke="#64748b" stroke-width="1"/>

  <text x="300" y="170" font-family="'Plus Jakarta Sans', sans-serif" font-size="18" font-weight="900" fill="#0f172a" text-anchor="middle" letter-spacing="1">LAPORAN KEUANGAN RESMI</text>
  <text x="300" y="190" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="bold" fill="#64748b" text-anchor="middle">Periode: ${currentMonthStr}</text>

  <rect x="35" y="215" width="165" height="75" fill="#f0fdf4" stroke="#bbf7d0" stroke-width="1.5" rx="8"/>
  <text x="117.5" y="240" font-family="'Plus Jakarta Sans', sans-serif" font-size="10" font-weight="bold" fill="#166534" text-anchor="middle">TOTAL PEMASUKAN</text>
  <text x="117.5" y="265" font-family="'Plus Jakarta Sans', sans-serif" font-size="14" font-weight="900" fill="#15803d" text-anchor="middle">${formatRupiahSvg(inC)}</text>

  <rect x="217.5" y="215" width="165" height="75" fill="#fef2f2" stroke="#fecaca" stroke-width="1.5" rx="8"/>
  <text x="300" y="240" font-family="'Plus Jakarta Sans', sans-serif" font-size="10" font-weight="bold" fill="#991b1b" text-anchor="middle">TOTAL PENGELUARAN</text>
  <text x="300" y="265" font-family="'Plus Jakarta Sans', sans-serif" font-size="14" font-weight="900" fill="#b91c1c" text-anchor="middle">${formatRupiahSvg(outC)}</text>

  <rect x="400" y="215" width="165" height="75" fill="#eff6ff" stroke="#bfdbfe" stroke-width="1.5" rx="8"/>
  <text x="482.5" y="240" font-family="'Plus Jakarta Sans', sans-serif" font-size="10" font-weight="bold" fill="#075985" text-anchor="middle">SALDO KAS RIIL</text>
  <text x="482.5" y="265" font-family="'Plus Jakarta Sans', sans-serif" font-size="14" font-weight="900" fill="#0369a1" text-anchor="middle">${formatRupiahSvg(saldo)}</text>

  <text x="35" y="325" font-family="'Plus Jakarta Sans', sans-serif" font-size="13" font-weight="900" fill="#0f172a" letter-spacing="0.5">5 TRANSAKSI TERAKHIR</text>
  <line x1="35" y1="333" x2="160" y2="333" stroke="#1e3a8a" stroke-width="2"/>

  <rect x="35" y="345" width="530" height="30" fill="#1e3a8a" rx="4"/>
  <text x="50" y="364" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="bold" fill="#ffffff">TANGGAL</text>
  <text x="140" y="364" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="bold" fill="#ffffff">KETERANGAN / PEMBAYAR</text>
  <text x="360" y="364" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="bold" fill="#ffffff">JENIS</text>
  <text x="440" y="364" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="bold" fill="#ffffff">NOMINAL</text>

  ${transactionRowsSvg}

  <line x1="35" y1="620" x2="565" y2="620" stroke="#e2e8f0" stroke-width="1.5"/>

  <text x="120" y="655" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="bold" fill="#64748b" text-anchor="middle">Mengetahui,</text>
  <text x="120" y="670" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="bold" fill="#0f172a" text-anchor="middle">${ketua.jabatan}</text>
  
  ${(ketua.tanda_tangan && ketua.tanda_tangan.trim() !== '') ? `
  <image href="${ketua.tanda_tangan}" x="70" y="675" width="100" height="50" preserveAspectRatio="xMidYMid meet" />
  ` : `
  <path d="M 90 710 Q 110 680 120 720 T 150 700" fill="none" stroke="#1e40af" stroke-width="1.5" stroke-linecap="round"/>
  `}
  
  <line x1="60" y1="730" x2="180" y2="730" stroke="#94a3b8" stroke-width="1"/>
  <text x="120" y="745" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="900" fill="#0f172a" text-anchor="middle">${ketua.nama}</text>

  <text x="480" y="655" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="bold" fill="#64748b" text-anchor="middle">Mengesahkan,</text>
  <text x="480" y="670" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="bold" fill="#0f172a" text-anchor="middle">${bendahara.jabatan}</text>
  
  ${(bendahara.tanda_tangan && bendahara.tanda_tangan.trim() !== '') ? `
  <image href="${bendahara.tanda_tangan}" x="430" y="675" width="100" height="50" preserveAspectRatio="xMidYMid meet" />
  ` : `
  <path d="M 450 715 Q 470 690 480 725 T 510 705" fill="none" stroke="#1e40af" stroke-width="1.5" stroke-linecap="round"/>
  `}

  <line x1="420" y1="730" x2="540" y2="730" stroke="#94a3b8" stroke-width="1"/>
  <text x="480" y="745" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" font-weight="900" fill="#0f172a" text-anchor="middle">${bendahara.nama}</text>

  <text x="300" y="810" font-family="'Plus Jakarta Sans', sans-serif" font-size="10" font-weight="bold" fill="#94a3b8" text-anchor="middle">Dihasilkan secara otomatis oleh Bot WhatsApp Reuni PP AL-FATAH</text>
  <text x="300" y="822" font-family="'Plus Jakarta Sans', sans-serif" font-size="9" font-weight="bold" fill="#cbd5e1" text-anchor="middle">Keabsahan data terikat dengan Ledger Keuangan Portal Web Resmi</text>
</svg>
    `;
    return svg;
}
