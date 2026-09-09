/**
 * Senior hang-harden for per-profile autoruns.
 * - Queue PostJS (max 1 drain / loop + boot grace)
 * - Single PlayFile attempt (Filename + ProbeString)
 * - SD:/ only reads for LED bus
 * - No CreateDirectory in deferred workers
 * - Boot Sleep(500) → short Sleep slices; post-msgPort → wait slices
 */
import fs from 'node:fs';

const POSTJS = `Sub PostJsToWidget(html as Object, msg as Object)
  if type(html) <> "roHtmlWidget" then return
  if type(msg) <> "roAssociativeArray" then return
  html.PostJSMessage(msg)
End Sub

' Queue outbound JS messages — never call PostJSMessage synchronously on hot path.
' Boot grace + max 1 drain per wait() keeps Main responsive.
Sub EnqueuePostJs(html as Object, msg as Object)
  if type(msg) <> "roAssociativeArray" then return
  g = GetGlobalAA()
  if type(g.p6PostJsQ) <> "roArray" then
    g.p6PostJsQ = CreateObject("roArray", 8, true)
  end if
  item = CreateObject("roAssociativeArray")
  item.html = html
  item.msg = msg
  g.p6PostJsQ.Push(item)
  if g.p6PostJsQ.Count() > 12 then
    g.p6PostJsQ.Shift()
  end if
End Sub

Sub DrainOnePostJs()
  g = GetGlobalAA()
  if g.p6LoopAlive <> true then return
  if type(g.p6LoopEnterSpan) = "roTimespan" then
    if g.p6LoopEnterSpan.TotalMilliseconds() < 3000 then return
  end if
  if type(g.p6PostJsQ) <> "roArray" then return
  if g.p6PostJsQ.Count() = 0 then return
  item = g.p6PostJsQ.Shift()
  if type(item) <> "roAssociativeArray" then return
  html = item.html
  if type(html) <> "roHtmlWidget" then html = ResolveBridgeHtml(invalid)
  PostJsToWidget(html, item.msg)
End Sub

' One PostJSMessage per event — BrightSign: one port per widget.
Sub PostJsMessage(html as Object, msg as Object)
  if type(msg) <> "roAssociativeArray" then return
  g = GetGlobalAA()
  ' Before loop-enter: drop (never block boot). After: queue only.
  if g.p6LoopAlive <> true then return
  if type(html) <> "roHtmlWidget" then
    if type(g.htmlTouch) = "roHtmlWidget" then
      html = g.htmlTouch
    else if type(g.htmlPrimary) = "roHtmlWidget" then
      html = g.htmlPrimary
    else if type(g.p6Html) = "roHtmlWidget" then
      html = g.p6Html
    else if type(g.html) = "roHtmlWidget" then
      html = g.html
    end if
  end if
  EnqueuePostJs(html, msg)
End Sub`;

const PLAY = `Function TryPlayFileOnce(vp as Object, p as String) as Boolean
  TraceFnEnter("TryPlayFileOnce", p)
  WritePlayfileCanary("trying", p, "?")
  ' Single BA-style attempt — stacked PlayFile variants can stall Main.
  aa = CreateObject("roAssociativeArray")
  aa.Filename = p
  if IsExtensionlessPoolPath(p) then
    aa.ProbeString = "mp4"
  end if
  ok = vp.PlayFile(aa)
  if ok = true then
    WritePlayfileCanary("ok-filename", p, "1")
    TraceFnExit("TryPlayFileOnce", "ok")
    return true
  end if
  WritePlayfileCanary("fail", p, "0")
  TraceFnExit("TryPlayFileOnce", "false")
  return false
End Function

' Pool play: pool-direct + ProbeString (no alias LocalMediaExists / CopyFile).
Function PlayLocalFile(vp as Object, path as String) as Boolean
  TraceFnEnter("PlayLocalFile", path)
  path = NormalizeLocalSrc(path)
  isPool = IsExtensionlessPoolPath(path)

  if TryPlayFileOnce(vp, path) then
    if isPool then
      LedLog("=== Perform6: PlayLocalFile pool-direct OK " + path + " ===")
    end if
    TraceFnExit("PlayLocalFile", "ok|" + path)
    return true
  end if
  LedLog("=== Perform6: PlayLocalFile exhausted " + path + " ===")
  TraceFnExit("PlayLocalFile", "exhausted")
  return false
End Function`;

