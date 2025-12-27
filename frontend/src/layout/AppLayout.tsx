import { Outlet, NavLink } from "react-router-dom";
import TopBar from "./TopBar";
import { ROUTE_MODULES } from "@/router/routes";
import { getAuthedUser } from "@/auth";

type NavState = { isActive: boolean; isPending: boolean; isTransitioning?: boolean };



export default function AppLayout() {
  const me = getAuthedUser();
  const menuModules = ROUTE_MODULES.filter((m) => {
    // Hide admin module unless ADMIN
    if (m.base === "/erp/admin") return me?.role === "ADMIN";
    return true;
  });
  return (
    <div className="app-shell">
      <TopBar />

      <div className="app-body">
        <aside className="sidebar">
          <div className="side-title">ERP</div>

          <nav className="side-nav">
            {menuModules.map((m) => (
              <NavLink
                key={m.base}
                to={m.base}
                end
                className={({ isActive }: NavState) =>
                  `side-link ${isActive ? "active" : ""}`
                }
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
