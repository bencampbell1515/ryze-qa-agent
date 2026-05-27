"use client";

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { auth } from "./firebase";

const ALLOWED_DOMAIN = "ryzewith.com";

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

function isAllowedUser(u: User | null | undefined): boolean {
  if (!u) return false;
  if (!u.emailVerified) return false;
  const googleLinked = u.providerData.some((p) => p.providerId === "google.com");
  if (!googleLinked) return false;
  return isAllowedEmail(u.email);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u && !isAllowedUser(u)) {
        await fbSignOut(auth);
        setUser(null);
        setError(`Sign-in restricted to verified @${ALLOWED_DOMAIN} Google accounts.`);
      } else {
        setUser(u);
        if (u) setError(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: "select_account" });
    try {
      const result = await signInWithPopup(auth, provider);
      if (!isAllowedUser(result.user)) {
        await fbSignOut(auth);
        setError(`Sign-in restricted to verified @${ALLOWED_DOMAIN} Google accounts.`);
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? "unknown";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        return;
      }
      setError(`Sign-in failed (${code}).`);
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
