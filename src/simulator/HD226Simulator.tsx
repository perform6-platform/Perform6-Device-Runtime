import { Link, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { DisplayScreen } from '../display-ui';
import { findScreenForClusterMember, getCurrentVideo } from '../services/playback';
import { useOfflineVideoSrc } from '../hooks/useOfflineVideoSrc';
import type { ClusterMember } from '../shared/types';
import { useRuntime } from '../hooks/useRuntime';
import { CLUSTER_MEMBERS } from '../config/runtime';

const ALL_MEMBERS: ClusterMember[] = [...CLUSTER_MEMBERS];

function parseMember(raw?: string): ClusterMember {
  const normalized = raw?.toUpperCase().replace('-', '_') as ClusterMember | undefined;
  if (normalized && ALL_MEMBERS.includes(normalized)) {
    return normalized;
  }
  return 'DEVICE_A';
}

export default function HD226Simulator() {
  const { member = 'device_a' } = useParams();
  const activeMember = parseMember(member);
  const { store } = useRuntime();
  const manifest = store.playbackState.manifest;

  const deployedMembers = useMemo(() => {
    if (!manifest?.screens?.length) return ALL_MEMBERS.slice(0, 1);
    const fromManifest = ALL_MEMBERS.filter((m) =>
      Boolean(findScreenForClusterMember(manifest, m)),
    );
    return fromManifest.length > 0 ? fromManifest : ALL_MEMBERS.slice(0, 1);
  }, [manifest]);

  const screen = manifest
    ? findScreenForClusterMember(manifest, activeMember)
    : undefined;
  const video = getCurrentVideo(screen);
  const offlineSrc = useOfflineVideoSrc(video?.id);
  // Prefer cached SD media; fall back to resolved fileUrl from the sync manifest.
  const videoSrc = offlineSrc ?? (video?.url ? video.url : null);

  const hasVideo = Boolean(videoSrc);
  const memberInDeployment = deployedMembers.includes(activeMember);

  return (
    <main className="p6-hd226-sim flex h-full flex-col gap-3 p-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-p6-cyan">HD226 Simulator</p>
          <h1 className="text-lg font-bold">Cluster Member · {activeMember}</h1>
          <p className="text-xs text-slate-500">
            {memberInDeployment
              ? `${deployedMembers.length} player(s) in this deployment — switch tabs to preview each screen`
              : 'This member is not in the current deployment manifest'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {deployedMembers.map((m) => {
            const memberScreen = manifest
              ? findScreenForClusterMember(manifest, m)
              : undefined;
            const memberVideo = getCurrentVideo(memberScreen);
            const ready = Boolean(memberVideo?.id || memberVideo?.url);
            return (
              <Link
                key={m}
                to={`/simulator/hd226/${m.toLowerCase()}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  m === activeMember
                    ? 'bg-p6-cyan text-black'
                    : ready
                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      : 'bg-slate-900 text-slate-500 hover:bg-slate-800'
                }`}
                title={
                  ready
                    ? memberScreen?.label ?? m
                    : `${m} — no video in manifest yet (re-sync)`
                }
              >
                {m.replace('DEVICE_', '')}
                {!ready && m !== activeMember ? ' · —' : ''}
              </Link>
            );
          })}
          <Link to="/dashboard" className="self-center text-xs text-slate-400 underline">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {hasVideo ? (
          <DisplayScreen
            label={screen?.label ?? activeMember}
            videoSrc={videoSrc}
            meta={{
              day: screen?.rotationDay ?? manifest?.deployment.currentDay,
              library: screen?.label ?? manifest?.deployment.libraryName,
            }}
          />
        ) : (
          <section className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-950 p-8 text-center">
            <p className="text-sm font-semibold text-slate-300">
              No video for {activeMember}
            </p>
            <p className="max-w-md text-xs text-slate-500">
              {manifest
                ? 'This cluster member has no playable media in the synced manifest. Open Device Status and Sync Now, then return here.'
                : 'Manifest not loaded yet. Complete pairing/registration and sync first.'}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
