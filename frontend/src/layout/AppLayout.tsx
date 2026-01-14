import React, { useEffect, useMemo, useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
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

  const menuModules = useMemo(() => {
    return ROUTE_MODULES.filter((m) => {
      if (m.base === "/erp/admin") return canSeeAdminModule(me?.role ?? null);
      return true;
    });
  }, [me?.role]);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const v = localStorage.getItem(LS_KEY);
    if (v === "1") setSidebarOpen(false);
  }, []);
  useEffect(() => {
    localStorage.setItem(LS_KEY, sidebarOpen ? "0" : "1");
  }, [sidebarOpen]);

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
            {menuModules.map((m) => (
              <NavLink
                key={m.base}
                to={m.base}
                end
                className={({ isActive }: NavState) => `side-link ${isActive ? "active" : ""}`}
              >
                {m.label ?? m.base}
              </NavLink>
            ))}
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

