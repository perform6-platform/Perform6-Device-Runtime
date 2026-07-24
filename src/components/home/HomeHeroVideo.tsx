import { useEffect, useRef } from 'react';

type HomeHeroVideoProps = {
  src: string | null;
  paused?: boolean;
  /** Attract / idle: full-bleed default video without menu vignette. */
  attract?: boolean;
};

export function HomeHeroVideo({ src, paused = false, attract = false }: HomeHeroVideoProps) {
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
    <div className={`p6-home__hero${attract ? ' p6-home__hero--attract' : ''}`} aria-hidden>
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
      {!attract ? (
        <>
          <div className="p6-home__hero-glow" />
          <div className="p6-home__hero-fade" />
        </>
      ) : null}
    </div>
  );
}
