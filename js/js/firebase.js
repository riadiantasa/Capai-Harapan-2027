// Inisialisasi Firebase (opsional). Bila konfigurasi tidak ada, aplikasi berjalan offline (IndexedDB).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, getDoc, onSnapshot, initializeFirestore, persistentLocalCache } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const appId = typeof __app_id !== 'undefined' ? __app_id : 'juwara-app-2027';
let firebaseConfig = null;
try { firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null; } catch (e) {}

if (firebaseConfig && firebaseConfig.apiKey) {
  const app = initializeApp(firebaseConfig);
  window.fbAuth = getAuth(app);
  window.fbDb = initializeFirestore(app, { localCache: persistentLocalCache() });
  window.fbSignInAnonymously = signInAnonymously;
  window.fbSignInWithCustomToken = signInWithCustomToken;
  window.fbDoc = doc; window.fbSetDoc = setDoc; window.fbGetDoc = getDoc; window.fbOnSnapshot = onSnapshot;
  window.appId = appId;
}
