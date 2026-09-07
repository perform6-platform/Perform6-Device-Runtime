/**
 * Autorun-side blindspot probe.
 *
 * The XT2145 in the field shows a one-way bridge (JS→autorun ok, autorun→JS
 * dead) AND `autorun:0` in every log batch — so we cannot see what the
 * BrightScript side is doing. The autorun serial log / `SD:/perform6-led.log`
 * is not reachable on that unit.
 *
 * This module reports what JS *can* observe through the one channel that works
 * (console → backend upload): whether autorun writes to disk at all, what its
 * last log lines say, whether SD writes from JS persist, and whether a single
 * inbound BrightScript message ever arrives. Diagnostic only — no behaviour
 * change. Remove once the field unit is understood.
 */
import { getBrightSignRequire, getNodeFs, toNodeSdPath } from '../platform/brightSignNode';
import { subscribeBsMessages, getBridgeTransport } from '../platform/bsMessagePort';
import { runtimeConfig } from '../config/runtime';

const PROBE_INTERVAL_MS = 20_000;
let started = false;
let inboundSeen = 0;
let lastInboundType = '';
let lastInboundAt = 0;

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

function runProbe(): void {
  try {
    console.info('[Perform6][diag] autorun blindspot probe', {
      transport: getBridgeTransport(),
      inbound: {
        seen: inboundSeen,
        lastType: lastInboundType || null,
        lastAgoMs: lastInboundAt ? Date.now() - lastInboundAt : null,
      },
      messagePortModule: describeMessagePortModule(),
      ledLog: readFileProbe('SD:/perform6-led.log', 1000),
      xtPlaybackFile: readFileProbe('SD:/perform6-xt-playback.json', 400),
      sdWritePersist: sdWritePersistProbe(),
      mediaPool: dirCountProbe('SD:/perform6-media-pool'),
      mediaStore: dirCountProbe('SD:/perform6-media'),
      sdRoot: dirCountProbe('SD:/'),
    });
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
    // Always surface the diag echo; sample everything else for the first 10.
    if (type === 'led-diag-echo' || inboundSeen <= 10) {
      console.info('[Perform6][diag] INBOUND autorun→JS message', {
        n: inboundSeen,
        type,
        data: event?.data ?? {},
      });
    }
  });

  window.setTimeout(runProbe, 4_000);
  window.setInterval(runProbe, PROBE_INTERVAL_MS);
  console.info('[Perform6][diag] autorun diagnostics armed');
}
