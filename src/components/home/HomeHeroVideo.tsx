import { useEffect, useRef, useState } from 'react';
import { safeHtmlVideoSrc } from '../../services/playbackSrc';
import { useVideoPlaybackTelemetry } from '../../hooks/useVideoPlaybackTelemetry';
import { htmlPlaybackEncryption } from '../../services/mediaEncryption';

type HomeHeroVideoProps = {
  src: string | null;
  paused?: boolean;
  /** Home ~60% vignette vs Program Overview ~80% vignette. */
  overlay?: 'home' | 'overview';
  mediaVersionId?: string | null;
  mediaTitle?: string | null;
};

export function HomeHeroVideo({
  src,
  paused = false,
  overlay = 'home',
  mediaVersionId = null,
  mediaTitle = null,
}: HomeHeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [, refreshEncryption] = useState(0);

  const playSrc = safeHtmlVideoSrc(src);
  const encryption = htmlPlaybackEncryption(mediaVersionId);

  useEffect(() => {
    const refreshForMedia = (event: Event) => {
      const detail = (event as CustomEvent<{ mediaVersionId?: string }>).detail;
      if (detail?.mediaVersionId === mediaVersionId) {
        refreshEncryption((value) => value + 1);
      }
    };
    window.addEventListener('perform6-encryption-key-staged', refreshForMedia);
    window.addEventListener('perform6-encrypted-media-ready', refreshForMedia);
    return () => {
      window.removeEventListener('perform6-encryption-key-staged', refreshForMedia);
      window.removeEventListener('perform6-encrypted-media-ready', refreshForMedia);
    };
  }, [mediaVersionId]);

  useVideoPlaybackTelemetry(
    videoRef,
    {
      screenKey: 'SCREEN_1',
      mediaVersionId,
      title: mediaTitle,
    },
    Boolean(playSrc),
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playSrc) return;

    // BrightSign requires these attributes before src is assigned. The value
    // remains in process/DOM memory only and is removed whenever the source is
    // replaced or this surface unmounts.
    video.removeAttribute('src');
    if (encryption) {
      video.setAttribute('EncryptionAlgorithm', encryption.algorithm);
      video.setAttribute('EncryptionKey', encryption.keyAndIvHex);
    } else {
      video.removeAttribute('EncryptionAlgorithm');
      video.removeAttribute('EncryptionKey');
    }
    video.src = playSrc;
    video.load();

    if (paused) {
      video.pause();
    } else {
      video.muted = true;
      void video.play().catch(() => {});
    }

    return () => {
      video.pause();
      video.removeAttribute('src');
      video.removeAttribute('EncryptionAlgorithm');
      video.removeAttribute('EncryptionKey');
      video.load();
    };
  }, [encryption?.algorithm, encryption?.keyAndIvHex, paused, playSrc]);

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
