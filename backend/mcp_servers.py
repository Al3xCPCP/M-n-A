"""In-process MCP tool servers fronted by the FastAPI MCP Gateway (JSON-RPC 2.0).

Each server exposes `tools/list` and `tools/call`. External data providers
(Apify, TED, LinkedIn, email finder) are deterministic stub providers until
credentials are wired in.
"""
import hashlib
import random
from typing import Any, Callable, Dict, List

from bson import ObjectId

from db import db
from models import Score, Signal, SubScore, now_iso

SERVER_META = {
    "scoring": {"description": "Acquisition readiness scoring engine", "version": "1.0.0"},
    "enrichment": {"description": "Contact enrichment waterfall", "version": "1.0.0"},
    "sourcing": {"description": "Deal sourcing graph + signal ingestion", "version": "1.0.0"},
    "research": {"description": "Target deep-dive research agent", "version": "1.0.0"},
    "linkedin": {"description": "LinkedIn monitoring agent", "version": "1.0.0"},
    "email": {"description": "Outreach drafting + reply classification", "version": "1.0.0"},
    "orchestrator": {"description": "Routes tasks to specialised agents", "version": "1.0.0"},
}

REGISTRY: Dict[str, Dict[str, Dict[str, Any]]] = {name: {} for name in SERVER_META}


def tool(server: str, name: str, description: str, schema: Dict[str, Any] | None = None):
    def deco(fn: Callable):
        REGISTRY[server][name] = {
            "name": name,
            "description": description,
            "inputSchema": schema or {"type": "object", "properties": {}},
            "fn": fn,
        }
        return fn
    return deco


def _seed(*parts: Any) -> random.Random:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return random.Random(int(h[:12], 16))


async def _target(target_id: str) -> dict:
    doc = await db.targets.find_one({"_id": ObjectId(target_id)})
    if not doc:
        raise ValueError(f"target {target_id} not found")
    return doc


# ---------------- Scoring server ----------------
WEIGHTS = [
    ("financials", "Financial Health", 0.30, "internal:financials"),
    ("tech_stack", "Tech Stack Modernity", 0.15, "provider:builtwith-stub"),
    ("team_stability", "Team Stability", 0.20, "provider:glassdoor-stub"),
    ("market_position", "Market Position", 0.20, "provider:ted+registry"),
    ("regulatory_risk", "Regulatory Risk (inverted)", 0.15, "provider:compliance-stub"),
]


@tool("scoring", "score_target", "Compute 0-100 acquisition readiness score with audited sub-scores",
      {"type": "object", "properties": {"target_id": {"type": "string"}, "triggered_by": {"type": "string"}},
       "required": ["target_id"]})
async def score_target(target_id: str, triggered_by: str = "manual") -> dict:
    t = await _target(target_id)
    rng = _seed(target_id, t.get("name"))
    signals = await db.signals.count_documents({"target_id": target_id})
    subs: List[SubScore] = []

    for key, label, weight, source in WEIGHTS:
        base = rng.uniform(35, 92)
        if key == "financials":
            rev = t.get("revenue_eur") or 0
            ebitda = t.get("ebitda_eur") or 0
            margin = (ebitda / rev) if rev else 0
            base = min(98, 40 + margin * 220 + (12 if rev > 20_000_000 else 0))
        if key == "tech_stack":
            base = min(98, 45 + len(t.get("tech_stack") or []) * 9)
        if key == "team_stability":
            hc = t.get("headcount") or 0
            base = min(96, 50 + (hc / 40) + rng.uniform(-8, 8))
        if key == "market_position":
            base = min(97, 45 + signals * 6 + rng.uniform(-5, 10))
        if key == "regulatory_risk":
            risky = (t.get("sector") or "").lower() in {"healthcare", "fintech", "defence", "energy"}
            base = 58 if risky else 82
        value = round(max(0, min(100, base)), 1)
        subs.append(SubScore(key=key, label=label, value=value, weight=weight, source=source,
                             notes=f"derived from {source}"))

    composite = round(sum(s.value * s.weight for s in subs), 1)
    score = Score(target_id=target_id, composite=composite, sub_scores=subs, triggered_by=triggered_by)
    res = await db.scores.insert_one(score.to_mongo())
    await db.targets.update_one({"_id": ObjectId(target_id)},
                                {"$set": {"readiness_score": composite, "scored_at": now_iso(),
                                          "updated_at": now_iso()}})
    return {"score_id": str(res.inserted_id), "target_id": target_id, "composite": composite,
            "sub_scores": [s.model_dump() for s in subs]}


