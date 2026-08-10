import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Empty, Overline, Panel } from "@/components/Bits";

export default function Gateway() {
  const [health, setHealth] = useState(null);
  const [openServer, setOpenServer] = useState(null);
  const [tools, setTools] = useState([]);

  useEffect(() => { api.gatewayHealth().then(setHealth).catch(() => toast.error("Gateway unreachable")); }, []);

  const open = async (name) => {
    setOpenServer(name);
    const r = await api.mcpTools(name);
    setTools(r.tools);
  };

  if (!health) return <Overline>probing gateway…</Overline>;

  return (
    <div className="space-y-6" data-testid="gateway-page">
      <div>
        <Overline>Infrastructure</Overline>
        <h1 className="text-4xl font-light tracking-tighter mt-2">MCP Gateway</h1>
        <p className="text-xs text-zinc-500 mt-2 mono">JSON-RPC 2.0 over HTTP · /api/mcp/&lt;server&gt;</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[["Gateway", health.gateway], ["Database", health.mongo], ["Object store", health.object_store], ["Servers", `${health.servers.length} online`]].map(([l, v]) => (
          <div key={l} className="panel p-4">
            <Overline>{l}</Overline>
            <div className="mono text-sm mt-2 text-emerald-400">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="MCP servers" testId="mcp-servers">
          <div className="divide-y divide-border">
            {health.servers.map((s) => (
              <button
                key={s.name}
                data-testid={`mcp-server-${s.name}`}
                onClick={() => open(s.name)}
                className={`w-full text-left px-4 py-3 transition-colors duration-150 ${
                  openServer === s.name ? "bg-[#18181b] border-l-2 border-l-[#FF4F00]" : "hover:bg-[#141416]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm mono">{s.name}</span>
                  <span className="flex items-center gap-2 mono text-[11px] text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 pulse-dot" /> {s.status}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">{s.description}</div>
                <div className="mono text-[10px] text-zinc-600 mt-1">
                  {s.endpoint} · {s.tools} tools · v{s.version}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title={openServer ? `Tools — ${openServer}` : "Tools"} testId="mcp-tools">
            <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
              {tools.map((t) => (
                <div key={t.name} className="px-4 py-3" data-testid={`mcp-tool-${t.name}`}>
                  <div className="mono text-xs text-[#FF4F00]">{t.name}</div>
                  <div className="text-[11px] text-zinc-500 mt-1">{t.description}</div>
                  <div className="mono text-[10px] text-zinc-600 mt-1">
                    args: {Object.keys(t.inputSchema?.properties || {}).join(", ") || "none"}
                  </div>
                </div>
              ))}
              {!openServer && <Empty>Select a server to inspect its tool schema.</Empty>}
            </div>
          </Panel>

          <Panel title="External providers" testId="external-providers">
            <div className="divide-y divide-border">
              {health.external_providers.map((p) => (
                <div key={p.name} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm">{p.name}</div>
                    <div className="text-[11px] text-zinc-600">{p.reason}</div>
                  </div>
                  <span className="mono text-[10px] uppercase px-2 py-1 border border-amber-600/40 text-amber-500">
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
