import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAPaFb5Bim2jnedsVsh1Bs-m11J8U3N_2E",
  authDomain: "live-qa-agent.firebaseapp.com",
  projectId: "live-qa-agent",
  storageBucket: "live-qa-agent.firebasestorage.app",
  messagingSenderId: "285814142624",
  appId: "1:285814142624:web:abcb51fc3f79d0abbbfbc5",
};

const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
export { app };
