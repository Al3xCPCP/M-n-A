import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { toast } from "sonner";
import { DownloadCloud, RefreshCw } from "lucide-react";
import { api, eur } from "@/lib/api";
import { Metric, Overline, Panel, Empty } from "@/components/Bits";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api.overview(), api.runs()]).then(([o, r]) => {
      setD(o);
      setRuns(r.slice(0, 6));
    });

  useEffect(() => {
    load();
  }, []);

  const ingest = async () => {
    setBusy(true);
    try {
      const r = await api.ingest(6);
      toast.success(`Ingested ${r.ingested} sourcing signals`);
      await load();
    } catch (e) {
      toast.error("Ingestion failed");
    }
    setBusy(false);
  };

  if (!d) return <Overline>loading telemetry…</Overline>;

  return (
    <div className="space-y-8" data-testid="dashboard">
      <div className="flex items-end justify-between">
        <div>
          <Overline>Firm-wide</Overline>
          <h1 className="text-4xl font-light tracking-tighter mt-2">Deal Origination Console</h1>
        </div>
        <div className="flex gap-2">
          <Button
            data-testid="ingest-signals-button"
            onClick={ingest}
            disabled={busy}
            className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-white text-xs mono uppercase tracking-wider"
          >
            <DownloadCloud size={14} className="mr-2" /> Ingest signals
          </Button>
          <Button
            data-testid="refresh-dashboard-button"
            variant="outline"
            onClick={load}
            className="rounded-none border-border bg-transparent hover:bg-[#18181b] hover:text-white text-xs mono uppercase tracking-wider"
          >
            <RefreshCw size={14} className="mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Pipeline value" value={eur(d.pipeline_value_eur)} sub={`${d.counts.deals} live deals`} testId="metric-pipeline-value" />
        <Metric label="Avg readiness" value={d.avg_score} accent="text-[#FF4F00]" sub={`${d.counts.targets} targets tracked`} testId="metric-avg-score" />
        <Metric label="Enrichment rate" value={`${d.enrichment_rate}%`} sub={`${d.counts.contacts} contacts`} testId="metric-enrichment" />
        <Metric label="Agent runs" value={d.counts.agent_runs} sub={`${d.counts.signals} signals ingested`} testId="metric-agent-runs" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Pipeline by stage" className="lg:col-span-2" testId="panel-pipeline">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 border-t border-border h-[calc(100%-2.75rem)]">
            {d.pipeline.map((p) => (
              <Link
                key={p.key}
                to="/pipeline"
                className="p-4 border-r border-b border-border hover:bg-[#18181b] transition-colors duration-150"
                data-testid={`stage-tile-${p.key}`}
              >
                <div className="overline truncate">{p.stage}</div>
                <div className="mono text-2xl mt-2">{p.count}</div>
                <div className="text-[11px] text-zinc-500 mt-1">{eur(p.value_eur)}</div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Readiness distribution" testId="panel-distribution">
          <div className="h-[190px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.score_distribution}>
                <XAxis dataKey="bucket" tick={{ fill: "#71717a", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 0, fontSize: 12 }}
                  cursor={{ fill: "#ffffff08" }}
                />
                <Bar dataKey="count" fill="#FF4F00" radius={0} isAnimationActive={false} minPointSize={2}>
                  {d.score_distribution.map((b, i) => (
                    <Cell key={b.bucket} fill={["#ef4444", "#f59e0b", "#FF4F00", "#10b981"][i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Signal mix" testId="panel-signal-mix">
          <div className="divide-y divide-border">
            {d.signal_mix.length === 0 && <Empty>No signals ingested yet.</Empty>}
            {d.signal_mix.map((s) => (
              <div key={s.kind} className="flex items-center gap-4 px-4 py-3">
                <span className="mono text-xs text-zinc-400 w-28">{s.kind}</span>
                <div className="flex-1 h-[3px] bg-[#1f1f23]">
                  <div
                    className="h-full bg-[#FF4F00]"
                    style={{ width: `${(s.count / Math.max(...d.signal_mix.map((x) => x.count))) * 100}%` }}
                  />
                </div>
                <span className="mono text-xs w-8 text-right">{s.count}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent agent activity" action={<Link to="/agents" className="overline hover:text-white">open console</Link>} testId="panel-recent-agents">
          <div className="divide-y divide-border">
            {runs.length === 0 && <Empty>No agent runs yet.</Empty>}
            {runs.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between text-xs">
                <span className="mono text-zinc-300">{r.agent}</span>
                <span className="text-zinc-500 truncate max-w-[45%]">{r.tools_called.join(", ") || "—"}</span>
                <span className={`mono ${r.status === "success" ? "text-emerald-400" : "text-red-400"}`}>
                  {r.status} · {r.duration_ms}ms
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
