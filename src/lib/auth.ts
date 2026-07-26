const AUTH_STORE_KEY = "merit-mobile-auth";
const DEVELOPMENT_IDENTITIES = new Set([
  "james.davis@army.mil",
  "marcus.johnson@army.mil",
]);

interface SupabaseUser {
  id: string;
  email?: string;
}

interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: SupabaseUser;
}

function configuration() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) {
    throw new Error("MERIT Mobile authentication is not configured.");
  }
  return { url: url.replace(/\/$/, ""), anonKey };
}

function readSession(): AuthSession | null {
  const raw = localStorage.getItem(AUTH_STORE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    localStorage.removeItem(AUTH_STORE_KEY);
    return null;
  }
}

function storeSession(session: AuthSession): AuthSession {
  const normalized = {
    ...session,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
  };
  localStorage.setItem(AUTH_STORE_KEY, JSON.stringify(normalized));
  localStorage.removeItem("devAuth");
  return normalized;
}

async function tokenRequest(grantType: "password" | "refresh_token", body: Record<string, string>): Promise<AuthSession> {
  const { url, anonKey } = configuration();
  const response = await fetch(`${url}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as (Partial<AuthSession> & { error_description?: string; msg?: string }) | null;
  if (!response.ok || !payload?.access_token || !payload.refresh_token || !payload.user) {
    throw new Error(payload?.error_description || payload?.msg || "Unable to sign in to MERIT.");
  }
  return storeSession(payload as AuthSession);
}

export async function signInToMerit(email: string, password: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (import.meta.env.DEV && password === "testpass" && DEVELOPMENT_IDENTITIES.has(normalizedEmail)) {
    useDevelopmentIdentity(normalizedEmail);
    return;
  }
  await tokenRequest("password", { email: normalizedEmail, password });
}

export async function getMeritAccessToken(): Promise<string | null> {
  const session = readSession();
  if (!session) return null;
  const expiresAt = session.expires_at ?? 0;
  if (expiresAt > Math.floor(Date.now() / 1000) + 60) return session.access_token;
  if (!session.refresh_token) return null;
  const refreshed = await tokenRequest("refresh_token", { refresh_token: session.refresh_token });
  return refreshed.access_token;
}

export function useDevelopmentIdentity(email: string): void {
  if (!import.meta.env.DEV) return;
  localStorage.setItem("devAuth", `Bearer dev:${email}:testpass`);
  localStorage.removeItem(AUTH_STORE_KEY);
}

export async function signOutOfMerit(): Promise<void> {
  const session = readSession();
  localStorage.removeItem(AUTH_STORE_KEY);
  localStorage.removeItem("devAuth");
  if (!session) return;
  try {
    const { url, anonKey } = configuration();
    await fetch(`${url}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
    });
  } catch {
    // Local session removal is sufficient when the network is unavailable.
  }
}

export const isMobileDemoMode = import.meta.env.VITE_EES_DEMO_MODE !== "false";
