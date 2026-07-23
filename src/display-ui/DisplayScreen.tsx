import { DisplayVideoPlayer } from './DisplayVideoPlayer';

interface DisplayScreenProps {
  label: string;
  videoSrc: string | null;
  loop?: boolean;
  meta?: {
    day?: number;
    library?: string;
    rotation?: string;
  };
}

export function DisplayScreen({ label, videoSrc, loop = true, meta }: DisplayScreenProps) {
  return (
    <section className="p6-display-screen flex h-full flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-white">{label}</h3>
        {meta && (
          <div className="flex gap-3 text-[10px] uppercase tracking-wide text-slate-400">
            {meta.day != null && <span>Day {meta.day}</span>}
            {meta.library && <span>{meta.library}</span>}
            {meta.rotation && <span>{meta.rotation}</span>}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1">
        <DisplayVideoPlayer src={videoSrc} label={label} loop={loop} />
      </div>
    </section>
  );
}
