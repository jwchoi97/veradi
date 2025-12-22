// src/routes.tsx
import React from "react";
import type { RouteObject } from "react-router-dom";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import AppLayout from "@/layout/AppLayout";
import MockUploadPage from "@/pages/MockUploadPage";
import ProjectAdminPage from "@/pages/ProjectAdminPage";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/HomePage";

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
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
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
export function buildRoutes(): RouteObject[] {
  return [
    // Public route(s)
    { path: "/login", element: <LoginPage /> },

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
            // ✅ Home page (renders inside <Outlet /> in AppLayout)
            { path: "home", element: <HomePage /> },

            // ERP modules
            ...ROUTE_MODULES.map((m) => ({
              path: m.base,
              children: m.routes,
            })),
          ],
        },

        // Catch-all under AppLayout: optional (redirect to "/")
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ];
}
