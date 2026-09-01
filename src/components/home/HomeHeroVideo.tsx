import { useEffect, useRef } from 'react';
import { safeHtmlVideoSrc } from '../../services/playbackSrc';

type HomeHeroVideoProps = {
  src: string | null;
  paused?: boolean;
  /** Home ~60% vignette vs Program Overview ~80% vignette. */
  overlay?: 'home' | 'overview';
};

export function HomeHeroVideo({
  src,
  paused = false,
  overlay = 'home',
}: HomeHeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const playSrc = safeHtmlVideoSrc(src);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playSrc) return;

    if (paused) {
      video.pause();
      return;
    }

    video.muted = true;
    void video.play().catch(() => {});
  }, [paused, playSrc]);

  return (
    <div
      className={`p6-home__hero${overlay === 'overview' ? ' p6-home__hero--overview' : ''}`}
      aria-hidden
    >
      {playSrc ? (
        <video
          ref={videoRef}
          key={playSrc}
          className="p6-home__hero-video"
          src={playSrc}
          autoPlay
          muted
          loop
          playsInline
          draggable={false}
        />
      ) : null}
      <div className="p6-home__hero-fade" />
    </div>
  );
}
