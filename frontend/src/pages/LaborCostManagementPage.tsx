import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthedUser } from "@/auth";
import {
  createLaborAssignment,
  deleteLaborAssignment,
  getLaborAssignments,
  getLaborDepartmentMembers,
  getLaborTeams,
  updateLaborAlpha,
  updateLaborTeamRates,
  type LaborDepartmentSummary,
  type LaborManagerAssignment,
} from "@/data/files/api";
import { fetchAllUsers, type AdminUser } from "@/data/files/adminUsersApi";
import { DEPARTMENTS, DEPARTMENT_LABEL } from "@/data/departments";

function asWon(v: number): string {
  return `${v.toLocaleString("ko-KR")}원`;
}

export default function LaborCostManagementPage() {
  const me = getAuthedUser();
  const isAdmin = me?.role === "ADMIN";
  const userId = me?.id ?? null;
  const canOpenAdminTab = isAdmin;

  const [period, setPeriod] = useState<string>(new Date().toISOString().slice(0, 7));
  const [activeTab, setActiveTab] = useState<"summary" | "admin">("summary");
  const [teams, setTeams] = useState<string[]>([]);
  const [activeTeam, setActiveTeam] = useState<string>("");
  const [adminTeam, setAdminTeam] = useState<string>("");

  const [summary, setSummary] = useState<LaborDepartmentSummary | null>(null);
  const [assignments, setAssignments] = useState<LaborManagerAssignment[]>([]);
  const [leadCandidates, setLeadCandidates] = useState<AdminUser[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<number | "">("");

  const [alphaInputs, setAlphaInputs] = useState<Record<number, string>>({});
  const [uploadUnitInput, setUploadUnitInput] = useState<string>("70000");
  const [reviewUnitInput, setReviewUnitInput] = useState<string>("70000");
  const [loading, setLoading] = useState(false);
  const [savingRates, setSavingRates] = useState(false);
  const [savingMemberId, setSavingMemberId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canOpenTeam = useCallback(
    (dep: string): boolean => {
      if (isAdmin) return true;
      return teams.includes(dep);
    },
    [isAdmin, teams]
  );

  const loadTeams = useCallback(async () => {
    setError(null);
    const data = await getLaborTeams();
    const nextTeams = Array.isArray(data.teams) ? data.teams : [];
    setTeams(nextTeams);
    if (!activeTeam) setActiveTeam(nextTeams[0] ?? "");
    if (activeTeam && !nextTeams.includes(activeTeam) && nextTeams.length > 0) {
      setActiveTeam(nextTeams[0]);
    }
    if (!adminTeam) setAdminTeam(nextTeams[0] ?? DEPARTMENTS[0]);
    if (adminTeam && !nextTeams.includes(adminTeam) && nextTeams.length > 0) {
      setAdminTeam(nextTeams[0]);
    }
  }, [activeTeam, adminTeam]);

  const loadSummary = useCallback(
    async (targetTeam: string) => {
      if (!targetTeam) return;
      const [yearPart, monthPart] = period.split("-");
      const targetYear = yearPart || String(new Date().getFullYear());
      const targetMonth = Number(monthPart || String(new Date().getMonth() + 1));
      setLoading(true);
      setError(null);
      try {
        const data = await getLaborDepartmentMembers(targetTeam, targetYear, targetMonth);
        setSummary(data);
        const nextInputs: Record<number, string> = {};
        data.members.forEach((m) => {
          nextInputs[m.member_user_id] = String(m.alpha_amount ?? 0);
        });
        setAlphaInputs(nextInputs);
        setUploadUnitInput(String(data.upload_unit_amount ?? 70000));
        setReviewUnitInput(String(data.review_unit_amount ?? 70000));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "인건비 집계를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [period]
  );

  const loadAssignmentsAndCandidates = useCallback(
    async (targetTeam: string) => {
      if (!isAdmin || !userId || !targetTeam) return;
      try {
        const [rows, leads] = await Promise.all([
          getLaborAssignments(targetTeam),
          fetchAllUsers(userId, { role: "LEAD", department: targetTeam }),
        ]);
        setAssignments(rows);
        setLeadCandidates(leads);
        setSelectedLeadId("");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "LEAD 지정 정보를 불러오지 못했습니다.");
      }
    },
    [isAdmin, userId]
  );

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    if (!activeTeam || !canOpenTeam(activeTeam)) return;
    if (activeTab === "summary") {
      void loadSummary(activeTeam);
    }
  }, [activeTeam, canOpenTeam, loadSummary, activeTab]);

  useEffect(() => {
    if (!isAdmin || activeTab !== "admin" || !adminTeam) return;
    void loadAssignmentsAndCandidates(adminTeam);
  }, [isAdmin, activeTab, adminTeam, loadAssignmentsAndCandidates]);

  const totals = useMemo(() => {
    if (!summary) return { upload: 0, review: 0, total: 0 };
    return summary.members.reduce(
      (acc, m) => {
        acc.upload += m.upload_amount;
        acc.review += m.review_amount;
        acc.total += m.total_amount;
        return acc;
      },
      { upload: 0, review: 0, total: 0 }
    );
  }, [summary]);

  async function handleSaveAlpha(memberId: number) {
    if (!activeTeam) return;
    if (!summary?.can_edit) return;
    const raw = alphaInputs[memberId] ?? "0";
    const alpha = Math.max(0, Number(raw || 0));
    if (!Number.isFinite(alpha)) return;
    setSavingMemberId(memberId);
    setError(null);
    try {
      await updateLaborAlpha(activeTeam, memberId, {
        year: summary?.year ?? period.slice(0, 4),
        month: summary?.month ?? Number(period.slice(5, 7)),
        alpha_amount: alpha,
      });
      await loadSummary(activeTeam);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "알파 금액 저장에 실패했습니다.");
    } finally {
      setSavingMemberId(null);
    }
  }

  async function handleSaveTeamRates() {
    if (!activeTeam) return;
    if (!summary?.can_edit) return;
    const uploadUnit = Math.max(0, Number(uploadUnitInput || 0));
    const reviewUnit = Math.max(0, Number(reviewUnitInput || 0));
    if (!Number.isFinite(uploadUnit) || !Number.isFinite(reviewUnit)) return;
    setSavingRates(true);
    setError(null);
    try {
      await updateLaborTeamRates(activeTeam, {
        year: summary?.year ?? period.slice(0, 4),
        month: summary?.month ?? Number(period.slice(5, 7)),
        upload_unit_amount: uploadUnit,
        review_unit_amount: reviewUnit,
      });
      await loadSummary(activeTeam);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "팀 단가 저장에 실패했습니다.");
    } finally {
      setSavingRates(false);
    }
  }

  async function handleAssignLead() {
    if (!isAdmin || !adminTeam || !selectedLeadId) return;
    setError(null);
    try {
      await createLaborAssignment({
        department: adminTeam,
        lead_user_id: Number(selectedLeadId),
      });
      await loadAssignmentsAndCandidates(adminTeam);
      await loadTeams();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "LEAD 지정에 실패했습니다.");
    }
  }

  async function handleUnassignLead(leadUserId: number) {
    if (!isAdmin || !adminTeam) return;
    setError(null);
    try {
      await deleteLaborAssignment(adminTeam, leadUserId);
      await loadAssignmentsAndCandidates(adminTeam);
      await loadTeams();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "LEAD 지정 해제에 실패했습니다.");
    }
  }

  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 space-y-4">
      <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">인건비 관리</h1>
        <p className="text-sm leading-6 text-slate-600">
          팀별 건당 단가(업로드/콘텐츠 검토)를 설정하고, alpha를 반영해 멤버 인건비를 집계합니다.
        </p>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">{error}</div>
      )}

      <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur space-y-4">
        <div className="flex gap-1 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab("summary")}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition ${
              activeTab === "summary"
                ? "border border-slate-200 border-b-0 bg-white text-slate-900 -mb-px"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            인건비 집계
          </button>
          {canOpenAdminTab && (
            <button
              type="button"
              onClick={() => setActiveTab("admin")}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition ${
                activeTab === "admin"
                  ? "border border-slate-200 border-b-0 bg-white text-slate-900 -mb-px"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              관리자 설정(LEAD 지정)
            </button>
          )}
        </div>

        {activeTab === "summary" && (
          <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {DEPARTMENTS.map((dep) => {
              const active = dep === activeTeam;
              const enabled = canOpenTeam(dep);
              return (
                <button
                  key={dep}
                  type="button"
                  onClick={() => enabled && setActiveTeam(dep)}
                  disabled={!enabled}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                    active
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : enabled
                        ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  {DEPARTMENT_LABEL[dep]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">연-월</label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              max={new Date().toISOString().slice(0, 7)}
              className="month-no-clear w-40 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">업로드 건당 단가(원)</label>
              <input
                value={uploadUnitInput}
                onChange={(e) => setUploadUnitInput(e.target.value.replace(/[^\d]/g, ""))}
                disabled={!summary?.can_edit}
                className="w-32 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-right"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">콘텐츠 검토 건당 단가(원)</label>
              <input
                value={reviewUnitInput}
                onChange={(e) => setReviewUnitInput(e.target.value.replace(/[^\d]/g, ""))}
                disabled={!summary?.can_edit}
                className="w-32 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-right"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSaveTeamRates()}
              disabled={savingRates || !summary?.can_edit}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {savingRates ? "저장중" : "팀 단가 저장"}
            </button>
          </div>
          {!summary?.can_edit && (
            <p className="mt-2 text-xs text-slate-500">과거 월은 조회만 가능하며 단가/alpha 수정이 잠겨 있습니다.</p>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-sm text-slate-600">집계 데이터를 불러오는 중입니다...</div>
        ) : (
          <div className="w-full overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-slate-50/90">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">대상자</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">업로드 세트</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">콘텐츠 검토완료</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">alpha(원)</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">업로드 금액</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">검토 금액</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">총액</th>
                </tr>
              </thead>
              <tbody>
                {!summary || summary.members.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={7}>
                      집계할 멤버가 없습니다.
                    </td>
                  </tr>
                ) : (
                  summary.members.map((m) => (
                    <tr key={m.member_user_id} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{m.member_name}</div>
                        <div className="text-xs text-slate-500">{m.member_username}</div>
                      </td>
                      <td className="px-4 py-3 text-right">{m.upload_set_count}</td>
                      <td className="px-4 py-3 text-right">{m.content_review_approved_count}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <input
                            value={alphaInputs[m.member_user_id] ?? "0"}
                            onChange={(e) =>
                              setAlphaInputs((prev) => ({
                                ...prev,
                                [m.member_user_id]: e.target.value.replace(/[^\d]/g, ""),
                              }))
                            }
                            disabled={!summary?.can_edit}
                            className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-sm text-right"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveAlpha(m.member_user_id)}
                            disabled={savingMemberId === m.member_user_id || !summary?.can_edit}
                            className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            {savingMemberId === m.member_user_id ? "저장중" : "저장"}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{asWon(m.upload_amount)}</td>
                      <td className="px-4 py-3 text-right">{asWon(m.review_amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{asWon(m.total_amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {summary && summary.members.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="px-4 py-3 font-semibold">합계</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right font-semibold">{asWon(totals.upload)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{asWon(totals.review)}</td>
                    <td className="px-4 py-3 text-right font-bold">{asWon(totals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
          </>
        )}

        {activeTab === "admin" && canOpenAdminTab && (
          <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">팀별 인건비 관리 LEAD 지정</h2>
            <div className="flex flex-wrap gap-2">
              {DEPARTMENTS.map((dep) => {
                const active = dep === adminTeam;
                return (
                  <button
                    key={dep}
                    type="button"
                    onClick={() => setAdminTeam(dep)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                      active
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {DEPARTMENT_LABEL[dep]}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="min-w-[240px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={selectedLeadId}
                onChange={(e) => setSelectedLeadId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">LEAD 선택</option>
                {leadCandidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.name || u.username) + ` (${u.username})`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleAssignLead()}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                지정
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {assignments.length === 0 ? (
                <span className="text-sm text-slate-500">지정된 LEAD가 없습니다.</span>
              ) : (
                assignments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm">
                    {a.lead_user_name || `ID ${a.lead_user_id}`}
                    <button
                      type="button"
                      onClick={() => void handleUnassignLead(a.lead_user_id)}
                      className="text-rose-700 hover:underline"
                    >
                      해제
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
