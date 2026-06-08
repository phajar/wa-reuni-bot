const { initializeApp } = require('firebase/app');
const { getFirestore, getDoc, doc, collection, getDocs } = require('firebase/firestore');
require('dotenv').config();

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyCfZ9zV6DOuSZoFoFvkW8NCSaxNlmn8R8k",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "reuniakbar.firebaseapp.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "reuniakbar",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "reuniakbar.firebasestorage.app",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "542951643652",
    appId: process.env.FIREBASE_APP_ID || "1:542951643652:web:1b4b7dac6c676a5d6c3351"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
    try {
        console.log("=== CHECKING SETTINGS/WHATSAPP_API ===");
        const apiSnap = await getDoc(doc(db, 'settings', 'whatsapp_api'));
        if (apiSnap.exists()) {
            console.log("whatsapp_api exists. Data:", apiSnap.data());
        } else {
            console.log("whatsapp_api does NOT exist.");
        }

        console.log("\n=== CHECKING USERS ROLES ===");
        const usersCol = collection(db, 'users');
        const usersSnap = await getDocs(usersCol);
        usersSnap.forEach(doc => {
            console.log(`User: ${doc.id}, Name: ${doc.data().nama || doc.data().displayName}, Role: ${doc.data().role}`);
        });

    } catch (e) {
        console.error("Error occurred:", e);
    }
}

check();
