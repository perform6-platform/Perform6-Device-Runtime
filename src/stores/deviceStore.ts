import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeviceRegistrationStatus } from '../shared/types';

interface DeviceState {
  pairingId: string | null;
  deviceId: string | null;
  apiToken: string | null;
  pairingCode: string | null;
  registrationStatus: DeviceRegistrationStatus;
  hasCredentials: boolean;
  setPairing: (payload: {
    pairingId: string;
    pairingCode: string;
    registrationStatus: DeviceRegistrationStatus;
  }) => void;
  setRegistrationStatus: (status: DeviceRegistrationStatus) => void;
  setCredentials: (payload: { deviceId: string; apiToken: string }) => void;
  clear: () => void;
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set) => ({
      pairingId: null,
      deviceId: null,
      apiToken: null,
      pairingCode: null,
      registrationStatus: 'idle',
      hasCredentials: false,
      setPairing: ({ pairingId, pairingCode, registrationStatus }) =>
        set({ pairingId, pairingCode, registrationStatus }),
      setRegistrationStatus: (registrationStatus) => set({ registrationStatus }),
      setCredentials: ({ deviceId, apiToken }) =>
        set({
          deviceId,
          apiToken,
          hasCredentials: true,
          registrationStatus: 'registered',
        }),
      clear: () =>
        set({
          pairingId: null,
          deviceId: null,
          apiToken: null,
          pairingCode: null,
          registrationStatus: 'idle',
          hasCredentials: false,
        }),
    }),
    {
      name: 'perform6-device',
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Partial<DeviceState & { deviceId?: string | null }>;
        if (version < 2) {
          const legacyDeviceId = state.deviceId;
          const hasCreds = state.hasCredentials === true;
          if (!state.pairingId && legacyDeviceId && !hasCreds) {
            return {
              ...state,
              pairingId: legacyDeviceId,
              deviceId: null,
            } as DeviceState;
          }
        }
        return state as DeviceState;
      },
    },
  ),
);

/** Device is ready for sync/playback (credentials injected after admin register). */
export function isDeviceReady(): boolean {
  const s = useDeviceStore.getState();
  return s.hasCredentials && !!s.deviceId && !!s.apiToken;
}
