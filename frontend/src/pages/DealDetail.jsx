import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, MessageSquarePlus } from "lucide-react";
import { api, dt, eur } from "@/lib/api";
import { Empty, Overline, Panel, ScoreBadge } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KIND_COLOR = {
  stage_change: "border-l-[#0055FF]",
  score: "border-l-[#FF4F00]",
  document: "border-l-emerald-500",
  enrichment: "border-l-amber-500",
  agent: "border-l-[#FF4F00]",
  note: "border-l-zinc-600",
};

export default function DealDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => api.deal(id).then(setData), [id]);
  useEffect(() => {
    load();
  }, [load]);

  const addNote = async () => {
    if (!note.trim()) return;
    await api.addNote(id, { summary: note });
    setNote("");
    toast.success("Note logged");
    load();
  };

  if (!data) return <Overline>loading deal…</Overline>;
  const { deal, target, activities, documents } = data;

  return (
    <div className="space-y-6" data-testid="deal-detail">
      <Link to="/pipeline" className="overline flex items-center gap-2 hover:text-white">
        <ArrowLeft size={12} /> back to pipeline
      </Link>

      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Overline>{deal.stage} · owner {deal.owner || "unassigned"}</Overline>
          <h1 className="text-4xl font-light tracking-tighter mt-2">{deal.title}</h1>
          {target && (
            <Link to={`/targets/${target.id}`} className="text-sm text-zinc-400 hover:text-[#FF4F00] mt-2 inline-block">
              {target.name} · {target.sector}
            </Link>
          )}
        </div>
        <div className="flex gap-4">
          <div className="panel p-4 min-w-[130px]">
            <Overline>Value</Overline>
            <div className="mono text-xl mt-2">{eur(deal.value_eur)}</div>
          </div>
          <div className="panel p-4 min-w-[130px]">
            <Overline>Readiness</Overline>
            <div className="mt-3"><ScoreBadge score={target?.readiness_score} testId="deal-readiness" /></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Activity timeline" className="lg:col-span-2" testId="activity-timeline">
          <div className="p-3 border-b border-border flex gap-2">
            <Input
              data-testid="note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Log a note…"
              className="rounded-none bg-[#09090b] border-border h-9 text-sm"
            />
            <Button data-testid="add-note-button" onClick={addNote} className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] h-9 text-xs mono uppercase">
              <MessageSquarePlus size={14} className="mr-1.5" /> log
            </Button>
          </div>
          <div className="divide-y divide-border max-h-[460px] overflow-y-auto">
            {activities.map((a) => (
              <div key={a.id} className={`px-4 py-3 border-l-2 ${KIND_COLOR[a.kind] || "border-l-zinc-700"}`}>
                <div className="flex justify-between items-baseline">
                  <span className="text-sm">{a.summary}</span>
                  <span className="mono text-[10px] text-zinc-600">{dt(a.created_at)}</span>
                </div>
                <div className="overline mt-1">{a.kind} · {a.actor}</div>
              </div>
            ))}
            {!activities.length && <Empty>No activity yet.</Empty>}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Next step" testId="next-step-panel">
            <div className="p-4 text-sm text-zinc-300">{deal.next_step || "—"}</div>
          </Panel>
          <Panel title={`Data room (${documents.length})`} action={<Link to="/vdr" className="overline hover:text-white">open vdr</Link>} testId="deal-documents">
            <div className="divide-y divide-border">
              {documents.map((d) => (
                <div key={d.id} className="px-4 py-3 text-sm flex justify-between">
                  <span className="truncate">{d.filename}</span>
                  <span className="mono text-[10px] text-zinc-500">v{d.version} · {d.access_level}</span>
                </div>
              ))}
              {!documents.length && <Empty>No documents.</Empty>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
