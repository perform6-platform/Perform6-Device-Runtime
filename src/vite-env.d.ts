/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_RUNTIME_MODE: string;
  readonly VITE_HARDWARE_PROFILE: string;
  readonly VITE_DEPLOYMENT_TYPE: string;
  readonly VITE_CLUSTER_MEMBER: string;
  readonly VITE_DISPLAY_TARGET: string;
  readonly VITE_SIM_SERIAL_NUMBER: string;
  readonly VITE_SIM_MODEL: string;
  readonly VITE_SIM_FIRMWARE_VERSION: string;
  readonly VITE_SIM_MAC_ADDRESS: string;
  readonly VITE_SIM_IP_ADDRESS: string;
  readonly VITE_HEARTBEAT_INTERVAL_MS: string;
  readonly VITE_SYNC_INTERVAL_MS: string;
  readonly VITE_PAIRING_POLL_MS: string;
  readonly VITE_RUNTIME_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
