# roHtmlWidget bridge audit

This audit is the release gate for the next disabled-encryption diagnostic.
It records the external contracts used by Perform6 without copying any
third-party implementation into the runtime.

## Sources checked

- BrightSign `roHtmlWidget` reference:
  <https://docs.brightsign.biz/develop/rohtmlwidget>
- BrightSign Dev Cookbook `send-plugin-message` example:
  <https://github.com/brightsign/dev-cookbook/tree/main/examples/browser/send-plugin-message>
- BrightSign BrightAuthor HTML zone messaging example:
  <https://github.com/brightsign/BrightAuthor-Plugins/tree/master/HTMLZoneMessage>
- BrightSign BrightAuthor user-variable example:
  <https://github.com/brightsign/BrightAuthor-Plugins/tree/master/Send-User-Variables-To-HTML>
- BrightSign Code Samples repository (searched for all bridge APIs):
  <https://github.com/brightsign/brightscript-samples>
- Community Simple File Networking autorun (widget construction comparison):
  <https://github.com/alexnathanson/brightsign_simplefilenetworking_autosync>
- Gifted and Talented CMS integration autorun (event-loop comparison):
  <https://github.com/riordan/brightsign-gifted-and-talented>
- BrightDevelopers technical documentation (secondary cross-check only):
  <https://github.com/BrightDevelopers/technical-documentation>

## Contract matrix

| Boundary | Verified contract | Perform6 requirement |
| --- | --- | --- |
| Widget creation | `roHtmlWidget(rect, properties)` | Construct one XT touch widget only |
| Event port | initialization property `port` | Attach the existing `roMessagePort` in the constructor |
| Node runtime | `nodejs_enabled: true` | Required for AssetPool and other BrightSign modules |
| BrightSign JS objects | `brightsign_js_objects_enabled: true` | Required for the browser-global compatibility surface |
| JS to BrightScript | `PostBSMessage(flatObject)` | No nested protocol objects |
| BrightScript to JS | widget `PostJSMessage(flatAA)` | Send to the exact retained touch widget |
| Node receive | `addEventListener('bsmessage', handler)` | Payload is normally the callback argument itself |
| Browser-global receive | `onbsmessage = handler` | Payload is normally under `event.data` |
| Port cardinality | one `BSMessagePort` per `roHtmlWidget` | Never construct Node and DOM port objects together |
| Node reload | destroy/rebuild; `SetUrl()` is undefined | Never reload a live Node widget with `SetUrl()` |
| Readiness | JavaScript is guaranteed at bind-ready | JS sends hello only after its receiver is installed |

## Findings from field versions 1.5.39-1.5.42

- JavaScript-to-BrightScript delivery is healthy: native code receives the
  hello and playback commands.
- The native reply is built as a flat associative array and
  `PostJSMessage()` returns true.
- JavaScript receives zero callbacks through the Node module on BOS 9.1.93.2.
- Constructor `port` versus post-construction `SetPort()` did not change that
  result.
- Playback, heartbeat, OTA, storage, and output configuration remain healthy;
  encryption is still disabled.

## Rejected diagnostic designs

- DOM-only was rejected because it would displace the field-proven Node object
  used by playback and the autorun HTTP OTA fallback.
- Node outbound plus a separate DOM receiver was rejected because BrightSign
  permits only one message-port instance per widget.

## Safe boundary

Keep the single Node instance and existing outbound behavior unchanged.
Native capability and encrypted-playback outcomes must use the already proven
SD status/log path, which JavaScript can read with Node `fs` and report through
normal telemetry. A missing native callback must remain observe-only: it may
not trigger a widget recycle, reboot, format, OTA commit, or encryption action.
