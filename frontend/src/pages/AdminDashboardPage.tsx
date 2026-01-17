import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FolderKanban, Users } from "lucide-react";
import { getAuthedUser } from "@/auth";

export default function AdminDashboardPage() {
  const me = getAuthedUser();
  const role = me?.role ?? "MEMBER";
  const canSeeAdmin = role === "ADMIN" || role === "LEAD";

  if (!canSeeAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">접근 권한 없음</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            관리자 페이지는 ADMIN 또는 LEAD 권한이 필요합니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">관리자 대시보드</h1>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to="/erp/admin/projects"
          className="group rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur transition hover:shadow-[0_22px_55px_-30px_rgba(15,23,42,0.60)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white">
                  <FolderKanban className="h-4 w-4 text-indigo-700" />
                </span>
                <h2 className="text-base font-semibold tracking-tight text-slate-900">프로젝트 관리</h2>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 transition group-hover:bg-white">
              바로가기 <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </Link>

        <Link
          to="/erp/admin/users"
          className="group rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur transition hover:shadow-[0_22px_55px_-30px_rgba(15,23,42,0.60)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white">
                  <Users className="h-4 w-4 text-indigo-700" />
                </span>
                <h2 className="text-base font-semibold tracking-tight text-slate-900">유저 관리</h2>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 transition group-hover:bg-white">
              바로가기 <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </Link>
      </section>
    </div>
  );
}
