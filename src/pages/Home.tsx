import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeHeroVideo } from '../components/home';
import { useDisplayPlayback } from '../hooks/useRuntime';
import { useTouchVideos, getTouchSlotMedia } from '../hooks/useOfflineVideoSrc';
import { useRuntimeStore } from '../stores/runtimeStore';
import type { TouchPlaybackSlot } from '../services/playback';
import {
  CardThumbnail,
  FullProgramContent,
  GlowCard,
  Logo,
  PhaseCardContent,
  SectionDivider,
  SessionModal,
  StartHereContent,
  TouchHint,
  VideoPlayingModal,
} from '../components/ui';
import { FULL_PROGRAM_ITEMS } from '../lib/fullProgram';
import { useHomeIdle } from '../hooks/useHomeIdle';
import { PHASE1_ITEMS } from '../lib/phase1';
import { PHASE2_ITEMS } from '../lib/phase2';
import {
  isTouchLoopingProgram,
  TOUCH_LOOP_SESSION_MS,
  type TouchProgramSource,
} from '../lib/touchSessionPolicy';
import type { P6Accent } from '../components/ui';

const IMAGES = {
  phase1: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&q=80&auto=format&fit=crop',
  phase2: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80&auto=format&fit=crop',
  fullProgram: 'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=700&q=80&auto=format&fit=crop',
};

const START_HERE_ITEMS = [
  'Learn the Perform6 system',
  'Complete the Safety Check',
  'Prepare your body for training',
];

const HOME_IDLE_DELAY_MS = 30000;

