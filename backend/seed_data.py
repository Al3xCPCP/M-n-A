import random

from bson import ObjectId

import mcp_servers as mcp
from db import db
from models import Activity, Contact, Deal, Target, now_iso

TARGETS = [
    dict(name="Helvetia Precision Systems", domain="helvetiaprecision.ch", sector="Industrials",
         country="Switzerland", revenue_eur=48_000_000, ebitda_eur=9_600_000, headcount=310,
         ownership="Family-owned", founded_year=1978,
         description="Precision components for medtech and aerospace OEMs.",
         tech_stack=["SAP", "Siemens NX", "Azure"], tags=["carve-out candidate"]),
    dict(name="Nordfjord Data Labs", domain="nordfjorddata.no", sector="Software", country="Norway",
         revenue_eur=14_500_000, ebitda_eur=3_800_000, headcount=96, ownership="Founder-owned",
         founded_year=2014, description="Data pipeline tooling for energy utilities.",
         tech_stack=["Kubernetes", "Kafka", "Snowflake", "Terraform", "React"], tags=["high growth"]),
    dict(name="Atelier Verdi Logistique", domain="verdilog.fr", sector="Logistics", country="France",
         revenue_eur=72_000_000, ebitda_eur=5_100_000, headcount=640, ownership="PE-backed",
         founded_year=1996, description="Cold-chain distribution across Southern Europe.",
         tech_stack=["Oracle", "AWS"], tags=["secondary buyout"]),
    dict(name="Meridian Health Analytics", domain="meridianhealth.io", sector="Healthcare",
         country="Netherlands", revenue_eur=21_000_000, ebitda_eur=2_100_000, headcount=140,
         ownership="Founder-owned", founded_year=2011,
         description="Clinical outcome benchmarking for hospital groups.",
         tech_stack=["PostgreSQL", "Python", "GCP", "dbt"], tags=["regulated"]),
    dict(name="Brandenburg Grid Services", domain="bg-grid.de", sector="Energy", country="Germany",
         revenue_eur=95_000_000, ebitda_eur=16_200_000, headcount=520, ownership="Public",
         founded_year=1988, description="Grid maintenance and substation engineering.",
         tech_stack=["SAP", "IBM Maximo"], tags=["infrastructure"]),
    dict(name="Iberia Fintech Rails", domain="iberiarails.es", sector="Fintech", country="Spain",
         revenue_eur=9_800_000, ebitda_eur=-400_000, headcount=71, ownership="VC-backed",
         founded_year=2019, description="Payment orchestration for Iberian merchants.",
         tech_stack=["Go", "Kubernetes", "PostgreSQL"], tags=["distressed"]),
    dict(name="Baltic Marine Robotics", domain="balticmarine.lt", sector="Industrials",
         country="Lithuania", revenue_eur=6_200_000, ebitda_eur=1_400_000, headcount=44,
         ownership="Founder-owned", founded_year=2016,
         description="Autonomous hull inspection drones for shipping fleets.",
         tech_stack=["ROS", "Python", "AWS"], tags=["bolt-on"]),
    dict(name="Toscana Software Group", domain="toscanasw.it", sector="Software", country="Italy",
         revenue_eur=31_000_000, ebitda_eur=7_200_000, headcount=225, ownership="PE-backed",
         founded_year=2005, description="Vertical ERP for the Italian manufacturing mid-market.",
         tech_stack=[".NET", "Azure", "SQL Server", "React"], tags=["platform deal"]),
]

CONTACTS = [
    ("Anna Vogel", "CEO", 0), ("Marco Bianchi", "CFO", 1), ("Sofie Jansen", "Head of M&A", 3),
    ("Luc Moreau", "COO", 2), ("Tom Weber", "Managing Director", 4), ("Elena Rossi", "CTO", 7),
    ("Petras Kazlauskas", "Founder", 6), ("Clara Fischer", "VP Finance", 4),
    ("Diego Alvarez", "CEO", 5), ("Nils Haugen", "Founder & CEO", 1),
]

STAGES = ["identified", "identified", "screening", "screening", "loi", "due_diligence", "closed", "passed"]


async def run_seed(reset: bool = True):
    if reset:
        for c in ["targets", "deals", "contacts", "scores", "signals", "documents",
                  "access_logs", "activities", "agent_runs", "vdr_blobs"]:
            await db[c].delete_many({})

    rng = random.Random(7)
    target_ids = []
    for t in TARGETS:
        res = await db.targets.insert_one(Target(**t).to_mongo())
        target_ids.append(str(res.inserted_id))

    await mcp.call_tool("sourcing", "ingest_ted", {"limit": 26})

    for tid in target_ids:
        await mcp.call_tool("scoring", "score_target", {"target_id": tid, "triggered_by": "workflow:seed"})

    deal_ids = []
    for i, tid in enumerate(target_ids):
        t = await db.targets.find_one({"_id": ObjectId(tid)})
        stage = STAGES[i]
        if stage in ("loi", "due_diligence") and (t.get("readiness_score") or 0) < 60:
            stage = "screening"
        d = Deal(title=f"Project {t['name'].split()[0]}", target_id=tid, stage=stage,
                 owner=rng.choice(["J. Keller", "M. Duarte", "S. Novak"]),
                 value_eur=round((t.get("revenue_eur") or 10_000_000) * rng.uniform(0.8, 2.2), -4),
                 probability=rng.choice([10, 25, 40, 60, 75]),
                 next_step=rng.choice(["Management call", "Send NDA", "Review CIM", "Financial QoE",
                                       "Draft LOI"]))
        res = await db.deals.insert_one(d.to_mongo())
        did = str(res.inserted_id)
        deal_ids.append(did)
        for kind, summary in [("stage_change", f"Deal created in {stage}"),
                              ("score", f"Readiness scored at {t.get('readiness_score')}"),
                              ("note", rng.choice(["Intro via procurement partner",
                                                   "Owner open to minority sale",
                                                   "Competitive process expected"]))]:
            await db.activities.insert_one(Activity(deal_id=did, kind=kind, summary=summary).to_mongo())

    for name, role, ti in CONTACTS:
        await db.contacts.insert_one(Contact(full_name=name, role=role, target_id=target_ids[ti],
                                             relationship_strength=rng.randint(0, 4)).to_mongo())

    # enrich a subset so the waterfall has visible history
    for c in (await db.contacts.find({}).to_list(10))[:4]:
        await mcp.call_tool("enrichment", "enrich_contact", {"contact_id": str(c["_id"])})

    for tid, agent in zip(target_ids[:4], ["research", "linkedin", "orchestrator", "research"]):
        from server import run_agent  # local import to avoid circular at module load
        from models import AgentRunRequest
        await run_agent(AgentRunRequest(agent=agent, target_id=tid))

    return {"targets": len(target_ids), "deals": len(deal_ids),
            "contacts": await db.contacts.count_documents({}),
            "signals": await db.signals.count_documents({})}
