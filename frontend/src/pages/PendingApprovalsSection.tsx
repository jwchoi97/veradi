// src/pages/PendingApprovalsSection.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  approvePendingUser,
  fetchPendingUsers,
  rejectPendingUser,
  type ApproveRole,
  type PendingUser,
} from "@/data/files/adminUsersApi";
import { getAuthedUser } from "@/auth";

const departmentLabel: Record<string, string> = {
  PHYSICS_1: "물리1",
  CHEMISTRY_1: "화학1",
  BIOLOGY_1: "생물1",
  EARTH_1: "지구1",
  CHEMISTRY_2: "화학2",
  MATH: "수학",
  SOCIETY: "사회문화",
  ADMIN: "관리",
};

function maskPhone(phone?: string | null): string {
  if (!phone) return "-";
  // phone is digits-only (010xxxxxxxx)
  if (phone.length === 11) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  if (phone.length === 10) return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  return phone;
}

export default function PendingApprovalsSection() {
  const me = getAuthedUser();

  const adminId = me?.id ?? null;
  const isAdmin = me?.role === "ADMIN";
  const canUse = useMemo(() => Boolean(adminId && isAdmin), [adminId, isAdmin]);

  const [items, setItems] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // per-user approval role pick (LEAD/MEMBER only)
  const [rolePick, setRolePick] = useState<Record<number, ApproveRole>>({});

  async function refresh() {
    if (!adminId) return;
    setErr(null);
    setLoading(true);
    try {
      const list = await fetchPendingUsers(adminId);
      setItems(list);

      // Ensure a default pick for new rows
      const next: Record<number, ApproveRole> = {};
      for (const u of list) next[u.id] = rolePick[u.id] ?? "MEMBER";
      setRolePick(next);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load pending users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canUse) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse]);

  async function onApprove(userId: number) {
    if (!adminId) return;
    setErr(null);
    try {
      const role = rolePick[userId] ?? "MEMBER";
      await approvePendingUser(adminId, userId, role);
      setItems((prev) => prev.filter((x) => x.id !== userId));
    } catch (e: any) {
      setErr(e?.message ?? "Approve failed");
    }
  }

  async function onReject(userId: number) {
    if (!adminId) return;
    setErr(null);
    try {
      await rejectPendingUser(adminId, userId);
      setItems((prev) => prev.filter((x) => x.id !== userId));
    } catch (e: any) {
      setErr(e?.message ?? "Reject failed");
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">가입 요청</h2>
          <p className="mt-1 text-sm text-gray-500">
            승인 대기(PENDING) 계정에 대해 역할을 부여하거나 거절할 수 있어요.
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={!canUse || loading}
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "불러오는 중..." : "새로고침"}
        </button>
      </div>

      {!isAdmin && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          관리자(ADMIN)만 접근할 수 있어요. 현재 계정 role: <b>{me?.role ?? "UNKNOWN"}</b>
        </div>
      )}

      {err && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {canUse && (
        <>
          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
            <span>
              승인 대기: <b className="text-gray-900">{items.length}</b> 건
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">아이디</th>
                  <th className="px-3 py-2">소속 팀</th>
                  <th className="px-3 py-2">전화번호</th>
                  <th className="px-3 py-2">부여 Role</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-gray-500" colSpan={6}>
                      승인 대기 계정이 없어요.
                    </td>
                  </tr>
                ) : (
                  items.map((u) => (
                    <tr key={u.id} className="border-b">
                      <td className="px-3 py-2">{u.id}</td>
                      <td className="px-3 py-2">{u.username}</td>
                      <td className="px-3 py-2">{departmentLabel[u.department] ?? u.department}</td>
                      <td className="px-3 py-2">{maskPhone(u.phone_number)}</td>
                      <td className="px-3 py-2">
                        <select
                          value={rolePick[u.id] ?? "MEMBER"}
                          onChange={(e) =>
                            setRolePick((prev) => ({
                              ...prev,
                              [u.id]: e.target.value as ApproveRole,
                            }))
                          }
                          className="rounded-lg border border-gray-300 bg-white px-2 py-1"
                        >
                          <option value="MEMBER">MEMBER</option>
                          <option value="LEAD">LEAD</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onApprove(u.id)}
                            className="rounded-xl bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                          >
                            승인
                          </button>
                          <button
                            type="button"
                            onClick={() => onReject(u.id)}
                            className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                          >
                            거절
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-gray-400">
            거절은 계정을 DB에서 삭제합니다(재신청 가능).
          </p>
        </>
      )}
    </section>
  );
}
