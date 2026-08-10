import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Lock, Plus } from "lucide-react";
import { api, eur } from "@/lib/api";
import { Overline } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Pipeline() {
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [targets, setTargets] = useState([]);
  const [drag, setDrag] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", target_id: "", value_eur: "", owner: "" });

  const load = () =>
    Promise.all([api.stages(), api.deals(), api.targets()]).then(([s, d, t]) => {
      setStages(s);
      setDeals(d);
      setTargets(t);
    });

  useEffect(() => {
    load();
  }, []);

  const move = async (deal, stage) => {
    if (deal.stage === stage) return;
    try {
      await api.updateDeal(deal.id, { stage });
      toast.success(`${deal.title} → ${stage}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Move blocked");
      load();
    }
  };

  const create = async () => {
    if (!form.title || !form.target_id) return toast.error("Title and target required");
    try {
      await api.createDeal({
        title: form.title,
        target_id: form.target_id,
        owner: form.owner || null,
        value_eur: form.value_eur ? Number(form.value_eur) : null,
      });
      toast.success("Deal created");
      setOpen(false);
      setForm({ title: "", target_id: "", value_eur: "", owner: "" });
      load();
    } catch {
      toast.error("Could not create deal");
    }
  };

  return (
    <div className="space-y-6" data-testid="pipeline-page">
      <div className="flex items-end justify-between">
        <div>
          <Overline>CRM</Overline>
          <h1 className="text-4xl font-light tracking-tighter mt-2">Deal Pipeline</h1>
          <p className="text-xs text-zinc-500 mt-2 mono">
            stage gates enforced · LOI needs score ≥ 60 · DD needs ≥ 70
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-deal-button" className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-xs mono uppercase tracking-wider">
              <Plus size={14} className="mr-2" /> New deal
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#121214] border-border rounded-none">
            <DialogHeader><DialogTitle className="font-display font-medium">Create deal</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="overline">Title</Label>
                <Input data-testid="deal-title-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-none bg-[#09090b] border-border h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="overline">Target</Label>
                <Select value={form.target_id} onValueChange={(v) => setForm({ ...form, target_id: v })}>
                  <SelectTrigger data-testid="deal-target-select" className="rounded-none bg-[#09090b] border-border h-9">
                    <SelectValue placeholder="Select target" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#121214] border-border rounded-none">
                    {targets.map((t) => (
                      <SelectItem key={t.id} value={t.id} data-testid={`deal-target-option-${t.id}`}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="overline">Value (EUR)</Label>
                  <Input data-testid="deal-value-input" value={form.value_eur} onChange={(e) => setForm({ ...form, value_eur: e.target.value })} className="rounded-none bg-[#09090b] border-border h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="overline">Owner</Label>
                  <Input data-testid="deal-owner-input" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} className="rounded-none bg-[#09090b] border-border h-9" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button data-testid="submit-deal-button" onClick={create} className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-xs mono uppercase tracking-wider">Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4" data-testid="kanban-board">
        {stages.map((s) => {
          const col = deals.filter((d) => d.stage === s.key);
          return (
            <div
              key={s.key}
              data-testid={`kanban-column-${s.key}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drag && move(drag, s.key)}
              className="w-[280px] shrink-0 panel flex flex-col"
            >
              <div className="px-4 h-12 flex items-center justify-between border-b border-border">
                <div>
                  <div className="overline">{s.label}</div>
                  {s.gate && (
                    <div className="flex items-center gap-1 text-[10px] mono text-amber-500 mt-0.5">
                      <Lock size={9} /> gate ≥ {s.gate}
                    </div>
                  )}
                </div>
                <span className="mono text-xs text-zinc-500">{col.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[160px]">
                {col.map((d) => (
                  <div
                    key={d.id}
                    draggable
                    onDragStart={() => setDrag(d)}
                    onDragEnd={() => setDrag(null)}
                    data-testid={`deal-card-${d.id}`}
                    className="border border-border bg-[#18181b] p-3 cursor-grab hover:border-[#FF4F00] transition-colors duration-150"
                  >
                    <Link to={`/deals/${d.id}`} className="text-sm hover:text-[#FF4F00]" data-testid={`deal-open-${d.id}`}>
                      {d.title}
                    </Link>
                    <div className="text-[11px] text-zinc-500 mt-1">{d.target_name}</div>
                    <div className="flex items-center justify-between mt-3 mono text-[11px]">
                      <span className="text-zinc-400">{eur(d.value_eur)}</span>
                      <span className={d.readiness_score >= 60 ? "text-emerald-400" : "text-amber-400"}>
                        {d.readiness_score?.toFixed(0) ?? "—"}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-1">
                      {stages.filter((x) => x.key !== d.stage).slice(0, 6).map((x) => (
                        <button
                          key={x.key}
                          onClick={() => move(d, x.key)}
                          data-testid={`move-${d.id}-to-${x.key}`}
                          title={`Move to ${x.label}`}
                          className="text-[9px] mono px-1 border border-border text-zinc-500 hover:text-white hover:border-[#FF4F00] transition-colors duration-150"
                        >
                          {x.label.split(" ").map((w) => w[0]).join("")}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