@tool("scoring", "explain_score", "Return the latest stored score with source attribution",
      {"type": "object", "properties": {"target_id": {"type": "string"}}, "required": ["target_id"]})
async def explain_score(target_id: str) -> dict:
    doc = await db.scores.find_one({"target_id": target_id}, sort=[("created_at", -1)])
    if not doc:
        return {"target_id": target_id, "score": None}
    s = Score.from_mongo(doc)
    return {"target_id": target_id, "score": s.model_dump()}


# ---------------- Enrichment server (waterfall) ----------------
WATERFALL = ["internal_db", "linkedin_profile", "email_finder", "social_profiles", "phone_lookup"]


@tool("enrichment", "enrich_contact", "Run the sequential enrichment waterfall for one contact",
      {"type": "object", "properties": {"contact_id": {"type": "string"}}, "required": ["contact_id"]})
async def enrich_contact(contact_id: str) -> dict:
    doc = await db.contacts.find_one({"_id": ObjectId(contact_id)})
    if not doc:
        raise ValueError("contact not found")
    rng = _seed(contact_id, doc.get("full_name"))
    updates: Dict[str, Any] = {}
    sources: Dict[str, str] = dict(doc.get("sources") or {})
    steps = []
    slug = (doc.get("full_name") or "unknown").lower().replace(" ", ".")
    company = "example.com"
    if doc.get("target_id"):
        t = await db.targets.find_one({"_id": ObjectId(doc["target_id"])})
        if t and t.get("domain"):
            company = t["domain"]

    need = {
        "email": not doc.get("email"),
        "linkedin_url": not doc.get("linkedin_url"),
        "phone": not doc.get("phone"),
        "location": not doc.get("location"),
    }

    for step in WATERFALL:
        if not any(need.values()):
            steps.append({"step": step, "status": "skipped", "reason": "all fields resolved upstream"})
            continue
        hit = rng.random() > 0.25
        found = {}
        if step == "internal_db" and need["location"] and hit:
            found["location"] = rng.choice(["Berlin, DE", "Paris, FR", "Amsterdam, NL", "Milan, IT"])
        if step == "linkedin_profile" and need["linkedin_url"] and hit:
            found["linkedin_url"] = f"https://linkedin.com/in/{slug}"
        if step == "email_finder" and need["email"] and hit:
            found["email"] = f"{slug}@{company}"
        if step == "social_profiles" and need["linkedin_url"] and hit:
            found["linkedin_url"] = f"https://linkedin.com/in/{slug}-alt"
        if step == "phone_lookup" and need["phone"] and hit:
            found["phone"] = f"+49 30 {rng.randint(1000000, 9999999)}"
        for k, v in found.items():
            updates[k] = v
            sources[k] = step
            need[k] = False
        steps.append({"step": step, "status": "hit" if found else "miss",
                      "fields": list(found.keys())})

    status = "enriched" if not any(need.values()) else ("partial" if updates else "failed")
    updates.update({"sources": sources, "enrichment_status": status, "enriched_at": now_iso()})
    await db.contacts.update_one({"_id": ObjectId(contact_id)}, {"$set": updates})
    return {"contact_id": contact_id, "status": status, "steps": steps,
            "fields_resolved": [k for k in updates if k in ("email", "phone", "linkedin_url", "location")]}


# ---------------- Sourcing graph server ----------------
SIGNAL_KINDS = ["ted_award", "funding", "ma_rumor", "patent", "hiring"]
BUYERS = ["Bundeswehr Procurement", "Ville de Paris", "NHS Digital", "Rijkswaterstaat", "ESA", "Comune di Milano"]


@tool("sourcing", "ingest_ted", "Ingest TED procurement awards (stub provider) and link to targets",
      {"type": "object", "properties": {"limit": {"type": "integer"}}, })
