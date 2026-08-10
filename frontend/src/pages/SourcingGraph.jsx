import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Empty, Overline, Panel } from "@/components/Bits";

const COLOR = { target: "#FF4F00", sector: "#0055FF", counterparty: "#10b981" };
const W = 900;
const H = 560;

export default function SourcingGraph() {
  const [g, setG] = useState({ nodes: [], links: [] });
  const [sel, setSel] = useState(null);
  const [paths, setPaths] = useState([]);

  useEffect(() => { api.graph().then(setG); }, []);

  const positions = useMemo(() => {
    const groups = { target: [], sector: [], counterparty: [] };
    g.nodes.forEach((n) => groups[n.type]?.push(n));
    const pos = {};
    const cols = [
      { key: "sector", x: 120 },
      { key: "target", x: W / 2 },
      { key: "counterparty", x: W - 120 },
    ];
    cols.forEach(({ key, x }) => {
      const arr = groups[key];
      arr.forEach((n, i) => {
        pos[n.id] = { x, y: 50 + ((H - 100) / Math.max(arr.length - 1, 1)) * i || H / 2 };
      });
    });
    return pos;
  }, [g]);

  const pick = async (n) => {
    setSel(n);
    if (n.type === "target" && n.target_id) {
      const r = await api.warmPaths(n.target_id);
      setPaths(r.paths || []);
    } else setPaths([]);
  };

  return (
    <div className="space-y-6" data-testid="graph-page">
      <div>
        <Overline>Sourcing</Overline>
        <h1 className="text-4xl font-light tracking-tighter mt-2">Relationship Graph</h1>
        <p className="text-xs text-zinc-500 mt-2 mono">
          sector ← company → procurement counterparty · {g.nodes.length} nodes / {g.links.length} edges
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Panel title="Graph" className="xl:col-span-3 overflow-hidden" testId="graph-canvas">
          <div className="overflow-auto bg-[#0b0b0d]">
            <svg width={W} height={H} data-testid="graph-svg">
              {g.links.map((l, i) => {
                const a = positions[l.source];
                const b = positions[l.target];
                if (!a || !b) return null;
                const on = sel && (l.source === sel.id || l.target === sel.id);
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={on ? "#FF4F00" : "#27272a"}
                    strokeWidth={on ? 1.4 : 0.6}
                  />
                );
              })}
              {g.nodes.map((n) => {
                const p = positions[n.id];
                if (!p) return null;
                const r = n.type === "target" ? 7 : 5;
                return (
                  <g key={n.id} onClick={() => pick(n)} style={{ cursor: "pointer" }} data-testid={`graph-node-${n.id}`}>
                    <circle
                      cx={p.x} cy={p.y} r={sel?.id === n.id ? r + 3 : r}
                      fill={COLOR[n.type]}
                      opacity={sel && sel.id !== n.id ? 0.5 : 1}
                    />
                    <text
                      x={n.type === "counterparty" ? p.x - 12 : p.x + 12}
                      y={p.y + 3.5}
                      textAnchor={n.type === "counterparty" ? "end" : "start"}
                      fill="#a1a1aa"
                      fontSize="10"
                      fontFamily="IBM Plex Mono"
                    >
                      {n.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Legend" testId="graph-legend">
            <div className="p-4 space-y-2 text-xs">
              {Object.entries(COLOR).map(([k, c]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                  <span className="text-zinc-400 mono">{k}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Selection" testId="graph-selection">
            {!sel && <Empty>Click a node.</Empty>}
            {sel && (
              <div className="p-4 space-y-2">
                <div className="text-sm">{sel.label}</div>
                <div className="overline">{sel.type}</div>
                {sel.score != null && <div className="mono text-2xl text-[#FF4F00]">{sel.score.toFixed(1)}</div>}
                {sel.target_id && (
                  <Link to={`/targets/${sel.target_id}`} className="overline hover:text-[#FF4F00] block">open target →</Link>
                )}
              </div>
            )}
          </Panel>

          <Panel title={`Warm paths (${paths.length})`} testId="graph-warm-paths">
            <div className="divide-y divide-border max-h-[240px] overflow-y-auto">
              {paths.map((p, i) => (
                <div key={i} className="px-4 py-2.5 text-xs">
                  <div className="text-zinc-200">{p.peer}</div>
                  <div className="mono text-[10px] text-zinc-600">via {p.via}</div>
                </div>
              ))}
              {!paths.length && <Empty>Select a company node.</Empty>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
