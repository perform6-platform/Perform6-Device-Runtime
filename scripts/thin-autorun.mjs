/**
 * Phase 1+2: strip HTTP cache/OTA, alias CopyFile, mini-DWS, heal/recycle
 * from brightsign/autorun.brs — keep boot + LED SD bus + PlayFile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const autorunPath = path.join(root, 'brightsign', 'autorun.brs');
if (!fs.existsSync(autorunPath)) {
  console.error(
    '[thin-autorun] brightsign/autorun.brs godfile removed — edit autorun-{xt2145,xc4055,hd226}.brs directly (or hang-harden-autorun.mjs).',
  );
  process.exit(1);
}
let text = fs.readFileSync(autorunPath, 'utf8');
const origLen = text.split(/\r?\n/).length;

function removeRoutine(src, name, kind) {
  const lines = src.split(/\r?\n/);
  const headerRe = new RegExp(`^${kind} ${name}\\(`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    console.warn('NOT FOUND', kind, name);
    return src;
  }
  let depth = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (/^(Sub|Function) /.test(line)) depth += 1;
    if (/^End Sub\b/.test(line) || /^End Function\b/.test(line)) {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    console.warn('FAILED CLOSE', kind, name);
    return src;
  }
  console.log('REMOVED', kind, name, `(${end - start + 1} lines)`);
  lines.splice(start, end - start + 1);
  return lines.join('\n');
}

const removeList = [
  ['AliasCopyMaxBytes', 'Function'],
  ['PoolPathTooLargeForAlias', 'Function'],
  ['EnsureMp4PlayAlias', 'Function'],
  ['DrainMp4AliasQueueOne', 'Sub'],
  ['CreatePrefetchWorker', 'Function'],
  ['FindPrefetchWorker', 'Function'],
  ['FindKeepNames', 'Function'],
  ['EnsureOtaWorker', 'Sub'],
  ['EnsureDeferredWorkers', 'Sub'],
  ['SetCacheNotifyHtml', 'Sub'],
  ['LookupUrlMediaId', 'Function'],
  ['RecalcPrefetchTotals', 'Sub'],
  ['ScheduleDeferredCacheComplete', 'Sub'],
  ['FlushDeferredCacheComplete', 'Sub'],
  ['WriteCacheProgressFile', 'Sub'],
  ['PostCacheProgress', 'Sub'],
  ['MaybePostCacheProgress', 'Sub'],
  ['CreateOtaWorker', 'Function'],
  ['FindOtaWorker', 'Function'],
  ['SetOtaNotifyHtml', 'Sub'],
  ['PostOtaProgressBytes', 'Sub'],
  ['PostOtaProgress', 'Sub'],
  ['MaybePostOtaProgress', 'Sub'],
  ['EnsureDirTree', 'Sub'],
  ['EnsureParentDir', 'Sub'],
  ['OtaDestForPath', 'Function'],
  ['CancelOtaTransfer', 'Sub'],
  ['HandleLedOtaCancel', 'Sub'],
  ['StartOtaDownload', 'Sub'],
  ['DrainOtaQueue', 'Sub'],
  ['HandleLedOtaAuth', 'Sub'],
  ['HandleLedOtaPing', 'Sub'],
  ['HandleLedOtaInstall', 'Sub'],
  ['HandleOtaEvent', 'Sub'],
  ['ShouldBridgeHealReboot', 'Function'],
  ['ShouldAllowHtmlRecycle', 'Function'],
  ['ClearBridgeHealMarker', 'Sub'],
  ['HasActiveTransfer', 'Function'],
  ['RepostLedReadyAfterRecycle', 'Sub'],
  ['RecycleHtmlWidget', 'Function'],
  ['MaybeBridgeWatchdogHeal', 'Sub'],
  ['DiagEchoInbound', 'Sub'],
  ['PostBridgeTick', 'Sub'],
  ['HandleLedBridgeHeal', 'Sub'],
  ['SplitPipeUrls', 'Function'],
  ['PruneCache', 'Sub'],
  ['StartCacheDownload', 'Sub'],
  ['DrainPrefetchQueue', 'Sub'],
  ['QueueHasUrl', 'Function'],
  ['QueueInsertFront', 'Sub'],
  ['HandleLedKeepSet', 'Sub'],
  ['HandleLedPrefetch', 'Sub'],
  ['HandleLedCacheClearAll', 'Sub'],
  ['HandleLedCacheEvict', 'Sub'],
  ['HandleLedCacheCancel', 'Sub'],
  ['FindStateForUrlEvent', 'Function'],
  ['HandleDownloadProgressTick', 'Sub'],
  ['HandleCacheEvent', 'Sub'],
  ['ConfigureDownloadTransfer', 'Sub'],
  ['StartResumableGet', 'Function'],
  ['EventSha256', 'Function'],
  ['IsRangeIgnoredCorruption', 'Function'],
  ['UrlRetryCount', 'Function'],
  ['SetUrlRetryCount', 'Sub'],
  ['ClearUrlRetryCount', 'Sub'],
  ['HasSdSpaceForBytes', 'Function'],
  ['HttpFailureIsRetryable', 'Function'],
  ['CacheHttpErrorText', 'Function'],
  ['FinishCacheFailure', 'Sub'],
  ['CacheNameFor', 'Function'],
  ['CachedPathFor', 'Function'],
  ['LookupUrlExpectedSize', 'Function'],
  ['IsCacheFileValid', 'Function'],
  ['InvalidateCacheForUrl', 'Sub'],
  ['SimpleHash', 'Function'],
  ['UrlExtension', 'Function'],
  ['OtaPoolDir', 'Function'],
  ['IsSafeMediaWipePath', 'Function'],
  ['PathLooksLikeDirectory', 'Function'],
  ['DeleteTree', 'Sub'],
  ['WipeMediaDirectory', 'Sub'],
  ['HexHashesMatch', 'Function'],
  ['NormalizeSdPath', 'Function'],
  ['PostLedFsResult', 'Sub'],
  ['HandleLedStorageInfo', 'Sub'],
  ['ListSdDirectoryNames', 'Function'],
  ['SdPathIsDirectory', 'Function'],
  ['HandleLedFsList', 'Sub'],
  ['HandleLedFsRead', 'Sub'],
  ['HandleLedFsWrite', 'Sub'],
  ['HandleLedFsDelete', 'Sub'],
  ['ReadLogTail', 'Function'],
  ['PostLedLogTail', 'Sub'],
  ['HandleLedLogTailRequest', 'Sub'],
  ['PlayNetworkStream', 'Function'],
];

for (const [name, kind] of removeList) {
  text = removeRoutine(text, name, kind);
}

const stubs = `
' --- Thin stubs: cache/OTA/FS live in JS AssetPool + Node fs ---
Sub EnsureDeferredWorkers(states as Object, html as Object)
  RememberP6Html(html)
  CreateDirectory(CacheDir())
  CreateDirectory(MediaPoolDir())
  LedLog("=== Perform6: thin autorun — media dirs only (no HTTP workers) ===")
End Sub

Sub HandleLedPrefetch(payload as Object, msgPort as Object, states as Object)
  LedLog("=== Perform6: led-cache-prefetch ignored (use JS AssetPool) ===")
End Sub

Sub HandleLedKeepSet(payload as Object, states as Object)
End Sub

Sub HandleLedCacheEvict(payload as Object, states as Object)
End Sub

Sub HandleLedCacheCancel(payload as Object, msgPort as Object, states as Object)
End Sub

Sub HandleLedCacheClearAll(states as Object)
  LedLog("=== Perform6: led-cache-clear-all ignored (use JS Node wipe) ===")
End Sub

Sub HandleLedOtaInstall(payload as Object, msgPort as Object, states as Object)
  LedLog("=== Perform6: led-ota-install ignored (use JS OTA AssetPool) ===")
End Sub

Sub HandleLedOtaPing(states as Object)
  html = ResolveBridgeHtml(states)
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-ota-pong")
  msg.ok = "1"
  msg.detail = "thin-autorun-no-http-ota"
  PostJsMessage(html, msg)
End Sub

Sub HandleLedOtaAuth(payload as Object, states as Object)
End Sub

Sub HandleLedOtaCancel(states as Object)
End Sub

Sub HandleLedBridgeHeal(payload as Object)
  LedLog("=== Perform6: bridge heal ignored (thin — reboot only) ===")
End Sub

Sub HandleLedFsList(payload as Object, states as Object)
End Sub

Sub HandleLedFsRead(payload as Object, states as Object)
End Sub

Sub HandleLedFsWrite(payload as Object, states as Object)
End Sub

Sub HandleLedFsDelete(payload as Object, states as Object)
End Sub

Sub HandleLedStorageInfo(states as Object)
End Sub

Sub HandleLedLogTailRequest(payload as Object, states as Object)
End Sub

Function CachedPathFor(url as String) as String
  return ""
End Function

Function PlayNetworkStream(st as Object, url as String) as Boolean
  LedLog("=== Perform6: network stream disabled in thin autorun ===")
  return false
End Function

`;

const playMarker = 'Sub PlayNativeSrc(';
const playIdx = text.indexOf(playMarker);
if (playIdx < 0) throw new Error('PlayNativeSrc not found');
text = text.slice(0, playIdx) + stubs + '\n' + text.slice(playIdx);

text = text.replace(
  /' Pool hash play order:[\s\S]*?Function PlayLocalFile\(vp as Object, path as String\) as Boolean[\s\S]*?End Function\r?\n/,
  `' Pool play: existing .mp4 alias-hit, else pool-direct + ProbeString (no CopyFile).
Function PlayLocalFile(vp as Object, path as String) as Boolean
  path = NormalizeLocalSrc(path)
  isPool = IsExtensionlessPoolPath(path)

  if isPool then
    existingAlias = PoolMp4AliasPath(path)
    if Len(existingAlias) > 0 and LocalMediaExists(existingAlias) then
      if TryPlayFileOnce(vp, existingAlias) then
        LedLog("=== Perform6: PlayLocalFile alias-hit " + existingAlias + " ===")
        return true
      end if
    end if
  end if

  candidates = CreateObject("roArray", 4, true)
  candidates.Push(path)
  if Left(path, 4) = "SD:/" then
    candidates.Push("/storage/sd/" + Mid(path, 5))
  else if Left(path, 12) = "/storage/sd/" then
    candidates.Push("SD:/" + Mid(path, 13))
  end if
  for each p in candidates
    if TryPlayFileOnce(vp, p) then
      if isPool then
        LedLog("=== Perform6: PlayLocalFile pool-direct OK " + p + " ===")
      end if
      return true
    end if
  end for
  LedLog("=== Perform6: PlayLocalFile exhausted " + path + " ===")
  return false
End Function

`,
);

text = text.replace(/\r?\n[ \t]*FlushDeferredCacheComplete\(ledStates\)\r?\n/g, '\n');
text = text.replace(/\r?\n[ \t]*DrainMp4AliasQueueOne\(\)\r?\n/g, '\n');
text = text.replace(/\r?\n[ \t]*HandleDownloadProgressTick\(msgPort, ledStates\)\r?\n/g, '\n');
text = text.replace(/\r?\n[ \t]*MaybeBridgeWatchdogHeal\(ledStates\)\r?\n/g, '\n');
text = text.replace(/\r?\n[ \t]*DiagEchoInbound\(msgType, ledStates\)\r?\n/g, '\n');

text = text.replace(
  /\r?\n[ \t]*else if type\(ev\) = "roUrlEvent" then\r?\n[\s\S]*?(?=\r?\n[ \t]*else if type\(ev\) = "roHtmlWidgetEvent" then)/,
  '\n    else if type(ev) = "roHtmlWidgetEvent" then',
);

// Drop progress timer (only used for cache ticks) — keep pb file timer
text = text.replace(
  /progressTimer = CreateObject\("roTimer"\)\r?\n[\s\S]*?pbFileTimer = CreateObject\("roTimer"\)/,
  'pbFileTimer = CreateObject("roTimer")',
);
text = text.replace(
  /else\r?\n[ \t]*MaybeResumePlaybackFromFile\(ledStates, msgPort, "timer"\)\r?\n[ \t]*if type\(progressTimer\) = "roTimer" then\r?\n[\s\S]*?end if\r?\n[ \t]*end if\r?\n[ \t]*end if/,
  `else
        MaybeResumePlaybackFromFile(ledStates, msgPort, "timer")
      end if
    end if`,
);

text = text.replace(
  /^' Perform6 BrightSign autorun[\s\S]*?\r?\n\r?\nSub SafePrint/,
  `' Perform6 BrightSign autorun — THIN boot + LED SD bus
' KEEP: identity, DWS, SetScreenModes, HtmlWidget, roVideoPlayer LEDs, idle, SD playback poll.
' LED PRIMARY: SD:/perform6-led-playback.json → PlayFile(pool-direct + ProbeString).
' NO HTTP in autorun: cache/OTA/prefetch/FS = JS AssetPool + Node fs.
' Bridge PostJSMessage optional (hello/ping/ack). Never SetUrl-recycle after load-finished.
' Profiles: XT2145 / XC4055 = React HDMI-1 + native LEDs; HD226 = one HtmlWidget.

Sub SafePrint`,
);

// HandleLedBridgeHealthy may call ClearBridgeHealMarker — fix if removed
if (text.includes('ClearBridgeHealMarker') && !text.includes('Sub ClearBridgeHealMarker')) {
  text = text.replace(/\r?\n[ \t]*ClearBridgeHealMarker\(\)\r?\n/g, '\n');
}

fs.writeFileSync(autorunPath, text);
const newLen = text.split(/\r?\n/).length;
console.log('DONE', origLen, '->', newLen, 'removed', origLen - newLen);

// Sanity: required symbols
for (const needle of [
  'MaybePollLedPlaybackFile',
  'PlayLocalFile',
  'ApplyNativePlayback',
  'EnsureDeferredWorkers',
  'HandleLedPrefetch',
  'Sub Main(',
]) {
  if (!text.includes(needle)) console.error('MISSING', needle);
}
