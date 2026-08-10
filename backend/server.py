import base64
import logging
import os
import time
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

import mcp_servers as mcp
import seed_data
from db import db
from models import (AccessLog, Activity, AgentRun, AgentRunRequest, Contact, ContactCreate,
                    ContactUpdate, DEAL_STAGES, Deal, DealCreate, DealUpdate, DocumentMeta,
                    STAGE_GATES, STAGE_LABELS, Score, Signal, SignalBase, Target, TargetCreate,
                    TargetUpdate, now_iso)

app = FastAPI(title="M&A Deal Platform")
api = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


def oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except Exception:
        raise HTTPException(400, "invalid id")


async def log_activity(deal_id: str, kind: str, summary: str, detail: str = None, actor: str = "system"):
    await db.activities.insert_one(
        Activity(deal_id=deal_id, kind=kind, summary=summary, detail=detail, actor=actor).to_mongo())


# ============ Targets ============
@api.get("/targets")
async def list_targets(q: Optional[str] = None, sector: Optional[str] = None,
                       min_score: Optional[float] = None):
    query: Dict[str, Any] = {}
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    if sector:
        query["sector"] = sector
    if min_score is not None:
        query["readiness_score"] = {"$gte": min_score}
    docs = await db.targets.find(query).sort("created_at", -1).to_list(500)
    return [Target.from_mongo(d) for d in docs]


@api.post("/targets")
async def create_target(payload: TargetCreate):
    t = Target(**payload.model_dump())
    res = await db.targets.insert_one(t.to_mongo())
    tid = str(res.inserted_id)
    try:
        await mcp.call_tool("scoring", "score_target", {"target_id": tid, "triggered_by": "workflow:on_create"})
    except Exception as e:
        logger.warning("auto-score failed: %s", e)
    doc = await db.targets.find_one({"_id": res.inserted_id})
    return Target.from_mongo(doc)


@api.get("/targets/{target_id}")
async def get_target(target_id: str):
    doc = await db.targets.find_one({"_id": oid(target_id)})
    if not doc:
        raise HTTPException(404, "target not found")
    t = Target.from_mongo(doc)
    scores = [Score.from_mongo(d) for d in
              await db.scores.find({"target_id": target_id}).sort("created_at", -1).to_list(20)]
    contacts = [Contact.from_mongo(d) for d in await db.contacts.find({"target_id": target_id}).to_list(100)]
    signals = [Signal.from_mongo(d) for d in
               await db.signals.find({"target_id": target_id}).sort("created_at", -1).to_list(50)]
    deals = [Deal.from_mongo(d) for d in await db.deals.find({"target_id": target_id}).to_list(20)]
    runs = [AgentRun.from_mongo(d) for d in
            await db.agent_runs.find({"target_id": target_id}).sort("started_at", -1).to_list(20)]
    return {"target": t, "scores": scores, "contacts": contacts, "signals": signals,
            "deals": deals, "agent_runs": runs}


@api.patch("/targets/{target_id}")
async def update_target(target_id: str, payload: TargetUpdate):
    updates = payload.model_dump(exclude_none=True)
    updates["updated_at"] = now_iso()
    r = await db.targets.update_one({"_id": oid(target_id)}, {"$set": updates})
    if not r.matched_count:
        raise HTTPException(404, "target not found")
    await mcp.call_tool("scoring", "score_target", {"target_id": target_id, "triggered_by": "workflow:on_update"})
    return Target.from_mongo(await db.targets.find_one({"_id": oid(target_id)}))


@api.delete("/targets/{target_id}")
async def delete_target(target_id: str):
    await db.targets.delete_one({"_id": oid(target_id)})
    return {"deleted": target_id}


@api.post("/targets/{target_id}/score")
async def rescore_target(target_id: str):
    result = await mcp.call_tool("scoring", "score_target", {"target_id": target_id, "triggered_by": "manual"})
    for d in await db.deals.find({"target_id": target_id}).to_list(10):
        await log_activity(str(d["_id"]), "score",
                           f"Readiness re-scored: {result['composite']}", actor="scoring-mcp")
    return result


