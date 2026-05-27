import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
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

const RECAPTCHA_SITE_KEY = "6LfcsP8sAAAAAMToipxWzRMS5MOVAXH2DNcix2f6";

const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

// App Check: attaches a verified reCAPTCHA v3 token to every Firestore/Storage
// call so Google can reject traffic that didn't come from our actual web app
// (curl-with-stolen-token attacks, scripted abuse, etc). Browser-only — the
// admin SDK in the runner daemon bypasses App Check naturally.
//
// Wrapped in try/catch so a reCAPTCHA load failure (CSP misconfig, ad blocker,
// network hiccup) cannot prevent the rest of the SDK from initializing. App
// Check is defense-in-depth — Firestore rules are still the hard gate. If
// App Check is enforced in the console and init fails here, the user will see
// "permission denied" on data calls but at least the page will render.
if (typeof window !== "undefined" && !((globalThis as { __APP_CHECK_INITIALIZED__?: boolean }).__APP_CHECK_INITIALIZED__)) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    (globalThis as { __APP_CHECK_INITIALIZED__?: boolean }).__APP_CHECK_INITIALIZED__ = true;
  } catch (e) {
    console.warn("[firebase] App Check init failed (continuing):", e);
  }
}

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
export { app };
