import { Outlet, NavLink } from "react-router-dom";
import TopBar from "./TopBar";
import { ROUTE_MODULES } from "@/router/routes";

type NavState = { isActive: boolean; isPending: boolean; isTransitioning?: boolean };

export default function AppLayout() {
  return (
    <div className="app-shell">
      <TopBar />

      <div className="app-body">
        <aside className="sidebar">
          <div className="side-title">ERP</div>

          <nav className="side-nav">
            {ROUTE_MODULES.map((m) => (
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
