// FILE: src/data/adminUsersApi.ts
// Matches backend routers/auth.py paths:
// - GET  /auth/pending
// - GET  /auth/users (admin, optional department, role)
// - DELETE /auth/users/{user_id} (admin, delete user)
// - POST /auth/{user_id}/approve
// - POST /auth/{user_id}/reject

export type PendingUser = {
  id: number;
  username: string;
  name: string | null;

  // ✅ NEW (multi)
  departments?: string[] | null;

  // ✅ legacy (single)
  department?: string;

  phone_number?: string | null;
  role: "PENDING" | "LEAD" | "MEMBER" | "ADMIN";
};

/** Admin: 전체 등록 유저 (UserOut) */
export type AdminUser = {
  id: number;
  username: string;
  name: string | null;
  role: "PENDING" | "LEAD" | "MEMBER" | "ADMIN";
  department: string;
  departments?: string[];
  phone_number?: string | null;
  phone_verified?: boolean;
  profile_image_url?: string | null;
};

export type AdminUserFilters = {
  department?: string | null;
  role?: string | null;
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

  const data = (await res.json()) as PendingUserListResponse | PendingUser[];

  // ✅ tolerate legacy response shapes
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}

/** Admin: 전체 유저 목록 (필터: 소속 팀, 역할) */
export async function fetchAllUsers(
  adminUserId: number,
  filters?: AdminUserFilters
): Promise<AdminUser[]> {
  const params = new URLSearchParams();
  if (filters?.department) params.set("department", filters.department);
  if (filters?.role) params.set("role", filters.role);
  const qs = params.toString();
  const url = `${getBaseUrl()}/auth/users${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-User-Id": String(adminUserId),
    },
  });

  if (!res.ok) throw new Error(await readErrorMessage(res));
  return (await res.json()) as AdminUser[];
}

/** Admin: 유저 계정 DB에서 삭제 */
export async function deleteUser(adminUserId: number, userId: number): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/auth/users/${userId}`, {
    method: "DELETE",
    headers: {
      "X-User-Id": String(adminUserId),
    },
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
}

export type AdminUserUpdatePayload = {
  role?: "ADMIN" | "LEAD" | "MEMBER" | "PENDING";
  departments?: string[];
};

/** Admin: 유저 역할/소속팀 변경 */
export async function updateUser(
  adminUserId: number,
  userId: number,
  payload: AdminUserUpdatePayload
): Promise<AdminUser> {
  const res = await fetch(`${getBaseUrl()}/auth/users/${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": String(adminUserId),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return (await res.json()) as AdminUser;
}

export async function approvePendingUser(
  adminUserId: number,
  userId: number,
  arg: ApproveRole | { role: ApproveRole; departments: string[] }
): Promise<void> {
  const body =
    typeof arg === "string"
      ? { role: arg }
      : {
          role: arg.role,
          departments: arg.departments,
        };

  const res = await fetch(`${getBaseUrl()}/auth/${userId}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": String(adminUserId),
    },
    body: JSON.stringify(body),
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
