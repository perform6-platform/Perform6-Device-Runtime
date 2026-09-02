import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeHeroVideo, DownloadProgressOverlay } from '../components/home';
import { useDisplayPlayback, useSync } from '../hooks/useRuntime';
import { useTouchVideos, getTouchSlotMedia } from '../hooks/useOfflineVideoSrc';
import { useTouchProgramGate } from '../hooks/useTouchProgramGate';
import { useRuntimeStore } from '../stores/runtimeStore';
import { runtimeConfig } from '../config/runtime';
import { BluefinMasterFrame } from '../layout/BluefinMasterFrame';
import type { TouchPlaybackSlot } from '../services/playback';
import {
  registerRemoteCommandExecutor,
  type DeviceRemoteCommand,
} from '../services/remoteCommandBridge';
import {
  buildTouchCurrentContent,
  setTouchUiState,
} from '../services/touchUiTelemetry';
import {
  FullProgramContent,
  GlowCard,
  Logo,
  PhaseCardContent,
  SessionModal,
  StartHereContent,
  VideoPlayingModal,
} from '../components/ui';
import { FULL_PROGRAM_ITEMS } from '../lib/fullProgram';
import { DEFAULT_VOLUME } from '../lib/displayVolumePrefs';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';
import { PHASE1_ITEMS } from '../lib/phase1';
import { PHASE2_ITEMS } from '../lib/phase2';
import {
  isTouchLoopingProgram,
  TOUCH_LOOP_SESSION_MS,
  type TouchProgramSource,
} from '../lib/touchSessionPolicy';
import type { P6Experience } from '../components/ui';

function simOnlyFallback(url: string | null | undefined): string | null {
  if (!url) return null;
  return runtimeConfig.isSimulator ? url : null;
}

const START_HERE_ITEMS = [
  {
    title: 'Learn the Perform6 System',
    description: 'Understand how the 6 Steps work together to build performance.',
  },
  {
    title: 'Identify movement limitations',
    description: 'with the pre-exercise Safety Check',
  },
  {
    title: 'Prepare your body for training',
    description: 'with the Pre-Workout foam rolling sequence',
  },
];

const OVERVIEW_IDLE_MS = 60_000;

type ActiveSession = {
  source: TouchProgramSource;
  experience: P6Experience;
  videoSrc: string;
  /** Stable token so the 45-min timer only resets on a real new session start. */
  startedAt: number;
};

const SESSION_LABEL: Record<ActiveSession['source'], string> = {
  'start-here': 'Start Here',
  phase1: 'Phase 1',
  phase2: 'Phase 2',
  'full-program': 'Full Program',
};

const SESSION_EXPERIENCE: Record<ActiveSession['source'], P6Experience> = {
  'start-here': 'start-here',
  phase1: 'phase',
  phase2: 'phase',
  'full-program': 'full-program',
};

