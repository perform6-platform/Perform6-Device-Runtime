import { CLUSTER_MEMBERS } from '../config/runtime';
import type { ClusterMember, DeviceRegistrationStatus } from '../shared/types';

const HD_PAIRING_SESSION_KEY = 'perform6-hd-pairing-session';

export interface HdPairingSessionEntry {
  clusterMember: ClusterMember;
  pairingId: string;
  pairingCode: string;
  serialNumber: string;
  registrationStatus: DeviceRegistrationStatus;
  updatedAt: string;
}

export interface HdPairingSession {
  entries: HdPairingSessionEntry[];
}

function emptySession(): HdPairingSession {
  return { entries: [] };
}

export function loadHdPairingSession(): HdPairingSession {
  try {
    const raw = sessionStorage.getItem(HD_PAIRING_SESSION_KEY);
    if (!raw) return emptySession();
    const parsed = JSON.parse(raw) as HdPairingSession;
    if (!Array.isArray(parsed?.entries)) return emptySession();
    return { entries: parsed.entries };
  } catch {
    return emptySession();
  }
}

export function clearHdPairingSession(): void {
  try {
    sessionStorage.removeItem(HD_PAIRING_SESSION_KEY);
  } catch {
    // ignore
  }
}

function saveHdPairingSession(session: HdPairingSession): void {
  sessionStorage.setItem(HD_PAIRING_SESSION_KEY, JSON.stringify(session));
}

/** Upsert the current on-screen HD pairing into the simulator session list. */
export function upsertHdPairingSessionEntry(
  entry: Omit<HdPairingSessionEntry, 'updatedAt'>,
): HdPairingSession {
  const session = loadHdPairingSession();
  const nextEntry: HdPairingSessionEntry = {
    ...entry,
    updatedAt: new Date().toISOString(),
  };
  const index = session.entries.findIndex(
    (item) => item.clusterMember === entry.clusterMember,
  );
  if (index >= 0) {
    session.entries[index] = nextEntry;
  } else {
    session.entries.push(nextEntry);
  }
  session.entries.sort(
    (a, b) =>
      CLUSTER_MEMBERS.indexOf(a.clusterMember) - CLUSTER_MEMBERS.indexOf(b.clusterMember),
  );
  saveHdPairingSession(session);
  return session;
}

export function listUsedHdClusterMembers(session = loadHdPairingSession()): ClusterMember[] {
  return session.entries.map((entry) => entry.clusterMember);
}

/** Next unused DEVICE_* slot (A→J), optionally skipping `current`. */
export function resolveNextHdClusterMember(
  current?: ClusterMember | null,
  session = loadHdPairingSession(),
): ClusterMember | null {
  const used = new Set(listUsedHdClusterMembers(session));
  if (current) used.add(current);

  for (const member of CLUSTER_MEMBERS) {
    if (!used.has(member)) return member;
  }
  return null;
}

export function hdClusterMemberRoute(member: ClusterMember): string {
  return `/simulator/hd226/${member.toLowerCase()}`;
}

export function clusterMemberShortLabel(member: ClusterMember): string {
  return member.replace('DEVICE_', 'Player ');
}
