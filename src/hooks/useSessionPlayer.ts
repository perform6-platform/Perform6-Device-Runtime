import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionPlayerConfig } from '../components/session/types';
import { useAutoHideControls } from './useAutoHideControls';

export function useSessionPlayer({
  open,
  onClose,
  videoSrc,
  attractMode = false,
}: SessionPlayerConfig) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const volumeBeforeMuteRef = useRef(1);
  const userUnmutedRef = useRef(false);
  const {
    visible: controlsVisible,
    reveal: onRevealControls,
    reset: resetControls,
    clearHideTimer,
  } = useAutoHideControls();

  const [paused, setPaused] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [bufferedRatio, setBufferedRatio] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const syncPlayback = useCallback((shouldPause: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    if (shouldPause) video.pause();
    else void video.play().catch(() => {});
  }, []);

  const attemptPlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      await video.play();
      return;
    } catch {
      video.muted = true;
      setMuted(true);
      try {
        await video.play();
      } catch {
        /* ignored */
      }
    }
  }, []);

  const unmuteOnGesture = useCallback(() => {
    if (attractMode || userUnmutedRef.current) return;

    userUnmutedRef.current = true;
    setMuted(false);

    const video = videoRef.current;
    if (!video) return;

    video.muted = false;
    video.volume = volumeBeforeMuteRef.current;
    setVolume(volumeBeforeMuteRef.current);
    void video.play().catch(() => {});
  }, [attractMode]);

  useEffect(() => {
    if (!open) return;

    userUnmutedRef.current = false;
    setPaused(false);
    setMuted(true);
    setVolume(1);
    volumeBeforeMuteRef.current = 1;
    resetControls();

    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      video.muted = true;
      video.volume = 1;
      void attemptPlay();
    }

    return clearHideTimer;
  }, [open, videoSrc, resetControls, clearHideTimer, attemptPlay]);

  useEffect(() => {
    if (!open) return;

    const video = videoRef.current;
    if (!video) return;

    const onCanPlay = () => {
      if (!paused) void attemptPlay();
    };

    video.addEventListener('canplay', onCanPlay);
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) onCanPlay();

    return () => video.removeEventListener('canplay', onCanPlay);
  }, [open, paused, videoSrc, attemptPlay]);

  useEffect(() => {
    syncPlayback(paused);
  }, [paused, syncPlayback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !open) return;

    const updateBuffer = () => {
      if (video.buffered.length > 0 && video.duration > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        setBufferedRatio(end / video.duration);
      }
    };

    const onLoadedMetadata = () => {
      setVideoDuration(video.duration || 0);
      updateBuffer();
    };

    const onTimeUpdate = () => {
      setVideoCurrentTime(video.currentTime);
      updateBuffer();
    };

    video.volume = volume;
    video.muted = muted;
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('durationchange', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('progress', updateBuffer);

    if (video.readyState >= 1) onLoadedMetadata();

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('durationchange', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('progress', updateBuffer);
    };
  }, [open, volume, muted, videoSrc]);

  const handleSeek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = time;
      setVideoCurrentTime(time);
      onRevealControls();
    },
    [onRevealControls],
  );

  const handleTogglePlay = useCallback(() => {
    unmuteOnGesture();
    setPaused((p) => !p);
    onRevealControls();
  }, [onRevealControls, unmuteOnGesture]);

  const handleRestart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    unmuteOnGesture();
    video.currentTime = 0;
    setVideoCurrentTime(0);
    setPaused(false);
    void video.play().catch(() => {});
    onRevealControls();
  }, [onRevealControls, unmuteOnGesture]);

  const handleClose = useCallback(() => {
    clearHideTimer();
    onClose();
  }, [clearHideTimer, onClose]);

  const handleVolumeChange = useCallback(
    (nextVolume: number) => {
      const video = videoRef.current;
      const nextMuted = nextVolume === 0;
      if (nextVolume > 0) {
        volumeBeforeMuteRef.current = nextVolume;
        userUnmutedRef.current = true;
      }
      setMuted(nextMuted);
      setVolume(nextVolume);
      if (video) {
        video.volume = nextVolume;
        video.muted = nextMuted;
      }
      onRevealControls();
    },
    [onRevealControls],
  );

  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (muted) {
      const restored = volumeBeforeMuteRef.current > 0 ? volumeBeforeMuteRef.current : 1;
      userUnmutedRef.current = true;
      setMuted(false);
      setVolume(restored);
      if (video) {
        video.muted = false;
        video.volume = restored;
      }
    } else {
      volumeBeforeMuteRef.current = volume > 0 ? volume : 1;
      setMuted(true);
      setVolume(0);
      if (video) {
        video.muted = true;
        video.volume = 0;
      }
    }
    onRevealControls();
  }, [onRevealControls, muted, volume]);

  const handleFullscreen = useCallback(() => {
    const video = videoRef.current;
    const el = video ?? playerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
    onRevealControls();
  }, [onRevealControls]);

  const handleRevealControls = useCallback(() => {
    unmuteOnGesture();
    onRevealControls();
  }, [onRevealControls, unmuteOnGesture]);

  return {
    videoRef,
    playerRef,
    paused,
    controlsVisible,
    videoCurrentTime,
    videoDuration,
    bufferedRatio,
    volume,
    muted,
    onRevealControls: handleRevealControls,
    onTogglePlay: handleTogglePlay,
    onRestart: handleRestart,
    onSeek: handleSeek,
    onVolumeChange: handleVolumeChange,
    onToggleMute: handleToggleMute,
    onFullscreen: handleFullscreen,
    onClose: handleClose,
  };
}
