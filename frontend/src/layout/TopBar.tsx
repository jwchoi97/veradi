import React from "react";
import "./TopBar.css";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clearToken } from "@/auth";
import type { AuthedUser } from "@/auth";
import { prettyDepartment } from "@/data/departments";

type TopBarProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  me: AuthedUser | null;
};

function normalizeDepartments(me: AuthedUser | null): string[] {
  if (!me) return [];
  
  // Admin 계정은 소속팀을 표시하지 않음
  if (me.role === "ADMIN") return [];
  
  const raw = Array.isArray(me.departments) ? me.departments : [];
  const cleaned = raw
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => d.length > 0);

  const base = cleaned.length > 0 ? cleaned : [me.department].filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of base) {
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function title(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function TopBar({ sidebarOpen, onToggleSidebar, me }: TopBarProps) {
  const loc = useLocation();
  const navigate = useNavigate();

  const rawSegments = loc.pathname.split("/").filter(Boolean);
  const lower = rawSegments.map((s) => s.toLowerCase());

  const contentIdx = lower.indexOf("content");
  const mockIdx = lower.indexOf("mock");
  const individualIdx = lower.indexOf("individual");
  const adminIdx = lower.indexOf("admin");
  const projectsIdx = lower.indexOf("projects");
  const usersIdx = lower.indexOf("users");

  const isContentPage = contentIdx >= 0;
  const isMockPage = mockIdx >= 0;
  const isIndividualPage = individualIdx >= 0;
  const isAdminPage = adminIdx >= 0;
  const isProjectsPage = projectsIdx >= 0;
  const isUsersPage = usersIdx >= 0;

  const contentHref = isContentPage ? "/erp/content" : null;
  const mockHref = isMockPage ? "/" + rawSegments.slice(0, mockIdx + 1).join("/") : null;
  const individualHref = isIndividualPage ? "/" + rawSegments.slice(0, individualIdx + 1).join("/") : null;
  const adminHref = isAdminPage ? "/" + rawSegments.slice(0, adminIdx + 1).join("/") : null;
  const projectsHref = isProjectsPage ? "/" + rawSegments.slice(0, projectsIdx + 1).join("/") : null;
  const usersHref = isUsersPage ? "/" + rawSegments.slice(0, usersIdx + 1).join("/") : null;

  const onLogout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const displayName = (me?.name && String(me.name).trim()) || me?.username || "Unknown";
  const departments = normalizeDepartments(me);

  // 프로필 이미지 또는 이니셜
  const getInitials = (name?: string | null, username?: string): string => {
    const source = name || username || "";
    if (!source || source.trim().length === 0) return "?";
    const trimmed = source.trim();
    
    // 한글 이름인지 확인 (가-힣 범위)
    const isKorean = /[가-힣]/.test(trimmed);
    
    if (isKorean && trimmed.length >= 3) {
      // 한국인 이름: 성(첫 글자) + 이름 첫 글자(두 번째 글자)
      // 예: "홍길동" → "홍길", "김철수" → "김철"
      return trimmed.slice(0, 2);
    } else if (trimmed.length >= 2) {
      // 영문 이름 또는 2글자 한글 이름: 처음 2글자
      return trimmed.slice(0, 2).toUpperCase();
    }
    return trimmed.toUpperCase();
  };

  const profileImageUrl = me?.profile_image_url;
  const initials = getInitials(me?.name, me?.username);

  const breadcrumb = (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/">Home</Link>

      {isContentPage && contentHref && (
        <span>
          <span className="sep">›</span>
          <Link to={contentHref}>Upload</Link>
        </span>
      )}

      {isMockPage && mockHref && (
        <span>
          <span className="sep">›</span>
          <Link to={mockHref}>Contents</Link>
        </span>
      )}

      {isIndividualPage && individualHref && (
        <span>
          <span className="sep">›</span>
          <Link to={individualHref}>Individual</Link>
        </span>
      )}

      {isAdminPage && adminHref && (
        <span>
          <span className="sep">›</span>
          <Link to={adminHref}>{title("admin")}</Link>
        </span>
      )}

      {isProjectsPage && projectsHref && (
        <span>
          <span className="sep">›</span>
          <Link to={projectsHref}>{title("projects")}</Link>
        </span>
      )}

      {isUsersPage && usersHref && (
        <span>
          <span className="sep">›</span>
          <Link to={usersHref}>{title("users")}</Link>
        </span>
      )}
    </nav>
  );

  return (
    <header className="topbar">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="sidebar-toggle"
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        {sidebarOpen ? "×" : "≡"}
      </button>

      <div className="brand">
        <Link to="/" className="logo">
          VERADI CONTENTS ERP
        </Link>
      </div>

      <div className="grow" />

      <div className="topbar-breadcrumb">{breadcrumb}</div>

      <div className="topbar-right">
        {me ? (
          <div className="topbar-me" title={`${me.username} · ${me.role}`}>
            {profileImageUrl ? (
              <img
                src={profileImageUrl}
                alt={displayName}
                className="topbar-avatar"
              />
            ) : (
              <div className="topbar-avatar-initials">{initials}</div>
            )}
            <span className="me-name">{displayName}</span>
            <span className="me-deps" aria-label="Departments">
              {departments.map((d) => (
                <span key={d} className="me-pill">
                  {prettyDepartment(d)}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        <button onClick={onLogout} className="logout-btn">
          Logout
        </button>
      </div>
    </header>
  );
}



// // FILE: frontend/src/layout/TopBar.tsx

// import React from "react";
// import "./TopBar.css";
// import { Link, useLocation, useNavigate } from "react-router-dom";
// import { clearToken } from "@/auth";

// type AuthedUser = {
//   id: number;
//   username: string;
//   name?: string | null;
//   role: string;
//   department: string;
// };

// type TopBarProps = {
//   sidebarOpen: boolean;
//   onToggleSidebar: () => void;
//   me: AuthedUser | null;
// };

// function prettyDepartment(dep?: string | null): string {
//   if (!dep) return "-";
//   if (dep === "ADMIN") return "ADMIN";
//   return dep;
// }

// function title(s: string): string {
//   return s.charAt(0).toUpperCase() + s.slice(1);
// }

// export default function TopBar({ sidebarOpen, onToggleSidebar, me }: TopBarProps) {
//   const loc = useLocation();
//   const navigate = useNavigate();

//   const rawSegments = loc.pathname.split("/").filter(Boolean);
//   const lower = rawSegments.map((s) => s.toLowerCase());

//   // ---- page detection ----
//   const mockIdx = lower.indexOf("mock");
//   const adminIdx = lower.indexOf("admin");

//   const isMockPage = mockIdx >= 0;
//   const isAdminPage = adminIdx >= 0;

//   // ---- real existing route prefix ----
//   const mockHref = isMockPage
//     ? "/" + rawSegments.slice(0, mockIdx + 1).join("/")
//     : null;

//   const adminHref = isAdminPage
//     ? "/" + rawSegments.slice(0, adminIdx + 1).join("/")
//     : null;

//   const onLogout = () => {
//     clearToken();
//     navigate("/login", { replace: true });
//   };

//   const displayName = (me?.name && String(me.name).trim()) || me?.username || "Unknown";

//   const breadcrumb = (
//     <nav className="breadcrumb" aria-label="Breadcrumb">
//       <Link to="/">Home</Link>

//       {isMockPage && mockHref && (
//         <span>
//           <span className="sep">›</span>
//           <Link to={mockHref}>{title("mock")}</Link>
//         </span>
//       )}

//       {isAdminPage && adminHref && (
//         <span>
//           <span className="sep">›</span>
//           <Link to={adminHref}>{title("admin")}</Link>
//         </span>
//       )}
//     </nav>
//   );

//   return (
//     <header className="topbar">
//       <button
//         type="button"
//         onClick={onToggleSidebar}
//         className="sidebar-toggle"
//         aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
//         title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
//       >
//         {sidebarOpen ? "×" : "≡"}
//       </button>

//       <div className="brand">
//         <Link to="/" className="logo">
//           VERADI CONTENTS ERP
//         </Link>
//       </div>

//       <div className="grow" />

//       <div className="topbar-breadcrumb">{breadcrumb}</div>

//       <div className="topbar-right">
//         {me ? (
//           <div className="topbar-me" title={`${me.username} · ${me.role}`}>
//             <span className="me-name">{displayName}</span>
//             <span className="me-pill">{prettyDepartment(me.department)}</span>
//           </div>
//         ) : null}

//         <button onClick={onLogout} className="logout-btn">
//           Logout
//         </button>
//       </div>
//     </header>
//   );
// }

