import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const http = axios.create({ baseURL: API });

const unwrap = (p) => p.then((r) => r.data);

export const api = {
  overview: () => unwrap(http.get("/analytics/overview")),
  gatewayHealth: () => unwrap(http.get("/gateway/health")),

  targets: (params) => unwrap(http.get("/targets", { params })),
  target: (id) => unwrap(http.get(`/targets/${id}`)),
  createTarget: (body) => unwrap(http.post("/targets", body)),
  updateTarget: (id, body) => unwrap(http.patch(`/targets/${id}`, body)),
  deleteTarget: (id) => unwrap(http.delete(`/targets/${id}`)),
  rescore: (id) => unwrap(http.post(`/targets/${id}/score`)),

  deals: () => unwrap(http.get("/deals")),
  stages: () => unwrap(http.get("/deals/stages")),
  deal: (id) => unwrap(http.get(`/deals/${id}`)),
  createDeal: (body) => unwrap(http.post("/deals", body)),
  updateDeal: (id, body) => unwrap(http.patch(`/deals/${id}`, body)),
  addNote: (id, body) => unwrap(http.post(`/deals/${id}/activities`, body)),

  contacts: (params) => unwrap(http.get("/contacts", { params })),
  createContact: (body) => unwrap(http.post("/contacts", body)),
  enrich: (id) => unwrap(http.post(`/contacts/${id}/enrich`)),

  signals: (params) => unwrap(http.get("/signals", { params })),
  ingest: (limit = 8) => unwrap(http.post("/sourcing/ingest", null, { params: { limit } })),
  graph: () => unwrap(http.get("/sourcing/graph")),
  warmPaths: (id) => unwrap(http.get(`/sourcing/warm-paths/${id}`)),

  documents: (params) => unwrap(http.get("/documents", { params })),
  upload: (form) => unwrap(http.post("/documents", form)),
  setAccess: (id, access_level) => unwrap(http.patch(`/documents/${id}/access`, { access_level })),
  viewDoc: (id) => unwrap(http.post(`/documents/${id}/view`)),
  deleteDoc: (id) => unwrap(http.delete(`/documents/${id}`)),
  accessLogs: (params) => unwrap(http.get("/access-logs", { params })),

  runs: (params) => unwrap(http.get("/agent-runs", { params })),
  runAgent: (body) => unwrap(http.post("/agent-runs", body)),
  mcpTools: (server) => unwrap(http.get(`/mcp/${server}/tools`)),
  mcpCall: (server, name, args) =>
    unwrap(http.post(`/mcp/${server}`, {
      jsonrpc: "2.0", id: Date.now(), method: "tools/call",
      params: { name, arguments: args || {} },
    })),
};

export const eur = (v) =>
  v == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(v);

export const dt = (v) => (v ? new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