# ============ Deals ============
@api.get("/deals")
async def list_deals():
    docs = await db.deals.find({}).sort("updated_at", -1).to_list(500)
    out = []
    for d in docs:
        deal = Deal.from_mongo(d)
        t = await db.targets.find_one({"_id": ObjectId(deal.target_id)}) if deal.target_id else None
        out.append({**deal.model_dump(), "target_name": t["name"] if t else None,
                    "readiness_score": t.get("readiness_score") if t else None,
                    "sector": t.get("sector") if t else None})
    return out


@api.get("/deals/stages")
async def deal_stages():
    return [{"key": k, "label": STAGE_LABELS[k], "gate": STAGE_GATES.get(k)} for k in DEAL_STAGES]


@api.post("/deals")
async def create_deal(payload: DealCreate):
    if payload.stage not in DEAL_STAGES:
        raise HTTPException(400, "invalid stage")
    if not await db.targets.find_one({"_id": oid(payload.target_id)}):
        raise HTTPException(404, "target not found")
    d = Deal(**payload.model_dump())
    res = await db.deals.insert_one(d.to_mongo())
    await log_activity(str(res.inserted_id), "stage_change", f"Deal created in {STAGE_LABELS[d.stage]}")
    return Deal.from_mongo(await db.deals.find_one({"_id": res.inserted_id}))


@api.get("/deals/{deal_id}")
async def get_deal(deal_id: str):
    doc = await db.deals.find_one({"_id": oid(deal_id)})
    if not doc:
        raise HTTPException(404, "deal not found")
    deal = Deal.from_mongo(doc)
    t = await db.targets.find_one({"_id": ObjectId(deal.target_id)}) if deal.target_id else None
    acts = [Activity.from_mongo(a) for a in
            await db.activities.find({"deal_id": deal_id}).sort("created_at", -1).to_list(200)]
    docs = [DocumentMeta.from_mongo(x) for x in await db.documents.find({"deal_id": deal_id}).to_list(300)]
    return {"deal": deal, "target": Target.from_mongo(t), "activities": acts, "documents": docs}


@api.patch("/deals/{deal_id}")
async def update_deal(deal_id: str, payload: DealUpdate):
    doc = await db.deals.find_one({"_id": oid(deal_id)})
    if not doc:
        raise HTTPException(404, "deal not found")
    updates = payload.model_dump(exclude_none=True)
    new_stage = updates.get("stage")
    if new_stage:
        if new_stage not in DEAL_STAGES:
            raise HTTPException(400, "invalid stage")
        gate = STAGE_GATES.get(new_stage)
        if gate:
            t = await db.targets.find_one({"_id": ObjectId(doc["target_id"])})
            score = (t or {}).get("readiness_score")
            if score is None or score < gate:
                await log_activity(deal_id, "stage_change",
                                   f"Blocked move to {STAGE_LABELS[new_stage]} — gate requires score >= {gate}",
                                   actor="workflow")
                raise HTTPException(422, f"Stage gate: {STAGE_LABELS[new_stage]} requires readiness score >= "
                                        f"{gate} (current: {score if score is not None else 'unscored'})")
    updates["updated_at"] = now_iso()
    await db.deals.update_one({"_id": oid(deal_id)}, {"$set": updates})
    if new_stage and new_stage != doc.get("stage"):
        await log_activity(deal_id, "stage_change",
                           f"Stage {STAGE_LABELS[doc['stage']]} -> {STAGE_LABELS[new_stage]}", actor="analyst")
    return Deal.from_mongo(await db.deals.find_one({"_id": oid(deal_id)}))


@api.delete("/deals/{deal_id}")
async def delete_deal(deal_id: str):
    await db.deals.delete_one({"_id": oid(deal_id)})
    return {"deleted": deal_id}


