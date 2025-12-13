import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAOFHZbn02JpIlSHNxNdvBnfdYv08tZMJs",
  authDomain: "the-classics-befd2.firebaseapp.com",
  projectId: "the-classics-befd2",
  storageBucket: "the-classics-befd2.firebasestorage.app",
  messagingSenderId: "171500319429",
  appId: "1:171500319429:web:2f67b006048191fa6036ac",
  measurementId: "G-08W3C50VF6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const CANONICAL_REDIRECT_URL = "https://theclassics.school";
const ALLOWED_REDIRECT_ORIGINS = new Set([
  CANONICAL_REDIRECT_URL,
  "http://localhost:3000",
  "http://localhost:4173",
  "http://127.0.0.1:5500"
]);

function deriveRedirectUrl() {
  try {
    const { origin, pathname } = new URL(window.location.href);
    const normalizedPath = pathname === "/" ? "" : pathname.replace(/\/$/, "");
    const candidate = `${origin}${normalizedPath}`;

    if (ALLOWED_REDIRECT_ORIGINS.has(candidate) || ALLOWED_REDIRECT_ORIGINS.has(origin)) {
      return candidate;
    }

    console.warn(`Redirect origin not whitelisted: ${origin}. Falling back to canonical domain.`);
  } catch (e) {
    console.warn("Could not derive redirect URL; falling back to canonical domain.", e);
  }

  return CANONICAL_REDIRECT_URL;
}

const actionCodeSettings = {
  // Use the current origin so email links work in production and on local previews
  // without needing to change Firebase settings.
  url: `${window.location.origin}${window.location.pathname}`.replace(/\/$/, ""),
  handleCodeInApp: true
};

export {
  actionCodeSettings,
  auth,
  db,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  getFirestore,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  runTransaction,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut
};
