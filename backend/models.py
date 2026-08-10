from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from db import BaseDocument

DEAL_STAGES = ["identified", "screening", "loi", "due_diligence", "closed", "passed"]
STAGE_LABELS = {
    "identified": "Identified",
    "screening": "Screening",
    "loi": "LOI",
    "due_diligence": "Due Diligence",
    "closed": "Closed",
    "passed": "Passed",
}
# Stage gates: minimum readiness score required to enter a stage
STAGE_GATES = {"loi": 60, "due_diligence": 70}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Targets ----------
class TargetBase(BaseModel):
    name: str
    domain: Optional[str] = None
    sector: Optional[str] = None
    country: Optional[str] = None
    revenue_eur: Optional[float] = None
    ebitda_eur: Optional[float] = None
    headcount: Optional[int] = None
    ownership: Optional[str] = None  # founder-owned, PE-backed, public, family
    founded_year: Optional[int] = None
    description: Optional[str] = None
    tech_stack: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)


class TargetCreate(TargetBase):
    pass


class TargetUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    sector: Optional[str] = None
    country: Optional[str] = None
    revenue_eur: Optional[float] = None
    ebitda_eur: Optional[float] = None
    headcount: Optional[int] = None
    ownership: Optional[str] = None
    founded_year: Optional[int] = None
    description: Optional[str] = None
    tech_stack: Optional[List[str]] = None
    tags: Optional[List[str]] = None


class Target(BaseDocument, TargetBase):
    readiness_score: Optional[float] = None
    scored_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


# ---------- Deals ----------
class DealBase(BaseModel):
    title: str
    target_id: str
    stage: str = "identified"
    owner: Optional[str] = None
    value_eur: Optional[float] = None
    probability: Optional[int] = None
    next_step: Optional[str] = None


class DealCreate(DealBase):
    pass


class DealUpdate(BaseModel):
    title: Optional[str] = None
    stage: Optional[str] = None
    owner: Optional[str] = None
    value_eur: Optional[float] = None
    probability: Optional[int] = None
    next_step: Optional[str] = None


class Deal(BaseDocument, DealBase):
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Activity(BaseDocument):
    deal_id: str
    kind: str  # stage_change, score, document, email, note, enrichment, agent
    summary: str
    detail: Optional[str] = None
    actor: str = "system"
    created_at: str = Field(default_factory=now_iso)


# ---------- Contacts ----------
class ContactBase(BaseModel):
    full_name: str
    target_id: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    twitter_url: Optional[str] = None
    location: Optional[str] = None
    relationship_strength: int = 0  # 0-5


class ContactCreate(ContactBase):
    pass


class ContactUpdate(BaseModel):
    full_name: Optional[str] = None
    target_id: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    location: Optional[str] = None
    relationship_strength: Optional[int] = None


class Contact(BaseDocument, ContactBase):
    enrichment_status: str = "pending"  # pending, enriched, partial, failed
    sources: Dict[str, str] = Field(default_factory=dict)  # field -> source
    enriched_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


# ---------- Scores ----------
class SubScore(BaseModel):
    key: str
    label: str
    value: float
    weight: float
    source: str
    notes: Optional[str] = None


class Score(BaseDocument):
    target_id: str
    composite: float
    sub_scores: List[SubScore] = Field(default_factory=list)
    engine_version: str = "1.0.0"
    triggered_by: str = "manual"
    created_at: str = Field(default_factory=now_iso)


# ---------- Documents (VDR) ----------
class DocumentMeta(BaseDocument):
    deal_id: str
    folder: str = "/"
    filename: str
    doc_type: Optional[str] = None  # NDA, CIM, Financials, Legal, Other
    size_bytes: int = 0
    version: int = 1
    access_level: str = "view"  # view, download, no-access
    storage_key: str
    uploaded_by: str = "analyst"
    created_at: str = Field(default_factory=now_iso)


class AccessLog(BaseDocument):
    document_id: str
    deal_id: str
    action: str  # view, download, upload, denied
    actor: str = "analyst"
    created_at: str = Field(default_factory=now_iso)


# ---------- Sourcing Signals ----------
class SignalBase(BaseModel):
    target_id: Optional[str] = None
    kind: str  # ted_award, funding, ma_rumor, patent, hiring
    title: str
    source: str
    url: Optional[str] = None
    value_eur: Optional[float] = None
    counterparty: Optional[str] = None
    sector: Optional[str] = None
    occurred_at: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class Signal(BaseDocument, SignalBase):
    strength: int = 1  # 1-5
    created_at: str = Field(default_factory=now_iso)


# ---------- Agent Runs ----------
class AgentRunRequest(BaseModel):
    agent: str  # research, linkedin, email, orchestrator
    target_id: Optional[str] = None
    contact_id: Optional[str] = None
    deal_id: Optional[str] = None
    instruction: Optional[str] = None


class AgentRun(BaseDocument):
    agent: str
    status: str = "running"  # running, success, failed
    target_id: Optional[str] = None
    contact_id: Optional[str] = None
    deal_id: Optional[str] = None
    instruction: Optional[str] = None
    tools_called: List[str] = Field(default_factory=list)
    logs: List[Dict[str, str]] = Field(default_factory=list)
    findings: Dict[str, Any] = Field(default_factory=dict)
    changes: List[str] = Field(default_factory=list)
    duration_ms: int = 0
    started_at: str = Field(default_factory=now_iso)
    finished_at: Optional[str] = None
