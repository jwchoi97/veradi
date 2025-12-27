// src/routes.tsx
import type { RouteObject } from "react-router-dom";
import { Navigate, Outlet, useLocation, Link } from "react-router-dom";

import AppLayout from "@/layout/AppLayout";
import MockUploadPage from "@/pages/MockUploadPage";
import ProjectAdminPage from "@/pages/ProjectAdminPage";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/HomePage";
import SignupPage from "@/pages/SignupPage";

import { isAuthed } from "@/auth";

/**
 * RouteModule: self-contained unit that can be registered under a base path.
 * Add more modules for other ERP content paths without touching the core router.
 */
export type RouteModule = {
  base: string; // e.g. "/erp/content/mock"
  routes: RouteObject[]; // children routes under the base
  label?: string; // optional for navigation
};

// --- Module: ERP / content / mock ---
export const contentMockModule: RouteModule = {
  base: "/erp/content/mock",
  label: "모의고사 업로드",
  routes: [{ index: true, element: <MockUploadPage /> }],
};

// --- Module: ERP / Admin ---
export const adminProjectModule: RouteModule = {
  base: "/erp/admin",
  label: "관리자 페이지",
  routes: [{ index: true, element: <ProjectAdminPage /> }],
};

// Add more modules here and export in the array below.
export const ROUTE_MODULES: RouteModule[] = [contentMockModule, adminProjectModule];

/**
 * Guard component: blocks access unless authenticated.
 * Keeps the original destination in location.state for post-login redirect.
 */
function RequireAuth() {
  const location = useLocation();
  if (!isAuthed()) {
    // return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

function RequireAdmin() {
  const location = useLocation();

  const raw = localStorage.getItem("authed_user");
  const me = raw ? JSON.parse(raw) : null;

  // Not logged in -> login
  if (!me) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Not admin -> pretend it doesn't exist (404-like)
  if (me.role !== "ADMIN") {
    return <Navigate to="/404" replace />;
  }

  return <Outlet />;
}

/**
 * Index redirect:
 * - If not logged in: go to /login
 * - If logged in: go to /home
 */
function IndexRedirect() {
  return isAuthed() ? <Navigate to="/home" replace /> : <Navigate to="/login" replace />;
}

/**
 * Builds a react-router RouteObject tree.
 * - /login is outside AppLayout (usually no sidebar/header)
 * - Protected routes are inside AppLayout and gated by RequireAuth
 */

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
    // Public route(s)
    { path: "/login", element: <LoginPage /> },
    { path: "/signup", element: <SignupPage /> },
    { path: "/404", element: <NotFoundPage /> },
    
    // Protected app shell
    {
      path: "/",
      element: <AppLayout />,
      children: [
        // "/" -> /home or /login depending on auth state
        { index: true, element: <IndexRedirect /> },

        // Protected area
        {
          element: <RequireAuth />,
          children: [
            { path: "home", element: <HomePage /> },

            // non-admin modules (visible to any logged-in user)
            ...nonAdminModules.map((m) => ({
              path: m.base,
              children: m.routes,
            })),

            // admin modules (ADMIN only)
            {
              element: <RequireAdmin />,
              children: adminModules.map((m) => ({
                path: m.base,
                children: m.routes,
              })),
            },
          ],
        },

        // Catch-all under AppLayout: optional (redirect to "/")
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ];
}