type ActiveSession = {
  source: TouchProgramSource;
  accent: P6Accent;
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

const SESSION_ACCENT: Record<ActiveSession['source'], P6Accent> = {
  'start-here': 'cyan',
  phase1: 'cyan',
  phase2: 'purple',
  'full-program': 'gold',
};

export default function Home() {
  const { playbackState, setDisplayVideoSrc } = useDisplayPlayback();
  const resetDisplayControls = useRuntimeStore((s) => s.resetDisplayControls);
  const setDisplayVideoLoop = useRuntimeStore((s) => s.setDisplayVideoLoop);
  const setDisplayPaused = useRuntimeStore((s) => s.setDisplayPaused);
  const setDisplayVideoEndedHandler = useRuntimeStore((s) => s.setDisplayVideoEndedHandler);
  const touchVideos = useTouchVideos(playbackState.manifest);
  const [startHereOpen, setStartHereOpen] = useState(false);
  const [phase1Open, setPhase1Open] = useState(false);
  const [phase2Open, setPhase2Open] = useState(false);
  const [fullProgramOpen, setFullProgramOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);

  const sessionOpen = activeSession !== null;
  const modalOpen = startHereOpen || phase1Open || phase2Open || fullProgramOpen;

  const idle = useHomeIdle({
    delayMs: HOME_IDLE_DELAY_MS,
    blocked: modalOpen || sessionOpen,
  });

  /** No touch for 30s → hide menu buttons; default video fills touch + display. */
  const attractMode = idle.isOpen && !sessionOpen;

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
    idle.close();
    resetDisplayControls();
    const slot = source as TouchPlaybackSlot;
    const media = getTouchSlotMedia(playbackState.manifest, slot);
    // Looping programs: loop until 45-min timer. Full Program: single play.
    setDisplayVideoLoop(isTouchLoopingProgram(source));
    setDisplayVideoSrc(videoSrc, {
      screenKey: 'SCREEN_1',
      mediaVersionId: media.mediaVersionId,
      title: media.title ?? SESSION_LABEL[source],
    });
    setActiveSession({
      source,
      accent: SESSION_ACCENT[source],
      videoSrc,
      startedAt: Date.now(),
    });
  };

  const handleStartHereOpen = () => {
    idle.close();
    setPhase1Open(false);
    setPhase2Open(false);
    setFullProgramOpen(false);
    setStartHereOpen(true);
  };

  const handlePhase1Open = () => {
    idle.close();
    setStartHereOpen(false);
    setPhase2Open(false);
    setFullProgramOpen(false);
    setPhase1Open(true);
  };

  const handlePhase2Open = () => {
    idle.close();
    setStartHereOpen(false);
    setPhase1Open(false);
    setFullProgramOpen(false);
    setPhase2Open(true);
  };

  const handleFullProgramOpen = () => {
    idle.close();
    setStartHereOpen(false);
    setPhase1Open(false);
    setPhase2Open(false);
    setFullProgramOpen(true);
  };

  return (
    <main
      className={`p6-home relative h-full w-full overflow-hidden${attractMode ? ' p6-home--attract' : ''}`}
      onPointerDown={idle.onActivity}
    >
      <HomeHeroVideo src={touchVideos.idle} paused={sessionOpen} attract={attractMode} />

      <div className="p6-home__grid" aria-hidden={attractMode}>
        <Logo className="p6-home__logo" />

        <GlowCard
          variant="blue"
          className="p6-home__start-here"
          onClick={handleStartHereOpen}
        >
          <StartHereContent
            title="Start Here"
            bullets="The 6-Step System • Safety Check • Prep"
            description="Learn the system. Check movement. Prepare for performance."
            duration="UP TO 45 MIN"
          />
        </GlowCard>

        <SectionDivider className="p6-home__divider">Choose Your Mode</SectionDivider>

        <GlowCard variant="cyan" className="p6-home__phase1" onClick={handlePhase1Open}>
          <PhaseCardContent
            title="Phase 1"
            keywords="Mobility • Stability • Power"
            description="Foundation Training"
            duration="UP TO 45 MIN"
            variant="cyan"
            thumbnail={
              <CardThumbnail
                src={IMAGES.phase1}
                alt="Phase 1"
                className="aspect-[13/11] h-full w-[4.75rem] sm:w-[5.5rem] md:w-[6.5rem]"
              />
            }
          />
        </GlowCard>

        <GlowCard variant="purple" className="p6-home__phase2" onClick={handlePhase2Open}>
          <PhaseCardContent
            title="Phase 2"
            keywords="Strength • Energy • Recovery"
            description="Performance Training"
            duration="UP TO 45 MIN"
            variant="purple"
            thumbnail={
              <CardThumbnail
                src={IMAGES.phase2}
                alt="Phase 2"
                className="aspect-[13/11] h-full w-[4.75rem] sm:w-[5.5rem] md:w-[6.5rem]"
              />
            }
          />
        </GlowCard>

        <GlowCard variant="gold" className="p6-home__full-program" onClick={handleFullProgramOpen}>
          <FullProgramContent
            title="Full Program"
            subtitle="All 6 Steps"
            description="Complete Guided Training"
            duration="PLAY ONCE"
            image={
              <img
                src={IMAGES.fullProgram}
                alt=""
                className="h-full w-full object-cover object-center"
                draggable={false}
              />
            }
          />
        </GlowCard>

        <TouchHint className="p6-home__touch-hint" />
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
        items={START_HERE_ITEMS}
        duration="Loops up to 45 minutes, then returns to menu"
        accent="blue"
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
        items={FULL_PROGRAM_ITEMS}
        duration="Plays once, then returns to menu"
        accent="blue"
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
        items={PHASE1_ITEMS}
        duration="Loops up to 45 minutes, then returns to menu"
        accent="cyan"
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
        items={PHASE2_ITEMS}
        duration="Loops up to 45 minutes, then returns to menu"
        accent="purple"
      />

      <VideoPlayingModal
        open={sessionOpen}
        onClose={returnToMainMenu}
        accent={activeSession?.accent ?? 'cyan'}
        variant={activeSession?.source === 'full-program' ? 'full-program' : 'simple'}
        sessionLabel={activeSession ? SESSION_LABEL[activeSession.source] : undefined}
      />
    </main>
  );
}
