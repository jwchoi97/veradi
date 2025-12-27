const TOKEN_KEY = "access_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// export function isAuthed(): boolean {
//   return !!getToken();
// }

export type AuthedUser = {
  id: number;
  username: string;
  role: "ADMIN" | "LEAD" | "MEMBER" | "PENDING";
  department: string;
};

const USER_KEY = "authed_user";

export function setAuthedUser(u: AuthedUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(u));
}

export function getAuthedUser(): AuthedUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthedUser;
  } catch {
    return null;
  }
}

export function clearAuthedUser() {
  localStorage.removeItem(USER_KEY);
}

// // 기존 isAuthed가 token 기반이면 임시로 이렇게 바꿔도 됨
export function isAuthed(): boolean {
  return getAuthedUser() !== null;
}