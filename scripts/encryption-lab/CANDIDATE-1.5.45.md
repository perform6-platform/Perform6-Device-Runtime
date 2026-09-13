# XT2145 candidate 1.5.45 — isolated AES-CTR playback interoperability

## Purpose

Prove the documented native `roVideoPlayer.PlayFile` AES-CTR parameter shape on
the field XT2145 without deleting, replacing, downloading, or encrypting any
existing Perform6 video. This is an interoperability fixture, not the final
production key-delivery pipeline.

## Execution boundary

- Normal startup, authenticated heartbeat, OTA control, and existing plaintext
  playback initialize first.
- The code is hard-gated to XT2145 runtime 1.5.45 and executes once per boot.
- A synthetic two-second 320x180 H.264 test pattern is bundled only as raw
  AES-128-CTR ciphertext at a unique non-library path.
- Its test-only key and IV are stored and read through the registry path proven
  by 1.5.44. They are not production secrets and protect no customer content.
- Native HDMI-2 receives one encrypted `PlayFile` attempt with `ProbeString`
  `mp4`; after 1.2 seconds, the previous plaintext source is restored regardless
  of whether the native call accepted or rejected the encrypted fixture.
- Only fixed, secret-free outcomes are written to the SD diagnostic log.

## Preserved hard lines

- No SD formatting, full-card encryption, mount/remount, cache wipe, deletion,
  media sync, source-video replacement, output-mode change, `SetUrl`, recovery
  mutation, automatic OTA, or probe-triggered reboot.
- No new message port or native-to-JavaScript acknowledgement dependency.
- Failure is contained to the synthetic playback attempt. Restoration uses the
  exact prior plaintext path; if restoration fails, the existing idle fallback
  is displayed and the normal two-second SD playback poll remains available.
- The 1.5.44 safer OTA replacement routine is active before this installation.

## Advance evidence

Require runtime 1.5.45 online, recurring heartbeat, OTA `Up to date`, existing
media retained, and exactly one fixed outcome. The positive first-stage result
is `MEDIA|ENCRYPTED_PROBE|state=native-accepted-restored|secretLogged=0`.
This proves native acceptance and restoration, not yet sustained 4K60 encrypted
playback or production key secrecy.
