# Local inspection artifact 1.5.36 — NOT APPROVED FOR INSTALLATION

Final ZIP SHA256: 9f373a54d4cae13ba5c57fce1e3946a0f3d639db26a4a4a2d948bac363d4317d

Built with SKIP_R2_UPLOAD=1. No publication, installation or reboot.
Initial packaging was blocked. Following exact-source review, the gate now
supports only version 1.5.36 with two pinned source hashes and regression checks.
Final packaging passes, including ZIP/folder equality and the 1.5.33 negative
fixture. This is local validation, not hardware validation or installation approval.
Inherited clean-card pool changes were removed: only autorun and capability
reporting differ from c7011b5. Existing OTA, heartbeat, playback and pool sources
match that baseline. The earlier local ZIP checksum is superseded.

This is a disabled integration artifact, not functioning encrypted playback:
- dormant registry reader appended to autorun, no startup/event caller;
- existing hello ack advertises disabled/unavailable;
- JS records those informational fields, never interprets them as permission;
- no media keys generated/stored, native encrypted PlayFile not connected;
- no filesystem encryption, formatting, content replacement or reboot added.

Checks: TypeScript and Vite build pass; local Roku-oriented parser reports zero
syntax diagnostics on exact packaged autorun. This is not a BrightSign runtime
test. Four exact-source regression tests verify the prior autorun body is
unchanged except hello fields, reader has no active caller, and no writes/reboot
exist in the helper. Existing playback assertions passed during packaging.

pauseOta=true is the existing automatic-update restriction. applyOtaUpdate allows
explicit Admin Install with allowWhenPaused=true; syncEngine and RuntimeContext
use that option. Do not change this to false merely to claim OTA preservation.
Source inspection is not a new live OTA test.

Outstanding: native encrypted playback integration, key provisioning and trust,
hardware behavior and explicit field-risk/install approval. The initial install
itself uses the existing updater; its interrupted-write risk is not repaired by
this candidate. No claim of crash-safe installation or guaranteed recovery.
83 lab tests pass; exact packaged autorun has zero local parser diagnostics.
