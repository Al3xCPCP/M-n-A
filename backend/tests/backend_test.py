"""Regression coverage for M&A platform APIs, workflows, agents, VDR, and MCP."""
import os
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL is missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def api_client():
    session = requests.Session()
    session.headers.update({"Accept": "application/json"})
    response = session.post(f"{API}/admin/seed", params={"reset": "true"}, timeout=60)
    assert response.status_code == 200, response.text
    seeded = response.json()
    assert seeded == {"targets": 8, "deals": 8, "contacts": 10, "signals": 26}
    yield session


@pytest.fixture(scope="session")
def seeded(api_client):
    targets_response = api_client.get(f"{API}/targets", timeout=30)
    deals_response = api_client.get(f"{API}/deals", timeout=30)
    contacts_response = api_client.get(f"{API}/contacts", timeout=30)
    assert targets_response.status_code == deals_response.status_code == contacts_response.status_code == 200
    return {
        "targets": targets_response.json(),
        "deals": deals_response.json(),
        "contacts": contacts_response.json(),
    }


def assert_document_id(item):
    assert isinstance(item["id"], str) and len(item["id"]) == 24
    assert "_id" not in item


# Service health, analytics, and seeded collection integrity.
class TestPlatformOverview:
    def test_service_root_and_seeded_collections(self, api_client, seeded):
        response = api_client.get(f"{API}/", timeout=30)
        assert response.status_code == 200
        assert response.json() == {"service": "M&A Deal Sourcing Platform", "status": "ok"}
        assert len(seeded["targets"]) == 8
        assert len(seeded["deals"]) == 8
        assert len(seeded["contacts"]) == 10
        for item in seeded["targets"] + seeded["deals"] + seeded["contacts"]:
            assert_document_id(item)

    def test_analytics_overview_values_and_distribution(self, api_client):
        response = api_client.get(f"{API}/analytics/overview", timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert data["counts"]["targets"] == 8
        assert data["counts"]["deals"] == 8
        assert data["counts"]["contacts"] == 10
        assert data["counts"]["signals"] == 26
        assert data["pipeline_value_eur"] > 0
        assert 0 <= data["avg_score"] <= 100
        assert 0 <= data["enrichment_rate"] <= 100
        assert len(data["pipeline"]) == 6
        assert sum(bucket["count"] for bucket in data["score_distribution"]) == 8


# Target create/search/detail/update/score persistence.
class TestTargets:
    def test_target_create_auto_score_search_update_and_delete(self, api_client):
        payload = {
            "name": "TEST_AutoScore Systems",
            "domain": "test-autoscore.example",
            "sector": "Software",
            "country": "DE",
            "revenue_eur": 12000000,
            "ebitda_eur": 2400000,
            "headcount": 80,
            "tech_stack": ["React", "Kubernetes"],
        }
        created_response = api_client.post(f"{API}/targets", json=payload, timeout=30)
        assert created_response.status_code == 200, created_response.text
        created = created_response.json()
        assert_document_id(created)
        target_id = created["id"]
        assert created["name"] == payload["name"]
        assert isinstance(created["readiness_score"], float)
        assert 0 <= created["readiness_score"] <= 100

        search = api_client.get(f"{API}/targets", params={"q": "autoscore"}, timeout=30)
        assert search.status_code == 200
        assert [row["id"] for row in search.json()] == [target_id]

        detail = api_client.get(f"{API}/targets/{target_id}", timeout=30)
        assert detail.status_code == 200
        detail_data = detail.json()
        assert detail_data["target"]["readiness_score"] == created["readiness_score"]
        assert len(detail_data["scores"]) == 1
        assert len(detail_data["scores"][0]["sub_scores"]) == 5
        assert all(score["source"] for score in detail_data["scores"][0]["sub_scores"])

        updated = api_client.patch(
            f"{API}/targets/{target_id}", json={"headcount": 95}, timeout=30
        )
        assert updated.status_code == 200
        assert updated.json()["headcount"] == 95
        verify = api_client.get(f"{API}/targets/{target_id}", timeout=30).json()
        assert verify["target"]["headcount"] == 95
        assert len(verify["scores"]) == 2

        rescored = api_client.post(f"{API}/targets/{target_id}/score", timeout=30)
        assert rescored.status_code == 200
        assert rescored.json()["target_id"] == target_id
        assert isinstance(rescored.json()["composite"], float)

        deleted = api_client.delete(f"{API}/targets/{target_id}", timeout=30)
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": target_id}
        assert api_client.get(f"{API}/targets/{target_id}", timeout=30).status_code == 404


# Deal CRUD, stage-gate rejection/success, and timeline activity persistence.
class TestDeals:
    def test_deal_stages_and_stage_gate_enforcement(self, api_client, seeded):
        stages = api_client.get(f"{API}/deals/stages", timeout=30)
        assert stages.status_code == 200
        stage_data = stages.json()
        assert [stage["key"] for stage in stage_data] == [
            "identified", "screening", "loi", "due_diligence", "closed", "passed"
        ]
        assert next(x for x in stage_data if x["key"] == "loi")["gate"] == 60

        low_deal = next(deal for deal in seeded["deals"] if deal["readiness_score"] < 60)
        blocked = api_client.patch(
            f"{API}/deals/{low_deal['id']}", json={"stage": "loi"}, timeout=30
        )
        assert blocked.status_code == 422
        assert "requires readiness score >= 60" in blocked.json()["detail"]
        unchanged = api_client.get(f"{API}/deals/{low_deal['id']}", timeout=30).json()
        assert unchanged["deal"]["stage"] == low_deal["stage"]
        assert any("Blocked move to LOI" in a["summary"] for a in unchanged["activities"])

        high_deal = next(deal for deal in seeded["deals"] if deal["readiness_score"] >= 60)
        moved = api_client.patch(
            f"{API}/deals/{high_deal['id']}", json={"stage": "loi"}, timeout=30
        )
        assert moved.status_code == 200, moved.text
        assert moved.json()["stage"] == "loi"
        persisted = api_client.get(f"{API}/deals/{high_deal['id']}", timeout=30).json()
        assert persisted["deal"]["stage"] == "loi"
        assert any(a["kind"] == "stage_change" and "-> LOI" in a["summary"] for a in persisted["activities"])

    def test_create_deal_add_note_and_delete(self, api_client, seeded):
        target_id = seeded["targets"][0]["id"]
        payload = {"title": "TEST_Project Note", "target_id": target_id, "value_eur": 1234567}
        create = api_client.post(f"{API}/deals", json=payload, timeout=30)
        assert create.status_code == 200
        deal = create.json()
        assert_document_id(deal)
        deal_id = deal["id"]
        assert deal["title"] == payload["title"]
        assert deal["stage"] == "identified"

        note = api_client.post(
            f"{API}/deals/{deal_id}/activities",
            json={"summary": "TEST_QA diligence note", "detail": "persist this"},
            timeout=30,
        )
        assert note.status_code == 200 and note.json() == {"ok": True}
        detail = api_client.get(f"{API}/deals/{deal_id}", timeout=30)
        assert detail.status_code == 200
        activities = detail.json()["activities"]
        assert any(a["kind"] == "stage_change" for a in activities)
        saved_note = next(a for a in activities if a["summary"] == "TEST_QA diligence note")
        assert saved_note["kind"] == "note" and saved_note["detail"] == "persist this"

        deleted = api_client.delete(f"{API}/deals/{deal_id}", timeout=30)
        assert deleted.status_code == 200
        assert api_client.get(f"{API}/deals/{deal_id}", timeout=30).status_code == 404


# Contact enrichment waterfall and outreach draft generation.
class TestContacts:
    def test_contact_create_enrichment_waterfall_and_outreach(self, api_client, seeded):
        create = api_client.post(
            f"{API}/contacts",
            json={"full_name": "TEST_Waterfall Person", "role": "CEO", "target_id": seeded["targets"][0]["id"]},
            timeout=30,
        )
        assert create.status_code == 200
        contact = create.json()
        assert_document_id(contact)
        contact_id = contact["id"]
        assert contact["enrichment_status"] == "pending"

        enriched = api_client.post(f"{API}/contacts/{contact_id}/enrich", timeout=30)
        assert enriched.status_code == 200, enriched.text
        result = enriched.json()
        assert [step["step"] for step in result["steps"]] == [
            "internal_db", "linkedin_profile", "email_finder", "social_profiles", "phone_lookup"
        ]
        assert all(step["status"] in {"hit", "miss", "skipped"} for step in result["steps"])
        assert result["status"] in {"enriched", "partial", "failed"}
        persisted = next(c for c in api_client.get(f"{API}/contacts", timeout=30).json() if c["id"] == contact_id)
        assert persisted["enrichment_status"] == result["status"]

        rpc = api_client.post(
            f"{API}/mcp/email",
            json={"jsonrpc": "2.0", "id": 31, "method": "tools/call", "params": {
                "name": "draft_outreach", "arguments": {"contact_id": contact_id}
            }},
            timeout=30,
        )
        assert rpc.status_code == 200
        draft = rpc.json()["result"]["content"][0]["json"]
        assert draft["contact_id"] == contact_id
        assert "exploratory conversation" in draft["subject"]
        assert "TEST_Waterfall" in draft["body"]
        assert len(draft["sequence"]) == 3

        deleted = api_client.delete(f"{API}/contacts/{contact_id}", timeout=30)
        assert deleted.status_code == 200


# Signal ingestion/filtering, graph nodes/edges, and warm paths.
class TestSourcing:
    def test_signal_filter_ingestion_graph_and_warm_paths(self, api_client, seeded):
        before = api_client.get(f"{API}/signals", timeout=30)
        assert before.status_code == 200 and len(before.json()) == 26
        ted = api_client.get(f"{API}/signals", params={"kind": "ted_award"}, timeout=30)
        assert ted.status_code == 200
        assert len(ted.json()) > 0 and all(signal["kind"] == "ted_award" for signal in ted.json())

        ingest = api_client.post(f"{API}/sourcing/ingest", params={"limit": 5}, timeout=30)
        assert ingest.status_code == 200
        assert ingest.json()["ingested"] == 5 and len(ingest.json()["signal_ids"]) == 5
        after = api_client.get(f"{API}/signals", timeout=30)
        assert len(after.json()) == 31

        graph = api_client.get(f"{API}/sourcing/graph", timeout=30)
        assert graph.status_code == 200
        graph_data = graph.json()
        target_nodes = [n for n in graph_data["nodes"] if n["type"] == "target"]
        assert len(target_nodes) == 8
        assert len(graph_data["links"]) > 0
        assert all(node.get("target_id") for node in target_nodes)

        warm = api_client.get(f"{API}/sourcing/warm-paths/{seeded['targets'][0]['id']}", timeout=30)
        assert warm.status_code == 200
        assert warm.json()["target_id"] == seeded["targets"][0]["id"]
        assert isinstance(warm.json()["paths"], list)


# VDR versioning, access policy, binary download, and access audit trail.
class TestVDR:
    def test_vdr_versioning_access_and_audit(self, api_client, seeded):
        deal_id = seeded["deals"][0]["id"]
        uploaded_ids = []
        try:
            for expected_version, content in [(1, b"TEST_v1"), (2, b"TEST_v2")]:
                response = api_client.post(
                    f"{API}/documents",
                    data={"deal_id": deal_id, "folder": "/Legal", "doc_type": "Legal", "access_level": "download"},
                    files={"file": ("TEST_qa-vdr.txt", content, "text/plain")},
                    timeout=30,
                )
                assert response.status_code == 200, response.text
                doc = response.json()
                assert_document_id(doc)
                uploaded_ids.append(doc["id"])
                assert doc["version"] == expected_version
                assert doc["folder"] == "/Legal"
            document_id = uploaded_ids[-1]

            no_access = api_client.patch(
                f"{API}/documents/{document_id}/access", json={"access_level": "no-access"}, timeout=30
            )
            assert no_access.status_code == 200 and no_access.json()["access_level"] == "no-access"
            assert api_client.post(f"{API}/documents/{document_id}/view", timeout=30).status_code == 403

            view_only = api_client.patch(
                f"{API}/documents/{document_id}/access", json={"access_level": "view"}, timeout=30
            )
            assert view_only.status_code == 200
            assert api_client.post(f"{API}/documents/{document_id}/view", timeout=30).status_code == 200
            assert api_client.get(f"{API}/documents/{document_id}/download", timeout=30).status_code == 403

            download_access = api_client.patch(
                f"{API}/documents/{document_id}/access", json={"access_level": "download"}, timeout=30
            )
            assert download_access.status_code == 200
            downloaded = api_client.get(f"{API}/documents/{document_id}/download", timeout=30)
            assert downloaded.status_code == 200
            assert downloaded.content == b"TEST_v2"
            assert "TEST_qa-vdr.txt" in downloaded.headers["Content-Disposition"]

            logs = api_client.get(f"{API}/access-logs", params={"deal_id": deal_id}, timeout=30)
            assert logs.status_code == 200
            relevant = [log for log in logs.json() if log["document_id"] in uploaded_ids]
            actions = [log["action"] for log in relevant]
            assert actions.count("upload") == 2
            assert "view" in actions and "download" in actions
            assert actions.count("denied") >= 2
        finally:
            for document_id in uploaded_ids:
                api_client.delete(f"{API}/documents/{document_id}", timeout=30)


# All agent dispatch plans and persisted trace/findings validation.
class TestAgentRuns:
    @pytest.mark.parametrize("agent,subject_key", [
        ("research", "target_id"),
        ("linkedin", "target_id"),
        ("orchestrator", "target_id"),
        ("email", "contact_id"),
    ])
    def test_agent_dispatch_success(self, api_client, seeded, agent, subject_key):
        subject_id = seeded["contacts"][0]["id"] if subject_key == "contact_id" else seeded["targets"][0]["id"]
        response = api_client.post(
            f"{API}/agent-runs", json={"agent": agent, subject_key: subject_id}, timeout=30
        )
        assert response.status_code == 200, response.text
        run = response.json()
        assert_document_id(run)
        assert run["agent"] == agent and run["status"] == "success"
        assert len(run["logs"]) >= 3
        assert len(run["tools_called"]) >= 1
        assert isinstance(run["findings"], dict) and run["findings"]
        persisted = api_client.get(f"{API}/agent-runs", params={"agent": agent}, timeout=30)
        assert persisted.status_code == 200
        assert any(item["id"] == run["id"] for item in persisted.json())


# Gateway health/tool schemas and JSON-RPC 2.0 success/error envelopes.
class TestMCPGateway:
    def test_gateway_health_and_tool_listing(self, api_client):
        response = api_client.get(f"{API}/gateway/health", timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert data["gateway"] == "healthy" and data["mongo"] == "healthy"
        assert len(data["servers"]) == 7
        assert all(server["status"] == "healthy" for server in data["servers"])
        providers = {p["name"]: p["status"] for p in data["external_providers"]}
        assert providers["Apify (TED / LinkedIn / registries)"] == "stubbed"
        assert providers["Gmail API"] == "stubbed"

        tools = api_client.get(f"{API}/mcp/scoring/tools", timeout=30)
        assert tools.status_code == 200
        names = [tool["name"] for tool in tools.json()["tools"]]
        assert names == ["score_target", "explain_score"]

    def test_json_rpc_list_call_and_error_objects(self, api_client, seeded):
        listed = api_client.post(
            f"{API}/mcp/scoring",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            timeout=30,
        )
        assert listed.status_code == 200
        assert listed.json()["jsonrpc"] == "2.0" and listed.json()["id"] == 1
        assert len(listed.json()["result"]["tools"]) == 2

        called = api_client.post(
            f"{API}/mcp/scoring",
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
                "name": "score_target", "arguments": {"target_id": seeded["targets"][0]["id"]}
            }},
            timeout=30,
        )
        assert called.status_code == 200
        content = called.json()["result"]["content"][0]["json"]
        assert content["target_id"] == seeded["targets"][0]["id"]
        assert 0 <= content["composite"] <= 100

        unknown_method = api_client.post(
            f"{API}/mcp/scoring",
            json={"jsonrpc": "2.0", "id": 3, "method": "missing/method"},
            timeout=30,
        )
        assert unknown_method.status_code == 200
        assert unknown_method.json()["error"]["code"] == -32601
        assert unknown_method.json()["id"] == 3

        unknown_server = api_client.post(
            f"{API}/mcp/not-a-server",
            json={"jsonrpc": "2.0", "id": 4, "method": "tools/list"},
            timeout=30,
        )
        assert unknown_server.status_code == 200
        assert unknown_server.json()["error"]["code"] == -32601
        assert "unknown server" in unknown_server.json()["error"]["message"]



# Referential integrity and missing-resource error handling.
class TestErrorHandling:
    def test_create_deal_rejects_nonexistent_target(self, api_client):
        response = api_client.post(
            f"{API}/deals",
            json={"title": "TEST_Invalid Target Deal", "target_id": "000000000000000000000000"},
            timeout=30,
        )
        try:
            assert response.status_code in {400, 404, 422}, response.text
            assert "target" in response.text.lower()
        finally:
            if response.status_code == 200 and response.headers.get("content-type", "").startswith("application/json"):
                deal_id = response.json().get("id")
                if deal_id:
                    api_client.delete(f"{API}/deals/{deal_id}", timeout=30)

    @pytest.mark.parametrize(
        "method,path,payload",
        [
            ("patch", "/contacts/000000000000000000000000", {"role": "TEST_missing"}),
            ("patch", "/documents/000000000000000000000000/access", {"access_level": "view"}),
        ],
    )
    def test_missing_resource_updates_return_404(self, api_client, method, path, payload):
        response = getattr(api_client, method)(f"{API}{path}", json=payload, timeout=30)
        assert response.status_code == 404, response.text
        assert "not found" in response.text.lower()
