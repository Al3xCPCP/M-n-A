import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Plus, Waves } from "lucide-react";
import { api } from "@/lib/api";
import { Empty, Overline, Panel } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_COLOR = {
  enriched: "text-emerald-400",
  partial: "text-amber-400",
  failed: "text-red-400",
  pending: "text-zinc-500",
};

export default function Contacts() {
  const [rows, setRows] = useState([]);
  const [targets, setTargets] = useState([]);
  const [waterfall, setWaterfall] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", role: "", target_id: "", email: "" });

  const load = () => Promise.all([api.contacts(), api.targets()]).then(([c, t]) => { setRows(c); setTargets(t); });
  useEffect(() => { load(); }, []);

  const enrich = async (c) => {
    setBusy(c.id);
    try {
      const r = await api.enrich(c.id);
      setWaterfall({ name: c.full_name, ...r });
      toast.success(`Waterfall complete: ${r.status}`);
      await load();
    } catch {
      toast.error("Enrichment failed");
    }
    setBusy("");
  };

  const outreach = async (c) => {
    setBusy(c.id);
    try {
      const r = await api.mcpCall("email", "draft_outreach", { contact_id: c.id });
      const payload = r?.result?.content?.[0]?.json;
      if (!payload) throw new Error();
      setDraft({ name: c.full_name, ...payload });
    } catch {
      toast.error("Draft failed");
    }
    setBusy("");
  };

  const create = async () => {
    if (!form.full_name) return toast.error("Name required");
    const body = { ...form };
    Object.keys(body).forEach((k) => body[k] === "" && delete body[k]);
    await api.createContact(body);
    setOpen(false);
    setForm({ full_name: "", role: "", target_id: "", email: "" });
    toast.success("Contact added");
    load();
  };

  return (
    <div className="space-y-6" data-testid="contacts-page">
      <div className="flex items-end justify-between">
        <div>
          <Overline>Collection</Overline>
          <h1 className="text-4xl font-light tracking-tighter mt-2">Contacts</h1>
          <p className="text-xs text-zinc-500 mt-2 mono">
            waterfall: internal_db → linkedin_profile → email_finder → social_profiles → phone_lookup
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-contact-button" className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-xs mono uppercase tracking-wider">
              <Plus size={14} className="mr-2" /> New contact
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#121214] border-border rounded-none">
            <DialogHeader><DialogTitle className="font-display font-medium">Add contact</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="overline">Full name</Label>
                <Input data-testid="contact-name-input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="rounded-none bg-[#09090b] border-border h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="overline">Role</Label>
                <Input data-testid="contact-role-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded-none bg-[#09090b] border-border h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="overline">Target</Label>
                <Select value={form.target_id} onValueChange={(v) => setForm({ ...form, target_id: v })}>
                  <SelectTrigger data-testid="contact-target-select" className="rounded-none bg-[#09090b] border-border h-9">
                    <SelectValue placeholder="Link to target" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#121214] border-border rounded-none">
                    {targets.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button data-testid="submit-contact-button" onClick={create} className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] text-xs mono uppercase">Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Panel testId="contacts-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {["Name", "Role", "Company", "Email", "Phone", "LinkedIn", "Status", ""].map((h) => (
                <th key={h} className="overline font-normal px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-border hover:bg-[#18181b] transition-colors duration-150">
                <td className="px-4 py-3">{c.full_name}</td>
                <td className="px-4 py-3 text-zinc-400">{c.role || "—"}</td>
                <td className="px-4 py-3 text-zinc-400">{c.target_name || "—"}</td>
                <td className={`px-4 py-3 mono text-xs ${c.sources?.email ? "border-l-2 border-l-[#FF4F00] bg-[#FF4F00]/5" : ""}`}>
                  {c.email || "—"}
                </td>
                <td className="px-4 py-3 mono text-xs">{c.phone || "—"}</td>
                <td className="px-4 py-3 mono text-xs truncate max-w-[170px]">{c.linkedin_url || "—"}</td>
                <td className={`px-4 py-3 mono text-xs ${STATUS_COLOR[c.enrichment_status]}`}>{c.enrichment_status}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    data-testid={`enrich-button-${c.id}`}
                    disabled={busy === c.id}
                    onClick={() => enrich(c)}
                    className="text-[10px] mono uppercase px-2 py-1 border border-border text-zinc-400 hover:text-white hover:border-[#FF4F00] transition-colors duration-150"
                  >
                    <Waves size={11} className="inline mr-1" /> enrich
                  </button>
                  <button
                    data-testid={`outreach-button-${c.id}`}
                    disabled={busy === c.id}
                    onClick={() => outreach(c)}
                    className="ml-2 text-[10px] mono uppercase px-2 py-1 border border-border text-zinc-400 hover:text-white hover:border-[#0055FF] transition-colors duration-150"
                  >
                    <Mail size={11} className="inline mr-1" /> draft
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty>No contacts.</Empty>}
      </Panel>

      <Dialog open={!!waterfall} onOpenChange={() => setWaterfall(null)}>
        <DialogContent className="bg-[#121214] border-border rounded-none max-w-lg" data-testid="waterfall-dialog">
          <DialogHeader>
            <DialogTitle className="font-display font-medium">Enrichment waterfall — {waterfall?.name}</DialogTitle>
          </DialogHeader>
          <div className="bg-black p-3 mono text-[11px] space-y-1.5">
            {waterfall?.steps?.map((s) => (
              <div key={s.step} className="flex gap-3" data-testid={`waterfall-step-${s.step}`}>
                <span className="text-zinc-600 w-36">{s.step}</span>
                <span className={s.status === "hit" ? "text-emerald-400" : s.status === "miss" ? "text-amber-500" : "text-zinc-600"}>
                  {s.status}
                </span>
                <span className="text-zinc-400">{(s.fields || []).join(", ") || s.reason || ""}</span>
              </div>
            ))}
          </div>
          <div className="overline">final status: {waterfall?.status}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!draft} onOpenChange={() => setDraft(null)}>
        <DialogContent className="bg-[#121214] border-border rounded-none max-w-xl" data-testid="draft-dialog">
          <DialogHeader>
            <DialogTitle className="font-display font-medium">Outreach draft — {draft?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="overline">subject</div>
            <div className="text-sm">{draft?.subject}</div>
            <div className="overline">body</div>
            <pre className="bg-black p-3 text-[11px] text-zinc-300 whitespace-pre-wrap">{draft?.body}</pre>
            <div className="overline">sequence · channel: {draft?.channel}</div>
            <div className="flex gap-2">
              {draft?.sequence?.map((s) => (
                <span key={s.step} className="mono text-[10px] px-2 py-1 border border-border text-zinc-400">
                  D+{s.day} {s.type}
                </span>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
