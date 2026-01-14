// FILE: frontend/src/pages/PendingApprovalsSection.tsx

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

export default function PendingApprovalsSection() {
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

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">가입 요청</h2>
          <p className="mt-1 text-sm text-gray-500">승인 대기(PENDING) 계정의 요청 정보를 확인하고 승인/거절할 수 있어요.</p>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
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
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      )}

      {canUse && (
        <>
          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
            <span>
              승인 대기: <b className="text-gray-900">{items.length}</b> 건
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">이름/아이디</th>
                  <th className="px-3 py-2">요청 소속 팀</th>
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
                  items.map((u) => {
                    const nm = trimOrEmpty((u as any).name);
                    return (
                      <tr key={u.id} className="border-b">
                        <td className="px-3 py-2">{u.id}</td>

                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-semibold text-gray-900">{nm || "-"}</span>
                            <span className="text-xs text-gray-500">{u.username}</span>
                          </div>
                        </td>

                        <td className="px-3 py-2">
                          <div className="text-sm text-gray-900">{formatDeptList(u)}</div>
                          <div className="text-[11px] text-gray-500 mt-1">(회원가입 시 선택한 소속)</div>
                        </td>

                        <td className="px-3 py-2">{maskPhone((u as any).phone_number)}</td>

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
                              onClick={() => void onApprove(u.id)}
                              className="rounded-xl bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                            >
                              승인
                            </button>
                            <button
                              type="button"
                              onClick={() => void onReject(u.id)}
                              className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
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

          <p className="mt-3 text-xs text-gray-400">거절은 계정을 DB에서 삭제합니다(재신청 가능).</p>
        </>
      )}
    </section>
  );
}



// // FILE: src/pages/PendingApprovalsSection.tsx
// import React, { useEffect, useMemo, useState } from "react";
// import {
//   approvePendingUser,
//   fetchPendingUsers,
//   rejectPendingUser,
//   type ApproveRole,
//   type PendingUser,
// } from "@/data/files/adminUsersApi";
// import { getAuthedUser } from "@/auth";

// import { DEPARTMENTS, DEPARTMENT_LABEL, isDepartment, prettyDepartment, type Department } from "@/data/departments";

// function uniqStr(list: string[]): string[] {
//   const out: string[] = [];
//   const seen = new Set<string>();
//   for (const x of list) {
//     const v = String(x || "").trim();
//     if (!v) continue;
//     if (seen.has(v)) continue;
//     seen.add(v);
//     out.push(v);
//   }
//   return out;
// }

// function maskPhone(phone?: string | null): string {
//   if (!phone) return "-";
//   if (phone.length === 11) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
//   if (phone.length === 10) return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
//   return phone;
// }

// function trimOrEmpty(v: unknown): string {
//   return typeof v === "string" ? v.trim() : "";
// }

// /**
//  * PENDING user dept list from backend:
//  * - prefer u.departments (multi)
//  * - fallback u.department (legacy)
//  * - exclude ADMIN
//  * - filter to known departments
//  */
// function getUserDepartments(u: PendingUser): Department[] {
//   const multi = Array.isArray((u as any).departments) ? ((u as any).departments as string[]) : [];
//   const legacy = typeof (u as any).department === "string" ? [(u as any).department as string] : [];
//   const merged = uniqStr([...multi, ...legacy]).filter((d) => d && d !== "ADMIN");

//   const out: Department[] = [];
//   for (const d of merged) {
//     if (isDepartment(d)) out.push(d);
//   }
//   return out;
// }

// function formatDeptList(u: PendingUser): string {
//   const depts = getUserDepartments(u);
//   if (depts.length === 0) return "-";
//   return depts.map((d) => DEPARTMENT_LABEL[d] ?? d).join(", ");
// }

// export default function PendingApprovalsSection() {
//   const me = getAuthedUser();

//   const adminId = me?.id ?? null;
//   const isAdmin = me?.role === "ADMIN";
//   const canUse = useMemo(() => Boolean(adminId && isAdmin), [adminId, isAdmin]);

//   const [items, setItems] = useState<PendingUser[]>([]);
//   const [loading, setLoading] = useState(false);
//   const [err, setErr] = useState<string | null>(null);

//   const [rolePick, setRolePick] = useState<Record<number, ApproveRole>>({});
//   // ✅ 승인 시 최종 부여할 과목(팀) 단일 선택
//   const [deptPick, setDeptPick] = useState<Record<number, Department>>({});

//   async function refresh() {
//     if (!adminId) return;
//     setErr(null);
//     setLoading(true);
//     try {
//       const list = await fetchPendingUsers(adminId);
//       setItems(list);

//       const nextRole: Record<number, ApproveRole> = {};
//       const nextDept: Record<number, Department> = {};

//       for (const u of list) {
//         nextRole[u.id] = rolePick[u.id] ?? "MEMBER";

//         const requested = getUserDepartments(u);
//         const fallback: Department = requested[0] ?? DEPARTMENTS[0];
//         nextDept[u.id] = deptPick[u.id] ?? fallback;
//       }

//       setRolePick(nextRole);
//       setDeptPick(nextDept);
//     } catch (e: any) {
//       setErr(e?.message ?? "Failed to load pending users");
//     } finally {
//       setLoading(false);
//     }
//   }

//   useEffect(() => {
//     if (canUse) refresh();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [canUse]);

//   async function onApprove(userId: number) {
//     if (!adminId) return;
//     setErr(null);

//     try {
//       const role = rolePick[userId] ?? "MEMBER";
//       const dept = deptPick[userId] ?? DEPARTMENTS[0];

//       // ✅ 승인 시: role + departments(단일) 전송
//       await approvePendingUser(adminId, userId, { role, departments: [dept] });

//       setItems((prev) => prev.filter((x) => x.id !== userId));
//     } catch (e: any) {
//       setErr(e?.message ?? "Approve failed");
//     }
//   }

//   async function onReject(userId: number) {
//     if (!adminId) return;
//     setErr(null);
//     try {
//       await rejectPendingUser(adminId, userId);
//       setItems((prev) => prev.filter((x) => x.id !== userId));
//     } catch (e: any) {
//       setErr(e?.message ?? "Reject failed");
//     }
//   }

//   return (
//     <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
//       <div className="flex items-center justify-between gap-3">
//         <div>
//           <h2 className="text-base font-semibold text-gray-900">가입 요청</h2>
//           <p className="mt-1 text-sm text-gray-500">
//             승인 대기(PENDING) 계정의 요청 정보를 확인하고 역할/과목(팀)을 선택해 승인/거절할 수 있어요.
//           </p>
//         </div>

//         <button
//           type="button"
//           onClick={refresh}
//           disabled={!canUse || loading}
//           className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
//         >
//           {loading ? "불러오는 중..." : "새로고침"}
//         </button>
//       </div>

//       {!isAdmin && (
//         <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
//           관리자(ADMIN)만 접근할 수 있어요. 현재 계정 role: <b>{me?.role ?? "UNKNOWN"}</b>
//         </div>
//       )}

//       {err && (
//         <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
//       )}

//       {canUse && (
//         <>
//           <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
//             <span>
//               승인 대기: <b className="text-gray-900">{items.length}</b> 건
//             </span>
//           </div>

//           <div className="mt-3 overflow-x-auto">
//             <table className="w-full min-w-[980px] border-collapse text-sm">
//               <thead>
//                 <tr className="border-b bg-gray-50 text-left">
//                   <th className="px-3 py-2">ID</th>
//                   <th className="px-3 py-2">이름/아이디</th>
//                   <th className="px-3 py-2">요청 소속 팀</th>
//                   <th className="px-3 py-2">승인 소속 팀</th>
//                   <th className="px-3 py-2">전화번호</th>
//                   <th className="px-3 py-2">부여 Role</th>
//                   <th className="px-3 py-2">액션</th>
//                 </tr>
//               </thead>

//               <tbody>
//                 {items.length === 0 ? (
//                   <tr>
//                     <td className="px-3 py-6 text-gray-500" colSpan={7}>
//                       승인 대기 계정이 없어요.
//                     </td>
//                   </tr>
//                 ) : (
//                   items.map((u) => {
//                     const nm = trimOrEmpty((u as any).name);
//                     const requested = getUserDepartments(u);
//                     const picked = deptPick[u.id] ?? requested[0] ?? DEPARTMENTS[0];

//                     return (
//                       <tr key={u.id} className="border-b">
//                         <td className="px-3 py-2">{u.id}</td>

//                         <td className="px-3 py-2">
//                           <div className="flex flex-col">
//                             <span className="font-semibold text-gray-900">{nm || "-"}</span>
//                             <span className="text-xs text-gray-500">{u.username}</span>
//                           </div>
//                         </td>

//                         {/* 요청한 소속 (표시만) */}
//                         <td className="px-3 py-2">
//                           <div className="text-sm text-gray-900">{formatDeptList(u)}</div>
//                           <div className="text-[11px] text-gray-500 mt-1">(회원가입 시 선택한 소속)</div>
//                         </td>

//                         {/* ✅ 승인 시 부여할 과목(팀) 단일 선택 */}
//                         <td className="px-3 py-2">
//                           <select
//                             value={picked}
//                             onChange={(e) => {
//                               const v = e.target.value;
//                               if (!isDepartment(v)) return;
//                               setDeptPick((prev) => ({ ...prev, [u.id]: v }));
//                             }}
//                             className="rounded-lg border border-gray-300 bg-white px-2 py-1"
//                             title="승인 소속 팀"
//                           >
//                             {/* UX: 요청한 과목이 있으면 위에 보여주고, 그 외 전체 목록 */}
//                             {requested.length > 0 ? (
//                               <>
//                                 <optgroup label="요청 소속">
//                                   {requested.map((d) => (
//                                     <option key={`req-${d}`} value={d}>
//                                       {DEPARTMENT_LABEL[d]}
//                                     </option>
//                                   ))}
//                                 </optgroup>
//                                 <optgroup label="전체 과목">
//                                   {DEPARTMENTS.map((d) => (
//                                     <option key={`all-${d}`} value={d}>
//                                       {DEPARTMENT_LABEL[d]}
//                                     </option>
//                                   ))}
//                                 </optgroup>
//                               </>
//                             ) : (
//                               DEPARTMENTS.map((d) => (
//                                 <option key={d} value={d}>
//                                   {DEPARTMENT_LABEL[d]}
//                                 </option>
//                               ))
//                             )}
//                           </select>

//                           <div className="text-[11px] text-gray-500 mt-1">
//                             선택된 소속: <span className="text-gray-800">{prettyDepartment(picked)}</span>
//                           </div>
//                         </td>

//                         <td className="px-3 py-2">{maskPhone((u as any).phone_number)}</td>

//                         <td className="px-3 py-2">
//                           <select
//                             value={rolePick[u.id] ?? "MEMBER"}
//                             onChange={(e) =>
//                               setRolePick((prev) => ({
//                                 ...prev,
//                                 [u.id]: e.target.value as ApproveRole,
//                               }))
//                             }
//                             className="rounded-lg border border-gray-300 bg-white px-2 py-1"
//                           >
//                             <option value="MEMBER">MEMBER</option>
//                             <option value="LEAD">LEAD</option>
//                           </select>
//                         </td>

//                         <td className="px-3 py-2">
//                           <div className="flex gap-2">
//                             <button
//                               type="button"
//                               onClick={() => onApprove(u.id)}
//                               className="rounded-xl bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
//                             >
//                               승인
//                             </button>
//                             <button
//                               type="button"
//                               onClick={() => onReject(u.id)}
//                               className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
//                             >
//                               거절
//                             </button>
//                           </div>
//                         </td>
//                       </tr>
//                     );
//                   })
//                 )}
//               </tbody>
//             </table>
//           </div>

//           <p className="mt-3 text-xs text-gray-400">거절은 계정을 DB에서 삭제합니다(재신청 가능).</p>
//         </>
//       )}
//     </section>
//   );
// }

