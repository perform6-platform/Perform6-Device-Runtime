import { Link } from 'react-router-dom';
import { DisplayScreen } from '../display-ui';
import { findScreenForTarget, getCurrentVideo } from '../services/playback';
import { useOfflineVideoSrc } from '../hooks/useOfflineVideoSrc';
import { XC4055_SCREEN_FALLBACK_LABELS } from '../shared/displayTarget';
import type { DisplayTarget } from '../shared/types';
import { useRuntime, useSync } from '../hooks/useRuntime';

const SCREEN_TARGETS: DisplayTarget[] = ['SCREEN_1', 'SCREEN_2', 'SCREEN_3'];

function SimulatorScreenPane({
  target,
  index,
  manifest,
}: {
  target: DisplayTarget;
  index: number;
  manifest: ReturnType<typeof useRuntime>['store']['playbackState']['manifest'];
}) {
  const screen = manifest ? findScreenForTarget(manifest, target) : undefined;
  const video = getCurrentVideo(screen);
  const offlineSrc = useOfflineVideoSrc(video?.id);
  // Prefer cached SD media; fall back to sync fileUrl so sim panes are not blank
  // when IndexedDB is empty but the assignment is valid.
  const videoSrc = offlineSrc ?? (video?.url ? video.url : null);
  const categoryLabel = screen?.label?.trim();
  const paneLabel = categoryLabel
    ? /^screen\s*\d/i.test(categoryLabel)
      ? categoryLabel
      : `Screen ${index + 1} — ${categoryLabel}`
    : XC4055_SCREEN_FALLBACK_LABELS[target];

  return (
    <DisplayScreen
      label={paneLabel}
      videoSrc={videoSrc}
      meta={{
        day: screen?.rotationDay ?? manifest?.deployment.currentDay,
        library: categoryLabel ?? paneLabel,
        rotation: manifest?.deployment.rotationId,
      }}
    />
  );
}

export default function XC4055Simulator() {
  const { store, deviceInfo } = useRuntime();
  const { syncState } = useSync();
  const manifest = store.playbackState.manifest;

  return (
    <main className="p6-xc4055-sim flex h-full flex-col gap-3 overflow-hidden p-3">
      <header className="flex shrink-0 items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-p6-cyan">XC4055 Simulator</p>
          <h1 className="text-lg font-bold">Three HDMI Outputs</h1>
          <p className="text-xs text-slate-500">
            {deviceInfo?.serialNumber} · Phase: {syncState.runtimePhase}
            {manifest ? ` · Day ${manifest.deployment.currentDay}` : ''}
          </p>
        </div>
        <Link to="/dashboard" className="text-xs text-slate-400 underline">
          Dashboard
        </Link>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        {SCREEN_TARGETS.map((target, index) => (
          <SimulatorScreenPane
            key={target}
            target={target}
            index={index}
            manifest={manifest}
          />
        ))}
      </div>
    </main>
  );
}
