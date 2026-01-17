import type { RouteObject } from "react-router-dom";
import { Navigate, Outlet, useLocation, Link } from "react-router-dom";

import AppLayout from "@/layout/AppLayout";
import MockUploadPage from "@/pages/MockUploadPage";
import IndividualItemUploadPage from "@/pages/IndividualItemUploadPage";
import AdminDashboardPage from "@/pages/AdminDashboardPage";
import ProjectManagementPage from "@/pages/ProjectManagementPage";
import UserManagementPage from "@/pages/UserManagementPage";
import MyPage from "@/pages/MyPage";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/HomePage";
import SignupPage from "@/pages/SignupPage";

import { isAuthed } from "@/auth";

export type RouteModule = {
  base: string;
  routes: RouteObject[];
  label?: string;
};

// --- Module: ERP / content / mock ---
export const contentMockModule: RouteModule = {
  base: "/erp/content/mock",
  label: "콘텐츠 업로드",
  routes: [{ index: true, element: <MockUploadPage /> }],
};

// --- Module: ERP / content / individual ---
export const contentIndividualModule: RouteModule = {
  base: "/erp/content/individual",
  label: "개별 문항 업로드",
  routes: [{ index: true, element: <IndividualItemUploadPage /> }],
};

// --- Module: ERP / Admin ---
export const adminDashboardModule: RouteModule = {
  base: "/erp/admin",
  label: "관리자 페이지",
  routes: [{ index: true, element: <Navigate to="/home" replace /> }],
};

export const adminProjectModule: RouteModule = {
  base: "/erp/admin/projects",
  label: "프로젝트 관리",
  routes: [{ index: true, element: <ProjectManagementPage /> }],
};

export const adminUserModule: RouteModule = {
  base: "/erp/admin/users",
  label: "유저 관리",
  routes: [{ index: true, element: <UserManagementPage /> }],
};

export const ROUTE_MODULES: RouteModule[] = [
  contentMockModule,
  contentIndividualModule,
  adminDashboardModule,
  adminProjectModule,
  adminUserModule,
];

function RequireAuth() {
  const location = useLocation();
  if (!isAuthed()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

function RequireAdmin() {
  const location = useLocation();

  const raw = localStorage.getItem("authed_user");
  const me = raw ? JSON.parse(raw) : null;

  if (!me) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // ADMIN + LEAD
  if (me.role !== "ADMIN" && me.role !== "LEAD") {
    return <Navigate to="/404" replace />;
  }

  return <Outlet />;
}

function IndexRedirect() {
  return isAuthed() ? <Navigate to="/home" replace /> : <Navigate to="/login" replace />;
}

const NotFoundPage = () => (
  <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">404</h1>
      <p className="mt-1 text-sm text-gray-500">Page not found.</p>
      <Link to="/" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
        Go home
      </Link>
    </div>
  </div>
);

const adminModules = ROUTE_MODULES.filter((m) => m.base.startsWith("/erp/admin"));
const nonAdminModules = ROUTE_MODULES.filter((m) => !m.base.startsWith("/erp/admin"));

export function buildRoutes(): RouteObject[] {
  return [
    { path: "/login", element: <LoginPage /> },
    { path: "/signup", element: <SignupPage /> },
    { path: "/404", element: <NotFoundPage /> },

    {
      path: "/",
      element: <AppLayout />,
          children: [
            { index: true, element: <IndexRedirect /> },
            {
              element: <RequireAuth />,
              children: [
                { path: "home", element: <HomePage /> },
                { path: "me", element: <MyPage /> },

            ...nonAdminModules.map((m) => ({
              path: m.base,
              children: m.routes,
            })),

            {
              element: <RequireAdmin />,
              children: adminModules.map((m) => ({
                path: m.base,
                children: m.routes,
              })),
            },
          ],
        },
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ];
}
