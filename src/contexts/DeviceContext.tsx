import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { collectDeviceInfo, type MockDeviceOptions } from '../shared/mockDevice';
import type { DeviceInfo } from '../shared/types';
import { useRuntimeStore } from '../stores/runtimeStore';

interface DeviceContextValue {
  deviceInfo: DeviceInfo | null;
  loading: boolean;
  error: string | null;
  refreshDeviceInfo: (overrides?: MockDeviceOptions) => Promise<DeviceInfo>;
  updateDeviceProfile: (overrides: MockDeviceOptions) => Promise<DeviceInfo>;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const setDeviceInfo = useRuntimeStore((s) => s.setDeviceInfo);
  const pushDebugLog = useRuntimeStore((s) => s.pushDebugLog);
  const [deviceInfo, setLocalDeviceInfo] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDeviceInfo = useCallback(
    async (overrides: MockDeviceOptions = {}) => {
      setLoading(true);
      setError(null);
      try {
        const info = await collectDeviceInfo(overrides);
        setLocalDeviceInfo(info);
        setDeviceInfo(info);
        pushDebugLog({
          category: 'device',
          message: `Device info collected (${info.hardwareProfile})`,
          data: info,
        });
        return info;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to collect device info';
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [pushDebugLog, setDeviceInfo],
  );

  const updateDeviceProfile = useCallback(
    async (overrides: MockDeviceOptions) => refreshDeviceInfo(overrides),
    [refreshDeviceInfo],
  );

  const value = useMemo(
    () => ({
      deviceInfo,
      loading,
      error,
      refreshDeviceInfo,
      updateDeviceProfile,
    }),
    [deviceInfo, loading, error, refreshDeviceInfo, updateDeviceProfile],
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDeviceContext(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDeviceContext must be used within DeviceProvider');
  return ctx;
}
