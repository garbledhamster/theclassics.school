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
const actionCodeSettings = {
  url: "https://theclassics.school",
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
