import React from "react";
import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <div className="p-6 space-y-6">
      {/* 페이지 타이틀 */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Home</h1>
        <p className="mt-1 text-sm text-gray-600">
          로그인 성공! 아래 메뉴를 통해 작업을 시작하세요.
        </p>
      </div>

      {/* 메인 액션 영역 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to="/erp/content/mock"
          className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow transition"
        >
          <h2 className="text-base font-medium text-gray-900">
            모의고사 업로드
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            프로젝트별 모의고사 파일을 업로드하고 관리합니다.
          </p>
        </Link>

        {/* 나중에 확장용 카드 예시 */}
        {/* 
        <Link to="/erp/admin" className="...">
          관리자 페이지
        </Link>
        */}
      </div>
    </div>
  );
}
