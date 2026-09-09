/**
 * Autorun-side blindspot probe + debug session f6ed41 hang classifier.
 * Reads SD canaries written by autorun boot steps; uploads via console (Admin)
 * and best-effort POST to local debug ingest (sim / USB-host only).
 */
import { getBrightSignRequire, getNodeFs, toNodeSdPath } from '../platform/brightSignNode';
import { subscribeBsMessages, getBridgeTransport } from '../platform/bsMessagePort';
import { runtimeConfig } from '../config/runtime';

const PROBE_INTERVAL_MS = 10_000;
const DEBUG_SESSION = 'f6ed41';
const DEBUG_INGEST =
  'http://127.0.0.1:7707/ingest/be63a13d-3cf4-409d-8cdd-18a262ff1565';

let started = false;
let inboundSeen = 0;
let lastInboundType = '';
let lastInboundAt = 0;
let probeCount = 0;

function describeMessagePortModule(): Record<string, unknown> {
  const req = getBrightSignRequire();
  if (!req) return { require: false };
  try {
    const mod = req('@brightsign/messageport') as unknown;
    const t = typeof mod;
    const keys =
      mod && (t === 'object' || t === 'function')
        ? Object.getOwnPropertyNames(mod as object).slice(0, 20)
        : [];
    let ctorProbe = 'n/a';
    try {
      const Ctor =
        t === 'function'
          ? (mod as new () => Record<string, unknown>)
          : ((mod as { MessagePort?: new () => Record<string, unknown> }).MessagePort ??
            (mod as { default?: new () => Record<string, unknown> }).default);
      if (typeof Ctor === 'function') {
        const inst = new Ctor();
        ctorProbe = Object.getOwnPropertyNames(
          Object.getPrototypeOf(inst) ?? {},
        )
          .concat(Object.getOwnPropertyNames(inst))
          .slice(0, 25)
          .join(',');
      }
    } catch (e) {
      ctorProbe = `construct threw: ${String(e)}`;
    }
    return { require: true, type: t, keys, ctorProbe };
  } catch (e) {
    return { require: true, error: String(e) };
  }
}

function readFileProbe(sdPath: string, tailChars = 0): Record<string, unknown> {
  const fs = getNodeFs();
  if (!fs) return { fs: false };
  const nodePath = toNodeSdPath(sdPath);
  try {
    if (!fs.existsSync(nodePath)) return { exists: false, path: nodePath };
    const stat = fs.statSync(nodePath);
    const out: Record<string, unknown> = {
      exists: true,
      path: nodePath,
      bytes: stat.size,
    };
    if (tailChars > 0 && stat.size > 0) {
      const raw = fs.readFileSync(nodePath, 'utf8');
      const text = typeof raw === 'string' ? raw : String(raw);
      out.tail = text.slice(-tailChars);
      out.full = text.slice(0, 4000);
    }
    return out;
  } catch (e) {
    return { error: String(e), path: nodePath };
  }
}

function sdWritePersistProbe(): Record<string, unknown> {
  const fs = getNodeFs();
  if (!fs) return { fs: false };
  const nodePath = toNodeSdPath('SD:/perform6-jsdiag.json');
  const stamp = Date.now();
  try {
    fs.writeFileSync(nodePath, JSON.stringify({ stamp }), 'utf8');
    const raw = fs.readFileSync(nodePath, 'utf8');
    const back = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as {
      stamp?: number;
    };
    return { wrote: true, readBack: back.stamp === stamp };
  } catch (e) {
    return { wrote: false, error: String(e) };
  }
}

function dirCountProbe(sdPath: string): Record<string, unknown> {
  const fs = getNodeFs();
  if (!fs) return { fs: false };
  const nodePath = toNodeSdPath(sdPath);
  try {
    if (!fs.existsSync(nodePath)) return { exists: false };
    const entries = fs.readdirSync(nodePath) as string[];
    return { exists: true, count: entries.length, sample: entries.slice(0, 8) };
  } catch (e) {
    return { error: String(e) };
  }
}