class NoteIn(BaseModel):
    summary: str
    detail: Optional[str] = None


@api.post("/deals/{deal_id}/activities")
async def add_activity(deal_id: str, payload: NoteIn):
    await log_activity(deal_id, "note", payload.summary, payload.detail, actor="analyst")
    return {"ok": True}


# ============ Contacts ============
@api.get("/contacts")
async def list_contacts(target_id: Optional[str] = None):
    query = {"target_id": target_id} if target_id else {}
    docs = await db.contacts.find(query).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        c = Contact.from_mongo(d)
        t = await db.targets.find_one({"_id": ObjectId(c.target_id)}) if c.target_id else None
        out.append({**c.model_dump(), "target_name": t["name"] if t else None})
    return out


@api.post("/contacts")
async def create_contact(payload: ContactCreate):
    c = Contact(**payload.model_dump())
    res = await db.contacts.insert_one(c.to_mongo())
    return Contact.from_mongo(await db.contacts.find_one({"_id": res.inserted_id}))


@api.patch("/contacts/{contact_id}")
async def update_contact(contact_id: str, payload: ContactUpdate):
    r = await db.contacts.update_one({"_id": oid(contact_id)}, {"$set": payload.model_dump(exclude_none=True)})
    if not r.matched_count:
        raise HTTPException(404, "contact not found")
    return Contact.from_mongo(await db.contacts.find_one({"_id": oid(contact_id)}))


@api.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str):
    await db.contacts.delete_one({"_id": oid(contact_id)})
    return {"deleted": contact_id}


@api.post("/contacts/{contact_id}/enrich")
async def enrich(contact_id: str):
    result = await mcp.call_tool("enrichment", "enrich_contact", {"contact_id": contact_id})
    c = await db.contacts.find_one({"_id": oid(contact_id)})
    if c and c.get("target_id"):
        for d in await db.deals.find({"target_id": c["target_id"]}).to_list(10):
            await log_activity(str(d["_id"]), "enrichment",
                               f"Enriched {c['full_name']} ({result['status']})", actor="enrichment-mcp")
    return {**result, "contact": Contact.from_mongo(c)}


# ============ Signals / Sourcing graph ============
@api.get("/signals")
async def list_signals(kind: Optional[str] = None, target_id: Optional[str] = None):
    query: Dict[str, Any] = {}
    if kind:
        query["kind"] = kind
    if target_id:
        query["target_id"] = target_id
    docs = await db.signals.find(query).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        s = Signal.from_mongo(d)
        t = await db.targets.find_one({"_id": ObjectId(s.target_id)}) if s.target_id else None
        out.append({**s.model_dump(), "target_name": t["name"] if t else None})
    return out


@api.post("/signals")
async def create_signal(payload: SignalBase):
    s = Signal(**payload.model_dump())
    res = await db.signals.insert_one(s.to_mongo())
    return Signal.from_mongo(await db.signals.find_one({"_id": res.inserted_id}))


@api.post("/sourcing/ingest")
async def ingest(limit: int = 8):
    return await mcp.call_tool("sourcing", "ingest_ted", {"limit": limit})


@api.get("/sourcing/graph")
async def graph():
    return await mcp.call_tool("sourcing", "build_graph", {})


@api.get("/sourcing/warm-paths/{target_id}")
async def warm(target_id: str):
    return await mcp.call_tool("sourcing", "warm_paths", {"target_id": target_id})


# ============ VDR ============
@api.get("/documents")
async def list_documents(deal_id: Optional[str] = None):
    query = {"deal_id": deal_id} if deal_id else {}
    docs = await db.documents.find(query).sort("created_at", -1).to_list(500)
    return [DocumentMeta.from_mongo(d) for d in docs]