async def ingest_ted(limit: int = 8) -> dict:
    targets = await db.targets.find({}).to_list(200)
    if not targets:
        return {"ingested": 0, "reason": "no targets"}
    rng = _seed("ted", len(targets), limit)
    created = []
    for i in range(limit):
        t = rng.choice(targets)
        kind = rng.choice(SIGNAL_KINDS)
        counterparty = rng.choice(BUYERS)
        titles = {
            "ted_award": f"Framework award: {t['name']} selected by {counterparty}",
            "funding": f"{t['name']} raises growth round",
            "ma_rumor": f"Market chatter: {t['name']} exploring exit options",
            "patent": f"{t['name']} files patent in {t.get('sector') or 'software'}",
            "hiring": f"{t['name']} opens senior engineering roles",
        }
        sig = Signal(target_id=str(t["_id"]), kind=kind, title=titles[kind],
                     source="apify:ted-scraper-stub" if kind == "ted_award" else "provider:openfeeds-stub",
                     counterparty=counterparty if kind == "ted_award" else None,
                     sector=t.get("sector"), value_eur=round(rng.uniform(0.2, 12) * 1_000_000, -3),
                     occurred_at=now_iso(), strength=rng.randint(1, 5),
                     payload={"provider": "stub", "confidence": round(rng.uniform(0.5, 0.97), 2)})
        res = await db.signals.insert_one(sig.to_mongo())
        created.append(str(res.inserted_id))
    return {"ingested": len(created), "signal_ids": created}


@tool("sourcing", "build_graph", "Build the company → contract → partner → sector relationship graph")
async def build_graph() -> dict:
    targets = await db.targets.find({}).to_list(300)
    signals = await db.signals.find({}).to_list(1000)
    nodes, links, seen = [], [], set()

    def add(nid, label, ntype, extra=None):
        if nid in seen:
            return
        seen.add(nid)
        nodes.append({"id": nid, "label": label, "type": ntype, **(extra or {})})

    for t in targets:
        add(f"t:{t['_id']}", t["name"], "target",
            {"score": t.get("readiness_score"), "target_id": str(t["_id"])})
        if t.get("sector"):
            add(f"s:{t['sector']}", t["sector"], "sector")
            links.append({"source": f"t:{t['_id']}", "target": f"s:{t['sector']}", "kind": "operates_in"})
    for s in signals:
        if s.get("counterparty"):
            add(f"c:{s['counterparty']}", s["counterparty"], "counterparty")
            if s.get("target_id"):
                links.append({"source": f"t:{s['target_id']}", "target": f"c:{s['counterparty']}",
                              "kind": "contracted_with"})
    return {"nodes": nodes, "links": links}


@tool("sourcing", "warm_paths", "Find warm paths: shared counterparties or sectors between targets",
      {"type": "object", "properties": {"target_id": {"type": "string"}}, "required": ["target_id"]})
async def warm_paths(target_id: str) -> dict:
    t = await _target(target_id)
    mine = await db.signals.find({"target_id": target_id}).to_list(500)
    my_parties = {s["counterparty"] for s in mine if s.get("counterparty")}
    paths = []
    others = await db.signals.find({"target_id": {"$ne": target_id},
                                    "counterparty": {"$in": list(my_parties)}}).to_list(500) if my_parties else []
    for s in others:
        other = await db.targets.find_one({"_id": ObjectId(s["target_id"])}) if s.get("target_id") else None
        if not other:
            continue
        paths.append({"via": s["counterparty"], "via_type": "shared procurement partner",
                      "peer": other["name"], "peer_id": str(other["_id"]), "strength": s.get("strength", 1)})
    if t.get("sector"):
        peers = await db.targets.find({"sector": t["sector"], "_id": {"$ne": ObjectId(target_id)}}).to_list(20)
        for p in peers:
            paths.append({"via": t["sector"], "via_type": "shared sector", "peer": p["name"],
                          "peer_id": str(p["_id"]), "strength": 1})
    return {"target_id": target_id, "paths": paths[:25]}


# ---------------- Research / LinkedIn / Email agents ----------------
@tool("research", "deep_dive", "Deep-dive a target: financials, news, workforce sentiment, tech stack",
      {"type": "object", "properties": {"target_id": {"type": "string"}}, "required": ["target_id"]})
