# AI-Native M&A Deal Sourcing & Management Platform — PRD

## Original problem statement
Self-hosted, single-firm M&A platform (originally specced on NocoBase + MCP servers) combining
AI-driven deal sourcing, acquisition readiness scoring, contact enrichment, CRM and a VDR, powered
by MCP-connected specialised agents behind a FastAPI MCP gateway.

## User decisions (2026-06)
- Build natively on this stack (React + FastAPI + MongoDB); NocoBase/MinIO/Postgres not hostable here.
- Scope: everything at once (all phases).
- No LLM/AI reasoning for now (scoring/research/email are deterministic engines).
- No auth (single-firm deployment).
- Apify + Gmail credentials absent → deterministic stub providers.

## Architecture
- FastAPI `/api` gateway (`server.py`) fronting 7 in-process MCP tool servers (`mcp_servers.py`)
  exposed over JSON-RPC 2.0 at `POST /api/mcp/{server}` (`tools/list`, `tools/call`).
- Servers: scoring, enrichment, sourcing, research, linkedin, email, orchestrator (11 tools).
- MongoDB collections: targets, deals, contacts, scores, documents, signals, agent_runs,
  activities, access_logs, vdr_blobs.
- Frontend: React + Tailwind + shadcn, dark "Swiss/technical terminal" design, 10 routes.

## Implemented (2026-06)
- 7 core collections with CRUD + relationships; seeded demo firm data (8 targets, 8 deals, 10 contacts, 26+ signals).
- Readiness scoring 0-100 with 5 weighted sub-scores + per-sub-score source attribution; auto-scoring
  workflow on target create/update; score history.
- Sourcing: TED/funding/rumour/patent/hiring signal ingestion (stub providers), relationship graph
  (sector ← company → counterparty) with SVG visualisation, warm-path discovery.
- Contact enrichment waterfall (internal_db → linkedin → email_finder → social → phone) with
  per-field source tagging and step-by-step trace UI.
- CRM: kanban across 6 stages with enforced stage gates (LOI ≥ 60, DD ≥ 70), deal detail with
  activity timeline (stage changes, scores, docs, enrichment, agent runs, notes).
- VDR: folder structure per deal, versioned uploads, per-document access policy
  (view/download/no-access) enforced server-side, full access audit trail.
- Agent runs: dispatch console with terminal-style trace, tools called, mutations, findings JSON.
- Gateway health dashboard + external provider status; analytics overview dashboard.
- Tested end-to-end (iteration_1): all desktop flows pass; backend validation gaps fixed
  (orphan deal, 404s, blob cleanup) plus responsive mobile navigation.

## Backlog
- P0: real Apify actors (TED, LinkedIn, registries) + Gmail API send/reply sync once credentials exist.
- P0: swap Mongo blob store for S3/MinIO object storage.
- P1: LLM-backed research synthesis + email drafting via OmniRoute/Universal Key.
- P1: roles & permissions (analyst/partner/viewer) if the firm needs them; per-deal VDR guest access.
- P2: drag-drop reordering, saved target screens, CSV/PDF exports, scheduled ingestion cron,
  backup/restore runbook, data dictionary docs.
