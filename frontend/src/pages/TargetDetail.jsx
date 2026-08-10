import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Gauge, Network, Sparkles } from "lucide-react";
import { api, dt, eur } from "@/lib/api";
import { Empty, Overline, Panel, ScoreBadge, scoreColor } from "@/components/Bits";
import { Button } from "@/components/ui/button";

export default function TargetDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [paths, setPaths] = useState([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const [d, w] = await Promise.all([api.target(id), api.warmPaths(id)]);
    setData(d);
    setPaths(w.paths || []);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const rescore = async () => {
    setBusy("score");
    try {
      const r = await api.rescore(id);
      toast.success(`Re-scored: ${r.composite}`);
      await load();
    } catch {
      toast.error("Scoring failed");
    }
    setBusy("");
  };

  const runAgent = async (agent) => {
    setBusy(agent);
    try {
      const r = await api.runAgent({ agent, target_id: id });
      toast.success(`${agent} agent ${r.status} in ${r.duration_ms}ms`);
      await load();
    } catch {
      toast.error("Agent run failed");
    }
    setBusy("");
  };

  if (!data) return <Overline>loading target…</Overline>;
  const t = data.target;
  const latest = data.scores[0];

  return (
    <div className="space-y-6" data-testid="target-detail">
      <Link to="/targets" className="overline flex items-center gap-2 hover:text-white">
        <ArrowLeft size={12} /> back to targets
      </Link>

      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Overline>{t.sector} · {t.country} · {t.ownership}</Overline>
          <h1 className="text-4xl font-light tracking-tighter mt-2">{t.name}</h1>
          <p className="text-sm text-zinc-400 mt-2 max-w-2xl">{t.description}</p>
        </div>
        <div className="flex gap-2">
          <Button data-testid="rescore-button" onClick={rescore} disabled={busy === "score"} className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-xs mono uppercase tracking-wider">
            <Gauge size={14} className="mr-2" /> Re-score
          </Button>
          <Button data-testid="run-research-agent" variant="outline" onClick={() => runAgent("research")} disabled={busy === "research"} className="rounded-none border-border bg-transparent hover:bg-[#18181b] hover:text-white text-xs mono uppercase tracking-wider">
            <Sparkles size={14} className="mr-2" /> Research agent
          </Button>
          <Button data-testid="run-orchestrator-agent" variant="outline" onClick={() => runAgent("orchestrator")} disabled={busy === "orchestrator"} className="rounded-none border-border bg-transparent hover:bg-[#18181b] hover:text-white text-xs mono uppercase tracking-wider">
            <Network size={14} className="mr-2" /> Orchestrator
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="panel p-6 flex flex-col justify-between" data-testid="composite-score-widget">
          <Overline>Composite readiness</Overline>
          <div className={`mono text-6xl tracking-tighter my-4 ${scoreColor(t.readiness_score)}`} data-testid="composite-score-value">
            {t.readiness_score?.toFixed(1) ?? "—"}
          </div>
          <div className="text-[11px] text-zinc-500 mono">
            engine {latest?.engine_version || "—"} · {latest?.triggered_by || "n/a"} · {dt(t.scored_at)}
          </div>
        </div>

        <Panel title="Sub-scores & source attribution" className="lg:col-span-2" testId="sub-scores-panel">
          <div className="divide-y divide-border">
            {(latest?.sub_scores || []).map((s) => (
              <div key={s.key} className="px-4 py-3" data-testid={`sub-score-${s.key}`}>
                <div className="flex items-center justify-between text-sm">
                  <span>{s.label}</span>
                  <span className={`mono ${scoreColor(s.value)}`}>{s.value}</span>
                </div>
                <div className="h-[3px] bg-[#1f1f23] mt-2">
                  <div className="h-full bg-[#FF4F00]" style={{ width: `${s.value}%` }} />
                </div>
                <div className="flex justify-between mt-1.5 text-[11px] mono text-zinc-600">
                  <span>src: {s.source}</span>
                  <span>weight {(s.weight * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
            {!latest && <Empty>No score computed yet.</Empty>}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[["Revenue", eur(t.revenue_eur)], ["EBITDA", eur(t.ebitda_eur)], ["Headcount", t.headcount ?? "—"], ["Founded", t.founded_year ?? "—"]].map(([l, v]) => (
          <div key={l} className="panel p-4">
            <Overline>{l}</Overline>
            <div className="mono text-xl mt-2">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={`Contacts (${data.contacts.length})`} testId="target-contacts">
          <div className="divide-y divide-border">
            {data.contacts.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <div>
                  <div>{c.full_name}</div>
                  <div className="text-[11px] text-zinc-600 mono">{c.email || "no email"} · {c.role}</div>
                </div>
                <span className="mono text-[11px] text-zinc-500">{c.enrichment_status}</span>
              </div>
            ))}
            {!data.contacts.length && <Empty>No contacts linked.</Empty>}
          </div>
        </Panel>

        <Panel title={`Warm paths (${paths.length})`} testId="warm-paths-panel">
          <div className="divide-y divide-border">
            {paths.map((p, i) => (
              <div key={i} className="px-4 py-3 text-sm flex items-center justify-between">
                <div>
                  <div className="text-zinc-200">{p.peer}</div>
                  <div className="text-[11px] mono text-zinc-600">via {p.via} — {p.via_type}</div>
                </div>
                <Link to={`/targets/${p.peer_id}`} className="overline hover:text-[#FF4F00]">open</Link>
              </div>
            ))}
            {!paths.length && <Empty>No shared partners or sector peers.</Empty>}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={`Sourcing signals (${data.signals.length})`} testId="target-signals">
          <div className="divide-y divide-border max-h-[320px] overflow-y-auto">
            {data.signals.map((s) => (
              <div key={s.id} className="px-4 py-3 border-l-2 border-l-[#FF4F00]">
                <div className="text-sm">{s.title}</div>
                <div className="text-[11px] mono text-zinc-600 mt-1">{s.kind} · {s.source} · {eur(s.value_eur)}</div>
              </div>
            ))}
            {!data.signals.length && <Empty>No signals linked.</Empty>}
          </div>
        </Panel>

        <Panel title={`Agent runs (${data.agent_runs.length})`} testId="target-agent-runs">
          <div className="bg-black p-3 max-h-[320px] overflow-y-auto mono text-[11px] space-y-2">
            {data.agent_runs.flatMap((r) =>
              r.logs.map((l, i) => (
                <div key={`${r.id}-${i}`} className="flex gap-2">
                  <span className="text-zinc-700">{l.ts?.slice(11, 19)}</span>
                  <span className={l.level === "error" ? "text-red-400" : l.level === "ok" ? "text-emerald-400" : "text-[#FF4F00]"}>
                    {l.level}
                  </span>
                  <span className="text-zinc-300">{l.msg}</span>
                </div>
              ))
            )}
            {!data.agent_runs.length && <div className="text-zinc-600">no runs recorded</div>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