async def deep_dive(target_id: str) -> dict:
    t = await _target(target_id)
    rng = _seed("research", target_id)
    stack = t.get("tech_stack") or rng.sample(
        ["Kubernetes", "PostgreSQL", "React", "Kafka", "Snowflake", "SAP", "AWS", "Terraform"], 4)
    return {
        "target": t["name"],
        "financial_summary": {
            "revenue_eur": t.get("revenue_eur"),
            "ebitda_eur": t.get("ebitda_eur"),
            "margin_pct": round((t.get("ebitda_eur") or 0) / (t.get("revenue_eur") or 1) * 100, 1),
            "trend": rng.choice(["expanding", "flat", "compressing"]),
        },
        "news": [f"{t['name']} expands into {rng.choice(['DACH', 'Benelux', 'Nordics'])} market",
                 f"{t['name']} named in {rng.choice(['Gartner', 'Forrester'])} vendor landscape"],
        "workforce_sentiment": {"rating": round(rng.uniform(3.0, 4.6), 1), "source": "provider:glassdoor-stub"},
        "tech_stack_detected": stack,
        "risk_flags": rng.sample(["key-man dependency", "customer concentration", "legacy ERP",
                                  "pending litigation", "none material"], 2),
    }


@tool("linkedin", "monitor_company", "Track key hires and departures at a target (Apify actor stub)",
      {"type": "object", "properties": {"target_id": {"type": "string"}}, "required": ["target_id"]})
async def monitor_company(target_id: str) -> dict:
    t = await _target(target_id)
    rng = _seed("li", target_id)
    people = ["Anna Vogel", "Marco Bianchi", "Sofie Jansen", "Luc Moreau", "Tom Weber"]
    events = [{"person": rng.choice(people), "event": rng.choice(["joined as CFO", "promoted to COO",
                                                                  "departed to competitor"]),
               "detected_at": now_iso()} for _ in range(3)]
    return {"target": t["name"], "employee_count_estimate": t.get("headcount") or rng.randint(30, 400),
            "events": events, "provider": "apify:linkedin-company-scraper-stub"}


@tool("email", "draft_outreach", "Draft a stage-appropriate outreach email for a contact",
      {"type": "object", "properties": {"contact_id": {"type": "string"}, "angle": {"type": "string"}},
       "required": ["contact_id"]})
async def draft_outreach(contact_id: str, angle: str = "acquisition interest") -> dict:
    c = await db.contacts.find_one({"_id": ObjectId(contact_id)})
    if not c:
        raise ValueError("contact not found")
    company = "your company"
    if c.get("target_id"):
        t = await db.targets.find_one({"_id": ObjectId(c["target_id"])})
        if t:
            company = t["name"]
    subject = f"{company} — exploratory conversation"
    body = (f"Hi {c['full_name'].split()[0]},\n\n"
            f"I lead corporate development at our firm and have been following {company}'s "
            f"trajectory, particularly your position in {c.get('role') or 'the market'}.\n\n"
            f"We are actively looking at {angle} in this space and would value a short, "
            f"confidential conversation — no materials required at this stage.\n\n"
            f"Would 20 minutes next week work?\n\nBest regards,\nCorporate Development")
    return {"contact_id": contact_id, "subject": subject, "body": body,
            "sequence": [{"step": 1, "day": 0, "type": "intro"}, {"step": 2, "day": 4, "type": "value-add"},
                         {"step": 3, "day": 9, "type": "final follow-up"}],
            "channel": "gmail-api (pending credentials)"}


@tool("email", "classify_reply", "Classify an inbound reply",
      {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]})
async def classify_reply(text: str) -> dict:
    low = text.lower()
    if any(w in low for w in ["not interested", "no thanks", "unsubscribe"]):
        label = "negative"
    elif any(w in low for w in ["call", "meeting", "interested", "happy to"]):
        label = "positive"
    elif any(w in low for w in ["later", "next quarter", "busy"]):
        label = "defer"
    else:
        label = "neutral"
    return {"label": label, "confidence": 0.82}


@tool("orchestrator", "list_agents", "List available specialised agents and their tools")
async def list_agents() -> dict:
    return {"agents": [{"server": s, "tools": list(REGISTRY[s].keys()), **SERVER_META[s]}
                       for s in SERVER_META]}


async def call_tool(server: str, name: str, args: Dict[str, Any]) -> Any:
    if server not in REGISTRY:
        raise KeyError(f"unknown MCP server '{server}'")
    entry = REGISTRY[server].get(name)
    if not entry:
        raise KeyError(f"unknown tool '{name}' on server '{server}'")
    return await entry["fn"](**args)


def list_tools(server: str) -> List[dict]:
    return [{k: v for k, v in t.items() if k != "fn"} for t in REGISTRY[server].values()]