function textOf(probe: Record<string, unknown>): string {
  const full = probe.full;
  const tail = probe.tail;
  if (typeof full === 'string' && full.length) return full;
  if (typeof tail === 'string') return tail;
  return '';
}

/** Map SD breadcrumbs → which hang hypothesis is live. */
function classifyHang(opts: {
  bootCanary: string;
  heartbeatExists: boolean;
  heartbeatText: string;
  debugTrail: string;
  ledLogTail: string;
  playfileExists: boolean;
  statusExists: boolean;
  inboundSeen: number;
}): {
  hypothesisId: string;
  status: 'CONFIRMED' | 'LIKELY' | 'REJECTED' | 'INCONCLUSIVE';
  detail: string;
}[] {
  const boot = opts.bootCanary.trim();
  const trail = opts.debugTrail;
  const led = opts.ledLogTail;
  const out: {
    hypothesisId: string;
    status: 'CONFIRMED' | 'LIKELY' | 'REJECTED' | 'INCONCLUSIVE';
    detail: string;
  }[] = [];

  // H2: old autorun still on card (never writes boot-step / debug trail)
  const hasNewSteps =
    boot.startsWith('after-') ||
    boot.startsWith('before-') ||
    boot.startsWith('loop-') ||
    boot.startsWith('boot-resume') ||
    boot.startsWith('playfile') ||
    trail.includes('after-idle-led');
  if (!hasNewSteps && (boot.startsWith('boot-reached') || boot === '')) {
    out.push({
      hypothesisId: 'H2',
      status: 'LIKELY',
      detail:
        'boot canary still boot-reached / no debug trail — new instrumented autorun.brs may not be on SD',
    });
  } else {
    out.push({
      hypothesisId: 'H2',
      status: 'REJECTED',
      detail: `new boot-step canary present: ${boot.slice(0, 80)}`,
    });
  }

  // H1: hang between idle and workers/ops/loop
  if (trail.includes('loop-enter') || trail.includes('loop-tick-0')) {
    out.push({
      hypothesisId: 'H1',
      status: 'REJECTED',
      detail: 'reached loop-enter — pre-loop hang fixed or not present',
    });
  } else if (
    trail.includes('after-idle-led') &&
    !trail.includes('xt-boot-block-done') &&
    !trail.includes('xc-boot-block-done')
  ) {
    out.push({
      hypothesisId: 'H1',
      status: 'CONFIRMED',
      detail: 'stopped after idle before boot-block-done',
    });
  } else if (
    trail.includes('deferred-workers-enter') &&
    !trail.includes('deferred-workers-done')
  ) {
    out.push({
      hypothesisId: 'H1',
      status: 'CONFIRMED',
      detail: 'hung inside deferred EnsureDeferredWorkers (loop should still heartbeat)',
    });
  } else if (led.includes('LED led idle') && !hasNewSteps && !opts.heartbeatExists) {
    out.push({
      hypothesisId: 'H1',
      status: 'LIKELY',
      detail: 'led.log ends at idle; no heartbeat (pre-instrument hang pattern)',
    });
  } else {
    out.push({
      hypothesisId: 'H1',
      status: 'INCONCLUSIVE',
      detail: 'idle→loop path not fully classified',
    });
  }

  // H5: hang on heartbeat/flush after idle (ReadAsciiFile led.log)
  if (opts.heartbeatExists && (trail.includes('loop-enter') || trail.includes('loop-tick'))) {
    out.push({
      hypothesisId: 'H5',
      status: 'REJECTED',
      detail: 'heartbeat+loop alive — FlushLedLog read-hang not present',
    });
  } else if (
    trail.includes('after-idle-led') &&
    !opts.heartbeatExists &&
    !trail.includes('after-idle-heartbeat')
  ) {
    out.push({
      hypothesisId: 'H5',
      status: 'LIKELY',
      detail: 'after-idle-led written but no heartbeat — hang in canary/LedLog/Flush path',
    });
  } else {
    out.push({
      hypothesisId: 'H5',
      status: 'INCONCLUSIVE',
      detail: 'flush hang not isolated',
    });
  }

  // H3: hang inside PlayFile / boot resume
  if (
    trail.includes('boot-resume-1-enter') &&
    !trail.includes('boot-resume-1-done')
  ) {
    out.push({
      hypothesisId: 'H3',
      status: 'CONFIRMED',
      detail: 'hung in MaybeResumePlaybackFromFile(boot)',
    });
  } else if (
    trail.includes('playfile-enter') &&
    !trail.includes('playfile-ok') &&
    !trail.includes('boot-resume-1-done')
  ) {
    out.push({
      hypothesisId: 'H3',
      status: 'CONFIRMED',
      detail: 'hung inside PlayLocalFile / TryPlayFileOnce',
    });
  } else {
    out.push({
      hypothesisId: 'H3',
      status: trail.includes('playfile-ok') ? 'REJECTED' : 'INCONCLUSIVE',
      detail: 'PlayFile hang not proven',
    });
  }

  // H4: loop alive but no play / no inbound
  if (trail.includes('loop-tick-0') || trail.includes('loop-enter')) {
    if (opts.heartbeatExists && !opts.playfileExists && !opts.statusExists) {
      out.push({
        hypothesisId: 'H4',
        status: 'LIKELY',
        detail:
          'loop/heartbeat alive but no playfile-attempt/status — poll not applying or no command file',
      });
    } else if (opts.inboundSeen === 0 && opts.heartbeatExists) {
      out.push({
        hypothesisId: 'H4',
        status: 'INCONCLUSIVE',
        detail: 'loop alive, inbound still 0 (expected if PostJS skipped)',
      });
    } else {
      out.push({
        hypothesisId: 'H4',
        status: 'INCONCLUSIVE',
        detail: 'loop entered; playback signals mixed',
      });
    }
  } else {
    out.push({
      hypothesisId: 'H4',
      status: 'REJECTED',
      detail: 'never reached loop-enter — not a post-loop poll issue',
    });
  }

  return out;
}

