import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Targets from "@/pages/Targets";
import TargetDetail from "@/pages/TargetDetail";
import Pipeline from "@/pages/Pipeline";
import DealDetail from "@/pages/DealDetail";
import Contacts from "@/pages/Contacts";
import Signals from "@/pages/Signals";
import SourcingGraph from "@/pages/SourcingGraph";
import VDR from "@/pages/VDR";
import AgentRuns from "@/pages/AgentRuns";
import Gateway from "@/pages/Gateway";

function App() {
  return (
    <div className="App grain">
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/targets" element={<Targets />} />
            <Route path="/targets/:id" element={<TargetDetail />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/deals/:id" element={<DealDetail />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/graph" element={<SourcingGraph />} />
            <Route path="/vdr" element={<VDR />} />
            <Route path="/agents" element={<AgentRuns />} />
            <Route path="/gateway" element={<Gateway />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" theme="dark" />
    </div>
  );
}

export default App;