@api.post("/documents")
async def upload_document(deal_id: str = Form(...), folder: str = Form("/"),
                          doc_type: str = Form("Other"), access_level: str = Form("download"),
                          file: UploadFile = File(...)):
    content = await file.read()
    existing = await db.documents.find_one({"deal_id": deal_id, "folder": folder, "filename": file.filename},
                                           sort=[("version", -1)])
    version = (existing["version"] + 1) if existing else 1
    blob = await db.vdr_blobs.insert_one({"data": base64.b64encode(content).decode(),
                                          "content_type": file.content_type or "application/octet-stream"})
    meta = DocumentMeta(deal_id=deal_id, folder=folder or "/", filename=file.filename, doc_type=doc_type,
                        size_bytes=len(content), version=version, access_level=access_level,
                        storage_key=str(blob.inserted_id))
    res = await db.documents.insert_one(meta.to_mongo())
    did = str(res.inserted_id)
    await db.access_logs.insert_one(AccessLog(document_id=did, deal_id=deal_id, action="upload").to_mongo())
    await log_activity(deal_id, "document", f"Uploaded {file.filename} (v{version})", actor="analyst")
    return DocumentMeta.from_mongo(await db.documents.find_one({"_id": res.inserted_id}))


@api.get("/documents/{document_id}/download")
async def download_document(document_id: str):
    meta = await db.documents.find_one({"_id": oid(document_id)})
    if not meta:
        raise HTTPException(404, "document not found")
    if meta["access_level"] != "download":
        await db.access_logs.insert_one(
            AccessLog(document_id=document_id, deal_id=meta["deal_id"], action="denied").to_mongo())
        raise HTTPException(403, "download not permitted by VDR policy")
    blob = await db.vdr_blobs.find_one({"_id": ObjectId(meta["storage_key"])})
    await db.access_logs.insert_one(
        AccessLog(document_id=document_id, deal_id=meta["deal_id"], action="download").to_mongo())
    return Response(content=base64.b64decode(blob["data"]), media_type=blob["content_type"],
                    headers={"Content-Disposition": f'attachment; filename="{meta["filename"]}"'})


@api.post("/documents/{document_id}/view")
async def view_document(document_id: str):
    meta = await db.documents.find_one({"_id": oid(document_id)})
    if not meta:
        raise HTTPException(404, "document not found")
    allowed = meta["access_level"] != "no-access"
    await db.access_logs.insert_one(AccessLog(document_id=document_id, deal_id=meta["deal_id"],
                                              action="view" if allowed else "denied").to_mongo())
    if not allowed:
        raise HTTPException(403, "access denied by VDR policy")
    return {"ok": True}


class AccessIn(BaseModel):
    access_level: str


@api.patch("/documents/{document_id}/access")
async def set_access(document_id: str, payload: AccessIn):
    if payload.access_level not in ("view", "download", "no-access"):
        raise HTTPException(400, "invalid access level")
    r = await db.documents.update_one({"_id": oid(document_id)},
                                      {"$set": {"access_level": payload.access_level}})
    if not r.matched_count:
        raise HTTPException(404, "document not found")
    return DocumentMeta.from_mongo(await db.documents.find_one({"_id": oid(document_id)}))


@api.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    meta = await db.documents.find_one({"_id": oid(document_id)})
    if not meta:
        raise HTTPException(404, "document not found")
    await db.vdr_blobs.delete_one({"_id": ObjectId(meta["storage_key"])})
    await db.documents.delete_one({"_id": oid(document_id)})
    return {"deleted": document_id}


@api.get("/access-logs")
async def access_logs(deal_id: Optional[str] = None):
    query = {"deal_id": deal_id} if deal_id else {}
    logs = await db.access_logs.find(query).sort("created_at", -1).to_list(300)
    out = []
    for entry in logs:
        log = AccessLog.from_mongo(entry)
        d = await db.documents.find_one({"_id": ObjectId(log.document_id)})
        out.append({**log.model_dump(), "filename": d["filename"] if d else "(deleted)"})
    return out


