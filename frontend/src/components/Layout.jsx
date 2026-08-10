import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity, Boxes, Building2, Contact2, FileLock2, GitBranch, Kanban,
  Menu, Radar, ServerCog, Terminal,
} from "lucide-react";
import { api } from "@/lib/api";

const NAV = [
  { to: "/", label: "Overview", icon: Boxes, id: "overview" },
  { to: "/targets", label: "Targets", icon: Building2, id: "targets" },
  { to: "/pipeline", label: "Pipeline", icon: Kanban, id: "pipeline" },
  { to: "/contacts", label: "Contacts", icon: Contact2, id: "contacts" },
  { to: "/signals", label: "Sourcing Signals", icon: Radar, id: "signals" },
  { to: "/graph", label: "Sourcing Graph", icon: GitBranch, id: "graph" },
  { to: "/vdr", label: "Data Room", icon: FileLock2, id: "vdr" },
  { to: "/agents", label: "Agent Runs", icon: Terminal, id: "agents" },
  { to: "/gateway", label: "MCP Gateway", icon: ServerCog, id: "gateway" },
];

export default function Layout() {
  const [health, setHealth] = useState(null);
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    api.gatewayHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const crumb = NAV.find((n) => n.to !== "/" && loc.pathname.startsWith(n.to))?.label || "Overview";

  return (
    <div className="min-h-screen flex bg-[#09090b]">
      <aside
        data-testid="sidebar"
        className={`${open ? "flex" : "hidden"} md:flex fixed md:sticky z-50 top-0 h-screen w-[236px] shrink-0 border-r border-border bg-[#0c0c0e] flex-col`}
      >
        <Link to="/" data-testid="brand-link" className="px-5 py-6 border-b border-border block">
          <div className="flex items-center gap-2">
            <span className="h-6 w-[3px] bg-[#FF4F00]" />
            <div>
              <div className="font-display text-sm font-medium tracking-tight leading-none">
                MERIDIAN<span className="text-[#FF4F00]">/</span>DEALFLOW
              </div>
              <div className="overline mt-1.5">Corp Dev Intelligence</div>
            </div>
          </div>
        </Link>

        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, id }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              data-testid={`nav-${id}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2.5 text-sm border-l-2 transition-colors duration-150 ${
                  isActive
                    ? "border-[#FF4F00] bg-[#18181b] text-white"
                    : "border-transparent text-zinc-400 hover:bg-[#141416] hover:text-white"
                }`
              }
            >
              <Icon size={15} strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <div className="overline mb-2">Gateway</div>
          <div className="flex items-center gap-2 text-xs mono">
            <span
              className={`h-1.5 w-1.5 rounded-full pulse-dot ${health ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <span className="text-zinc-300">{health ? "healthy" : "offline"}</span>
            <span className="text-zinc-600">
              {health ? `${health.servers?.length} servers` : ""}
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-40 h-14 px-4 md:px-8 flex items-center justify-between border-b border-border bg-black/60 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-xs mono text-zinc-500">
            <button
              data-testid="mobile-nav-toggle"
              onClick={() => setOpen((v) => !v)}
              className="md:hidden mr-2 text-zinc-400 hover:text-white"
            >
              <Menu size={18} />
            </button>
            <span>meridian</span>
            <span className="text-zinc-700">/</span>
            <span className="text-white" data-testid="breadcrumb-current">{crumb}</span>
          </div>
          <div className="hidden sm:flex items-center gap-5 text-[11px] mono text-zinc-500">
            <span className="flex items-center gap-1.5">
              <Activity size={12} className="text-[#FF4F00]" />
              {health?.servers?.reduce((a, s) => a + s.tools, 0) || 0} MCP tools online
            </span>
            <span>single-firm · self-hosted</span>
          </div>
        </header>
        <div className="p-4 md:p-8 rise">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
