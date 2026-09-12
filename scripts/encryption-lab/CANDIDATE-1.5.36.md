# Local inspection artifact 1.5.36 — NOT APPROVED FOR INSTALLATION

ZIP SHA256: 30e4841c716388873e34d211f59ae0af9b01208cb65d69d0fe50ebb4e85cab29

Built with SKIP_R2_UPLOAD=1. No publication, installation or reboot.
Packaging exited nonzero at the existing XT safety gate because autorun differs
from the allowed baseline. The gate was not modified or bypassed.

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
exact-package security review and explicit field-risk/install approval.
