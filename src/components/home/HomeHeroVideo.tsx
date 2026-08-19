import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (paused) {
      video.pause();
      return;
    }

    video.muted = true;
    void video.play().catch(() => {});
  }, [paused, src]);

  return (
    <div
      className={`p6-home__hero${overlay === 'overview' ? ' p6-home__hero--overview' : ''}`}
      aria-hidden
    >
      {src ? (
        <video
          ref={videoRef}
          key={src}
          className="p6-home__hero-video"
          src={src}
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
