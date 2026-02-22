import React, { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchPendingPasswordChanges,
  approvePendingPasswordChange,
  rejectPendingPasswordChange,
  type PendingPasswordChangeRequest,
} from "@/data/files/adminUsersApi";
import { getAuthedUser } from "@/auth";
import { PENDING_COUNT_QUERY_KEY } from "@/hooks/usePendingCount";

function maskPhone(phone?: string | null): string {
  if (!phone) return "-";
  if (phone.length === 11) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  if (phone.length === 10) return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  return phone;
}

function formatRequestedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR");
  } catch {
    return iso;
  }
}

type PendingPasswordChangesSectionProps = {
  embedded?: boolean;
};

export default function PendingPasswordChangesSection({
  embedded,
}: PendingPasswordChangesSectionProps) {
  const me = getAuthedUser();
  const queryClient = useQueryClient();

  const adminId = me?.id ?? null;
  const isAdmin = me?.role === "ADMIN";
  const canUse = useMemo(() => Boolean(adminId && isAdmin), [adminId, isAdmin]);

  const [items, setItems] = useState<PendingPasswordChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    if (!adminId) return;
    setErr(null);
    setLoading(true);
    try {
      const list = await fetchPendingPasswordChanges(adminId);
      setItems(list);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load pending password changes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canUse) void refresh();
  }, [canUse]);

  async function onApprove(requestId: number) {
    if (!adminId) return;
    setErr(null);
    try {
      await approvePendingPasswordChange(adminId, requestId);
      setItems((prev) => prev.filter((x) => x.id !== requestId));
      await queryClient.invalidateQueries({ queryKey: PENDING_COUNT_QUERY_KEY });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "승인에 실패했습니다.");
    }
  }

  async function onReject(requestId: number) {
    if (!adminId) return;
    setErr(null);
    try {
      await rejectPendingPasswordChange(adminId, requestId);
      setItems((prev) => prev.filter((x) => x.id !== requestId));
      await queryClient.invalidateQueries({ queryKey: PENDING_COUNT_QUERY_KEY });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "거절에 실패했습니다.");
    }
  }

  const content = (
    <>
      {!embedded && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">
              비밀번호 변경 요청
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              아이디·전화번호로 본인 확인 후 요청된 비밀번호 변경을 승인/거절할 수 있어요.
            </p>
          </div>
        </div>
      )}
      <div className={`flex items-center justify-between gap-3 ${embedded ? "" : "mt-4"}`}>
        {embedded && (
          <span className="text-sm text-slate-600">비밀번호 변경 요청: {items.length}건</span>
        )}
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
          관리자(ADMIN)만 접근할 수 있어요.
        </div>
      )}

      {err && (
        <div className="mt-4 rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
          {err}
        </div>
      )}

      {canUse && (
        <div className="mt-3 w-full max-w-full rounded-2xl border border-slate-200/60 bg-white overflow-hidden">
          <div className="max-w-full overflow-x-auto" style={{ scrollbarGutter: "stable" }}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50/90 backdrop-blur sticky top-0 z-10">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">
                    ID
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">
                    이름/아이디
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">
                    전화번호
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">
                    요청 시각
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold tracking-wide text-slate-600">
                    액션
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500 text-sm" colSpan={5}>
                      비밀번호 변경 요청이 없어요.
                    </td>
                  </tr>
                ) : (
                  items.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-slate-700">{r.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900">{r.name || "-"}</span>
                          <span className="text-xs text-slate-500">{r.username}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {maskPhone(r.phone_number)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {formatRequestedAt(r.requested_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void onApprove(r.id)}
                            className="rounded-xl border border-indigo-600 bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_14px_34px_-22px_rgba(15,11,152,0.85)] hover:bg-indigo-800"
                          >
                            승인
                          </button>
                          <button
                            type="button"
                            onClick={() => void onReject(r.id)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
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
        </div>
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
