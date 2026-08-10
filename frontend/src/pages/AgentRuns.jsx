import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { api, dt } from "@/lib/api";
import { Empty, Overline, Panel } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const AGENTS = [
  { key: "research", needs: "target", desc: "Financials, news, workforce sentiment, tech stack" },
  { key: "linkedin", needs: "target", desc: "Key hires and departures monitoring" },
  { key: "email", needs: "contact", desc: "Outreach drafting + sequencing" },
  { key: "orchestrator", needs: "target", desc: "Scoring → research → warm paths" },
];

const LEVEL = { error: "text-red-400", ok: "text-emerald-400", warn: "text-amber-400", info: "text-[#FF4F00]" };

export default function AgentRuns() {
  const [runs, setRuns] = useState([]);
  const [targets, setTargets] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [agent, setAgent] = useState("research");
  const [subject, setSubject] = useState("");
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.runs().then((r) => { setRuns(r); setSel((s) => (s ? r.find((x) => x.id === s.id) || r[0] : r[0])); });

  useEffect(() => {
    Promise.all([api.targets(), api.contacts()]).then(([t, c]) => { setTargets(t); setContacts(c); });
    load();
  }, []);

  const cfg = AGENTS.find((a) => a.key === agent);
  const options = cfg?.needs === "contact" ? contacts : targets;

  const run = async () => {
    if (!subject) return toast.error(`Select a ${cfg.needs}`);
    setBusy(true);
    try {
      const body = { agent };
      body[cfg.needs === "contact" ? "contact_id" : "target_id"] = subject;
      const r = await api.runAgent(body);
      toast[r.status === "success" ? "success" : "error"](`${agent} agent ${r.status} · ${r.duration_ms}ms`);
      const all = await api.runs();
      setRuns(all);
      setSel(all.find((x) => x.id === r.id) || all[0]);
    } catch {
      toast.error("Agent dispatch failed");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-6" data-testid="agents-page">
      <div>
        <Overline>Automation</Overline>
        <h1 className="text-4xl font-light tracking-tighter mt-2">Agent Run Console</h1>
        <p className="text-xs text-zinc-500 mt-2 mono">every dispatch, tool call and mutation is audited</p>
      </div>

      <Panel title="Dispatch" testId="dispatch-panel">
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <Overline className="mb-1.5">Agent</Overline>
            <Select value={agent} onValueChange={(v) => { setAgent(v); setSubject(""); }}>
              <SelectTrigger data-testid="agent-select" className="w-[190px] rounded-none bg-[#09090b] border-border h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#121214] border-border rounded-none">
                {AGENTS.map((a) => <SelectItem key={a.key} value={a.key}>{a.key}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Overline className="mb-1.5">{cfg?.needs}</Overline>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger data-testid="subject-select" className="w-[280px] rounded-none bg-[#09090b] border-border h-9 text-sm">
                <SelectValue placeholder={`Select ${cfg?.needs}`} />
              </SelectTrigger>
              <SelectContent className="bg-[#121214] border-border rounded-none">
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name || o.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button data-testid="run-agent-button" onClick={run} disabled={busy} className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] h-9 text-xs mono uppercase tracking-wider">
            <Play size={13} className="mr-2" /> Dispatch
          </Button>
          <span className="text-xs text-zinc-500 ml-2">{cfg?.desc}</span>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title={`Runs (${runs.length})`} testId="runs-list">
          <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
            {runs.map((r) => (
              <button
                key={r.id}
                data-testid={`run-item-${r.id}`}
                onClick={() => setSel(r)}
                className={`w-full text-left px-4 py-3 transition-colors duration-150 ${
                  sel?.id === r.id ? "bg-[#18181b] border-l-2 border-l-[#FF4F00]" : "hover:bg-[#141416]"
                }`}
              >
                <div className="flex justify-between text-sm">
                  <span className="mono">{r.agent}</span>
                  <span className={`mono text-[11px] ${r.status === "success" ? "text-emerald-400" : "text-red-400"}`}>
                    {r.status}
                  </span>
                </div>
                <div className="mono text-[10px] text-zinc-600 mt-1">{dt(r.started_at)} · {r.duration_ms}ms</div>
              </button>
            ))}
            {!runs.length && <Empty>No runs yet.</Empty>}
          </div>
        </Panel>

        <Panel title="Run trace" className="lg:col-span-2" testId="run-trace">
          {!sel && <Empty>Select a run.</Empty>}
          {sel && (
            <div>
              <div className="bg-black p-4 mono text-[11px] space-y-1 max-h-[300px] overflow-y-auto">
                {sel.logs.map((l, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-zinc-700">{l.ts?.slice(11, 19)}</span>
                    <span className={LEVEL[l.level] || "text-zinc-400"}>{l.level.padEnd(5)}</span>
                    <span className="text-zinc-300">{l.msg}</span>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-border space-y-3">
                <div>
                  <Overline>tools called</Overline>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {sel.tools_called.map((t) => (
                      <span key={t} className="mono text-[10px] px-2 py-1 border border-border text-zinc-300">{t}</span>
                    ))}
                    {!sel.tools_called.length && <span className="text-xs text-zinc-600">none</span>}
                  </div>
                </div>
                <div>
                  <Overline>mutations</Overline>
                  <div className="mono text-[11px] text-emerald-400 mt-2">
                    {sel.changes.length ? sel.changes.join(" · ") : "no collection writes"}
                  </div>
                </div>
                <div>
                  <Overline>findings</Overline>
                  <pre className="bg-black p-3 mt-2 text-[10px] text-zinc-400 max-h-[240px] overflow-auto" data-testid="run-findings">
                    {JSON.stringify(sel.findings, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
