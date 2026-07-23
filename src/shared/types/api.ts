import type { ClusterMember } from './runtime';

/** POST /sync/check request */
export interface SyncCheckRequest {
  runtimeVersion: string;
  cachedMediaVersionIds?: string[];
  displayTarget?: string;
  clusterMember?: ClusterMember;
}

/** POST /sync/check response data (envelope unwrapped) */
export interface SyncCheckResponseData {
  syncJobId: string;
  device?: {
    id: string;
    rotationStartDate?: string;
    currentRotationDay?: number;
  };
  runtime?: {
    version?: string;
    fileUrl?: string;
    updateAvailable?: boolean;
  };
  deployment?: {
    deploymentType?: string;
    fieldCategory?: string;
    exerciseVariant?: string;
  };
  config?: {
    resolutionMode?: 'legacy' | 'logical' | string;
    runtimeContext?: {
      displayTarget?: string;
      clusterMember?: ClusterMember;
    };
  };
  playbackManifest?: BackendPlaybackManifest | null;
  targetManifest?: BackendTargetManifest | null;
  schedule?: Array<{ date: string; rotationDay: number }>;
  media?: SyncMediaItem[];
  requiredMedia?: SyncMediaItem[];
  evictMediaVersionIds?: string[];
  cacheWindow?: {
    days: number;
    startsAt?: string;
    expiresAt?: string;
    weekDays?: number;
    prefetchLeadDays?: number;
    mode?: string;
    inPrefetchLeadWindow?: boolean;
    currentWeekStart?: string | null;
    nextWeekStart?: string | null;
  };
  prefetchStatus?: {
    mode: string;
    inPrefetchLeadWindow: boolean;
    currentWeek: {
      weekIndex: number | null;
      startDate: string | null;
      expected: number;
      cached: number;
      complete: boolean;
    };
    nextWeek: {
      startDate: string | null;
      expected: number;
      cached: number;
      complete: boolean;
      downloading: boolean;
    };
    previousWeekHeld: boolean;
  } | null;
}

export interface SyncMediaItem {
  mediaVersionId: string;
  fileUrl: string;
  checksum?: string;
  fileSize?: string | null;
  title?: string | null;
  rotationDay?: number | null;
  /** current first, then prefetch — set by server for download priority */
  weekRole?: 'current' | 'prefetch' | 'previous' | string;
  cached?: boolean;
}

export interface PlaybackVideoItem {
  day?: number;
  order?: number;
  video?: string;
  mediaVersionId?: string;
  fileUrl?: string;
  thumbnail?: string;
  durationSeconds?: number;
  checksum?: string;
}

export interface PlaybackSlotContent {
  slot?: string;
  label?: string;
  libraryType?: string;
  categoryId?: string | null;
  isRotating?: boolean;
  items?: PlaybackVideoItem[];
  metadata?: Record<string, unknown>;
}

export interface BackendPlaybackManifest {
  deviceId?: string;
  deploymentType?: string;
  field?: string;
  variant?: string;
  rotationStartDate?: string;
  rotationDay?: number;
  branding?: {
    mode?: string;
    brandName?: string;
    logoUrl?: string;
  };
  runtimeUi?: {
    touchMode?: boolean;
    displayMode?: string;
    supportsControls?: boolean;
    uiMode?: string;
  };
  content?: {
    default?: PlaybackSlotContent;
    startHere?: PlaybackSlotContent;
    phase1?: PlaybackSlotContent;
    phase2?: PlaybackSlotContent;
    fullProgram?: PlaybackSlotContent;
    [slotKey: string]: PlaybackSlotContent | undefined;
  };
  screens?: BackendLogicalScreen[];
  targets?: Record<string, BackendTargetScreenContent>;
}

export interface BackendLogicalScreen {
  screenKey?: string;
  contentSlot?: string;
  legacySlot?: string;
  categoryId?: string | null;
  sortOrder?: number;
  slotContent?: PlaybackSlotContent;
}

/** Per-HDMI / per-output entry from TargetPlaybackManifest.targets */
export interface BackendTargetScreenContent {
  targetType?: string;
  targetKey?: string;
  screenKey?: string;
  contentSlot?: string;
  categoryId?: string | null;
  slotContent?: PlaybackSlotContent;
}

export interface BackendTargetManifest {
  resolutionSource?: string;
  hardwareProfileCode?: string | null;
  targets?: Record<string, BackendTargetScreenContent | PlaybackSlotContent>;
  screens?: BackendLogicalScreen[];
}

export interface SyncDownloadCompleteRequest {
  syncJobId: string;
  mediaVersionId: string;
  status: 'SUCCESS' | 'FAILED';
  bytesDownloaded?: string;
  durationMs?: number;
  errorMessage?: string;
}

export interface SyncDownloadProgressRequest {
  syncJobId: string;
  mediaVersionId: string;
  bytesDownloaded?: string;
  totalBytes?: string;
  phase?: 'DOWNLOADING' | 'VERIFYING';
}

export interface SyncStatusRequest {
  syncJobId: string;
  status: 'SUCCESS' | 'FAILED';
  message?: string;
}

export interface DeviceHeartbeatRequest {
  runtimeVersion?: string;
  firmwareVersion?: string;
  storageUsedBytes?: string;
  storageCapacityBytes?: string;
  playbackState?: 'IDLE' | 'MENU' | 'PLAYING' | 'PAUSED' | 'MODAL';
  currentContent?: {
    slot?: string;
    title?: string;
    mediaVersionId?: string;
    screenKey?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface DeviceCredentials {
  deviceId: string;
  apiToken: string;
}

export interface DeviceAuthContext extends DeviceCredentials {
  displayTarget?: string;
  clusterMember?: ClusterMember;
}
