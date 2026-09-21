"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  EmailAuthProvider,
  linkWithCredential,
  User as FirebaseUser,
} from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { isAllowedAdminEmail } from "@/lib/adminConfig";

interface UserProfile {
  username: string;
  name: string;
  email: string;
  role?: "user" | "organization" | "admin";
  authProvider?: "password" | "google" | "google+password";
  bio?: string;
  education?: string;
  skills?: string[];
  interests?: string[];
  location?: string;
  category?: string;
  income?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthContextType {
  currentUser: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  // email+username signup
  signup: (username: string, name: string, email: string, password: string) => Promise<any>;
  login: (email: string, password: string) => Promise<any>;
  loginWithIdentifier: (identifier: string, password: string) => Promise<any>;
  loginWithGoogle: () => Promise<{ cred: any; needsCompletion: boolean }>;
  completeGoogleProfile: (username: string, name: string, password: string) => Promise<void>;
  checkUsernameAvailable: (username: string) => Promise<boolean>;
  logout: () => Promise<any>;
  resetPassword: (email: string) => Promise<any>;
  updateUserProfile: (data: Partial<UserProfile>) => Promise<any>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

function normalizeUsername(u: string) {
  return u.trim().toLowerCase();
}

async function usernameAvailable(username: string): Promise<boolean> {
  const key = normalizeUsername(username);
  try {
    const snap = await getDoc(doc(db, "usernames", key));
    return !snap.exists();
  } catch {
    // Read blocked (rules) or offline → assume available; real uniqueness
    // is enforced at claim time via Firestore rules on the usernames collection.
    return true;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshProfile(uid?: string) {
    const activeUid = uid || currentUser?.uid;
    if (!activeUid) return;
    try {
      const snap = await getDoc(doc(db, "users", activeUid));
      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        if (isAllowedAdminEmail(data.email) && data.role !== "admin") {
          await updateDoc(doc(db, "users", activeUid), { role: "admin" });
          data.role = "admin";
        }
        setProfile(data);
      }
    } catch (error) {
      console.error("Error loading user profile:", error);
    }
  }

  async function checkUsernameAvailable(username: string) {
    return usernameAvailable(username);
  }

  async function signup(username: string, name: string, email: string, password: string) {
    const key = normalizeUsername(username);
    if (!(await usernameAvailable(username))) throw new Error("Username already taken");

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    const initialProfile: UserProfile = {
      username: key,
      name,
      email,
      role: isAllowedAdminEmail(email) ? "admin" : "user",
      authProvider: "password",
      bio: "",
      education: "",
      skills: [],
      interests: [],
      location: "",
      category: "",
      income: "",
      createdAt: new Date().toISOString(),
    };

    await setDoc(doc(db, "users", cred.user.uid), initialProfile);
    // Claim username atomically-ish (firestore rules should enforce unique)
    try {
      await setDoc(doc(db, "usernames", key), { uid: cred.user.uid, username: key, email, createdAt: new Date().toISOString() });
    } catch (e) {
      console.warn("Failed to claim username doc", e);
    }
    setProfile(initialProfile);
    return cred;
  }

  function login(email: string, password: string) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function loginWithIdentifier(identifier: string, password: string) {
    const raw = identifier.trim();
    // If looks like email, direct
    if (raw.includes("@")) {
      return signInWithEmailAndPassword(auth, raw, password);
    }
    // Otherwise treat as username → resolve to email via usernames collection
    const key = normalizeUsername(raw);
    const snap = await getDoc(doc(db, "usernames", key));
    if (!snap.exists()) {
      throw new Error("Username not found");
    }
    const data: any = snap.data();
    const email = data.email as string;
    if (!email) throw new Error("Username record missing email");
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function loginWithGoogle(): Promise<{ cred: any; needsCompletion: boolean }> {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    const uid = cred.user.uid;

    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) {
      // No profile yet → must complete username/name/password
      const draft: any = {
        username: "",
        name: cred.user.displayName || "",
        email: cred.user.email || "",
        role: isAllowedAdminEmail(cred.user.email) ? "admin" : "user",
        authProvider: "google",
        bio: "",
        education: "",
        skills: [],
        interests: [],
        location: "",
        category: "",
        income: "",
        createdAt: new Date().toISOString(),
      };
      // Create a minimal placeholder so uid is reserved; username empty signals incomplete
      await setDoc(doc(db, "users", uid), draft);
      setProfile(draft);
      return { cred, needsCompletion: true };
    }

    const data = snap.data() as UserProfile;
    // If existing profile but username missing/empty → needs completion
    if (!data.username || data.username.trim() === "") {
      setProfile(data);
      return { cred, needsCompletion: true };
    }

    if (isAllowedAdminEmail(data.email) && data.role !== "admin") {
      await updateDoc(doc(db, "users", uid), { role: "admin" });
      data.role = "admin";
    }
    setProfile(data);
    return { cred, needsCompletion: false };
  }

  async function completeGoogleProfile(username: string, name: string, password: string) {
    if (!auth.currentUser) throw new Error("No authenticated user");
    const user = auth.currentUser;
    const key = normalizeUsername(username);
    if (!(await usernameAvailable(username))) throw new Error("Username already taken");

    // Link password so user can also login with username/password
    const email = user.email;
    if (!email) throw new Error("Google account has no email");
    try {
      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(user, credential);
    } catch (e: any) {
      // If already linked (provider already exists) or other error, surface but don't block profile completion
      if (e.code === "auth/provider-already-linked" || e.code === "auth/credential-already-in-use") {
        // already linked — okay
      } else if (e.code === "auth/requires-recent-login") {
        throw new Error("Please re-login with Google and try again (recent login required to set password).");
      } else {
        // If linking fails for other reason, still allow profile completion but log
        console.warn("Password linking failed:", e);
        // Optionally fall back to just setting profile without linking — user can still login via Google
        // But per requirement, we want password set; rethrow to let user retry with different password
        if (e.code !== "auth/weak-password") throw e;
        else throw e;
      }
    }

    await updateProfile(user, { displayName: name });

    const uid = user.uid;
    const snap = await getDoc(doc(db, "users", uid));
    const existing = snap.exists() ? (snap.data() as any) : {};
    const updated: UserProfile = {
      username: key,
      name,
      email,
      role: existing.role || (isAllowedAdminEmail(email) ? "admin" : "user"),
      authProvider: "google+password",
      bio: existing.bio || "",
      education: existing.education || "",
      skills: existing.skills || [],
      interests: existing.interests || [],
      location: existing.location || "",
      category: existing.category || "",
      income: existing.income || "",
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, "users", uid), updated, { merge: true });
    try {
      await setDoc(doc(db, "usernames", key), { uid, username: key, email, createdAt: new Date().toISOString() });
    } catch (e) {
      console.warn("Failed to claim username doc", e);
    }
    setProfile(updated);
  }

  function logout() {
    return signOut(auth);
  }

  function resetPassword(email: string) {
    return sendPasswordResetEmail(auth, email);
  }

  async function updateUserProfile(data: Partial<UserProfile>) {
    if (!currentUser) throw new Error("No authenticated user");
    // If username is being changed, need uniqueness handling (not exposed in UI yet)
    if (data.username) {
      const key = normalizeUsername(data.username);
      if (key !== profile?.username) {
        if (!(await usernameAvailable(data.username))) throw new Error("Username already taken");
        // claim new, but ideally release old — keep simple for now
        await setDoc(doc(db, "usernames", key), { uid: currentUser.uid, username: key, email: profile?.email || currentUser.email || "", createdAt: new Date().toISOString() });
        data.username = key;
      }
    }
    await updateDoc(doc(db, "users", currentUser.uid), { ...data, updatedAt: new Date().toISOString() });
    await refreshProfile(currentUser.uid);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await refreshProfile(user.uid);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const value = {
    currentUser,
    profile,
    loading,
    signup,
    login,
    loginWithIdentifier,
    loginWithGoogle,
    completeGoogleProfile,
    checkUsernameAvailable,
    logout,
    resetPassword,
    updateUserProfile,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
}
