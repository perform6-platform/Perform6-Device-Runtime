import { Navigate, useLocation } from 'react-router-dom';
import { isDeviceReady } from '../../stores/deviceStore';

interface RequirePairedProps {
  children: React.ReactNode;
  redirectTo?: string;
}

/** Requires injected device credentials (deviceId + apiToken) after admin registration. */
export function RequirePaired({ children, redirectTo = '/pairing' }: RequirePairedProps) {
  const location = useLocation();

  if (!isDeviceReady()) {
    return <Navigate to={redirectTo} state={{ from: location.pathname }} replace />;
  }

  return children;
}
