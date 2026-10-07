import { useRuntimeStore } from '../../stores/runtimeStore';

function VolumeIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      {/* Figma 20×20 — vector inset ~12.5% / 22.92% / 20.83% */}
      <path
        d="M2.5 7h3.2L9.5 4.2v11.6L5.7 13H2.5V7zM13 6.2a4 4 0 010 7.6M15.5 4a6.5 6.5 0 010 12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {muted && (
        <path
          d="M3 16L17 4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function DisplayVolumeControl() {
  const displayMuted = useRuntimeStore((s) => s.displayMuted);
  const displayVolume = useRuntimeStore((s) => s.displayVolume);
  const toggleDisplayMuted = useRuntimeStore((s) => s.toggleDisplayMuted);
  const setDisplayVolume = useRuntimeStore((s) => s.setDisplayVolume);

  const sliderValue = displayMuted ? 0 : displayVolume;

  return (
    <div className="p6-video-playing-modal__volume">
      <button
        type="button"
        className="p6-video-playing-modal__volume-btn"
        onClick={toggleDisplayMuted}
        aria-label={displayMuted ? 'Unmute' : 'Mute'}
      >
        <VolumeIcon muted={displayMuted} />
      </button>
      <div className="p6-vc-bar__volume-wrap p6-video-playing-modal__volume-slider-wrap">
        <input
          type="range"
          className="p6-vc-bar__volume p6-video-playing-modal__volume-slider"
          min={0}
          max={1}
          step={0.05}
          value={sliderValue}
          style={{ ['--p6-volume' as string]: `${sliderValue * 100}%` }}
          onChange={(e) => setDisplayVolume(Number(e.target.value))}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
