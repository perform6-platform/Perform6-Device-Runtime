import { useEffect, useRef } from 'react';
import { runtimeConfig } from '../../config/runtime';
import { PrimaryOutputOnly } from '../../layout/PrimaryOutputOnly';
import { useDeviceStore } from '../../stores/deviceStore';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { isDeviceReady } from '../../stores/deviceStore';

/**
 * Full-screen BrightSign boot panel with live status lines.
 * Hides once pairing UI is ready. On pairing/API errors, yields to
 * DeviceStatusOverlay so the backend message is visible on the LCD.
 * Multi-HDMI: XT boot log is confined to the independent HDMI-1 widget.
 */
export function BootSplash() {
  const bootLines = useRuntimeStore((s) => s.bootLines);
  const pushBootLine = useRuntimeStore((s) => s.pushBootLine);
  const deviceInfo = useRuntimeStore((s) => s.deviceInfo);
  const syncState = useRuntimeStore((s) => s.syncState);
  const pairingCode = useDeviceStore((s) => s.pairingCode);
  const registrationStatus = useDeviceStore((s) => s.registrationStatus);
  const started = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (runtimeConfig.isSimulator || started.current) return;
    started.current = true;
    pushBootLine(`Profile ${runtimeConfig.hardwareProfile}`);
    pushBootLine(`API ${runtimeConfig.apiBaseUrl}`);
    pushBootLine('Waiting for device identity…');
  }, [pushBootLine]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [bootLines]);

  if (runtimeConfig.isSimulator) return null;

  // Let DeviceStatusOverlay own the LCD when pairing/API fails (shows backend text + Retry).
  if (registrationStatus === 'error' || syncState.runtimePhase === 'error') {
    return null;
  }

  // Hand off to /pairing as soon as pairing starts or a code arrives.
  const pairingUiReady =
    Boolean(pairingCode) ||
    registrationStatus === 'pairing' ||
    registrationStatus === 'waiting_for_registration' ||
    registrationStatus === 'paired' ||
    registrationStatus === 'registered' ||
    isDeviceReady();

  if (pairingUiReady) return null;

  const headline = deviceInfo ? 'Starting pairing…' : 'Starting Perform6…';
  const profile = deviceInfo?.hardwareProfile ?? runtimeConfig.hardwareProfile;

  return (
    <div className="fixed inset-0 z-[10000]" role="status" aria-live="polite">
      <PrimaryOutputOnly profile={profile}>
        <div className="flex h-full flex-col bg-black px-10 py-12 text-white">
          <p className="text-sm font-bold uppercase tracking-[0.35em] text-cyan-400">Perform6</p>
          <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">{headline}</h1>
          <p className="mt-3 max-w-3xl text-lg text-white/70">
            Connecting to Perform6. Pairing code will fill the primary screen when ready.
          </p>

          {deviceInfo && (
            <dl className="mt-8 grid max-w-2xl gap-2 text-base text-white/80">
              <div className="flex justify-between gap-6 border-b border-white/10 py-2">
                <dt>Model</dt>
                <dd className="font-medium text-white">{deviceInfo.model}</dd>
              </div>
              <div className="flex justify-between gap-6 border-b border-white/10 py-2">
                <dt>Serial</dt>
                <dd className="font-mono text-white">{deviceInfo.serialNumber}</dd>
              </div>
              <div className="flex justify-between gap-6 py-2">
                <dt>Status</dt>
                <dd className="text-white">{registrationStatus}</dd>
              </div>
            </dl>
          )}

          <div className="mt-8 min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/15 bg-white/5 p-5 font-mono text-sm leading-relaxed text-cyan-100">
            {bootLines.map((line, i) => (
              <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap">
                <span className="text-white/35">{String(i + 1).padStart(2, '0')}</span> {line}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      </PrimaryOutputOnly>
    </div>
  );
}
