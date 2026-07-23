import { Link } from 'react-router-dom';
import Home from '../pages/Home';
import { DisplayScreen } from '../display-ui';
import { useDisplayPlayback, useRuntime } from '../hooks/useRuntime';
import { useTouchVideos } from '../hooks/useOfflineVideoSrc';
import { useRuntimeStore } from '../stores/runtimeStore';

export default function XT2145Simulator() {
  const { displayVideoSrc, playbackState } = useDisplayPlayback();
  const displayVideoLoop = useRuntimeStore((s) => s.displayVideoLoop);
  const { deviceInfo } = useRuntime();
  const manifest = playbackState.manifest;
  const touchVideos = useTouchVideos(manifest);
  const idleVideo = touchVideos.idle;
  // HDMI mirrors touch: session video while playing, otherwise DEFAULT ambient loop.
  const externalSrc = displayVideoSrc ?? idleVideo;

  return (
    <div className="p6-xt2145-sim flex h-full flex-col lg:flex-row">
      <div className="relative min-h-0 flex-[3] overflow-hidden border-b border-slate-800 lg:border-b-0 lg:border-r">
        <div className="absolute left-2 top-2 z-20 rounded bg-black/70 px-2 py-1 text-[10px] uppercase tracking-wide text-p6-cyan">
          Touch Screen · {deviceInfo?.model ?? 'XT2145'}
        </div>
        <Home />
      </div>

      <aside className="flex min-h-[28vh] flex-[2] flex-col bg-slate-950 p-3 lg:min-h-0">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-300">
            External Display (Simulated)
          </h2>
          <Link to="/dashboard" className="text-[10px] text-slate-500 underline">
            Dashboard
          </Link>
        </div>
        <div className="min-h-0 flex-1">
          <DisplayScreen
            label="HDMI Out"
            videoSrc={externalSrc}
            loop={displayVideoLoop}
            meta={{
              day: manifest?.deployment.currentDay,
              library: manifest?.deployment.libraryName,
            }}
          />
        </div>
      </aside>
    </div>
  );
}
