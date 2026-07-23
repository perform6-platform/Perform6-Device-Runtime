import { useRuntimeStore } from '../../stores/runtimeStore';

function VolumeIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" fill="none" aria-hidden>
      <path
        d="M1 5.5h3l4-3.5v13l-4-3.5H1V5.5zM12 4.5a4.5 4.5 0 010 7M14.5 2a7.5 7.5 0 010 12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {muted && (
        <path
          d="M2 14L16 2"
          stroke="currentColor"
          strokeWidth="1.4"
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