# ============ Agent runs ============
AGENT_PLAN = {
    "research": [("research", "deep_dive", "target_id")],
    "linkedin": [("linkedin", "monitor_company", "target_id")],
    "email": [("email", "draft_outreach", "contact_id")],
    "orchestrator": [("scoring", "score_target", "target_id"),
                     ("research", "deep_dive", "target_id"),
                     ("sourcing", "warm_paths", "target_id")],
}


@api.get("/agent-runs")
async def list_runs(agent: Optional[str] = None):
    query = {"agent": agent} if agent else {}
    docs = await db.agent_runs.find(query).sort("started_at", -1).to_list(200)
    return [AgentRun.from_mongo(d) for d in docs]


@api.post("/agent-runs")
async def run_agent(payload: AgentRunRequest):
    if payload.agent not in AGENT_PLAN:
        raise HTTPException(400, f"unknown agent '{payload.agent}'")
    run = AgentRun(**payload.model_dump())
    res = await db.agent_runs.insert_one(run.to_mongo())
    rid = res.inserted_id
    start = time.time()
    logs: List[Dict[str, str]] = [{"ts": now_iso(), "level": "info",
                                   "msg": f"orchestrator dispatch -> {payload.agent} agent"}]
    findings: Dict[str, Any] = {}
    tools: List[str] = []
    changes: List[str] = []
    status = "success"

    for server, tool_name, arg_key in AGENT_PLAN[payload.agent]:
        arg_val = getattr(payload, arg_key, None)
        if not arg_val:
            logs.append({"ts": now_iso(), "level": "warn",
                         "msg": f"skip {server}.{tool_name} - missing {arg_key}"})
            continue
        logs.append({"ts": now_iso(), "level": "info",
                     "msg": f"call {server}.{tool_name}({arg_key}={arg_val})"})
        try:
            out = await mcp.call_tool(server, tool_name, {arg_key: arg_val})
            findings[f"{server}.{tool_name}"] = out
            tools.append(f"{server}.{tool_name}")
            logs.append({"ts": now_iso(), "level": "ok",
                         "msg": f"{server}.{tool_name} returned {len(str(out))} bytes"})
            if server == "scoring":
                changes.append(f"targets.readiness_score = {out.get('composite')}")
        except Exception as e:
            status = "failed"
            logs.append({"ts": now_iso(), "level": "error", "msg": f"{server}.{tool_name} failed: {e}"})

    if not tools and status == "success":
        status = "failed"
        logs.append({"ts": now_iso(), "level": "error", "msg": "no tools executed - insufficient input"})

    await db.agent_runs.update_one({"_id": rid}, {"$set": {
        "status": status, "logs": logs, "findings": findings, "tools_called": tools, "changes": changes,
        "duration_ms": int((time.time() - start) * 1000), "finished_at": now_iso()}})
    if payload.deal_id:
        await log_activity(payload.deal_id, "agent", f"{payload.agent} agent run {status}",
                           actor=f"{payload.agent}-mcp")
    return AgentRun.from_mongo(await db.agent_runs.find_one({"_id": rid}))


# ============ MCP Gateway ============
@api.get("/gateway/health")
async def gateway_health():
    servers = []
    for name, meta in mcp.SERVER_META.items():
        servers.append({"name": name, "status": "healthy", "transport": "http/json-rpc-2.0",
                        "endpoint": f"/api/mcp/{name}", "tools": len(mcp.REGISTRY[name]), **meta})
    ok = True
    try:
        await db.command("ping")
    except Exception:
        ok = False
    return {"gateway": "healthy", "mongo": "healthy" if ok else "unreachable",
            "object_store": "mongo blob store (S3/MinIO drop-in pending)", "servers": servers,
            "external_providers": [
                {"name": "Apify (TED / LinkedIn / registries)", "status": "stubbed", "reason": "no credentials"},
                {"name": "Gmail API", "status": "stubbed", "reason": "no credentials"},
                {"name": "LLM (OmniRoute)", "status": "disabled", "reason": "AI skipped per config"}]}


