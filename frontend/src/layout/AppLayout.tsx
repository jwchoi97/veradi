import React, { useEffect, useMemo, useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { UploadCloud, FileText, FolderKanban, Users, User, Home, CheckCircle } from "lucide-react";
import TopBar from "./TopBar";
import { ROUTE_MODULES } from "@/router/routes";
import { getAuthedUser } from "@/auth";

type NavState = { isActive: boolean; isPending: boolean; isTransitioning?: boolean };

const LS_KEY = "ui.sidebarHidden";

function canSeeAdminModule(role?: string | null): boolean {
  return role === "ADMIN" || role === "LEAD";
}

export default function AppLayout() {
  const me = getAuthedUser();
  const location = useLocation();

  const menuModules = useMemo(() => {
    return ROUTE_MODULES.filter((m) => {
      // 관리자 대시보드는 사이드바에서 제외
      if (m.base === "/erp/admin") return false;
      // 프로젝트 관리와 유저 관리는 별도로 처리
      if (m.base === "/erp/admin/projects" || m.base === "/erp/admin/users") return false;
      // 모의고사 업로드와 개별 문항 업로드는 별도로 처리
      if (m.base === "/erp/content/mock" || m.base === "/erp/content/individual") return false;
      return true;
    });
  }, []);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const v = localStorage.getItem(LS_KEY);
    if (v === "1") setSidebarOpen(false);
  }, []);
  useEffect(() => {
    localStorage.setItem(LS_KEY, sidebarOpen ? "0" : "1");
  }, [sidebarOpen]);

  const canSeeAdmin = canSeeAdminModule(me?.role ?? null);
  const isAdminPage = location.pathname.startsWith("/erp/admin");
  const isUploadPage = location.pathname.startsWith("/erp/content");

  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sb-hidden"}`}>
      <TopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        me={me ?? null}
      />

      <div className="app-body">
        <aside className="sidebar" aria-hidden={!sidebarOpen}>
          <div className="side-title">ERP</div>

          <nav className="side-nav">
            <NavLink
              to="/home"
              className={({ isActive }: NavState) =>
                `side-link ${isActive ? "active" : ""}`
              }
            >
              <span className="side-link-icon">
                <Home className="h-4 w-4" />
              </span>
              홈
            </NavLink>

            {menuModules.map((m) => {
              let icon = null;
              if (m.base === "/erp/content/mock") {
                icon = <UploadCloud className="h-4 w-4" />;
              } else if (m.base === "/erp/content/individual") {
                icon = <FileText className="h-4 w-4" />;
              }

              return (
                <NavLink
                  key={m.base}
                  to={m.base}
                  end
                  className={({ isActive }: NavState) =>
                    `side-link ${isActive ? "active" : ""}`
                  }
                >
                  {icon && <span className="side-link-icon">{icon}</span>}
                  {m.label ?? m.base}
                </NavLink>
              );
            })}

            <NavLink
              to="/me"
              className={({ isActive }: NavState) =>
                `side-link ${isActive ? "active" : ""}`
              }
            >
              <span className="side-link-icon">
                <User className="h-4 w-4" />
              </span>
              마이 페이지
            </NavLink>

            <div className="side-group-title">콘텐츠 페이지</div>
            <NavLink
              to="/erp/content/mock"
              className={({ isActive }: NavState) =>
                `side-link side-link-sub ${isActive ? "active" : ""}`
              }
            >
              <span className="side-link-icon">
                <UploadCloud className="h-4 w-4" />
              </span>
              콘텐츠 업로드
            </NavLink>
            <NavLink
              to="/erp/content/individual"
              className={({ isActive }: NavState) =>
                `side-link side-link-sub ${isActive ? "active" : ""}`
              }
            >
              <span className="side-link-icon">
                <FileText className="h-4 w-4" />
              </span>
              개별 문항 업로드
            </NavLink>
            <NavLink
              to="/reviews"
              className={({ isActive }: NavState) =>
                `side-link side-link-sub ${isActive ? "active" : ""}`
              }
            >
              <span className="side-link-icon">
                <CheckCircle className="h-4 w-4" />
              </span>
              콘텐츠 검토
            </NavLink>

            {canSeeAdmin && (
              <>
                <div className="side-group-title">관리자 페이지</div>
                <NavLink
                  to="/erp/admin/projects"
                  className={({ isActive }: NavState) =>
                    `side-link side-link-sub ${isActive ? "active" : ""}`
                  }
                >
                  <span className="side-link-icon">
                    <FolderKanban className="h-4 w-4" />
                  </span>
                  프로젝트 관리
                </NavLink>
                <NavLink
                  to="/erp/admin/users"
                  className={({ isActive }: NavState) =>
                    `side-link side-link-sub ${isActive ? "active" : ""}`
                  }
                >
                  <span className="side-link-icon">
                    <Users className="h-4 w-4" />
                  </span>
                  유저 관리
                </NavLink>
              </>
            )}
          </nav>
        </aside>

        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}



// // FILE: frontend/src/layout/AppLayout.tsx

// import React, { useEffect, useMemo, useState } from "react";
// import { Outlet, NavLink } from "react-router-dom";
// import TopBar from "./TopBar";
// import { ROUTE_MODULES } from "@/router/routes";
// import { getAuthedUser } from "@/auth";

// type NavState = { isActive: boolean; isPending: boolean; isTransitioning?: boolean };

// const LS_KEY = "ui.sidebarHidden";

// export default function AppLayout() {
//   const me = getAuthedUser();

//   const menuModules = useMemo(() => {
//     return ROUTE_MODULES.filter((m) => {
//       if (m.base === "/erp/admin") return me?.role === "ADMIN";
//       return true;
//     });
//   }, [me?.role]);

//   // true = sidebar shown, false = sidebar hidden(0px)
//   const [sidebarOpen, setSidebarOpen] = useState(true);

//   useEffect(() => {
//     const v = localStorage.getItem(LS_KEY);
//     if (v === "1") setSidebarOpen(false);
//   }, []);
//   useEffect(() => {
//     localStorage.setItem(LS_KEY, sidebarOpen ? "0" : "1");
//   }, [sidebarOpen]);

//   return (
//     <div className={`app-shell ${sidebarOpen ? "" : "sb-hidden"}`}>
//       <TopBar
//         sidebarOpen={sidebarOpen}
//         onToggleSidebar={() => setSidebarOpen((v) => !v)}
//         me={me ?? null}
//       />

//       <div className="app-body">
//         <aside className="sidebar" aria-hidden={!sidebarOpen}>
//           <div className="side-title">ERP</div>

//           <nav className="side-nav">
//             {menuModules.map((m) => (
//               <NavLink
//                 key={m.base}
//                 to={m.base}
//                 end
//                 className={({ isActive }: NavState) => `side-link ${isActive ? "active" : ""}`}
//               >
//                 {m.label ?? m.base}
//               </NavLink>
//             ))}
//           </nav>
//         </aside>

//         <main className="main">
//           <Outlet />
//         </main>
//       </div>
//     </div>
//   );
// }