export default function Home() {
  const { playbackState, setDisplayVideoSrc } = useDisplayPlayback();
  const { runSyncNow } = useSync();
  const resetDisplayControls = useRuntimeStore((s) => s.resetDisplayControls);
  const setDisplayVideoLoop = useRuntimeStore((s) => s.setDisplayVideoLoop);
  const setDisplayPaused = useRuntimeStore((s) => s.setDisplayPaused);
  const displayPaused = useRuntimeStore((s) => s.displayPaused);
  const setDisplayMuted = useRuntimeStore((s) => s.setDisplayMuted);
  const setDisplayVolume = useRuntimeStore((s) => s.setDisplayVolume);
  const setDisplayVideoEndedHandler = useRuntimeStore((s) => s.setDisplayVideoEndedHandler);
  const touchVideos = useTouchVideos(playbackState.manifest);
  const {
    showDownloadOverlay,
    downloadUi,
    programsReadyCount,
    programsTotalCount,
    isSlotReady,
  } = useTouchProgramGate(playbackState.manifest, runSyncNow);
  const [startHereOpen, setStartHereOpen] = useState(false);
  const [phase1Open, setPhase1Open] = useState(false);
  const [phase2Open, setPhase2Open] = useState(false);
  const [fullProgramOpen, setFullProgramOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);

  const sessionOpen = activeSession !== null;
  const modalOpen = startHereOpen || phase1Open || phase2Open || fullProgramOpen;
  const overviewOpen = modalOpen && !sessionOpen;

  const closeOverview = useCallback(() => {
    setStartHereOpen(false);
    setPhase1Open(false);
    setPhase2Open(false);
    setFullProgramOpen(false);
  }, []);

  useInactivityTimeout({
    enabled: overviewOpen,
    delayMs: OVERVIEW_IDLE_MS,
    onTimeout: closeOverview,
  });

  const returnToMainMenu = useCallback(() => {
    setActiveSession(null);
    resetDisplayControls();
    const idleMedia = getTouchSlotMedia(playbackState.manifest, 'touch-default');
    setDisplayVideoLoop(true);
    setDisplayPaused(false);
    setDisplayVideoSrc(touchVideos.idle, {
      screenKey: 'SCREEN_1',
      mediaVersionId: idleMedia.mediaVersionId,
      title: idleMedia.title,
      fallbackSrc: simOnlyFallback(idleMedia.url),
    });
  }, [
    playbackState.manifest,
    resetDisplayControls,
    setDisplayPaused,
    setDisplayVideoLoop,
    setDisplayVideoSrc,
    touchVideos.idle,
  ]);

  // Keep latest closer in a ref so timers / ended-handlers never re-subscribe on
  // sync or idle-URL changes (that previously reset the 45-min clock).
  const returnToMainMenuRef = useRef(returnToMainMenu);
  returnToMainMenuRef.current = returnToMainMenu;

  // Main menu: DEFAULT video loops on HDMI + behind touch buttons.
  useEffect(() => {
    if (sessionOpen) return;
    const idleMedia = getTouchSlotMedia(playbackState.manifest, 'touch-default');
    setDisplayVideoLoop(true);
    setDisplayPaused(false);
    setDisplayVideoSrc(touchVideos.idle, {
      screenKey: 'SCREEN_1',
      mediaVersionId: idleMedia.mediaVersionId,
      title: idleMedia.title,
      fallbackSrc: simOnlyFallback(idleMedia.url),
    });
  }, [
    sessionOpen,
    playbackState.manifest,
    setDisplayPaused,
    setDisplayVideoLoop,
    setDisplayVideoSrc,
    touchVideos.idle,
  ]);

  useEffect(() => {
    return () => setDisplayVideoSrc(null);
  }, [setDisplayVideoSrc]);

  // Touch-only: Start Here / Phase 1 / Phase 2 loop for 45 minutes, then menu.
  // Deps are only session identity — NOT returnToMainMenu (avoids sync/URL resets).
  useEffect(() => {
    if (!activeSession || !isTouchLoopingProgram(activeSession.source)) return;

    const timer = window.setTimeout(() => {
      returnToMainMenuRef.current();
    }, TOUCH_LOOP_SESSION_MS);

    return () => window.clearTimeout(timer);
  }, [activeSession?.startedAt, activeSession?.source]);

  // Touch-only: Full Program plays once — when HDMI video ends, return to menu.
  useEffect(() => {
    if (!activeSession || activeSession.source !== 'full-program') {
      setDisplayVideoEndedHandler(null);
      return;
    }

    setDisplayVideoEndedHandler(() => {
      returnToMainMenuRef.current();
    });

    return () => setDisplayVideoEndedHandler(null);
  }, [activeSession?.startedAt, activeSession?.source, setDisplayVideoEndedHandler]);

  const beginSession = (source: ActiveSession['source'], videoSrc: string | null) => {
    if (!videoSrc) return;
    const slot = source as TouchPlaybackSlot;
    const media = getTouchSlotMedia(playbackState.manifest, slot);
    const startedAt = Date.now();
    resetDisplayControls();
    // Full Program: start each session at 50% so playback is never unexpectedly loud.
    if (source === 'full-program') {
      setDisplayVolume(DEFAULT_VOLUME);
      setDisplayMuted(false);
    }
    // Looping programs: loop until 45-min timer. Full Program: single play.
    setDisplayVideoLoop(isTouchLoopingProgram(source));
    setDisplayVideoSrc(videoSrc, {
      screenKey: 'SCREEN_1',
      mediaVersionId: media.mediaVersionId,
      title: media.title ?? SESSION_LABEL[source],
      fallbackSrc: simOnlyFallback(media.url),
    });
    setActiveSession({
      source,
      experience: SESSION_EXPERIENCE[source],
      videoSrc,
      startedAt,
    });
    closeOverview();
  };

  const beginSessionRef = useRef(beginSession);
  beginSessionRef.current = beginSession;
  const touchVideosRef = useRef(touchVideos);
  touchVideosRef.current = touchVideos;

  useEffect(() => {
    if (activeSession) {
      const media = getTouchSlotMedia(playbackState.manifest, activeSession.source);
      setTouchUiState({
        playbackState: displayPaused ? 'PAUSED' : 'PLAYING',
        currentContent: buildTouchCurrentContent({
          slot: activeSession.source,
          title: media.title ?? SESSION_LABEL[activeSession.source],
          mediaVersionId: media.mediaVersionId,
          screenKey: 'SCREEN_1',
          sessionStartedAt: activeSession.startedAt,
        }),
      });
      return;
    }

    if (modalOpen) {
      let slot = 'touch-default';
      if (startHereOpen) slot = 'start-here';
      else if (phase1Open) slot = 'phase1';
      else if (phase2Open) slot = 'phase2';
      else if (fullProgramOpen) slot = 'full-program';

      const media = getTouchSlotMedia(playbackState.manifest, slot as TouchPlaybackSlot);
      setTouchUiState({
        playbackState: 'MODAL',
        currentContent: buildTouchCurrentContent({
          slot,
          title: media.title ?? SESSION_LABEL[slot as ActiveSession['source']] ?? 'Overview',
          mediaVersionId: media.mediaVersionId,
          screenKey: 'SCREEN_1',
          sessionStartedAt: null,
        }),
      });
      return;
    }

    const idleMedia = getTouchSlotMedia(playbackState.manifest, 'touch-default');
    setTouchUiState({
      playbackState: 'MENU',
      currentContent: buildTouchCurrentContent({
        slot: 'touch-default',
        title: idleMedia.title ?? 'Main menu',
        mediaVersionId: idleMedia.mediaVersionId,
        screenKey: 'SCREEN_1',
        sessionStartedAt: null,
      }),
    });
  }, [
    activeSession,
    displayPaused,
    fullProgramOpen,
    modalOpen,
    phase1Open,
    phase2Open,
    playbackState.manifest,
    startHereOpen,
  ]);

  useEffect(() => {
    return registerRemoteCommandExecutor(async (command: DeviceRemoteCommand) => {
      switch (command.action) {
        case 'PAUSE':
          setDisplayPaused(true);
          break;
        case 'PLAY':
          setDisplayPaused(false);
          break;
        case 'TOGGLE_PAUSE':
          useRuntimeStore.getState().toggleDisplayPaused();
          break;
        case 'RETURN_TO_MENU':
          returnToMainMenuRef.current();
          closeOverview();
          break;
        case 'SELECT_TOUCH_SLOT': {
          const slot = command.slot;
          if (!slot) break;
          const videos = touchVideosRef.current;
          if (slot === 'touch-default') {
            returnToMainMenuRef.current();
            closeOverview();
            break;
          }
          const videoBySlot: Record<string, string | null> = {
            'start-here': videos.startHere,
            phase1: videos.phase1,
            phase2: videos.phase2,
            'full-program': videos.fullProgram,
          };
          const videoSrc = videoBySlot[slot];
          if (!videoSrc) break;
          beginSessionRef.current(slot as ActiveSession['source'], videoSrc);
          break;
        }
        default:
          break;
      }
    });
  }, [closeOverview, setDisplayPaused]);

  const handleStartHereOpen = () => {
    if (!isSlotReady('start-here')) return;
    setPhase1Open(false);
    setPhase2Open(false);
    setFullProgramOpen(false);
    setStartHereOpen(true);
  };

  const handlePhase1Open = () => {
    if (!isSlotReady('phase1')) return;
    setStartHereOpen(false);
    setPhase2Open(false);
    setFullProgramOpen(false);
    setPhase1Open(true);
  };

  const handlePhase2Open = () => {
    if (!isSlotReady('phase2')) return;
    setStartHereOpen(false);
    setPhase1Open(false);
    setFullProgramOpen(false);
    setPhase2Open(true);
  };

  const handleFullProgramOpen = () => {
    if (!isSlotReady('full-program')) return;
    setStartHereOpen(false);
    setPhase1Open(false);
    setPhase2Open(false);
    setFullProgramOpen(true);
  };

  const home = (
    <main className={`p6-home relative h-full w-full overflow-hidden${overviewOpen || sessionOpen ? ' p6-home--dimmed' : ''}`}>
      <HomeHeroVideo
        src={touchVideos.idle}
        paused={sessionOpen}
        overlay={overviewOpen || sessionOpen ? 'overview' : 'home'}
      />

      <div className="p6-home__grid">
        <Logo className="p6-home__logo" />

        <GlowCard
          experience="start-here"
          className="p6-home__start-here"
          onClick={handleStartHereOpen}
          disabled={!isSlotReady('start-here')}
          aria-label={isSlotReady('start-here') ? 'Start Here' : 'Start Here — downloading'}
        >
          <StartHereContent
            title="Start Here"
            bullets="The 6-Step System · Safety Check · Pre-Workout"
            description="Learn the system. Check movement. Prepare for training."
            duration="5–10 Minutes"
          />
        </GlowCard>

        <div className="p6-home__divider">
          <div className="p6-home__divider-track p6-home__divider-track--left">
            <span className="p6-heading p6-home__divider-ghost" aria-hidden>
              Self-Guided
            </span>
            <span className="p6-section-divider__line" aria-hidden />
          </div>
          <span className="p6-section-divider__label">CHOOSE YOUR EXPERIENCE</span>
          <div className="p6-home__divider-track p6-home__divider-track--right">
            <span className="p6-section-divider__line" aria-hidden />
            <span className="p6-heading p6-home__divider-ghost" aria-hidden>
              Self-Guided
            </span>
          </div>
        </div>

        <div className="p6-home__col-header p6-home__col-left">
          <span className="p6-heading">Self-Guided</span>
          <span className="p6-small p6-muted">Complete individual phases</span>
        </div>

        <div className="p6-home__col-header p6-home__col-right">
          <span className="p6-heading">Guided</span>
          <span className="p6-small p6-muted">Complete the full guided session</span>
        </div>

        <GlowCard
          experience="phase"
          className="p6-home__phase1"
          onClick={handlePhase1Open}
          disabled={!isSlotReady('phase1')}
          aria-label={isSlotReady('phase1') ? 'Phase 1' : 'Phase 1 — downloading'}
        >
          <PhaseCardContent
            title="Phase 1"
            keywords="Mobility · Stability · Power"
            steps="Steps 1–3"
            description="Move Better. Build the Foundation."
            duration="15–20 Minutes"
          />
        </GlowCard>

        <GlowCard
          experience="phase"
          className="p6-home__phase2"
          onClick={handlePhase2Open}
          disabled={!isSlotReady('phase2')}
          aria-label={isSlotReady('phase2') ? 'Phase 2' : 'Phase 2 — downloading'}
        >
          <PhaseCardContent
            title="Phase 2"
            keywords="Strength · Energy · Recovery"
            steps="Steps 4–6"
            description="Get Stronger. Elevate Performance."
            duration="20–30 Minutes"
          />
        </GlowCard>

        <GlowCard
          experience="full-program"
          className="p6-home__full-program"
          onClick={handleFullProgramOpen}
          disabled={!isSlotReady('full-program')}
          aria-label={isSlotReady('full-program') ? 'Full Program' : 'Full Program — downloading'}
        >
          <FullProgramContent
            title="Full Program"
            subtitle="All 6 Steps"
            description="Experience the complete Perform6 training system."
            duration="60 Minutes"
          />
        </GlowCard>
      </div>

      <SessionModal
        open={startHereOpen}
        onClose={() => setStartHereOpen(false)}
        onBack={() => setStartHereOpen(false)}
        onPrimary={() => {
          setStartHereOpen(false);
          beginSession('start-here', touchVideos.startHere);
        }}
        title="Start Here"
        sessionDuration="5–10 Minutes"
        sectionLabel="This Session Will Help You"
        items={START_HERE_ITEMS}
        showDuration={false}
        experience="start-here"
      />

      <SessionModal
        open={fullProgramOpen}
        onClose={() => setFullProgramOpen(false)}
        onBack={() => setFullProgramOpen(false)}
        onPrimary={() => {
          setFullProgramOpen(false);
          beginSession('full-program', touchVideos.fullProgram);
        }}
        title="Full Program"
        sessionDuration="60 Minutes"
        sectionLabel="Program Outcomes"
        items={FULL_PROGRAM_ITEMS}
        showDuration={false}
        experience="full-program"
      />

      <SessionModal
        open={phase1Open}
        onClose={() => setPhase1Open(false)}
        onBack={() => setPhase1Open(false)}
        onPrimary={() => {
          setPhase1Open(false);
          beginSession('phase1', touchVideos.phase1);
        }}
        title="Phase 1"
        sessionDuration="15–20 Minutes"
        sectionLabel="This Phase Will Help You"
        items={PHASE1_ITEMS}
        showDuration={false}
        experience="phase"
      />

      <SessionModal
        open={phase2Open}
        onClose={() => setPhase2Open(false)}
        onBack={() => setPhase2Open(false)}
        onPrimary={() => {
          setPhase2Open(false);
          beginSession('phase2', touchVideos.phase2);
        }}
        title="Phase 2"
        sessionDuration="20–30 Minutes"
        sectionLabel="This Phase Will Help You"
        items={PHASE2_ITEMS}
        showDuration={false}
        experience="phase"
      />

      <VideoPlayingModal
        open={sessionOpen}
        onClose={returnToMainMenu}
        accent="blue"
        experience={activeSession?.experience ?? 'phase'}
        variant={activeSession?.source === 'full-program' ? 'full-program' : 'simple'}
        sessionLabel={activeSession ? SESSION_LABEL[activeSession.source] : undefined}
        title={activeSession ? SESSION_LABEL[activeSession.source] : undefined}
        sessionDuration={
          activeSession?.source === 'full-program'
            ? '60 Minutes'
            : activeSession?.source === 'phase1'
              ? '15–20 Minutes'
              : activeSession?.source === 'phase2'
                ? '20–30 Minutes'
                : '5–10 Minutes'
        }
        sectionLabel={
          activeSession?.source === 'full-program'
            ? 'Program Outcomes'
            : activeSession?.source === 'phase1' || activeSession?.source === 'phase2'
              ? 'This Phase Will Help You'
              : 'This Session Will Help You'
        }
        items={
          activeSession?.source === 'full-program'
            ? FULL_PROGRAM_ITEMS
            : activeSession?.source === 'phase1'
              ? PHASE1_ITEMS
              : activeSession?.source === 'phase2'
                ? PHASE2_ITEMS
                : START_HERE_ITEMS
        }
        startedAt={activeSession?.startedAt}
        totalSeconds={activeSession?.source === 'full-program' ? 3600 : 45 * 60}
      />

      {showDownloadOverlay ? (
        <DownloadProgressOverlay
          ui={downloadUi}
          programsReadyCount={programsReadyCount}
          programsTotalCount={programsTotalCount}
        />
      ) : null}
    </main>
  );

  if (runtimeConfig.isSimulator) {
    return <BluefinMasterFrame>{home}</BluefinMasterFrame>;
  }

  return home;
}
