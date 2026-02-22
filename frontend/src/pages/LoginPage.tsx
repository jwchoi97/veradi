import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { setAuthedUser } from "../auth";

type LoginResponse = {
  id: number;
  username: string;
  name: string | null;
  role: "ADMIN" | "LEAD" | "MEMBER" | "PENDING";

  // legacy single
  department: string;

  // NEW multi
  departments?: string[];

  // 프로필 이미지 URL (optional)
  profile_image_url?: string | null;
};

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const from = (loc.state as any)?.from ?? "/home";
  const signupSuccess = Boolean((loc.state as any)?.signupSuccess);
  const resetRequested = Boolean((loc.state as any)?.resetRequested);
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Login failed");
      }

      const data = (await res.json()) as LoginResponse;

      if (data.role === "PENDING") {
        throw new Error("승인 대기 중입니다. 관리자 승인 후 로그인할 수 있어요.");
      }

      setAuthedUser({
        id: data.id,
        username: data.username,
        name: data.name,
        role: data.role,
        department: data.department,
        departments: Array.isArray(data.departments) ? data.departments : [],
        profile_image_url: data.profile_image_url || null,
      });

      nav(from, { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-slate-100 px-4 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-[11px] font-extrabold tracking-[0.28em] text-indigo-700">VERADI</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Contents ERP</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">계정으로 로그인하여 작업을 시작하세요.</p>
        </div>

        <div className="w-full rounded-3xl border border-slate-200/60 bg-white/80 p-7 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
          <h1 className="text-base font-semibold tracking-tight text-slate-900">로그인</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">아이디/비밀번호를 입력해 주세요.</p>

          {signupSuccess && (
            <div className="mt-4 rounded-2xl border border-emerald-200/60 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
              가입 요청이 접수되었습니다. 관리자 승인 후 로그인할 수 있어요.
            </div>
          )}
          {resetRequested && (
            <div className="mt-4 rounded-2xl border border-emerald-200/60 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
              비밀번호 변경 요청이 접수되었습니다. 관리자 승인 후 새 비밀번호로 로그인할 수 있어요.
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold tracking-wide text-slate-700">아이디</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-200"
                placeholder="아이디를 입력하세요"
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold tracking-wide text-slate-700">비밀번호</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-200"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {err && (
              <div className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
                {err}
              </div>
            )}

            <button
              disabled={loading}
              className="h-11 w-full rounded-2xl bg-indigo-700 px-4 text-sm font-semibold text-white shadow-[0_14px_34px_-22px_rgba(15,11,152,0.85)] transition hover:bg-indigo-800 disabled:opacity-50"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between text-sm">
            <Link to="/signup" className="text-slate-600 hover:text-slate-900">
              회원가입
            </Link>

            <Link to="/forgot-password" className="text-slate-600 hover:text-slate-900">
              비밀번호를 잊으셨나요?
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
