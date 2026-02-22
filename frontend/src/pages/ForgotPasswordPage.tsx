// FILE: frontend/src/pages/ForgotPasswordPage.tsx

import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function digitsOnly(v: string): string {
  return v.replace(/[^\d]/g, "");
}

function trimOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export default function ForgotPasswordPage() {
  const nav = useNavigate();
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  const [username, setUsername] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const [step, setStep] = useState<"verify" | "reset">("verify");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameOk = useMemo(() => /^[a-zA-Z0-9_]{4,20}$/.test(username.trim()), [username]);
  const phoneDigits = useMemo(() => digitsOnly(phoneNumber), [phoneNumber]);
  const phoneOk = useMemo(() => phoneDigits.length >= 10 && phoneDigits.length <= 11, [phoneDigits]);

  const pwTooShort = useMemo(() => pw.length > 0 && pw.length < 8, [pw]);
  const pwMismatch = useMemo(() => pw && pw2 && pw !== pw2, [pw, pw2]);

  const canVerify = useMemo(() => usernameOk && phoneOk, [usernameOk, phoneOk]);
  const canReset = useMemo(() => {
    if (pw.length < 8) return false;
    if (pwMismatch) return false;
    return true;
  }, [pw, pwMismatch]);

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canVerify) return;
    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE}/auth/forgot-password/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: trimOrEmpty(username),
          phone_number: phoneDigits,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = (data?.detail ?? (await res.text())) || "본인 확인에 실패했습니다.";
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      setStep("reset");
    } catch (err: any) {
      setError(err?.message ?? "본인 확인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canReset) return;
    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE}/auth/forgot-password/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: trimOrEmpty(username),
          phone_number: phoneDigits,
          new_password: pw,
          new_password_confirm: pw2,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = (data?.detail ?? (await res.text())) || "비밀번호 변경에 실패했습니다.";
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      nav("/login", { replace: true, state: { resetRequested: true } });
    } catch (err: any) {
      setError(err?.message ?? "비밀번호 변경에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-slate-100 px-4 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-[11px] font-extrabold tracking-[0.28em] text-indigo-700">VERADI</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Contents ERP</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {step === "verify" ? "가입 시 등록한 아이디와 전화번호로 본인을 확인하세요." : "새 비밀번호를 입력하세요."}
          </p>
        </div>

        <div className="w-full rounded-3xl border border-slate-200/60 bg-white/80 p-7 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
          <h1 className="text-base font-semibold tracking-tight text-slate-900">비밀번호 재설정</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {step === "verify"
              ? "아이디와 가입 시 등록한 전화번호를 입력하세요."
              : "새 비밀번호를 두 번 입력해 주세요."}
          </p>

          {step === "verify" ? (
            <form onSubmit={onVerify} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold tracking-wide text-slate-700">아이디</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-200"
                  placeholder="아이디를 입력하세요"
                  autoComplete="username"
                />
                {username.length > 0 && !usernameOk && (
                  <p className="mt-1 text-xs text-red-600">아이디는 4~20자, 영문/숫자/언더스코어(_)만 허용해요.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold tracking-wide text-slate-700">전화번호</label>
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(digitsOnly(e.target.value))}
                  inputMode="numeric"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-200"
                  placeholder="01012345678"
                  autoComplete="tel"
                />
                {phoneNumber.length > 0 && !phoneOk && (
                  <p className="mt-1 text-xs text-red-600">전화번호는 숫자만 입력하세요 (10~11자리).</p>
                )}
              </div>
              {error && (
                <div className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={!canVerify || submitting}
                className="h-11 w-full rounded-2xl bg-indigo-700 px-4 text-sm font-semibold text-white shadow-[0_14px_34px_-22px_rgba(15,11,152,0.85)] transition hover:bg-indigo-800 disabled:opacity-50"
              >
                {submitting ? "확인 중..." : "본인 확인"}
              </button>
            </form>
          ) : (
            <form onSubmit={onReset} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold tracking-wide text-slate-700">새 비밀번호</label>
                <input
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  type="password"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-200"
                  placeholder="최소 8자"
                  autoComplete="new-password"
                />
                {pwTooShort && <p className="mt-1 text-xs text-red-600">비밀번호는 최소 8자 이상이어야 해요.</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold tracking-wide text-slate-700">비밀번호 확인</label>
                <input
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  type="password"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-4 focus:ring-indigo-200"
                  placeholder="한 번 더 입력"
                  autoComplete="new-password"
                />
                {pwMismatch && <p className="mt-1 text-xs text-red-600">비밀번호가 서로 달라요.</p>}
              </div>
              {error && (
                <div className="rounded-2xl border border-rose-200/60 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={!canReset || submitting}
                className="h-11 w-full rounded-2xl bg-indigo-700 px-4 text-sm font-semibold text-white shadow-[0_14px_34px_-22px_rgba(15,11,152,0.85)] transition hover:bg-indigo-800 disabled:opacity-50"
              >
                {submitting ? "변경 중..." : "비밀번호 변경"}
              </button>
              <button
                type="button"
                onClick={() => setStep("verify")}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                아이디/전화번호 다시 입력
              </button>
            </form>
          )}

          <div className="mt-5 text-sm">
            <Link to="/login" className="text-slate-600 hover:text-slate-900">
              로그인으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
