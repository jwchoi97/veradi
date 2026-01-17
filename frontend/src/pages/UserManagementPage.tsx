import React from "react";
import PendingApprovalsSection from "@/pages/PendingApprovalsSection";

export default function UserManagementPage() {
  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-4">
      <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">유저 관리</h1>
          <p className="text-sm leading-6 text-slate-600">가입 요청 승인 및 유저 관리를 수행합니다.</p>
        </div>
      </section>

      <PendingApprovalsSection />
    </div>
  );
}
