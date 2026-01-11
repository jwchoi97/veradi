import React from "react";
import "./TopBar.css";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clearToken } from "@/auth";

type AuthedUser = {
  id: number;
  username: string;
  name?: string | null;
  role: string;

  // legacy single
  department: string;

  // NEW multi (optional, backward compatible)
  departments?: string[] | null;
};

type TopBarProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  me: AuthedUser | null;
};

function prettyDepartment(dep?: string | null): string {
  if (!dep) return "-";
  if (dep === "ADMIN") return "ADMIN";
  return dep;
}

function normalizeDepartments(me: AuthedUser | null): string[] {
  if (!me) return [];

  const raw = Array.isArray(me.departments) ? me.departments : [];
  const cleaned = raw
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => d.length > 0);

  // If departments exist, prefer them; otherwise fallback to legacy single.
  const base = cleaned.length > 0 ? cleaned : [me.department].filter(Boolean);

  // Dedup preserving order
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

  // ---- page detection ----
  const mockIdx = lower.indexOf("mock");
  const adminIdx = lower.indexOf("admin");

  const isMockPage = mockIdx >= 0;
  const isAdminPage = adminIdx >= 0;

  // ---- real existing route prefix ----
  const mockHref = isMockPage ? "/" + rawSegments.slice(0, mockIdx + 1).join("/") : null;

  const adminHref = isAdminPage ? "/" + rawSegments.slice(0, adminIdx + 1).join("/") : null;

  const onLogout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const displayName = (me?.name && String(me.name).trim()) || me?.username || "Unknown";
  const departments = normalizeDepartments(me);

  const breadcrumb = (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/">Home</Link>

      {isMockPage && mockHref && (
        <span>
          <span className="sep">›</span>
          <Link to={mockHref}>{title("mock")}</Link>
        </span>
      )}

      {isAdminPage && adminHref && (
        <span>
          <span className="sep">›</span>
          <Link to={adminHref}>{title("admin")}</Link>
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
            <span className="me-name">{displayName}</span>

            {departments.length > 0 ? (
              <span className="me-deps" aria-label="Departments">
                {departments.map((d) => (
                  <span key={d} className="me-pill">
                    {prettyDepartment(d)}
                  </span>
                ))}
              </span>
            ) : (
              <span className="me-pill">{prettyDepartment(me.department)}</span>
            )}
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

