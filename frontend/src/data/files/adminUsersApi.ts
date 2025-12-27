// src/data/adminUsersApi.ts
// Matches backend routers/auth.py paths:
// - GET  /auth/pending
// - POST /auth/{user_id}/approve
// - POST /auth/{user_id}/reject

export type PendingUser = {
  id: number;
  username: string;
  department: string;
  phone_number?: string | null;
  role: "PENDING" | "LEAD" | "MEMBER" | "ADMIN";
};

export type PendingUserListResponse = {
  total: number;
  items: PendingUser[];
};

export type ApproveRole = "LEAD" | "MEMBER";

function getBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!baseUrl) throw new Error("VITE_API_BASE_URL is not set");
  return baseUrl;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (typeof data?.message === "string") return data.message;
    return JSON.stringify(data);
  } catch {
    const txt = await res.text();
    return txt || `HTTP ${res.status}`;
  }
}

export async function fetchPendingUsers(adminUserId: number): Promise<PendingUser[]> {
  const res = await fetch(`${getBaseUrl()}/auth/pending`, {
    method: "GET",
    headers: {
      "X-User-Id": String(adminUserId),
    },
  });

  if (!res.ok) throw new Error(await readErrorMessage(res));

  const data = (await res.json()) as PendingUserListResponse;
  return data.items ?? [];
}

export async function approvePendingUser(
  adminUserId: number,
  userId: number,
  role: ApproveRole
): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/auth/${userId}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": String(adminUserId),
    },
    body: JSON.stringify({ role }),
  });

  if (!res.ok) throw new Error(await readErrorMessage(res));
}

export async function rejectPendingUser(adminUserId: number, userId: number): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/auth/${userId}/reject`, {
    method: "POST",
    headers: {
      "X-User-Id": String(adminUserId),
    },
  });

  if (!res.ok) throw new Error(await readErrorMessage(res));
}