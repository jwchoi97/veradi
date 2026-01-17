const TOKEN_KEY = "access_token";
const USER_KEY = "authed_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export type AuthedUser = {
  id: number;
  username: string;
  name?: string | null;
  role: "ADMIN" | "LEAD" | "MEMBER" | "PENDING";

  // legacy single
  department: string;

  // NEW multi (optional, backward compatible)
  departments?: string[];

  // 프로필 이미지 URL (optional)
  profile_image_url?: string | null;
};

export function setAuthedUser(u: AuthedUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(u));
}

export function getAuthedUser(): AuthedUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AuthedUser;

    const rawDeps = Array.isArray((parsed as any).departments) ? (parsed as any).departments : [];
    const cleaned = rawDeps
      .map((d: any) => (typeof d === "string" ? d.trim() : ""))
      .filter((d: string) => d.length > 0);

    const seen = new Set<string>();
    const deps: string[] = [];
    for (const d of cleaned) {
      if (seen.has(d)) continue;
      seen.add(d);
      deps.push(d);
    }

    if (deps.length > 0) {
      parsed.departments = deps;
    } else if (typeof parsed.department === "string" && parsed.department.trim().length > 0) {
      parsed.departments = [parsed.department.trim()];
    } else {
      parsed.departments = [];
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearAuthedUser() {
  localStorage.removeItem(USER_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  clearAuthedUser();
}

export function isAuthed(): boolean {
  return getAuthedUser() !== null;
}