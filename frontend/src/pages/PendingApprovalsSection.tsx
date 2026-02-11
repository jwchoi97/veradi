import React, { useEffect, useMemo, useState } from "react";
import {
  approvePendingUser,
  fetchPendingUsers,
  rejectPendingUser,
  type ApproveRole,
  type PendingUser,
} from "@/data/files/adminUsersApi";
import { getAuthedUser } from "@/auth";
import { prettyDepartment, isDepartment, type Department } from "@/data/departments";

function uniqStr(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const v = String(x || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function maskPhone(phone?: string | null): string {
  if (!phone) return "-";
  if (phone.length === 11) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  if (phone.length === 10) return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  return phone;
}

function trimOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function getUserDepartments(u: PendingUser): Department[] {
  const multi = Array.isArray((u as any).departments) ? ((u as any).departments as string[]) : [];
  const legacy = typeof (u as any).department === "string" ? [String((u as any).department)] : [];
  const merged = uniqStr([...multi, ...legacy]).filter((d) => d && d !== "ADMIN");
  return merged.filter(isDepartment) as Department[];
}

function formatDeptList(u: PendingUser): string {
  const depts = getUserDepartments(u);
  if (depts.length === 0) return "-";
  return depts.map((d) => prettyDepartment(d)).join(", ");
}

type PendingApprovalsSectionProps = {
  /** 탭 안에 넣을 때 true: 섹션 카드/제목 없이 내용만 렌더 */
  embedded?: boolean;
};

export default function PendingApprovalsSection({ embedded }: PendingApprovalsSectionProps) {
  const me = getAuthedUser();

  const adminId = me?.id ?? null;
  const isAdmin = me?.role === "ADMIN";
  const canUse = useMemo(() => Boolean(adminId && isAdmin), [adminId, isAdmin]);

  const [items, setItems] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [rolePick, setRolePick] = useState<Record<number, ApproveRole>>({});

  async function refresh() {
    if (!adminId) return;
    setErr(null);
    setLoading(true);
    try {
      const list = await fetchPendingUsers(adminId);
      setItems(list);

      const nextRole: Record<number, ApproveRole> = {};
      for (const u of list) nextRole[u.id] = rolePick[u.id] ?? "MEMBER";
      setRolePick(nextRole);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load pending users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canUse) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse]);

  async function onApprove(userId: number) {
    if (!adminId) return;
    setErr(null);

    try {
      const role = rolePick[userId] ?? "MEMBER";
      // ✅ 승인에서는 role만
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

  const content = (
    <>
      {!embedded && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">가입 요청</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              승인 대기(PENDING) 계정의 요청 정보를 확인하고 승인/거절할 수 있어요.
            </p>
          </div>
        </div>
      )}
      <div className={`flex items-center justify-between gap-3 ${embedded ? "" : "mt-4"}`}>
        {embedded && <span className="text-sm text-slate-600">승인 대기: {items.length}건</span>}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={!canUse || loading}
          className="ml-auto h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "불러오는 중..." : "새로고침"}
        </button>
      </div>

      {!isAdmin && (
        <div className="mt-4 rounded-2xl border border-amber-200/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          관리자(ADMIN)만 접근할 수 있어요. 현재 계정 role: <b className="text-slate-900">{me?.role ?? "UNKNOWN"}</b>
        </div>
      )}

      {err && (
        <div className="mt-4 rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
          {err}
        </div>
      )}

      {canUse && (
        <>
          {!embedded && (
            <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
              <span>
                승인 대기: <b className="text-slate-900">{items.length}</b> 건
              </span>
            </div>
          )}

          <div className="mt-3 w-full max-w-full rounded-2xl border border-slate-200/60 bg-white overflow-hidden">
            <div className="max-w-full overflow-x-auto" style={{ scrollbarGutter: "stable" }}>
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-slate-50/90 backdrop-blur sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">ID</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">이름/아이디</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">요청 소속 팀</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">전화번호</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">부여 Role</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500 text-sm" colSpan={6}>
                        승인 대기 계정이 없어요.
                      </td>
                    </tr>
                  ) : (
                    items.map((u) => {
                      const nm = trimOrEmpty((u as any).name);
                      return (
                        <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                          <td className="px-4 py-3 text-slate-700">{u.id}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-900">{nm || "-"}</span>
                              <span className="text-xs text-slate-500">{u.username}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-700">{formatDeptList(u)}</div>
                            <div className="text-[11px] text-slate-500 mt-1">(회원가입 시 선택한 소속)</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{maskPhone((u as any).phone_number)}</td>
                          <td className="px-4 py-3">
                            <select
                              value={rolePick[u.id] ?? "MEMBER"}
                              onChange={(e) =>
                                setRolePick((prev) => ({
                                  ...prev,
                                  [u.id]: e.target.value as ApproveRole,
                                }))
                              }
                              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            >
                              <option value="MEMBER">MEMBER</option>
                              <option value="LEAD">LEAD</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void onApprove(u.id)}
                                className="rounded-xl border border-indigo-600 bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_14px_34px_-22px_rgba(15,11,152,0.85)] hover:bg-indigo-800"
                              >
                                승인
                              </button>
                              <button
                                type="button"
                                onClick={() => void onReject(u.id)}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                거절
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-500">거절은 계정을 DB에서 삭제합니다(재신청 가능).</p>
        </>
      )}
    </>
  );

  if (embedded) return content;
  return (
    <section className="mt-6 rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
      {content}
    </section>
  );
}

