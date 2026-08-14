import { Navigate, Route, Routes } from 'react-router-dom';
import { runtimeConfig } from './config/runtime';
import { getPostRegistrationRoute } from './services/runtime';
import { RequirePaired } from './components/routing/RequirePaired';
import { DebugConsole } from './components/debug/DebugConsole';
import { DeviceStatusOverlay, BootSplash } from './components/status';
import { isDeviceReady } from './stores/deviceStore';
import Home from './pages/Home';
import Pairing from './pages/Pairing';
import RuntimeDashboard from './pages/RuntimeDashboard';
import XC4055Display from './pages/display/XC4055Display';
import XT2145Display from './pages/display/XT2145Display';
import HD226Display from './pages/display/HD226Display';
import SimulatorLauncher from './simulator/SimulatorLauncher';
import XT2145Simulator from './simulator/XT2145Simulator';
import XC4055Simulator from './simulator/XC4055Simulator';
import HD226Simulator from './simulator/HD226Simulator';

function RootRedirect() {
  if (runtimeConfig.isSimulator) {
    return <Navigate to="/simulator" replace />;
  }
  // Unpaired BrightSign players always land on LCD pairing screen.
  if (!isDeviceReady()) {
    return <Navigate to="/pairing" replace />;
  }
  return <Navigate to={getPostRegistrationRoute(runtimeConfig.hardwareProfile)} replace />;
}

function Paired({ children }: { children: React.ReactNode }) {
  if (runtimeConfig.isSimulator) {
    return <>{children}</>;
  }
  return <RequirePaired redirectTo="/pairing">{children}</RequirePaired>;
}

export default function App() {
  return (
    <>
      <BootSplash />
      <DeviceStatusOverlay />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/pairing" element={<Pairing />} />
        <Route path="/dashboard" element={<RuntimeDashboard />} />

        {/* Production BrightSign display surfaces (also reachable in sim for smoke tests) */}
        <Route
          path="/display/xc4055"
          element={
            <Paired>
              <XC4055Display />
            </Paired>
          }
        />
        <Route
          path="/display/hd226"
          element={
            <Paired>
              <HD226Display />
            </Paired>
          }
        />

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
                {/* XT2145: HDMI-1 touch + HDMI-2 LED on multi-output canvas */}
                {runtimeConfig.hardwareProfile === 'XT2145' ? (
                  <XT2145Display />
                ) : (
                  <Home />
                )}
              </RequirePaired>
            )
          }
        />

        <Route path="/home" element={<Navigate to="/touch" replace />} />
        {/* Unknown paths → profile home (helps file:// / hash recovery) */}
        <Route path="*" element={<RootRedirect />} />
      </Routes>

      {runtimeConfig.isSimulator && <DebugConsole />}
    </>
  );
}