const LOAD_BUS = `Function LoadLedPlaybackFileAA() as Object
  ' SD:/ only — dual /storage/sd reads double Main I/O risk.
  paths = CreateObject("roArray", 2, true)
  paths.Push("SD:/perform6-led-playback.json")
  paths.Push("SD:/perform6-xt-playback.json")
  for each path in paths
    text = ReadAsciiFile(path)
    if type(text) = "roString" or type(text) = "String" then
      if Len(text) > 0 and Len(text) < 200000 then
        parsed = ParseJSON(text)
        if type(parsed) = "roAssociativeArray" then return parsed
        LedLog("=== Perform6: LED playback file JSON parse fail " + path + " len=" + IntToStr(Len(text)) + " ===")
      end if
    end if
  end for
  return invalid
End Function`;

const LOAD_STATUS = `Function LoadLedStatusRootAA() as Object
  text = ReadAsciiFile("SD:/perform6-led-playback-status.json")
  if Len(text) > 0 and Len(text) < 200000 then
    parsed = ParseJSON(text)
    if type(parsed) = "roAssociativeArray" then return parsed
  end if
  return invalid
End Function`;

const WORKERS = `Sub EnsureDeferredWorkers(states as Object, html as Object)
  RememberP6Html(html)
  ' No CreateDirectory here — JS/AssetPool owns dirs; mkdir can stall Main on some cards.
  LedLog("=== Perform6: thin autorun — media dirs only (no HTTP workers) ===")
End Sub`;

const HELPERS = `Sub BootSleepSlices(totalMs as Integer)
  ' Pre-msgPort boot only — never use wait() without a port.
  left = totalMs
  while left > 0
    slice = 100
    if left < slice then slice = left
    Sleep(slice)
    left = left - slice
  end while
End Sub

Sub WaitMsgSlices(msgPort as Object, slices as Integer)
  if slices < 1 then return
  i = 0
  while i < slices
    if type(msgPort) = "roMessagePort" then
      wait(100, msgPort)
    else
      Sleep(100)
    end if
    i = i + 1
  end while
End Sub

`;

const EXISTS = `Function LocalMediaExists(path as String) as Boolean
  path = NormalizeLocalSrc(path)
  if Len(path) = 0 then return false
  ' SD:/ only — avoid dual-mount PartFileBytes / Exists storms on Main.
  if Left(path, 12) = "/storage/sd/" then
    path = "SD:/" + Mid(path, 13)
  end if
  if PartFileBytes(path) > 0 then return true
  fs = CreateObject("roFileSystem")
  if type(fs) = "roFileSystem" then
    if fs.Exists(path) = true then return true
  end if
  return false
End Function`;

function replaceOnce(t, re, repl, label) {
  if (!re.test(t)) {
    throw new Error(`missing pattern: ${label}`);
  }
  return t.replace(re, repl);
}

