import type { RefObject } from 'react';
import { cn } from '../../lib/cn';
import { VideoControlBar } from '../ui/VideoControlBar';
import type { P6Accent } from '../ui/types';
import { safeHtmlVideoSrc } from '../../services/playbackSrc';

export type SessionPlayerViewProps = {
  videoRef: RefObject<HTMLVideoElement>;
  playerRef: RefObject<HTMLDivElement>;
  videoSrc: string;
  attractMode?: boolean;
  title?: string;
  accent?: P6Accent;
  className?: string;
  controlVariant?: 'full' | 'minimal' | 'program';
  paused: boolean;
  controlsVisible: boolean;
  videoCurrentTime: number;
  videoDuration: number;
  bufferedRatio: number;
  volume: number;
  muted: boolean;
  onClose: () => void;
  onRevealControls: () => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onFullscreen: () => void;
  onRestart: () => void;
};

export function SessionPlayerView({
  videoRef,
  playerRef,
  videoSrc,
  attractMode = false,
  title = 'Perform6',
  accent = 'cyan',
  className,
  controlVariant = 'full',
  paused,
  controlsVisible,
  videoCurrentTime,
  videoDuration,
  bufferedRatio,
  volume,
  muted,
  onClose,
  onRevealControls,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onFullscreen,
  onRestart,
}: SessionPlayerViewProps) {
  const playSrc = safeHtmlVideoSrc(videoSrc);

  return (
    <div className="p6-session-player-overlay">
      <div
        ref={playerRef}
        className={cn(
          'p6-session-player',
          `p6-session-player--${accent}`,
          attractMode && 'p6-session-player--attract',
          !controlsVisible && 'p6-session-player--controls-hidden',
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={attractMode ? 'Attract video' : title}
      >
        <div className="p6-session-player__video-wrap">
          <video
            ref={videoRef}
            key={playSrc ?? videoSrc}
            className="p6-session-player__video"
            src={playSrc ?? undefined}
            playsInline
            autoPlay
            muted={muted}
            preload="auto"
            loop={attractMode || controlVariant === 'minimal'}
          />
          <div className="p6-session-player__video-shade" aria-hidden />
        </div>

        <button
          type="button"
          className="p6-session-player__tap-catcher"
          aria-label={attractMode ? 'Return to home' : 'Show controls'}
          onPointerDown={attractMode ? onClose : onRevealControls}
        />

        <VideoControlBar
          visible={controlsVisible}
          variant={controlVariant}
          currentTime={videoCurrentTime}
          duration={videoDuration}
          bufferedRatio={bufferedRatio}
          paused={paused}
          volume={volume}
          muted={muted}
          onTogglePlay={onTogglePlay}
          onSeek={onSeek}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
          onFullscreen={onFullscreen}
          onReturnToMenu={onClose}
          onRestart={onRestart}
          onInteract={onRevealControls}
        />
      </div>
    </div>
  );
}