// #region agent log
function emitDebugIngest(
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  const payload = {
    sessionId: DEBUG_SESSION,
    runId: 'autorun-hang',
    hypothesisId,
    location: 'autorunDiag.ts:runProbe',
    message,
    data,
    timestamp: Date.now(),
  };
  console.info(`[Perform6][debug-${DEBUG_SESSION}] ${message}`, data);
  fetch(DEBUG_INGEST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': DEBUG_SESSION,
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    /* device cannot reach host ingest — Admin console upload is primary */
  });
  try {
    const fs = getNodeFs();
    if (fs) {
      const p = toNodeSdPath('SD:/perform6-debug-f6ed41.ndjson');
      const line = `${JSON.stringify(payload)}\n`;
      let prev = '';
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf8');
          prev = typeof raw === 'string' ? raw : String(raw);
          if (prev.length > 20000) prev = prev.slice(-10000);
        }
      } catch {
        /* ignore */
      }
      fs.writeFileSync(p, prev + line, 'utf8');
    }
  } catch {
    /* ignore */
  }
}
// #endregion

function runProbe(): void {
  try {
    probeCount += 1;
    const bootProbe = readFileProbe('SD:/perform6-boot-canary.txt', 500);
    const hbProbe = readFileProbe('SD:/perform6-heartbeat.txt', 200);
    const debugTrailProbe = readFileProbe('SD:/perform6-debug-f6ed41.txt', 2000);
    const ledLog = readFileProbe('SD:/perform6-led.log', 1000);
    const playfile = readFileProbe('SD:/perform6-playfile-attempt.txt', 300);
    const statusLed = readFileProbe(
      'SD:/perform6-led-playback-status-led.json',
      200,
    );
    const statusRoot = readFileProbe('SD:/perform6-led-playback-status.json', 200);

    const bootText = textOf(bootProbe);
    const hbText = textOf(hbProbe);
    const trailText = textOf(debugTrailProbe);
    const ledTail = String(ledLog.tail ?? '');

    const newAutorun =
      hbText.includes('alive-f6ed41') ||
      bootText.startsWith('loop-') ||
      bootText.startsWith('after-idle') ||
      trailText.includes('loop-enter');

    if (!newAutorun) {
      console.error(
        '[Perform6][debug-f6ed41] CRITICAL: NEW autorun.brs NOT on device. ' +
          'heartbeat=' +
          (hbProbe.exists === true ? hbText.slice(0, 80) : 'MISSING') +
          ' bootCanary=' +
          (bootText.slice(0, 80) || 'MISSING') +
          ' — flash SD autorun.brs from this build (OTA JS-only will NOT fix LED).',
      );
    } else {
      console.info('[Perform6][debug-f6ed41] NEW autorun detected', {
        bootCanary: bootText.slice(0, 120),
        heartbeat: hbText.slice(0, 120),
      });
    }

    const hypotheses = classifyHang({
      bootCanary: bootText,
      heartbeatExists: hbProbe.exists === true,
      heartbeatText: hbText,
      debugTrail: trailText,
      ledLogTail: ledTail,
      playfileExists: playfile.exists === true,
      statusExists: statusLed.exists === true || statusRoot.exists === true,
      inboundSeen,
    });

    if (!newAutorun) {
      hypotheses.unshift({
        hypothesisId: 'H2',
        status: 'CONFIRMED',
        detail:
          'no alive-f6ed41 heartbeat / no loop-enter canary — old autorun still running',
      });
    }

    const snapshot = {
      probeCount,
      transport: getBridgeTransport(),
      inbound: {
        seen: inboundSeen,
        lastType: lastInboundType || null,
        lastAgoMs: lastInboundAt ? Date.now() - lastInboundAt : null,
      },
      bootCanary: bootText.slice(0, 200),
      heartbeat: hbProbe.exists === true ? hbText.slice(0, 120) : 'MISSING',
      debugTrailTail: trailText.slice(-800),
      ledLogTail: ledTail.slice(-500),
      playfile: playfile.exists === true,
      status: statusLed.exists === true || statusRoot.exists === true,
      hypotheses,
      messagePortModule: describeMessagePortModule(),
      ledPlaybackFile: readFileProbe('SD:/perform6-led-playback.json', 300),
      sdWritePersist: sdWritePersistProbe(),
      mediaPool: dirCountProbe('SD:/perform6-media-pool'),
      sdRoot: dirCountProbe('SD:/'),
    };

    console.info('[Perform6][diag] autorun blindspot probe', snapshot);

    const top =
      hypotheses.find((h) => h.status === 'CONFIRMED') ??
      hypotheses.find((h) => h.status === 'LIKELY') ??
      hypotheses[0];
    emitDebugIngest('autorun-hang-classifier', snapshot, top?.hypothesisId ?? 'H0');
  } catch (error) {
    console.warn('[Perform6][diag] probe failed', error);
  }
}

export function startAutorunDiag(): void {
  if (started) return;
  if (runtimeConfig.runtimeMode !== 'BRIGHTSIGN') return;
  started = true;

  subscribeBsMessages((event) => {
    inboundSeen += 1;
    const type = String(event?.data?.type ?? '(no type)');
    lastInboundType = type;
    lastInboundAt = Date.now();
    if (type === 'led-diag-echo' || inboundSeen <= 10) {
      console.info('[Perform6][diag] INBOUND autorun→JS message', {
        n: inboundSeen,
        type,
        data: event?.data ?? {},
      });
    }
  });

  window.setTimeout(runProbe, 3_000);
  window.setTimeout(runProbe, 8_000);
  window.setInterval(runProbe, PROBE_INTERVAL_MS);
  console.info('[Perform6][diag] autorun diagnostics armed (debug-f6ed41)');
}
