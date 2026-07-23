import { Navigate, Route, Routes } from 'react-router-dom';
import { runtimeConfig } from './config/runtime';
import { RequirePaired } from './components/routing/RequirePaired';
import { DebugConsole } from './components/debug/DebugConsole';
import Home from './pages/Home';
import Pairing from './pages/Pairing';
import RuntimeDashboard from './pages/RuntimeDashboard';
import SimulatorLauncher from './simulator/SimulatorLauncher';
import XT2145Simulator from './simulator/XT2145Simulator';
import XC4055Simulator from './simulator/XC4055Simulator';
import HD226Simulator from './simulator/HD226Simulator';

function RootRedirect() {
  if (runtimeConfig.isSimulator) {
    return <Navigate to="/simulator" replace />;
  }
  return <Navigate to="/touch" replace />;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/pairing" element={<Pairing />} />
        <Route path="/dashboard" element={<RuntimeDashboard />} />

        {runtimeConfig.isSimulator && (
          <>
            <Route path="/simulator" element={<SimulatorLauncher />} />
            <Route
              path="/simulator/xt2145"
              element={
                <RequirePaired redirectTo="/pairing">
                  <XT2145Simulator />
                </RequirePaired>
              }
            />
            <Route
              path="/simulator/xc4055"
              element={
                <RequirePaired redirectTo="/pairing">
                  <XC4055Simulator />
                </RequirePaired>
              }
            />
            <Route
              path="/simulator/hd226/:member"
              element={
                <RequirePaired redirectTo="/pairing">
                  <HD226Simulator />
                </RequirePaired>
              }
            />
          </>
        )}

        <Route
          path="/touch"
          element={
            runtimeConfig.isSimulator ? (
              <Home />
            ) : (
              <RequirePaired redirectTo="/pairing">
                <Home />
              </RequirePaired>
            )
          }
        />

        {/* Legacy route — preserve direct access to touch UI */}
        <Route path="/home" element={<Navigate to="/touch" replace />} />
      </Routes>

      {runtimeConfig.isSimulator && <DebugConsole />}
    </>
  );
}
