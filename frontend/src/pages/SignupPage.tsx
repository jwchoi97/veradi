// FILE: frontend/src/pages/SignupPage.tsx

import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Department } from "@/data/departments";
import { DEPARTMENTS, prettyDepartment } from "@/data/departments";

type SignupPayloadCompat = {
  username: string;
  name: string;
  departments: Department[];
  department?: Department; // legacy fallback
  phone_number: string;
  password: string;
  password_confirm: string;
};

const departmentOptions: { value: Department; label: string }[] = DEPARTMENTS.map((d) => ({
  value: d,
  label: prettyDepartment(d),
}));

function digitsOnly(v: string): string {
  return v.replace(/[^\d]/g, "");
}

function trimOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function uniqDepartments(list: Department[]): Department[] {
  return Array.from(new Set(list));
}

export default function SignupPage() {
  const nav = useNavigate();

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameOk = useMemo(() => /^[a-zA-Z0-9_]{4,20}$/.test(username.trim()), [username]);
  const nameOk = useMemo(() => {
    const v = name.trim();
    return v.length >= 1 && v.length <= 50;
  }, [name]);
  const departmentsOk = useMemo(() => departments.length > 0, [departments]);

  const phoneDigits = useMemo(() => digitsOnly(phoneNumber), [phoneNumber]);
  const phoneOk = useMemo(() => phoneDigits.length >= 10 && phoneDigits.length <= 11, [phoneDigits]);

  const pwTooShort = useMemo(() => pw.length > 0 && pw.length < 8, [pw]);
  const pwMismatch = useMemo(() => pw && pw2 && pw !== pw2, [pw, pw2]);

  const canSubmit = useMemo(() => {
    if (!usernameOk) return false;
    if (!nameOk) return false;
    if (!departmentsOk) return false;
    if (!phoneOk) return false;
    if (pw.length < 8) return false;
    if (pwMismatch) return false;
    return true;
  }, [usernameOk, nameOk, departmentsOk, phoneOk, pw, pwMismatch]);

  const toggleDepartment = (dep: Department) => {
    setDepartments((prev) => {
      const next = new Set(prev);
      if (next.has(dep)) next.delete(dep);
      else next.add(dep);
      return Array.from(next);
    });
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;

    const uniq = uniqDepartments(departments);

    const payload: SignupPayloadCompat = {
      username: trimOrEmpty(username),
      name: trimOrEmpty(name),
      departments: uniq,
      department: uniq[0], // legacy fallback
      phone_number: phoneDigits,
      password: pw,
      password_confirm: pw2,
    };

    try {
      setSubmitting(true);
      const baseUrl = import.meta.env.VITE_API_BASE_URL;
      if (!baseUrl) throw new Error("VITE_API_BASE_URL is not set");

      const res = await fetch(`${baseUrl}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = `Signup failed (HTTP ${res.status})`;
        try {
          const data = await res.json();
          msg = data?.detail ?? data?.message ?? msg;
          if (typeof msg !== "string") msg = JSON.stringify(msg);
        } catch {
          const txt = await res.text();
          if (txt) msg = txt;
        }
        throw new Error(msg);
      }

      nav("/login", { replace: true, state: { signupSuccess: true } });
    } catch (err: any) {
      setError(err?.message ?? "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedLabels = useMemo(() => {
    if (departments.length === 0) return "-";
    return departments
      .slice()
      .map((d) => prettyDepartment(d))
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
  }, [departments]);

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">회원가입</h1>
        <p className="mt-1 text-sm text-gray-500">가입 요청 후 관리자가 승인하면 로그인할 수 있어요.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">아이디</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="4~20자 (영문/숫자/_)"
              autoComplete="username"
            />
            {username.length > 0 && !usernameOk && (
              <p className="mt-1 text-xs text-red-600">
                아이디는 4~20자, 영문/숫자/언더스코어(_)만 허용해요.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">이름</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="표시할 이름 (1~50자)"
              autoComplete="name"
            />
            {name.length > 0 && !nameOk && <p className="mt-1 text-xs text-red-600">이름은 1~50자여야 해요.</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">소속 팀 (복수 선택 가능)</label>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {departmentOptions.map((opt) => {
                const checked = departments.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleDepartment(opt.value)}
                    className={[
                      "flex items-center justify-between rounded-lg border px-2 py-1.5 text-xs",
                      checked ? "border-indigo-500 bg-indigo-50" : "border-gray-300 bg-white hover:bg-gray-50",
                    ].join(" ")}
                    aria-pressed={checked}
                  >
                    <span className="text-gray-900 truncate">{opt.label}</span>
                    <span
                      className={[
                        "h-3.5 w-3.5 rounded border flex-shrink-0",
                        checked ? "border-indigo-500 bg-indigo-600" : "border-gray-300 bg-white",
                      ].join(" ")}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>

            <div className="mt-2 text-xs text-gray-500">
              선택됨: <span className="text-gray-800">{selectedLabels}</span>
            </div>

            {!departmentsOk && <p className="mt-1 text-xs text-red-600">소속 팀은 최소 1개 선택해야 해요.</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">전화번호</label>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(digitsOnly(e.target.value))}
              inputMode="numeric"
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="01012345678"
              autoComplete="tel"
            />
            {phoneNumber.length > 0 && !phoneOk && (
              <p className="mt-1 text-xs text-red-600">전화번호는 숫자만 입력하세요 (10~11자리).</p>
            )}
            <p className="mt-1 text-xs text-gray-400">입력은 숫자만 가능해요. 저장도 숫자만 저장됩니다.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">비밀번호</label>
            <input
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="최소 8자"
              autoComplete="new-password"
            />
            {pwTooShort && <p className="mt-1 text-xs text-red-600">비밀번호는 최소 8자 이상이어야 해요.</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">비밀번호 확인</label>
            <input
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="한 번 더 입력"
              autoComplete="new-password"
            />
            {pwMismatch && <p className="mt-1 text-xs text-red-600">비밀번호가 서로 달라요.</p>}
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <button
            disabled={!canSubmit || submitting}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "요청 중..." : "가입 요청"}
          </button>
        </form>

        <div className="mt-4 text-sm">
          <Link to="/login" className="text-gray-600 hover:underline">
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}


// // FILE: frontend/src/pages/SignupPage.tsx

// import React, { useMemo, useState } from "react";
// import { Link, useNavigate } from "react-router-dom";
// import type { Department } from "@/data/departments";
// import { DEPARTMENTS, DEPARTMENT_LABEL } from "@/data/departments";

// /**
//  * IMPORTANT:
//  * - UI labels are Korean, but the value sent to backend is an enum code string.
//  * - Backend Department enum must match these codes.
//  * - Multi departments selectable on signup (ADMIN is role, not a selectable department).
//  */

// type SignupPayload = {
//   username: string;
//   name: string;
//   departments: Department[];
//   phone_number: string;
//   password: string;
//   password_confirm: string;
// };

// const departmentOptions: { value: Department; label: string }[] = DEPARTMENTS.map((d) => ({
//   value: d,
//   label: DEPARTMENT_LABEL[d],
// }));

// function digitsOnly(v: string): string {
//   return v.replace(/[^\d]/g, "");
// }

// function trimOrEmpty(v: unknown): string {
//   return typeof v === "string" ? v.trim() : "";
// }

// function uniqDepartments(list: Department[]): Department[] {
//   return Array.from(new Set(list));
// }

// function stringifyDetail(detail: unknown): string {
//   if (typeof detail === "string") return detail;
//   try {
//     return JSON.stringify(detail, null, 2);
//   } catch {
//     return String(detail);
//   }
// }

// export default function SignupPage() {
//   const nav = useNavigate();

//   const [username, setUsername] = useState("");
//   const [name, setName] = useState("");
//   const [departments, setDepartments] = useState<Department[]>([]);
//   const [phoneNumber, setPhoneNumber] = useState("");
//   const [pw, setPw] = useState("");
//   const [pw2, setPw2] = useState("");

//   const [submitting, setSubmitting] = useState(false);
//   const [error, setError] = useState<string | null>(null);

//   const usernameOk = useMemo(() => /^[a-zA-Z0-9_]{4,20}$/.test(username.trim()), [username]);
//   const nameOk = useMemo(() => {
//     const v = name.trim();
//     return v.length >= 1 && v.length <= 50;
//   }, [name]);

//   const departmentsOk = useMemo(() => departments.length > 0, [departments]);

//   const phoneDigits = useMemo(() => digitsOnly(phoneNumber), [phoneNumber]);
//   const phoneOk = useMemo(() => phoneDigits.length >= 10 && phoneDigits.length <= 11, [phoneDigits]);

//   const pwTooShort = useMemo(() => pw.length > 0 && pw.length < 8, [pw]);
//   const pwMismatch = useMemo(() => pw && pw2 && pw !== pw2, [pw, pw2]);

//   const canSubmit = useMemo(() => {
//     if (!usernameOk) return false;
//     if (!nameOk) return false;
//     if (!departmentsOk) return false;
//     if (!phoneOk) return false;
//     if (pw.length < 8) return false;
//     if (pwMismatch) return false;
//     return true;
//   }, [usernameOk, nameOk, departmentsOk, phoneOk, pw, pwMismatch]);

//   const toggleDepartment = (dep: Department) => {
//     setDepartments((prev) => {
//       const next = new Set(prev);
//       if (next.has(dep)) next.delete(dep);
//       else next.add(dep);
//       return Array.from(next);
//     });
//   };

//   async function onSubmit(e: React.FormEvent) {
//     e.preventDefault();
//     setError(null);
//     if (!canSubmit) return;

//     const payload: SignupPayload = {
//       username: trimOrEmpty(username),
//       name: trimOrEmpty(name),
//       departments: uniqDepartments(departments),
//       phone_number: phoneDigits,
//       password: pw,
//       password_confirm: pw2,
//     };

//     try {
//       setSubmitting(true);
//       const baseUrl = import.meta.env.VITE_API_BASE_URL;
//       if (!baseUrl) throw new Error("VITE_API_BASE_URL is not set");

//       const res = await fetch(`${baseUrl}/auth/signup`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(payload),
//       });

//       if (!res.ok) {
//         let msg = `Signup failed (HTTP ${res.status})`;
//         try {
//           const data = await res.json();
//           if (data?.detail !== undefined) msg = stringifyDetail(data.detail);
//           else if (data?.message !== undefined) msg = stringifyDetail(data.message);
//           else msg = stringifyDetail(data);
//         } catch {
//           const txt = await res.text();
//           if (txt) msg = txt;
//         }
//         throw new Error(msg);
//       }

//       nav("/login", { replace: true, state: { signupSuccess: true } });
//     } catch (err: any) {
//       setError(err?.message ?? "Signup failed");
//     } finally {
//       setSubmitting(false);
//     }
//   }

//   const selectedLabels = useMemo(() => {
//     const map = new Map<Department, string>(departmentOptions.map((o) => [o.value, o.label]));
//     return departments
//       .slice()
//       .sort((a, b) => (map.get(a) ?? a).localeCompare(map.get(b) ?? b))
//       .map((d) => map.get(d) ?? d)
//       .join(", ");
//   }, [departments]);

//   return (
//     <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
//       <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
//         <h1 className="text-xl font-semibold text-gray-900">회원가입</h1>
//         <p className="mt-1 text-sm text-gray-500">가입 요청 후 관리자가 승인하면 로그인할 수 있어요.</p>

//         <form onSubmit={onSubmit} className="mt-6 space-y-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700">아이디</label>
//             <input
//               value={username}
//               onChange={(e) => setUsername(e.target.value)}
//               className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
//               placeholder="4~20자 (영문/숫자/_)"
//               autoComplete="username"
//             />
//             {username.length > 0 && !usernameOk && (
//               <p className="mt-1 text-xs text-red-600">
//                 아이디는 4~20자, 영문/숫자/언더스코어(_)만 허용해요.
//               </p>
//             )}
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700">이름</label>
//             <input
//               value={name}
//               onChange={(e) => setName(e.target.value)}
//               className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
//               placeholder="표시할 이름 (1~50자)"
//               autoComplete="name"
//             />
//             {name.length > 0 && !nameOk && <p className="mt-1 text-xs text-red-600">이름은 1~50자여야 해요.</p>}
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700">소속 팀 (복수 선택 가능)</label>
//             <div className="mt-2 grid grid-cols-4 gap-1.5">
//               {departmentOptions.map((opt) => {
//                 const checked = departments.includes(opt.value);
//                 return (
//                   <button
//                     key={opt.value}
//                     type="button"
//                     onClick={() => toggleDepartment(opt.value)}
//                     className={[
//                       "flex items-center justify-between rounded-lg border px-2 py-1.5 text-xs",
//                       checked ? "border-indigo-500 bg-indigo-50" : "border-gray-300 bg-white hover:bg-gray-50",
//                     ].join(" ")}
//                     aria-pressed={checked}
//                   >
//                     <span className="text-gray-900 truncate">{opt.label}</span>
//                     <span
//                       className={[
//                         "h-3.5 w-3.5 rounded border flex-shrink-0",
//                         checked ? "border-indigo-500 bg-indigo-600" : "border-gray-300 bg-white",
//                       ].join(" ")}
//                       aria-hidden="true"
//                     />
//                   </button>
//                 );
//               })}
//             </div>

//             <div className="mt-2 text-xs text-gray-500">
//               선택됨: <span className="text-gray-800">{selectedLabels || "-"}</span>
//             </div>

//             {!departmentsOk && <p className="mt-1 text-xs text-red-600">소속 팀은 최소 1개 선택해야 해요.</p>}
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700">전화번호</label>
//             <input
//               value={phoneNumber}
//               onChange={(e) => setPhoneNumber(digitsOnly(e.target.value))}
//               inputMode="numeric"
//               className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
//               placeholder="01012345678"
//               autoComplete="tel"
//             />
//             {phoneNumber.length > 0 && !phoneOk && (
//               <p className="mt-1 text-xs text-red-600">전화번호는 숫자만 입력하세요 (10~11자리).</p>
//             )}
//             <p className="mt-1 text-xs text-gray-400">입력은 숫자만 가능해요. 저장도 숫자만 저장됩니다.</p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700">비밀번호</label>
//             <input
//               value={pw}
//               onChange={(e) => setPw(e.target.value)}
//               type="password"
//               className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
//               placeholder="최소 8자"
//               autoComplete="new-password"
//             />
//             {pwTooShort && <p className="mt-1 text-xs text-red-600">비밀번호는 최소 8자 이상이어야 해요.</p>}
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700">비밀번호 확인</label>
//             <input
//               value={pw2}
//               onChange={(e) => setPw2(e.target.value)}
//               type="password"
//               className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
//               placeholder="한 번 더 입력"
//               autoComplete="new-password"
//             />
//             {pwMismatch && <p className="mt-1 text-xs text-red-600">비밀번호가 서로 달라요.</p>}
//           </div>

//           {error && (
//             <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">
//               {error}
//             </div>
//           )}

//           <button
//             disabled={!canSubmit || submitting}
//             className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
//           >
//             {submitting ? "요청 중..." : "가입 요청"}
//           </button>
//         </form>

//         <div className="mt-4 text-sm">
//           <Link to="/login" className="text-gray-600 hover:underline">
//             로그인으로 돌아가기
//           </Link>
//         </div>
//       </div>
//     </div>
//   );
// }
