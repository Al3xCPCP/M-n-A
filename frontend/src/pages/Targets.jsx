import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { api, eur } from "@/lib/api";
import { Overline, Panel, ScoreBadge, Empty } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const blank = { name: "", domain: "", sector: "", country: "", revenue_eur: "", ebitda_eur: "", headcount: "", ownership: "", description: "" };

export default function Targets() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const load = (search) => api.targets(search ? { q: search } : {}).then(setRows);
  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      const body = {
        ...form,
        revenue_eur: form.revenue_eur ? Number(form.revenue_eur) : null,
        ebitda_eur: form.ebitda_eur ? Number(form.ebitda_eur) : null,
        headcount: form.headcount ? Number(form.headcount) : null,
      };
      Object.keys(body).forEach((k) => body[k] === "" && delete body[k]);
      const t = await api.createTarget(body);
      toast.success(`${t.name} added — auto-scored at ${t.readiness_score ?? "n/a"}`);
      setOpen(false);
      setForm(blank);
      load(q);
    } catch (e) {
      toast.error("Could not create target");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6" data-testid="targets-page">
      <div className="flex items-end justify-between">
        <div>
          <Overline>Collection</Overline>
          <h1 className="text-4xl font-light tracking-tighter mt-2">Targets</h1>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-target-button" className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-white text-xs mono uppercase tracking-wider">
              <Plus size={14} className="mr-2" /> New target
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#121214] border-border rounded-none max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-display font-medium">Add acquisition candidate</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              {[
                ["name", "Company name"], ["domain", "Domain"], ["sector", "Sector"], ["country", "Country"],
                ["revenue_eur", "Revenue (EUR)"], ["ebitda_eur", "EBITDA (EUR)"], ["headcount", "Headcount"],
                ["ownership", "Ownership"],
              ].map(([k, label]) => (
                <div key={k} className="space-y-1.5">
                  <Label className="overline">{label}</Label>
                  <Input
                    data-testid={`target-field-${k}`}
                    value={form[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    className="rounded-none bg-[#09090b] border-border h-9 text-sm"
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button data-testid="submit-target-button" disabled={saving} onClick={submit} className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-xs mono uppercase tracking-wider">
                Create &amp; score
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 panel px-3 h-11">
        <Search size={14} className="text-zinc-500" />
        <input
          data-testid="target-search-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            load(e.target.value);
          }}
          placeholder="Search targets…"
          className="bg-transparent outline-none text-sm w-full placeholder:text-zinc-600"
        />
        <span className="mono text-[11px] text-zinc-600">{rows.length} records</span>
      </div>

      <Panel testId="targets-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {["Company", "Sector", "Country", "Revenue", "EBITDA", "Staff", "Ownership", "Readiness"].map((h) => (
                <th key={h} className="overline font-normal px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-border hover:bg-[#18181b] transition-colors duration-150">
                <td className="px-4 py-3">
                  <Link to={`/targets/${t.id}`} data-testid={`target-link-${t.id}`} className="hover:text-[#FF4F00]">
                    {t.name}
                  </Link>
                  <div className="text-[11px] text-zinc-600 mono">{t.domain}</div>
                </td>
                <td className="px-4 py-3 text-zinc-400">{t.sector || "—"}</td>
                <td className="px-4 py-3 text-zinc-400">{t.country || "—"}</td>
                <td className="px-4 py-3 mono text-right text-zinc-300">{eur(t.revenue_eur)}</td>
                <td className="px-4 py-3 mono text-right text-zinc-300">{eur(t.ebitda_eur)}</td>
                <td className="px-4 py-3 mono text-right text-zinc-300">{t.headcount ?? "—"}</td>
                <td className="px-4 py-3 text-zinc-400">{t.ownership || "—"}</td>
                <td className="px-4 py-3"><ScoreBadge score={t.readiness_score} testId={`score-${t.id}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No targets match.</Empty>}
      </Panel>
    </div>
  );
}
