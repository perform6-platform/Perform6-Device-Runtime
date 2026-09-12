# File-level encryption research — 2026-09-12

Research only; no production mutations or imported third-party code.

## Primary documentation confirmed

- https://docs.brightsign.biz/develop/rovideoplayer#video-decryption
  documents PlayFile associative-array EncryptionAlgorithm and EncryptionKey.
  AesCtr and AesCtrHmac are listed for file playback; CTR key input is 128 bits
  of key followed by 128 bits of IV. Native playback is therefore a documented
  interface, not only an HTML feature. Exact XT2145/9.1.93.2 behavior untested.
- https://docs.brightsign.biz/develop/html-video
  documents corresponding HTML video encryption attributes.
- https://docs.brightsign.biz/technical/optimize-video-quality
  warns of approximately 10 Mbps less bitrate capability for AES-CTR/HMAC
  decryption. This is not our measured 4K60 result.

These contracts were retrieved directly from public documentation HTML when
web-reader extraction returned only the title. No sample keys copied into code.

## User-supplied repositories

- https://github.com/brightsign : official organization. dev-cookbook contains
  OS-specific templates and playback examples. Its recursive file tree at
  d92677f1bb6ea0ddea57531c76f132906b886604 did not expose an encryption-named
  example. Not an exhaustive code-content audit of all organization repositories.
- https://github.com/riordan/brightsign-gifted-and-talented/blob/master/_media/guides/CMS%20Integration%20Guide/Setup%20Files/autorun.brs
  is a community archive/setup-script reference, not verified current firmware
  guidance. GitHub page available; raw endpoint repeatedly returned 503. No
  encryption match in the rendered page. No full source safety audit claimed.
- https://github.com/BrightDevelopers/technical-documentation/blob/main/documentation/part-5-bsn-cloud/02-automated-provisioning.md
  describes self-hosted ru endpoints and override/periodic/last_resort modes.
  Particularly relevant: claims last_resort covers autorun runtime errors and
  requires different response handling. Treat this as a reference to corroborate
  against official OS docs and field requests, not proof our recovery works.
  Do not copy its formatting/recovery example to production.
- https://github.com/alexnathanson/brightsign_simplefilenetworking_autosync
  README targets LS423 Simple File Networking with device-ID server directories
  and BrightAuthor presentation structure. Useful setup background, not an
  encrypted-media or XT2145 unattended-recovery implementation.

## Proposed direction, not implemented

Encrypt a separate media object on the backend, download ciphertext, and pass
the file plus key/IV to documented playback interfaces. Do not remount/encrypt
the startup filesystem; do not write a plaintext decrypted media copy to SD.
This removes encryption-induced remount from this design, not all runtime risks.

Resolve before implementation:
1. Precise encryption wire format and integrity verification (do not invent
   BrightSign AesCtrHmac framing; CTR alone does not authenticate ciphertext).
2. Secure device-bound key delivery/storage without an SD-resident raw key or
   SD credential that lets a laptop obtain the key. Offline playback matters.
3. Native and HTML seek, duration probing, looping, audio, 4K60 throughput.
4. AssetPool checksum/size must describe ciphertext; no plaintext alias fallback.
5. Restrict key-bearing playback arguments from logs/SD bus/diagnostic exports.

Suggested first implementation test is an offline, disposable media fixture
and packaging/integrity tests, after selecting the key-management design.
No new OTA or change of production architecture is authorized by this research.