@api.get("/mcp/{server}/tools")
async def mcp_tools(server: str):
    if server not in mcp.REGISTRY:
        raise HTTPException(404, "unknown MCP server")
    return {"server": server, "tools": mcp.list_tools(server)}


class JsonRpcRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: Any = 1
    method: str
    params: Dict[str, Any] = {}


@api.post("/mcp/{server}")
async def mcp_rpc(server: str, req: JsonRpcRequest):
    if server not in mcp.REGISTRY:
        return {"jsonrpc": "2.0", "id": req.id,
                "error": {"code": -32601, "message": f"unknown server '{server}'"}}
    try:
        if req.method == "tools/list":
            return {"jsonrpc": "2.0", "id": req.id, "result": {"tools": mcp.list_tools(server)}}
        if req.method == "tools/call":
            name = req.params.get("name")
            args = req.params.get("arguments") or {}
            result = await mcp.call_tool(server, name, args)
            return {"jsonrpc": "2.0", "id": req.id,
                    "result": {"content": [{"type": "json", "json": result}], "isError": False}}
        return {"jsonrpc": "2.0", "id": req.id,
                "error": {"code": -32601, "message": f"method '{req.method}' not found"}}
    except Exception as e:
        return {"jsonrpc": "2.0", "id": req.id, "error": {"code": -32000, "message": str(e)}}


# ============ Analytics ============
@api.get("/analytics/overview")
async def overview():
    targets = await db.targets.find({}).to_list(1000)
    deals = await db.deals.find({}).to_list(1000)
    scores = [t.get("readiness_score") for t in targets if t.get("readiness_score") is not None]
    buckets = {"0-39": 0, "40-59": 0, "60-79": 0, "80-100": 0}
    for s in scores:
        buckets["0-39" if s < 40 else "40-59" if s < 60 else "60-79" if s < 80 else "80-100"] += 1
    pipeline = []
    for st in DEAL_STAGES:
        ds = [d for d in deals if d.get("stage") == st]
        pipeline.append({"stage": STAGE_LABELS[st], "key": st, "count": len(ds),
                         "value_eur": sum(d.get("value_eur") or 0 for d in ds)})
    runs = await db.agent_runs.find({}).sort("started_at", -1).to_list(200)
    agent_activity: Dict[str, int] = {}
    for r in runs:
        agent_activity[r["agent"]] = agent_activity.get(r["agent"], 0) + 1
    signals = await db.signals.find({}).to_list(1000)
    signal_mix: Dict[str, int] = {}
    for s in signals:
        signal_mix[s["kind"]] = signal_mix.get(s["kind"], 0) + 1
    contacts = await db.contacts.find({}).to_list(1000)
    enriched = len([c for c in contacts if c.get("enrichment_status") == "enriched"])
    return {
        "counts": {"targets": len(targets), "deals": len(deals), "contacts": len(contacts),
                   "signals": len(signals), "documents": await db.documents.count_documents({}),
                   "agent_runs": len(runs)},
        "avg_score": round(sum(scores) / len(scores), 1) if scores else 0,
        "score_distribution": [{"bucket": k, "count": v} for k, v in buckets.items()],
        "pipeline": pipeline,
        "pipeline_value_eur": sum(d.get("value_eur") or 0 for d in deals),
        "agent_activity": [{"agent": k, "runs": v} for k, v in agent_activity.items()],
        "signal_mix": [{"kind": k, "count": v} for k, v in signal_mix.items()],
        "enrichment_rate": round(enriched / len(contacts) * 100, 1) if contacts else 0,
    }


@api.post("/admin/seed")
async def seed(reset: bool = True):
    return await seed_data.run_seed(reset=reset)


@api.get("/")
async def root():
    return {"service": "M&A Deal Sourcing Platform", "status": "ok"}


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True,
                   allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
                   allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)


@app.on_event("startup")
async def startup():
    if await db.targets.count_documents({}) == 0:
        try:
            await seed_data.run_seed(reset=False)
        except Exception as e:
            logger.warning("seed failed: %s", e)