function patchFile(name) {
  let t = fs.readFileSync(`brightsign/${name}`, 'utf8');
  const origLines = t.split(/\r?\n/).length;

  t = replaceOnce(
    t,
    /Sub PostJsToWidget\(html as Object, msg as Object\)[\s\S]*?End Sub\r?\n\r?\n' One PostJSMessage per event[\s\S]*?End Sub/,
    POSTJS,
    'PostJs',
  );

  t = replaceOnce(
    t,
    /Function TryPlayFileOnce\(vp as Object, p as String\) as Boolean[\s\S]*?End Function\r?\n\r?\n' Pool play:.*\r?\nFunction PlayLocalFile\(vp as Object, path as String\) as Boolean[\s\S]*?End Function/,
    PLAY,
    'PlayFile',
  );

  t = replaceOnce(
    t,
    /Function LoadLedPlaybackFileAA\(\) as Object[\s\S]*?End Function/,
    LOAD_BUS,
    'LoadLedPlayback',
  );

  t = replaceOnce(
    t,
    /Function LoadLedStatusRootAA\(\) as Object[\s\S]*?End Function/,
    LOAD_STATUS,
    'LoadLedStatus',
  );

  t = replaceOnce(
    t,
    /Sub EnsureDeferredWorkers\(states as Object, html as Object\)[\s\S]*?End Sub/,
    WORKERS,
    'EnsureDeferredWorkers',
  );

  t = replaceOnce(
    t,
    /Function LocalMediaExists\(path as String\) as Boolean[\s\S]*?End Function/,
    EXISTS,
    'LocalMediaExists',
  );

  // Sidecar status: SD only
  t = t.replace(
    /Function LoadLedStatusSidecarEntry\(roleKey as String\) as Object\r?\n  if Len\(roleKey\) = 0 then return invalid\r?\n  paths = CreateObject\("roArray", 2, true\)\r?\n  paths\.Push\("SD:\/perform6-led-playback-status-" \+ roleKey \+ "\.json"\)\r?\n  paths\.Push\("\/storage\/sd\/perform6-led-playback-status-" \+ roleKey \+ "\.json"\)\r?\n  for each path in paths\r?\n    text = ReadAsciiFile\(path\)\r?\n    if Len\(text\) > 0 then\r?\n      parsed = ParseJSON\(text\)\r?\n      if type\(parsed\) = "roAssociativeArray" then return parsed\r?\n    end if\r?\n  end for\r?\n  return invalid\r?\nEnd Function/,
    `Function LoadLedStatusSidecarEntry(roleKey as String) as Object
  if Len(roleKey) = 0 then return invalid
  text = ReadAsciiFile("SD:/perform6-led-playback-status-" + roleKey + ".json")
  if Len(text) > 0 and Len(text) < 200000 then
    parsed = ParseJSON(text)
    if type(parsed) = "roAssociativeArray" then return parsed
  end if
  return invalid
End Function`,
  );

  if (!t.includes('Sub WaitMsgSlices(')) {
    t = t.replace(
      /Sub RememberP6Html\(html as Object\)/,
      HELPERS + 'Sub RememberP6Html(html as Object)',
    );
  }

  // First boot Sleep(500) is before msgPort — use BootSleepSlices
  t = t.replace(
    /SafePrint\("=== Perform6: display mode " \+ displayMode \+ " ==="\)\r?\n\r?\n  Sleep\(500\)\r?\n\r?\n  msgPort = CreateObject\("roMessagePort"\)/,
    'SafePrint("=== Perform6: display mode " + displayMode + " ===")\n\n  BootSleepSlices(500)\n\n  msgPort = CreateObject("roMessagePort")',
  );

  // Post-Show Sleep(500) — msgPort exists
  t = t.replace(/\r?\n    Sleep\(500\)\r?\n/g, '\n    WaitMsgSlices(msgPort, 5)\n');

  // PlayNativeSrc decoder settle
  t = t.replace(
    /st\.idleShown = false\r?\n      Sleep\(100\)\r?\n    end if/,
    'st.idleShown = false\n      WaitMsgSlices(msgPort, 1)\n    end if',
  );

  // Drain PostJS each loop after deferred work
  if (!t.includes('DrainOnePostJs()')) {
    t = replaceOnce(
      t,
      /MaybeRunDeferredBootWork\(ledStates, msgPort\)\r?\n    if type\(ev\) = "roVideoEvent" then/,
      'MaybeRunDeferredBootWork(ledStates, msgPort)\n    DrainOnePostJs()\n    if type(ev) = "roVideoEvent" then',
      'DrainOnePostJs insert',
    );
  }

  if (!t.includes('hang-harden')) {
    t = t.replace(
      /(' Docs-style[^\n]*)/,
      "$1\n' hang-harden: queued PostJS, single PlayFile, SD-only bus read, no mkdir/Sleep on hot path.",
    );
  }

  // Soften PlayNativeSrc: still try play if exists check fails for pool (false negatives)
  t = t.replace(
    /if not LocalMediaExists\(src\) then\r?\n      TraceFnBreak\("PlayNativeSrc", "media-missing"\)\r?\n      LedLog\("=== Perform6: LED " \+ st\.key \+ " media missing " \+ src \+ " ==="\)\r?\n      ok = false\r?\n    else\r?\n      ok = PlayLocalFile\(st\.vp, src\)\r?\n    end if/,
    `if LocalMediaExists(src) or IsExtensionlessPoolPath(src) then
      ok = PlayLocalFile(st.vp, src)
    else
      TraceFnBreak("PlayNativeSrc", "media-missing")
      LedLog("=== Perform6: LED " + st.key + " media missing " + src + " ===")
      ok = false
    end if`,
  );

  fs.writeFileSync(`brightsign/${name}`, t);
  const sleep500 = (t.match(/\n\s*Sleep\(500\)/g) || []).length;
  console.log(JSON.stringify({
    file: name,
    lines: `${origLines} -> ${t.split(/\r?\n/).length}`,
    drain: t.includes('DrainOnePostJs'),
    singlePlay: t.includes('Single BA-style attempt'),
    waitSlices: t.includes('Sub WaitMsgSlices'),
    bootSlices: t.includes('Sub BootSleepSlices'),
    noMkdir: t.includes('No CreateDirectory here'),
    sleep500,
  }));
  if (sleep500 > 0) throw new Error(`${name} still has Sleep(500)`);
}

for (const f of ['autorun-xt2145.brs', 'autorun-xc4055.brs', 'autorun-hd226.brs']) {
  patchFile(f);
}
