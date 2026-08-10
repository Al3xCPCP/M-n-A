import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { DownloadCloud } from "lucide-react";
import { api, dt, eur } from "@/lib/api";
import { Empty, Overline, Panel } from "@/components/Bits";
import { Button } from "@/components/ui/button";

const KINDS = ["all", "ted_award", "funding", "ma_rumor", "patent", "hiring"];

export default function Signals() {
  const [rows, setRows] = useState([]);
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState(false);

  const load = (k = kind) => api.signals(k === "all" ? {} : { kind: k }).then(setRows);
  useEffect(() => { load("all"); }, []);

  const ingest = async () => {
    setBusy(true);
    try {
      const r = await api.ingest(8);
      toast.success(`${r.ingested} signals ingested from stub providers`);
      await load();
    } catch {
      toast.error("Ingestion failed");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-6" data-testid="signals-page">
      <div className="flex items-end justify-between">
        <div>
          <Overline>Sourcing</Overline>
          <h1 className="text-4xl font-light tracking-tighter mt-2">Signals Feed</h1>
          <p className="text-xs text-zinc-500 mt-2 mono">TED awards · funding · M&amp;A rumours · patents · hiring</p>
        </div>
        <Button data-testid="ingest-button" onClick={ingest} disabled={busy} className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-xs mono uppercase tracking-wider">
          <DownloadCloud size={14} className="mr-2" /> Run ingestion
        </Button>
      </div>

      <div className="flex gap-1">
        {KINDS.map((k) => (
          <button
            key={k}
            data-testid={`filter-${k}`}
            onClick={() => { setKind(k); load(k); }}
            className={`mono text-[10px] uppercase tracking-wider px-3 py-1.5 border transition-colors duration-150 ${
              kind === k ? "border-[#FF4F00] text-white bg-[#18181b]" : "border-border text-zinc-500 hover:text-white"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <Panel testId="signals-list">
        <div className="divide-y divide-border">
          {rows.map((s) => (
            <div key={s.id} className="px-4 py-4 border-l-2 border-l-[#FF4F00] hover:bg-[#18181b] transition-colors duration-150" data-testid={`signal-${s.id}`}>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="text-sm">{s.title}</div>
                  <div className="mono text-[11px] text-zinc-600 mt-1.5">
                    {s.kind} · {s.source}
                    {s.counterparty ? ` · counterparty: ${s.counterparty}` : ""}
                    {s.target_name ? " · " : ""}
                    {s.target_id && (
                      <Link to={`/targets/${s.target_id}`} className="text-[#0055FF] hover:underline">{s.target_name}</Link>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="mono text-sm">{eur(s.value_eur)}</div>
                  <div className="mono text-[10px] text-zinc-600 mt-1">strength {s.strength}/5 · {dt(s.created_at)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        {!rows.length && <Empty>No signals for this filter.</Empty>}
      </Panel>
    </div>
  );
}
