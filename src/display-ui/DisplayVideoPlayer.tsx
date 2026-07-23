import { useEffect, useRef } from 'react';
import { useRuntimeStore } from '../stores/runtimeStore';

interface DisplayVideoPlayerProps {
  src: string | null;
  label?: string;
  loop?: boolean;
  className?: string;
}

export function DisplayVideoPlayer({
  src,
  label,
  loop: loopProp,
  className = '',
}: DisplayVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const paused = useRuntimeStore((s) => s.displayPaused);
  const muted = useRuntimeStore((s) => s.displayMuted);
  const volume = useRuntimeStore((s) => s.displayVolume);
  const restartNonce = useRuntimeStore((s) => s.displayRestartNonce);
  const storeLoop = useRuntimeStore((s) => s.displayVideoLoop);
  const setDisplayPaused = useRuntimeStore((s) => s.setDisplayPaused);
  const loop = loopProp ?? storeLoop;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (paused) video.pause();
    else void video.play().catch(() => {});
  }, [paused, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = muted;
    video.volume = volume;
  }, [muted, volume, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    if (!paused) void video.play().catch(() => {});
  }, [restartNonce, paused, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loop) return;

    const onEnded = () => {
      video.pause();
      setDisplayPaused(true);
    };

    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [loop, setDisplayPaused, src]);

  return (
    <div className={`p6-display-player relative h-full min-h-[12rem] overflow-hidden bg-black ${className}`}>
      {label && (
        <div className="absolute left-2 top-2 z-10 rounded bg-black/60 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          {label}
        </div>
      )}
      {src ? (
        <video
          ref={videoRef}
          key={src}
          src={src}
          className="h-full w-full object-cover"
          autoPlay
          muted={muted}
          loop={loop}
          playsInline
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-sm text-slate-500">
          <span>No playable video</span>
          <span className="text-xs text-slate-600">
            Assignment missing, or media not cached yet — Sync Now
          </span>
        </div>
      )}
    </div>
  );
}
