import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAuthedUser } from "@/auth";
import { UploadCloud, FolderKanban, Users, Clock, FileUp, FileX, CheckCircle, FileText } from "lucide-react";
import { getRecentActivities, type ActivityItem } from "@/data/files/api";

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "방금 전";
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function getActivityIcon(type: ActivityItem["type"]) {
  switch (type) {
    case "file_upload":
      return <FileUp className="h-5 w-5 text-indigo-600" />;
    case "file_delete":
      return <FileX className="h-5 w-5 text-red-600" />;
    case "review":
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    default:
      return <Clock className="h-5 w-5 text-gray-600" />;
  }
}

export default function HomePage() {
  const me = getAuthedUser();
  const role = me?.role ?? "MEMBER";
  const canSeeAdmin = role === "ADMIN" || role === "LEAD";

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);

  useEffect(() => {
    void loadActivities();
  }, []);

  const loadActivities = async () => {
    try {
      setActivitiesLoading(true);
      const data = await getRecentActivities(10);
      setActivities(data);
    } catch (e) {
      console.error("Failed to load activities", e);
    } finally {
      setActivitiesLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">대시보드</h1>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* 바로가기 */}
        <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-4 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 mb-3">바로가기</h2>
          <div className="space-y-1">
            <Link
              to="/erp/content/mock"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 transition"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 flex-shrink-0">
                <UploadCloud className="h-3.5 w-3.5 text-indigo-700" />
              </span>
              <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">콘텐츠 업로드</span>
            </Link>

            <Link
              to="/erp/content/individual"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 transition"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 flex-shrink-0">
                <FileText className="h-3.5 w-3.5 text-indigo-700" />
              </span>
              <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">개별 문항 업로드</span>
            </Link>

            {canSeeAdmin ? (
              <>
                <Link
                  to="/erp/admin/projects"
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 transition"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 flex-shrink-0">
                    <FolderKanban className="h-3.5 w-3.5 text-indigo-700" />
                  </span>
                  <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">프로젝트 관리</span>
                </Link>

                <Link
                  to="/erp/admin/users"
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 transition"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 flex-shrink-0">
                    <Users className="h-3.5 w-3.5 text-indigo-700" />
                  </span>
                  <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">유저 관리</span>
                </Link>
              </>
            ) : null}
          </div>
        </section>

        {/* 최근 변경사항 */}
        <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-4 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur flex flex-col h-[300px]">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 mb-3 flex-shrink-0">최근 변경사항</h2>
        
        {activitiesLoading ? (
          <div className="text-sm text-gray-500 text-center py-4 flex-1 flex items-center justify-center">로딩 중...</div>
        ) : activities.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-4 flex-1 flex items-center justify-center">활동 이력이 없습니다.</div>
        ) : (
          <div className="space-y-1 overflow-y-auto flex-1">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 transition"
              >
                <div className="flex-shrink-0">
                  {getActivityIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-sm text-gray-900 font-medium truncate">
                    {activity.file_name || activity.description}
                  </span>
                  <span className="text-xs text-gray-600 truncate">
                    {activity.project_name}
                    {activity.project_year && ` (${activity.project_year})`}
                    {activity.user_name && ` · ${activity.user_name}`}
                  </span>
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
                  {formatTimeAgo(activity.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
