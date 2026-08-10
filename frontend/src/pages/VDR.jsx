import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Eye, FolderClosed, Trash2, Upload } from "lucide-react";
import { API, api, dt } from "@/lib/api";
import { Empty, Overline, Panel } from "@/components/Bits";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FOLDERS = ["/", "/NDA", "/CIM", "/Financials", "/Legal"];
const ACCESS = ["download", "view", "no-access"];

export default function VDR() {
  const [deals, setDeals] = useState([]);
  const [dealId, setDealId] = useState("");
  const [folder, setFolder] = useState("/");
  const [docs, setDocs] = useState([]);
  const [logs, setLogs] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => {
    api.deals().then((d) => {
      setDeals(d);
      if (d.length) setDealId(d[0].id);
    });
  }, []);

  const load = (id = dealId) => {
    if (!id) return;
    Promise.all([api.documents({ deal_id: id }), api.accessLogs({ deal_id: id })]).then(([d, l]) => {
      setDocs(d);
      setLogs(l);
    });
  };

  useEffect(() => { load(dealId); }, [dealId]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !dealId) return;
    const form = new FormData();
    form.append("deal_id", dealId);
    form.append("folder", folder);
    form.append("doc_type", folder === "/" ? "Other" : folder.slice(1));
    form.append("access_level", "download");
    form.append("file", file);
    try {
      const d = await api.upload(form);
      toast.success(`${d.filename} uploaded as v${d.version}`);
      load();
    } catch {
      toast.error("Upload failed");
    }
    e.target.value = "";
  };

  const setAccess = async (doc, lvl) => {
    await api.setAccess(doc.id, lvl);
    toast.success(`${doc.filename} → ${lvl}`);
    load();
  };

  const view = async (doc) => {
    try {
      await api.viewDoc(doc.id);
      toast.success(`Viewed ${doc.filename} — logged`);
    } catch {
      toast.error("Access denied by VDR policy");
    }
    load();
  };

  const download = async (doc) => {
    if (doc.access_level !== "download") {
      try {
        await api.viewDoc(doc.id);
      } catch {}
      toast.error("Download not permitted by policy");
      load();
      return;
    }
    window.open(`${API}/documents/${doc.id}/download`, "_blank");
    setTimeout(load, 700);
  };

  const remove = async (doc) => {
    await api.deleteDoc(doc.id);
    toast.success("Document removed");
    load();
  };

  const shown = docs.filter((d) => d.folder === folder);

  return (
    <div className="space-y-6" data-testid="vdr-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Overline>Secure</Overline>
          <h1 className="text-4xl font-light tracking-tighter mt-2">Virtual Data Room</h1>
          <p className="text-xs text-zinc-500 mt-2 mono">per-document access policy · versioning · full audit trail</p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <Overline className="mb-1.5">Deal</Overline>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger data-testid="vdr-deal-select" className="w-[260px] rounded-none bg-[#121214] border-border h-9 text-sm">
                <SelectValue placeholder="Select deal" />
              </SelectTrigger>
              <SelectContent className="bg-[#121214] border-border rounded-none">
                {deals.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button data-testid="upload-button" onClick={() => fileRef.current?.click()} className="rounded-none bg-[#FF4F00] hover:bg-[#ff6a26] h-9 text-xs mono uppercase tracking-wider">
            <Upload size={14} className="mr-2" /> Upload to {folder}
          </Button>
          <input ref={fileRef} type="file" onChange={upload} className="hidden" data-testid="vdr-file-input" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Panel title="Folders" testId="vdr-folders">
          <div className="divide-y divide-border">
            {FOLDERS.map((f) => (
              <button
                key={f}
                data-testid={`vdr-folder-${f.replace("/", "root-") || "root"}`}
                onClick={() => setFolder(f)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors duration-150 ${
                  folder === f ? "bg-[#18181b] text-white border-l-2 border-l-[#FF4F00]" : "text-zinc-400 hover:bg-[#141416] hover:text-white"
                }`}
              >
                <FolderClosed size={14} /> {f === "/" ? "Root" : f.slice(1)}
                <span className="ml-auto mono text-[10px] text-zinc-600">
                  {docs.filter((d) => d.folder === f).length}
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title={`Documents in ${folder}`} className="lg:col-span-3" testId="vdr-documents">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["File", "Type", "Version", "Size", "Access", "Uploaded", ""].map((h) => (
                  <th key={h} className="overline font-normal px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} className="border-b border-border hover:bg-[#18181b] transition-colors duration-150" data-testid={`vdr-doc-${d.id}`}>
                  <td className="px-4 py-3 truncate max-w-[220px]">{d.filename}</td>
                  <td className="px-4 py-3 text-zinc-400">{d.doc_type}</td>
                  <td className="px-4 py-3 mono">v{d.version}</td>
                  <td className="px-4 py-3 mono text-zinc-400">{(d.size_bytes / 1024).toFixed(1)} KB</td>
                  <td className="px-4 py-3">
                    <Select value={d.access_level} onValueChange={(v) => setAccess(d, v)}>
                      <SelectTrigger data-testid={`access-select-${d.id}`} className="h-7 w-[112px] rounded-none bg-[#09090b] border-border mono text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#121214] border-border rounded-none">
                        {ACCESS.map((a) => <SelectItem key={a} value={a} className="mono text-[11px]">{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 mono text-[10px] text-zinc-600">{dt(d.created_at)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button data-testid={`view-doc-${d.id}`} onClick={() => view(d)} className="text-zinc-500 hover:text-white px-1.5"><Eye size={14} /></button>
                    <button data-testid={`download-doc-${d.id}`} onClick={() => download(d)} className="text-zinc-500 hover:text-white px-1.5"><Download size={14} /></button>
                    <button data-testid={`delete-doc-${d.id}`} onClick={() => remove(d)} className="text-zinc-500 hover:text-red-400 px-1.5"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <Empty>No documents in this folder. Upload one to start.</Empty>}
        </Panel>
      </div>

      <Panel title={`Access audit trail (${logs.length})`} testId="vdr-audit">
        <div className="bg-black p-3 mono text-[11px] max-h-[260px] overflow-y-auto space-y-1">
          {logs.map((l) => (
            <div key={l.id} className="flex gap-3">
              <span className="text-zinc-700">{dt(l.created_at)}</span>
              <span className={l.action === "denied" ? "text-red-400" : l.action === "upload" ? "text-[#FF4F00]" : "text-emerald-400"}>
                {l.action.toUpperCase()}
              </span>
              <span className="text-zinc-300">{l.filename}</span>
              <span className="text-zinc-600">by {l.actor}</span>
            </div>
          ))}
          {!logs.length && <div className="text-zinc-600">no access events yet</div>}
        </div>
      </Panel>
    </div>
  );
}
