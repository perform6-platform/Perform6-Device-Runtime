' Perform6 BrightSign autorun — XT2145 (BrightAuthor-style zones)
' ZONE PRIMARY: PostBSMessage → PlayFile (BA zone). SD resume-only. No boot PostJSMessage.
' LED OPTIONAL: JS PostBSMessage(xt-playback). Never required. No auto-reboot on silence.
' Media: AssetPool GetPoolFilePath → PlayFile({Filename, ProbeString}) — NO on-demand HTTPS stream.
' Never SetUrl-recycle HtmlWidget after load-finished.
' Docs-style thin: zones + SD PlayFile + hang-proof Main. No wipe/FS/heal. No recovery auto-reboot.
' hang-harden: queued PostJS, single PlayFile, SD-only bus read, no mkdir/Sleep on hot path.
' Profile: XT2145 = React HDMI-1 + native LED HDMI-2.

Sub SafePrint(msg as String)
  print msg
End Sub

Function LedLogState() as Object
  g = GetGlobalAA()
  if type(g.p6LedLog) <> "roAssociativeArray" then
    g.p6LedLog = CreateObject("roAssociativeArray")
    g.p6LedLog.buf = ""
    g.p6LedLog.lines = 0
    g.p6LedLog.dirty = false
    g.p6LedLog.lastFlushMs = 0
  end if
  return g.p6LedLog
End Function

Sub FlushLedLog()
  st = LedLogState()
  if st.dirty <> true then return
  ' NEVER ReadAsciiFile(perform6-led.log) — field XT hang: Main dead after idle,
  ' heartbeat never written. Keep history in RAM, overwrite SD file.
  g = GetGlobalAA()
  hist = ""
  if type(g.p6LedHist) = "roString" or type(g.p6LedHist) = "String" then hist = g.p6LedHist
  hist = hist + st.buf
  if Len(hist) > 30000 then hist = Right(hist, 20000)
  g.p6LedHist = hist
  WriteAsciiFile("SD:/perform6-led.log", hist)
  st.buf = ""
  st.lines = 0
  st.dirty = false
  st.lastFlushMs = ProgressNowMs()
End Sub

Sub MaybeFlushLedLog()
  st = LedLogState()
  if st.dirty <> true then return
  lastMs = st.lastFlushMs
  nowMs = ProgressNowMs()
  if type(lastMs) <> "roInteger" and type(lastMs) <> "Integer" then lastMs = 0
  if nowMs - lastMs < 5000 and st.lines < 40 then return
  FlushLedLog()
End Sub

' LED playback trail also lands on the card: BrightScript prints do not always
' show up in the DWS log view, and this is the only output we can read remotely.
Sub LedLog(msg as String)
  SafePrint(msg)
  st = LedLogState()
  st.buf = st.buf + msg + Chr(10)
  st.lines = st.lines + 1
  st.dirty = true
  ' No auto-flush on boot spam — only MaybeFlushLedLog inside wait() loop.
End Sub

' --- Field debug: canary files + TRACE (rate-limited) → Admin ---


' Critical traces always; enter/exit spam only when traceAutorun=true.

' One SD write (skip duplicate /storage/sd unless verbose) — less Main I/O.
Sub CanaryWrite(path as String, text as String)
  WriteAsciiFile(path, text)
  if TraceVerboseEnabled() then
    if Left(path, 4) = "SD:/" then
      WriteAsciiFile("/storage/sd/" + Mid(path, 5), text)
    end if
  end if
End Sub





Sub WriteBootCanary()
  CanaryWrite("SD:/perform6-boot-canary.txt", "boot-reached|" + IntToStr(ProgressNowMs()))
  TraceLog("MAIN|boot-canary|written")
End Sub

' Field breadcrumb: last boot step → perform6-boot-canary.txt (one small overwrite).
' Debug trail file written only AFTER loop-enter (pre-loop SD spam can hang Main).
Sub WriteBootStepCanary(step as String)
  if Len(step) = 0 then return
  line = step + "|" + IntToStr(ProgressNowMs())
  CanaryWrite("SD:/perform6-boot-canary.txt", line)
  SafePrint("=== Perform6: boot-step " + step + " ===")
  g = GetGlobalAA()
  trail = ""
  if type(g.p6DebugTrail) = "roString" or type(g.p6DebugTrail) = "String" then trail = g.p6DebugTrail
  trail = trail + line + Chr(10)
  if Len(trail) > 4000 then trail = Right(trail, 3000)
  g.p6DebugTrail = trail
  if g.p6LoopAlive = true then
    WriteAsciiFile("SD:/perform6-debug-f6ed41.txt", trail)
  end if
  ' Always flush so field can see last boundary even if Main stalls next.
  FlushLedLog()
End Sub

Sub WriteMainHeartbeat()
  ms = ProgressNowMs()
  ' Marker f6ed41 proves NEW autorun is on the card (Admin/JS can detect).
  CanaryWrite("SD:/perform6-heartbeat.txt", "alive-f6ed41-" + IntToStr(ms))
  SafePrint("=== Perform6: heartbeat alive-f6ed41-" + IntToStr(ms) + " ===")
End Sub

' LED play = SD JSON poll. Never PostJSMessage on boot — it can hang Main forever.
Sub ScheduleDeferredBootResume()
  g = GetGlobalAA()
  g.p6BootResumePending = true
  g.p6BootResumePass = 0
  g.p6BootResumeSpan = CreateObject("roTimespan")
  if type(g.p6BootResumeSpan) = "roTimespan" then g.p6BootResumeSpan.Mark()
End Sub

Sub ScheduleDeferredWorkersAndOps()
  g = GetGlobalAA()
  g.p6DeferWorkersOps = true
End Sub

' One small unit per call — never block wait()/poll behind workers+resume.
Sub MaybeRunDeferredBootWork(states as Object, msgPort as Object)
  g = GetGlobalAA()

  if g.p6BootResumePending = true then
    pass = g.p6BootResumePass
    if type(pass) <> "roInteger" and type(pass) <> "Integer" then pass = 0

    if pass = 0 then
      WriteBootStepCanary("boot-resume-1-enter")
      MaybeResumePlaybackFromFile(states, msgPort, "boot")
      WriteBootStepCanary("boot-resume-1-done")
      g.p6BootResumePass = 1
      if type(g.p6BootResumeSpan) <> "roTimespan" then
        g.p6BootResumeSpan = CreateObject("roTimespan")
      end if
      if type(g.p6BootResumeSpan) = "roTimespan" then g.p6BootResumeSpan.Mark()
      return
    end if

    if pass = 1 then
      if type(g.p6BootResumeSpan) = "roTimespan" then
        if g.p6BootResumeSpan.TotalMilliseconds() < 500 then return
      end if
      WriteBootStepCanary("boot-resume-2-enter")
      MaybeResumePlaybackFromFile(states, msgPort, "boot2")
      WriteBootStepCanary("boot-resume-2-done")
      g.p6BootResumePending = false
      return
    end if
  end if

  ' Workers/ops only after resume finished — never same tick as first PlayFile.
  if g.p6DeferWorkersOps = true then
    WriteBootStepCanary("deferred-workers-enter")
    html = ResolveBridgeHtml(states)
    EnsureDeferredWorkers(states, html)
    WriteBootStepCanary("deferred-workers-done")
    ProcessOpsOnBoot(states)
    WriteBootStepCanary("deferred-ops-done")
    g.p6DeferWorkersOps = false
  end if
End Sub

Sub WritePlayfileCanary(phase as String, path as String, okFlag as String)
  ' Skip noisy "trying|?" unless verbose — still log fail / ok.
  if phase = "trying" and not TraceVerboseEnabled() then return
  line = phase + "|" + path + "|ok=" + okFlag + "|ms=" + IntToStr(ProgressNowMs())
  CanaryWrite("SD:/perform6-playfile-attempt.txt", line)
  TraceLog("PLAY|" + line)
End Sub






Sub AttachHtmlWidgetPort(html as Object, msgPort as Object)
  ' BrightSign: cfg.port alone is not always enough — always SetPort after create
  ' so JS→autorun roHtmlWidgetEvent and autorun→JS PostJSMessage share one port.
  if type(html) <> "roHtmlWidget" then return
  if type(msgPort) <> "roMessagePort" then return
  html.SetPort(msgPort)
End Sub

Function TryCreateHtmlWidget(rect as Object, msgPort as Object, url as String) as Object
  html = invalid

  cfg = CreateObject("roAssociativeArray")
  cfg.url = url
  cfg.port = msgPort
  cfg.mouse_enabled = true
  cfg.brightsign_js_objects_enabled = true
  cfg.javascript_enabled = true
  cfg.nodejs_enabled = true
  html = CreateObject("roHtmlWidget", rect, cfg)
  if type(html) = "roHtmlWidget" then
    AttachHtmlWidgetPort(html, msgPort)
    SafePrint("=== Perform6: HtmlWidget modern config OK (nodejs) ===")
    return html
  end if

  cfg2 = CreateObject("roAssociativeArray")
  cfg2.url = url
  cfg2.port = msgPort
  cfg2.brightsign_js_objects_enabled = true
  cfg2.javascript_enabled = true
  html = CreateObject("roHtmlWidget", rect, cfg2)
  if type(html) = "roHtmlWidget" then
    AttachHtmlWidgetPort(html, msgPort)
    SafePrint("=== Perform6: HtmlWidget minimal config OK ===")
    return html
  end if

  ' Never create a widget without msgPort + JS objects (orphan / mute bridge).
  cfg3 = CreateObject("roAssociativeArray")
  cfg3.url = url
  cfg3.port = msgPort
  cfg3.brightsign_js_objects_enabled = true
  cfg3.javascript_enabled = true
  html = CreateObject("roHtmlWidget", rect, cfg3)
  if type(html) = "roHtmlWidget" then
    AttachHtmlWidgetPort(html, msgPort)
    SafePrint("=== Perform6: HtmlWidget url+port config OK ===")
    return html
  end if

  html = CreateObject("roHtmlWidget", rect)
  if type(html) = "roHtmlWidget" then
    SafePrint("=== Perform6: HtmlWidget classic constructor OK ===")
    AttachHtmlWidgetPort(html, msgPort)
    html.EnableJavascript(true)
    html.SetUrl(url)
    return html
  end if

  return invalid
End Function

Sub EnableJsObjectsSafe(html as Object)
  ' JS objects are enabled via brightsign_js_objects_enabled on widget create.
  ' AllowJavaScriptUrls is deprecated on BrightSignOS 9.1+ (log spam / ignored).
  if type(html) <> "roHtmlWidget" then return
End Sub

Function CreateAudioOutputSafe(outputName as String) as Object
  ao = CreateObject("roAudioOutput", outputName)
  if type(ao) = "roAudioOutput" then return ao

  ' Some Series 5 firmware builds accept the documented colon alias.
  if outputName = "hdmi-1" then ao = CreateObject("roAudioOutput", "hdmi:1")
  if outputName = "hdmi-2" then ao = CreateObject("roAudioOutput", "hdmi:2")
  if outputName = "hdmi-3" then ao = CreateObject("roAudioOutput", "hdmi:3")
  if outputName = "hdmi-4" then ao = CreateObject("roAudioOutput", "hdmi:4")
  if type(ao) = "roAudioOutput" then return ao

  LedLog("=== Perform6: audio output unavailable " + outputName + " ===")
  return invalid
End Function

Sub RoutePlayerAudio(player as Object, outputName as String)
  ao = CreateAudioOutputSafe(outputName)
  if type(ao) <> "roAudioOutput" then return

  pcmOk = player.SetPcmAudioOutputs(ao)
  compressedOk = player.SetCompressedAudioOutputs(ao)
  pcmText = "false"
  compressedText = "false"
  if pcmOk = true then pcmText = "true"
  if compressedOk = true then compressedText = "true"
  LedLog("=== Perform6: audio route " + outputName + " PCM=" + pcmText + " compressed=" + compressedText + " ===")
End Sub

Sub ConfigureAudioResources(profile as String)
  if profile <> "XT2145" and profile <> "XC4055" then return

  ac = CreateObject("roAudioConfiguration")
  if type(ac) <> "roAudioConfiguration" then
    LedLog("=== Perform6: roAudioConfiguration unavailable ===")
    return
  end if

  cfg = CreateObject("roAssociativeArray")
  cfg.mode = "prerouted"
  cfg.autolevel = "off"
  cfg.pcmonly = "true"
  cfg.srcrate = 48000
  ok = ac.ConfigureAudio(cfg)
  result = "false"
  if ok = true then result = "true"
  LedLog("=== Perform6: prerouted PCM audio " + result + " ===")
End Sub

Function TryCreateVideoPlayer(rect as Object, msgPort as Object, userTag as Integer, audioOutput as String) as Object
  if type(rect) <> "roRectangle" then
    return invalid
  end if

  vp = CreateObject("roVideoPlayer")
  if type(vp) <> "roVideoPlayer" then
    SafePrint("=== Perform6: ERROR roVideoPlayer unavailable ===")
    return invalid
  end if

  vp.SetRectangle(rect)
  vp.SetPort(msgPort)
  vp.SetUserData(userTag)
  vp.SetLoopMode(true)
  RoutePlayerAudio(vp, audioOutput)
  return vp
End Function

Function AsBrString(value as Object) as String
  if type(value) = "roString" or type(value) = "String" then return value
  return ""
End Function

Function EventLookup(data as Object, key as String) as Object
  if type(data) <> "roAssociativeArray" then return invalid
  return data.Lookup(key)
End Function

Function CoerceMessagePayload(raw as Object) as Object
  if type(raw) = "roAssociativeArray" then return raw
  text = AsBrString(raw)
  if Len(text) = 0 then return invalid
  if Left(text, 1) <> "{" then return invalid
  parsed = ParseJSON(text)
  if type(parsed) = "roAssociativeArray" then return parsed
  return invalid
End Function

Function ExtractJsPayload(data as Object) as Object
  if type(data) <> "roAssociativeArray" then return invalid
  nested = CoerceMessagePayload(EventLookup(data, "message"))
  if type(nested) <> "roAssociativeArray" then
    nested = CoerceMessagePayload(data.message)
  end if
  if type(nested) = "roAssociativeArray" then return nested
  if Len(PayloadString(data, "type")) > 0 then return data
  return invalid
End Function

Function HtmlWidgetEventReason(data as Object) as String
  reason = AsBrString(EventLookup(data, "reason"))
  if Len(reason) = 0 then reason = AsBrString(data.reason)
  return reason
End Function

Function ResolveBridgeHtml(states as Object) as Object
  html = ResolveP6Html(states, invalid)
  if type(html) = "roHtmlWidget" then return html
  g = GetGlobalAA()
  if type(g.p6Html) = "roHtmlWidget" then return g.p6Html
  if type(g.htmlTouch) = "roHtmlWidget" then return g.htmlTouch
  if type(g.htmlPrimary) = "roHtmlWidget" then return g.htmlPrimary
  if type(g.html) = "roHtmlWidget" then return g.html
  return invalid
End Function

Sub PostJsToWidget(html as Object, msg as Object)
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
End Sub

Function PayloadString(payload as Object, key as String) as String
  if type(payload) <> "roAssociativeArray" then
    return ""
  end if
  value = invalid
  if key = "src" then
    value = payload.src
  else if key = "fallbackSrc" then
    value = payload.fallbackSrc
  else if key = "type" then
    value = payload.Lookup("type")
  else if key = "role" then
    value = payload.role
  else if key = "target" then
    value = payload.target
  else if key = "urls" then
    value = payload.urls
  else if key = "ids" then
    value = payload.ids
  else if key = "sizes" then
    value = payload.sizes
  else if key = "append" then
    value = payload.append
  else if key = "priority" then
    value = payload.priority
  else if key = "prune" then
    value = payload.prune
  else if key = "count" then
    value = payload.count
  else if key = "fileUrls" then
    value = payload.fileUrls
  else if key = "filePaths" then
    value = payload.filePaths
  else if key = "fileSizes" then
    value = payload.fileSizes
  else if key = "authBearer" then
    value = payload.authBearer
  else if key = "deviceId" then
    value = payload.deviceId
  else if key = "version" then
    value = payload.version
  else if key = "requestId" then
    value = payload.requestId
  else if key = "content" then
    value = payload.content
  else if key = "path" then
    value = payload.path
  else if key = "encoding" then
    value = payload.encoding
  else if key = "fileUrl" then
    value = payload.fileUrl
  else if key = "filePath" then
    value = payload.filePath
  else if key = "fileSize" then
    value = payload.fileSize
  else if key = "mediaVersionId" then
    value = payload.mediaVersionId
  else if key = "mediaTitle" then
    value = payload.mediaTitle
  else if key = "screenKey" then
    value = payload.screenKey
  else if key = "reason" then
    value = payload.Lookup("reason")
    if type(value) = "Invalid" then value = payload.reason
  else
    value = payload.Lookup(key)
  end if
  if type(value) = "roString" or type(value) = "String" then
    return value
  end if
  if type(value) = "roInt" or type(value) = "Integer" or type(value) = "Float" then
    s = StrI(Int(value))
    while Len(s) > 0 and Left(s, 1) = " "
      s = Mid(s, 2)
    end while
    return s
  end if
  return ""
End Function

Function PayloadBool(payload as Object, key as String, fallback as Boolean) as Boolean
  if type(payload) <> "roAssociativeArray" then
    return fallback
  end if
  value = invalid
  if key = "loop" then
    value = payload.loop
  else if key = "paused" then
    value = payload.paused
  else if key = "muted" then
    value = payload.muted
  end if

  if type(value) = "Boolean" or type(value) = "roBoolean" then
    return value
  end if
  if type(value) = "roInt" or type(value) = "Integer" or type(value) = "Float" then
    return (Int(value) <> 0)
  end if
  if type(value) = "roString" or type(value) = "String" then
    text = LCase(value)
    if text = "true" or text = "1" or text = "yes" then return true
    if text = "false" or text = "0" or text = "no" then return false
  end if
  return fallback
End Function

Function PayloadInt(payload as Object, key as String, fallback as Integer) as Integer
  if type(payload) <> "roAssociativeArray" then
    return fallback
  end if
  value = invalid
  if key = "restartNonce" then
    value = payload.restartNonce
  else if key = "volumePercent" then
    value = payload.volumePercent
  else if key = "chunkIndex" then
    value = payload.chunkIndex
  else if key = "chunkTotal" then
    value = payload.chunkTotal
  else
    ' Generic lookup for other numeric payload keys
    value = payload.Lookup(key)
  end if

  if type(value) = "roInt" or type(value) = "Integer" or type(value) = "Float" then
    return Int(value)
  end if
  if type(value) = "roString" or type(value) = "String" then
    if Len(value) > 0 then return Int(Val(value))
  end if
  return fallback
End Function

Sub ApplyLedVolume(st as Object, payload as Object)
  if type(st) <> "roAssociativeArray" then return
  if type(st.vp) <> "roVideoPlayer" then return

  muted = PayloadBool(payload, "muted", false)
  percent = PayloadInt(payload, "volumePercent", 100)
  if muted then percent = 0
  if percent < 0 then percent = 0
  if percent > 100 then percent = 100

  if st.volumePercent = percent then return
  st.volumePercent = percent
  st.vp.SetVolume(percent)
  LedLog("=== Perform6: LED " + st.key + " volume " + IntToStr(percent) + " ===")
End Sub

Sub ApplyLedPauseState(st as Object)
  if type(st) <> "roAssociativeArray" then return
  if type(st.vp) <> "roVideoPlayer" then return

  if st.paused then
    st.vp.Pause()
  else
    st.vp.Resume()
  end if
End Sub

Function HasVideoExtension(src as String) as Boolean
  low = LCase(src)
  q = Instr(1, low, "?")
  if q > 0 then low = Left(low, q - 1)
  if Right(low, 4) = ".mp4" then return true
  if Right(low, 4) = ".mov" then return true
  if Right(low, 4) = ".m4v" then return true
  if Right(low, 5) = ".webm" then return true
  return false
End Function

Function IsPlayableNativeSrc(src as String) as Boolean
  if Len(src) = 0 then
    return false
  end if
  if Left(src, 5) = "blob:" then
    return false
  end if
  ' HTTPS/HTTP MP4 is VOD - never play from the network. RTSP/UDP live is OK.
  low = LCase(src)
  if Left(low, 7) = "http://" then return false
  if Left(low, 8) = "https://" then return false
  ' AssetPool GetPoolFilePath — PlayFile accepts hash pathnames (BrightAuthor plugin pattern).
  if Instr(1, low, "perform6-media-pool") > 0 then
    if Left(low, 4) = "sd:/" then return true
    if Left(low, 12) = "/storage/sd/" then return true
    if Left(low, 17) = "file:///sd:/" then return true
    if Left(low, 23) = "file:///storage/sd/" then return true
    return false
  end if
  if not HasVideoExtension(src) then return false
  return true
End Function

' BrightScript reads "https://x" as drive "https" - network URLs must never be
' passed to PlayFile() as a plain string ("Bad drive"). They go through roRtspStream.
Function IsNetworkSrc(src as String) as Boolean
  low = LCase(src)
  if Left(low, 7) = "http://" then return true
  if Left(low, 8) = "https://" then return true
  if Left(low, 7) = "rtsp://" then return true
  if Left(low, 6) = "rtp://" then return true
  if Left(low, 6) = "udp://" then return true
  return false
End Function

' HtmlWidget / Node use file:///SD:/… or /storage/sd/… — roVideoPlayer wants SD:/…
Function NormalizeLocalSrc(src as String) as String
  if Left(src, 15) = "file:///SD:/" then
    return "SD:/" + Mid(src, 16)
  end if
  if Left(src, 14) = "file://SD:/" then
    return "SD:/" + Mid(src, 15)
  end if
  ' Node AssetPool / OS 9.1 mount → BrightScript drive path
  if Left(src, 23) = "file:///storage/sd/" then
    return "SD:/" + Mid(src, 24)
  end if
  if Left(src, 22) = "file://storage/sd/" then
    return "SD:/" + Mid(src, 23)
  end if
  if Left(src, 12) = "/storage/sd/" then
    return "SD:/" + Mid(src, 13)
  end if
  if src = "/storage/sd" or src = "/storage/sd/" then
    return "SD:/"
  end if
  return src
End Function

' Idle logo candidates: BrightScript SD:/ first, then Node mount alias.
Function IdlePathCandidates(name as String) as Object
  paths = CreateObject("roArray", 1, true)
  paths.Push("SD:/" + name)
  return paths
End Function

Function IdleFilePresent(name as String) as Boolean
  if FileExistsIn("SD:/", name) then return true
  return false
End Function

Function IntToStr(value as Integer) as String
  s = StrI(value)
  while Len(s) > 0 and Left(s, 1) = " "
    s = Mid(s, 2)
  end while
  return s
End Function

' ---------------------------------------------------------------------------
' BrightSign-safe byte sizes (docs): do NOT funnel multi-GB through 32-bit Integer.
' Integer max is 2,147,483,647 (~2.15 GB). Use Float/Val (exact to 2^53) or
' LongInteger when present. Free space: compare in MB via GetFreeInMegabytes().
' ---------------------------------------------------------------------------

Function CacheDir() as String
  ' Single authoritative playable store (Bluefin + LED).
  return "SD:/perform6-media"
End Function

Function MediaPoolDir() as String
  return "SD:/perform6-media-pool"
End Function

Function FileExistsIn(dir as String, name as String) as Boolean
  files = MatchFiles(dir, name)
  if type(files) = "roList" or type(files) = "roArray" then
    return files.Count() > 0
  end if
  return false
End Function

' Returns Float byte count — never 32-bit Integer (multi-GB media safe).
Function PartFileBytes(path as String) as Float
  fs = CreateObject("roFileSystem")
  if type(fs) <> "roFileSystem" then return 0.0
  stat = fs.Stat(path)
  if type(stat) <> "roAssociativeArray" then return 0.0
  return ParseByteSize(stat.size)
End Function


Function CreateLedState(vp as Object, key as String) as Object
  st = CreateObject("roAssociativeArray")
  st.vp = vp
  st.key = key
  st.nonce = 0
  st.loopMode = true
  st.paused = false
  st.wantUrl = ""
  st.playingUrl = ""
  st.localName = ""
  st.idleShown = false
  st.volumePercent = -1
  st.ignoreEnded = false
  st.ignoreEndedSpan = invalid
  st.stream = invalid
  st.xfer = invalid
  st.xferUrl = ""
  st.xferTmp = ""
  st.xferDest = ""
  st.xferName = ""
  return st
End Function

Function LocalMediaExists(path as String) as Boolean
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
End Function

' True for AssetPool hash objects (no .mp4). BrightAuthor plays these via
' PlayFile({Filename: GetPoolFilePath(...)[, ProbeString]}) — extensionless is valid.
Function IsExtensionlessPoolPath(path as String) as Boolean
  low = LCase(path)
  if Instr(1, low, "perform6-media-pool") = 0 then return false
  if HasVideoExtension(path) then return false
  return true
End Function

Function PathLeafName(path as String) as String
  path = NormalizeLocalSrc(path)
  leaf = path
  while Instr(1, leaf, "/") > 0
    leaf = Mid(leaf, Instr(1, leaf, "/") + 1)
  end while
  while Instr(1, leaf, "\") > 0
    leaf = Mid(leaf, Instr(1, leaf, "\") + 1)
  end while
  return leaf
End Function

' Expected .mp4 alias path for an extensionless pool leaf (no I/O).
' Alias presence on SD is the persist signal that this hash needs .mp4 PlayFile.
Function PoolMp4AliasPath(poolPath as String) as String
  poolPath = NormalizeLocalSrc(poolPath)
  if not IsExtensionlessPoolPath(poolPath) then return ""
  leaf = PathLeafName(poolPath)
  if Len(leaf) = 0 then return ""
  if Right(LCase(leaf), 4) = ".mp4" then return ""
  return CacheDir() + "/" + leaf + ".mp4"
End Function

' Pool play: existing .mp4 alias-hit if present, else pool-direct + ProbeString (no CopyFile).

' BrightAuthor on-demand: GetPoolFilePath → PlayFile({Filename[, ProbeString]}).
' One attempt only — no alias-first / dual-mount / string+AA stack (hang risk).

Function TryPlayFileOnce(vp as Object, p as String) as Boolean
  TraceFnEnter("TryPlayFileOnce", p)
  WritePlayfileCanary("trying", p, "?")
  aa = CreateObject("roAssociativeArray")
  aa.Filename = p
  if IsExtensionlessPoolPath(p) then
    ' BA Connected / AssetPool: extensionless hash needs ProbeString media type.
    aa.ProbeString = "mp4"
  end if
  ok = vp.PlayFile(aa)
  if ok = true then
    WritePlayfileCanary("ok-ba-filename", p, "1")
    TraceFnExit("TryPlayFileOnce", "ok")
    return true
  end if
  WritePlayfileCanary("fail", p, "0")
  TraceFnExit("TryPlayFileOnce", "false")
  return false
End Function

' BA on-demand play of local/pool path (JS already resolved GetPoolFilePath → SD:/…).
Function PlayLocalFile(vp as Object, path as String) as Boolean
  TraceFnEnter("PlayLocalFile", path)
  path = NormalizeLocalSrc(path)
  isPool = IsExtensionlessPoolPath(path)

  if TryPlayFileOnce(vp, path) then
    if isPool then
      LedLog("=== Perform6: PlayLocalFile pool-direct OK " + path + " ===")
    else
      LedLog("=== Perform6: PlayLocalFile BA-OK " + path + " ===")
    end if
    TraceFnExit("PlayLocalFile", "ok|" + path)
    return true
  end if
  LedLog("=== Perform6: PlayLocalFile exhausted " + path + " ===")
  TraceFnExit("PlayLocalFile", "exhausted")
  return false
End Function

' After HtmlWidget.Show — attach cache/OTA workers so boot never blocks on SD downloads.
Sub BootSleepSlices(totalMs as Integer)
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

Sub RememberP6Html(html as Object)
  if type(html) <> "roHtmlWidget" then return
  g = GetGlobalAA()
  g.p6Html = html
End Sub

Function ResolveP6Html(states as Object, worker as Object) as Object
  if type(worker) = "roAssociativeArray" then
    if type(worker.notifyHtml) = "roHtmlWidget" then return worker.notifyHtml
  end if
  g = GetGlobalAA()
  if type(g.p6Html) = "roHtmlWidget" then return g.p6Html
  return ResolveBridgeHtml(states)
End Function

' One clock for the whole autorun - a fresh roTimespan is always ~0ms and
' breaks progress throttling + deferred cache-complete.
Function ProgressNowMs() as Integer
  g = GetGlobalAA()
  if type(g.progressClock) <> "roTimespan" then
    g.progressClock = CreateObject("roTimespan")
  end if
  return g.progressClock.TotalMilliseconds()
End Function

' --- Mini-DWS: thin SD list/read/write/delete (message handlers only; never on boot) ---

' SD capacity for Admin heartbeat (free / size / used in megabytes).

' BrightSign docs: ListDir(path) returns directory entries (files + folders).
' MatchFiles is a fallback for older behavior / pattern filters.

Sub RebootDeviceAfterOta()
  LedLog("=== Perform6: player reboot ===")
  FlushLedLog()
  restart = CreateObject("roSystemRestart")
  if type(restart) = "roSystemRestart" then restart.Reboot()
  Sleep(5000)
End Sub

' Bridge heal marker: auto-reboot while stuck; refuse until cooldown expires
' or JS proves round-trip (led-bridge-healthy). Prevents reboot-loops.

Sub RememberAppUrl(kind as String, appUrl as String)
  if Len(appUrl) = 0 then return
  g = GetGlobalAA()
  if kind = "touch" then
    g.appUrlTouch = appUrl
  else if kind = "primary" then
    g.appUrlPrimary = appUrl
  else
    g.appUrlSingle = appUrl
  end if
End Sub



Sub InitBridgeWatch()
  g = GetGlobalAA()
  g.bridgeEverSeen = false
  g.bridgeLastSpan = CreateObject("roTimespan")
  g.bridgeBootSpan = CreateObject("roTimespan")
  g.healRefuseLogSpan = CreateObject("roTimespan")
  if type(g.bridgeLastSpan) = "roTimespan" then g.bridgeLastSpan.Mark()
  if type(g.bridgeBootSpan) = "roTimespan" then g.bridgeBootSpan.Mark()
  if type(g.healRefuseLogSpan) = "roTimespan" then g.healRefuseLogSpan.Mark()
End Sub

Sub NoteBridgeActivity()
  g = GetGlobalAA()
  g.bridgeEverSeen = true
  if type(g.bridgeLastSpan) <> "roTimespan" then
    g.bridgeLastSpan = CreateObject("roTimespan")
  end if
  if type(g.bridgeLastSpan) = "roTimespan" then g.bridgeLastSpan.Mark()
End Sub


Sub HandleLedBridgePing(states as Object)
  NoteBridgeActivity()
  html = ResolveBridgeHtml(states)
  if type(html) <> "roHtmlWidget" then
    g = GetGlobalAA()
    if type(g.htmlTouch) <> "roHtmlWidget" and type(g.htmlPrimary) <> "roHtmlWidget" and type(g.html) <> "roHtmlWidget" and type(g.p6Html) <> "roHtmlWidget" then
      LedLog("=== Perform6: bridge ping — no HtmlWidget for pong ===")
      return
    end if
  end if
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-bridge-pong")
  msg.AddReplace("protocolVersion", "2")
  msg.AddReplace("features", "ota-ping,ota-reboot,playback-ack,sd-led-bus")
  msg.busy = "0"
  PostJsMessage(html, msg)
  ' Quiet hot path — pong every 15s was flooding SD log I/O on the video thread.
End Sub

Sub HandleLedHello(payload as Object, states as Object)
  NoteBridgeActivity()
  html = ResolveBridgeHtml(states)
  if type(html) <> "roHtmlWidget" then
    g = GetGlobalAA()
    if type(g.htmlTouch) <> "roHtmlWidget" and type(g.htmlPrimary) <> "roHtmlWidget" and type(g.html) <> "roHtmlWidget" and type(g.p6Html) <> "roHtmlWidget" then
      LedLog("=== Perform6: led-hello — no HtmlWidget for ack ===")
      return
    end if
  end if
  jsVersion = PayloadString(payload, "runtimeVersion")
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-hello-ack")
  msg.AddReplace("protocolVersion", "2")
  msg.AddReplace("features", "ota-ping,ota-reboot,playback-ack,sd-led-bus")
  msg.AddReplace("autorunRelease", "1.5.8")
  PostJsMessage(html, msg)
  g = GetGlobalAA()
  lastJs = ""
  if type(g.p6LastHelloJs) = "roString" or type(g.p6LastHelloJs) = "String" then lastJs = g.p6LastHelloJs
  helloCount = 0
  if type(g.p6HelloCount) = "roInt" or type(g.p6HelloCount) = "Integer" then helloCount = g.p6HelloCount
  helloCount = helloCount + 1
  g.p6HelloCount = helloCount
  ' Always log first ack + every 10th / version change so SD log proves JS→autorun.
  if helloCount = 1 or helloCount mod 10 = 0 or jsVersion <> lastJs then
    g.p6LastHelloJs = jsVersion
    if Len(jsVersion) > 0 then
      LedLog("=== Perform6: led-hello-ack protocol=2 js=" + jsVersion + " ===")
    else
      LedLog("=== Perform6: led-hello-ack protocol=2 ===")
    end if
  end if
End Sub




' One automatic recovery reboot after a fatal boot error; avoids silent blank forever.


Sub FatalHang(msg as String)
  LedLog(msg)
  SafePrint(msg)
  TraceLog("MAIN|FATAL|" + msg)
  CanaryWrite("SD:/perform6-fatal-canary.txt", msg)
  ' Docs-style: no recovery auto-reboot. Soft-alive so Admin sees heartbeat/logs.
  LedLog("=== Perform6: FATAL soft-alive (no auto-reboot; fix SD / Admin reboot) ===")
  FlushLedLog()
  while true
    WriteMainHeartbeat()
    CanaryWrite("SD:/perform6-fatal-canary.txt", "soft-alive|" + IntToStr(ProgressNowMs()))
    FlushLedLog()
    Sleep(15000)
  end while
End Sub


' --- Thin: no HTTP prefetch/OTA in autorun. Keep media wipe + storage + log-tail. ---





' Returns true if more work remains (call again later — keeps Main responsive).



' Heartbeat tick: delete up to ~40 entries then return (no multi-minute Main block).

Function ReadLogTail(path as String, maxChars as Integer) as String
  existing = ReadAsciiFile(path)
  if type(existing) <> "roString" and type(existing) <> "String" then return ""
  if Len(existing) <= maxChars then return existing
  return Right(existing, maxChars)
End Function

Sub PostLedLogTail(html as Object, requestId as String, text as String)
  if type(html) <> "roHtmlWidget" then return
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-log-tail")
  msg.AddReplace("requestId", requestId)
  msg.AddReplace("text", text)
  PostJsMessage(html, msg)
End Sub


' --- Docs-style stubs (JS owns cache/OTA/wipe/FS) ---
Sub TraceLog(msg as String)
End Sub

Sub TraceFnEnter(name as String, detail as String)
End Sub

Sub TraceFnExit(name as String, result as String)
End Sub

Sub TraceFnBreak(name as String, reason as String)
  LedLog("TRACE|FN|break|" + name + "|" + reason)
End Sub

Function TraceVerboseEnabled() as Boolean
  return false
End Function

Sub SetTraceVerbose(enabled as Boolean)
End Sub

Sub ClearBootFailMarker()
  DeleteFile("SD:/perform6-boot-fail")
End Sub

Sub HandleLedPrefetch(payload as Object, msgPort as Object, states as Object)
  LedLog("=== Perform6: led-cache-prefetch ignored (use JS AssetPool) ===")
End Sub

Sub HandleLedCacheClearAll(states as Object)
  LedLog("=== Perform6: led-cache-clear-all ignored (use JS Node wipe) ===")
End Sub

Sub HandleLedOtaInstall(payload as Object, msgPort as Object, states as Object)
  LedLog("=== Perform6: led-ota-install ignored (use JS OTA AssetPool) ===")
End Sub

Sub HandleLedBridgeHeal(payload as Object)
  LedLog("=== Perform6: bridge heal ignored (docs-style — no auto-reboot) ===")
End Sub

Sub HandleLedBridgeRecycle(payload as Object, states as Object)
  LedLog("=== Perform6: html recycle refused (docs-style — no SetUrl) ===")
End Sub

Sub WriteXtPlaybackStatus(st as Object, detail as String, ended as Boolean)
  WriteLedPlaybackStatus(st, detail, ended)
End Sub

Sub WriteXtBusHeartbeat(detail as String, src as String)
  WriteLedBusHeartbeat(detail, src)
End Sub

Sub EnsureDeferredWorkers(states as Object, html as Object)
  RememberP6Html(html)
  ' No CreateDirectory here — JS/AssetPool owns dirs; mkdir can stall Main on some cards.
  LedLog("=== Perform6: thin autorun — media dirs only (no HTTP workers) ===")
End Sub







Sub HandleLedOtaPing(states as Object)
  html = ResolveBridgeHtml(states)
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-ota-pong")
  msg.ok = "1"
  msg.detail = "thin-autorun-js-ota"
  PostJsMessage(html, msg)
End Sub








Sub HandleLedStorageInfo(states as Object)
  html = ResolveBridgeHtml(states)
  freeMb = 0
  sizeMb = 0
  si = CreateObject("roStorageInfo", "SD:/")
  if type(si) = "roStorageInfo" then
    freeVal = si.GetFreeInMegabytes()
    if type(freeVal) = "roInteger" or type(freeVal) = "Integer" then freeMb = freeVal
    sizeVal = si.GetSizeInMegabytes()
    if type(sizeVal) = "roInteger" or type(sizeVal) = "Integer" then sizeMb = sizeVal
  end if
  usedMb = 0
  if sizeMb > freeMb then usedMb = sizeMb - freeMb
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-storage-info-result")
  msg.freeMb = IntToStr(freeMb)
  msg.capacityMb = IntToStr(sizeMb)
  msg.usedMb = IntToStr(usedMb)
  PostJsMessage(html, msg)
  LedLog("=== Perform6: storage info freeMb=" + IntToStr(freeMb) + " sizeMb=" + IntToStr(sizeMb) + " ===")
End Sub

Sub HandleLedLogTailRequest(payload as Object, states as Object)
  FlushLedLog()
  html = ResolveBridgeHtml(states)
  tail = ReadLogTail("SD:/perform6-led.log", 48000)
  PostLedLogTail(html, PayloadString(payload, "requestId"), tail)
End Sub

Sub PlayNativeSrc(st as Object, src as String, msgPort as Object, states as Object)
  TraceFnEnter("PlayNativeSrc", st.key + "|" + src)
  ok = false
  st.localName = ""
  ' A fresh decoder session starts at default volume - force the next re-apply.
  st.volumePercent = -1
  src = NormalizeLocalSrc(src)

  wasIdle = (st.idleShown = true)

  if IsNetworkSrc(src) then
    ' Thin autorun: no HTTP cache worker. RTSP disabled; HTTPS must be local pool path.
    TraceFnBreak("PlayNativeSrc", "network-src")
    LedLog("=== Perform6: LED " + st.key + " wait cache (no HTTPS/network play) ===")
    WriteXtPlaybackStatus(st, "wait-cache", false)
    WriteLedBusHeartbeat("wait-cache-" + st.key, src)
    if st.idleShown <> true then PlayIdleClip(st)
    FlushLedLog()
    TraceFnExit("PlayNativeSrc", "wait-cache")
    return
  else
    if wasIdle then
      st.vp.StopClear()
      st.vp.SetViewMode("FillScreenAndCentered")
      st.idleShown = false
      WaitMsgSlices(msgPort, 1)
    end if
    ' BA: PlayFile immediately — no Exists pre-check (false negatives delay on-demand).
    st.vp.SetLoopMode(st.loopMode)
    ok = PlayLocalFile(st.vp, src)
  end if

  if ok then
    st.playingUrl = src
    st.idleShown = false
    st.vp.SetLoopMode(st.loopMode)
    if st.paused then
      st.vp.Pause()
    else
      st.vp.Resume()
    end if
    LedLog("=== Perform6: LED " + st.key + " play OK " + src + " ===")
    TraceFnExit("PlayNativeSrc", "play-OK")
  else
    st.playingUrl = ""
    LedLog("=== Perform6: LED " + st.key + " play FAILED " + src + " ===")
    TraceFnExit("PlayNativeSrc", "play-FAILED")
    ' Always restore splash after a failed swap — wasIdle alone missed some clears.
    if st.idleShown = false then PlayIdleClip(st)
  end if
  FlushLedLog()
End Sub

Sub ApplyNativePlayback(st as Object, payload as Object, msgPort as Object, states as Object)
  TraceFnEnter("ApplyNativePlayback", st.key)
  if type(st) <> "roAssociativeArray" then
    TraceFnBreak("ApplyNativePlayback", "no-state")
    return
  end if
  if type(st.vp) <> "roVideoPlayer" then
    TraceFnBreak("ApplyNativePlayback", "no-video-player")
    PostPlaybackAck(states, st, payload, false, "no video player")
    WriteXtPlaybackStatus(st, "no video player", false)
    TraceFnExit("ApplyNativePlayback", "no-vp")
    return
  end if

  src = PayloadString(payload, "src")
  fallbackSrc = PayloadString(payload, "fallbackSrc")
  assetName = PayloadString(payload, "assetName")
  mediaId = PayloadString(payload, "mediaVersionId")
  ' src = JS GetPoolFilePath (AssetPoolFiles.getPath) — BA media path.
  TraceLog("PLAY|ApplyNative|src=" + src + "|asset=" + assetName + "|fb=" + fallbackSrc + "|id=" + mediaId)
  if not IsPlayableNativeSrc(src) then
    TraceLog("PLAY|gate|primary-not-playable")
    src = fallbackSrc
  end if
  if not IsPlayableNativeSrc(src) then
    TraceFnBreak("ApplyNativePlayback", "no-playable-src")
    LedLog("=== Perform6: LED " + st.key + " no playable src ===")
    ' Avoid black LED while media pool / store is still filling.
    if Len(st.playingUrl) = 0 then PlayIdleClip(st)
    PostPlaybackAck(states, st, payload, false, "no playable src")
    WriteXtPlaybackStatus(st, "no playable src", false)
    FlushLedLog()
    TraceFnExit("ApplyNativePlayback", "no-playable-src")
    return
  end if

  st.loopMode = PayloadBool(payload, "loop", true)
  st.paused = PayloadBool(payload, "paused", false)
  restartNonce = PayloadInt(payload, "restartNonce", 0)
  forceRestart = restartNonce <> st.nonce
  st.nonce = restartNonce
  st.wantUrl = src
  WriteXtPlaybackStatus(st, "accepted", false)

  ' Idle splash must never short-circuit as "already playing".
  if src = st.playingUrl and not forceRestart and st.idleShown <> true and Len(st.playingUrl) > 0 then
    TraceFnExit("ApplyNativePlayback", "already-playing-transport")
    st.vp.SetLoopMode(st.loopMode)
    ApplyLedVolume(st, payload)
    ApplyLedPauseState(st)
    PostPlaybackAck(states, st, payload, true, "transport")
    WriteXtPlaybackStatus(st, "started-transport", false)
    return
  end if

  if forceRestart and src = st.playingUrl then
    LedLog("=== Perform6: LED " + st.key + " restart ===")
    st.ignoreEnded = true
    st.ignoreEndedSpan = CreateObject("roTimespan")
    if type(st.ignoreEndedSpan) = "roTimespan" then st.ignoreEndedSpan.Mark()
    st.vp.StopClear()
    st.playingUrl = ""
  end if

  PlayNativeSrc(st, src, msgPort, states)
  ApplyLedVolume(st, payload)
  ApplyLedPauseState(st)
  ok = false
  if Len(st.playingUrl) > 0 then ok = true
  detail = "play"
  if ok = false then detail = "play failed"
  PostPlaybackAck(states, st, payload, ok, detail)
  if ok then
    WriteXtPlaybackStatus(st, "started", false)
  else
    WriteXtPlaybackStatus(st, "play failed", false)
  end if
  TraceFnExit("ApplyNativePlayback", detail)
End Sub

Sub PostPlaybackAck(states as Object, st as Object, payload as Object, ok as Boolean, detail as String)
  html = ResolveBridgeHtml(states)
  msg = CreateObject("roAssociativeArray")
  profileHint = PayloadString(payload, "type")
  ackType = "xt-playback-ack"
  if profileHint = "xc-playback" then ackType = "xc-playback-ack"
  msg.AddReplace("type", ackType)
  if ok then msg.ok = "1" else msg.ok = "0"
  msg.role = st.key
  msg.src = st.playingUrl
  msg.detail = detail
  msg.restartNonce = IntToStr(PayloadInt(payload, "restartNonce", 0))
  PostJsMessage(html, msg)
End Sub

' --- LED Option A (BA zone semantics, no BSN) -----------------------------------
' ZONE PRIMARY: JS PostBSMessage(xt/xc-playback) → ApplyNativePlayback → PlayFile.
' src = JS AssetPool getPath (GetPoolFilePath equivalent). ProbeString for pool.
' SD RESUME-ONLY: perform6-led-playback.json on boot / 15s backup if bridge one-way.
' Legacy SD:/perform6-xt-playback.json still accepted (maps to target "led").

Function LoadLedPlaybackFileAA() as Object
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
End Function

Function FindLedStateByKey(states as Object, key as String) as Object
  if type(states) <> "roArray" then return invalid
  for each st in states
    if type(st) = "roAssociativeArray" then
      if st.key = key then return st
    end if
  end for
  return invalid
End Function

Function BoolToStr(v as Boolean) as String
  if v then return "1"
  return "0"
End Function

Function LedCmdSignature(aa as Object) as String
  sig = PayloadString(aa, "src")
  sig = sig + "|" + IntToStr(PayloadInt(aa, "restartNonce", 0))
  sig = sig + "|" + IntToStr(PayloadInt(aa, "volumePercent", 100))
  sig = sig + "|" + BoolToStr(PayloadBool(aa, "loop", true))
  sig = sig + "|" + BoolToStr(PayloadBool(aa, "paused", false))
  sig = sig + "|" + BoolToStr(PayloadBool(aa, "muted", false))
  sig = sig + "|" + PayloadString(aa, "writtenAt")
  return sig
End Function

Function ResolveLedCommandTarget(aa as Object) as String
  target = PayloadString(aa, "target")
  if Len(target) > 0 then return target
  role = PayloadString(aa, "role")
  if role = "led2" or role = "led3" or role = "led" then return role
  ' Legacy xt-playback used role=touch for HDMI-2 LED.
  if role = "touch" or role = "primary" or Len(role) = 0 then return "led"
  return role
End Function

Function LoadLedStatusRootAA() as Object
  text = ReadAsciiFile("SD:/perform6-led-playback-status.json")
  if Len(text) > 0 and Len(text) < 200000 then
    parsed = ParseJSON(text)
    if type(parsed) = "roAssociativeArray" then return parsed
  end if
  return invalid
End Function

Function LoadLedStatusSidecarEntry(roleKey as String) as Object
  if Len(roleKey) = 0 then return invalid
  text = ReadAsciiFile("SD:/perform6-led-playback-status-" + roleKey + ".json")
  if Len(text) > 0 and Len(text) < 200000 then
    parsed = ParseJSON(text)
    if type(parsed) = "roAssociativeArray" then
      migrated = RoleStatusEntryFromFlat(parsed)
      if type(migrated) = "roAssociativeArray" then return migrated
      return parsed
    end if
  end if
  return invalid
End Function

' Write via tmp + MoveFile so readers never see a half-written JSON body.
Function AtomicWriteAsciiFile(path as String, content as String) as Boolean
  if Len(path) = 0 then return false
  tmp = path + ".tmp"
  ok = WriteAsciiFile(tmp, content)
  if ok <> true then return false
  DeleteFile(path)
  moved = MoveFile(tmp, path)
  if moved = true then return true
  ' Fallback: direct write if MoveFile fails (some firmwares).
  ok2 = WriteAsciiFile(path, content)
  DeleteFile(tmp)
  return ok2 = true
End Function

' In-memory roles map — authoritative merge for this autorun process (no disk RMW race).
Function LedStatusRolesAA() as Object
  g = GetGlobalAA()
  if type(g.p6LedStatusRoles) = "roAssociativeArray" then return g.p6LedStatusRoles

  roles = CreateObject("roAssociativeArray")
  existing = LoadLedStatusRootAA()
  if type(existing) = "roAssociativeArray" then
    if type(existing.roles) = "roAssociativeArray" then
      roles = existing.roles
    else
      migrated = RoleStatusEntryFromFlat(existing)
      if type(migrated) = "roAssociativeArray" then
        roles.AddReplace(migrated.role, migrated)
      end if
    end if
  end if

  seedRoles = CreateObject("roArray", 3, true)
  seedRoles.Push("led")
  seedRoles.Push("led2")
  seedRoles.Push("led3")
  for each roleKey in seedRoles
    side = LoadLedStatusSidecarEntry(roleKey)
    if type(side) = "roAssociativeArray" then
      roles.AddReplace(roleKey, side)
    end if
  end for

  g.p6LedStatusRoles = roles
  return roles
End Function

Function RoleStatusEntryFromFlat(aa as Object) as Object
  if type(aa) <> "roAssociativeArray" then return invalid
  role = AsBrString(aa.role)
  if Len(role) = 0 then return invalid
  entry = CreateObject("roAssociativeArray")
  entry.role = role
  entry.src = AsBrString(aa.src)
  entry.wantUrl = AsBrString(aa.wantUrl)
  entry.restartNonce = AsBrString(aa.restartNonce)
  entry.ok = AsBrString(aa.ok)
  entry.state = AsBrString(aa.state)
  entry.detail = AsBrString(aa.detail)
  entry.ended = AsBrString(aa.ended)
  return entry
End Function

' Per-role keys from in-memory map (not disk RMW). Sidecar written first (atomic);
' unified JSON rebuilt from memory then atomic-replaced — multi-role safe under one autorun.
Sub WriteLedPlaybackStatus(st as Object, detail as String, ended as Boolean)
  if type(st) <> "roAssociativeArray" then return
  okStr = "0"
  if Len(st.playingUrl) > 0 and st.idleShown <> true then okStr = "1"
  endedStr = "0"
  if ended then endedStr = "1"
  state = "pending"
  if ended then
    state = "ended"
  else if detail = "accepted" then
    state = "accepted"
  else if Instr(1, detail, "fail") > 0 or Instr(1, detail, "error") > 0 or detail = "no playable src" or detail = "no video player" or detail = "media missing" then
    state = "error"
  else if Len(st.playingUrl) > 0 and st.idleShown <> true then
    state = "started"
  else if Instr(1, detail, "pending") > 0 then
    state = "pending"
  end if

  roleKey = st.key
  entry = CreateObject("roAssociativeArray")
  entry.role = roleKey
  entry.src = st.playingUrl
  entry.wantUrl = st.wantUrl
  entry.restartNonce = IntToStr(st.nonce)
  entry.ok = okStr
  entry.state = state
  entry.detail = detail
  entry.ended = endedStr

  roles = LedStatusRolesAA()
  roles.AddReplace(roleKey, entry)

  entryJson = FormatJSON(entry)
  if type(entryJson) <> "roString" and type(entryJson) <> "String" then entryJson = ""
  if Len(entryJson) = 0 then
    q = Chr(34)
    entryJson = "{"
    entryJson = entryJson + q + "role" + q + ":" + q + roleKey + q + ","
    entryJson = entryJson + q + "src" + q + ":" + q + st.playingUrl + q + ","
    entryJson = entryJson + q + "wantUrl" + q + ":" + q + st.wantUrl + q + ","
    entryJson = entryJson + q + "restartNonce" + q + ":" + q + IntToStr(st.nonce) + q + ","
    entryJson = entryJson + q + "ok" + q + ":" + q + okStr + q + ","
    entryJson = entryJson + q + "state" + q + ":" + q + state + q + ","
    entryJson = entryJson + q + "detail" + q + ":" + q + detail + q + ","
    entryJson = entryJson + q + "ended" + q + ":" + q + endedStr + q
    entryJson = entryJson + "}"
  end if

  ' Sidecar first — JS prefers these; each role is independently atomic.
  AtomicWriteAsciiFile("SD:/perform6-led-playback-status-" + roleKey + ".json", entryJson)

  root = CreateObject("roAssociativeArray")
  root.type = "led-playback-status"
  root.roles = roles
  ' Flat mirror of the role just written (legacy XT / last-event probe).
  root.role = roleKey
  root.src = entry.src
  root.wantUrl = entry.wantUrl
  root.restartNonce = entry.restartNonce
  root.ok = entry.ok
  root.state = entry.state
  root.detail = entry.detail
  root.ended = entry.ended

  json = FormatJSON(root)
  if type(json) <> "roString" and type(json) <> "String" then json = ""
  if Len(json) = 0 then json = entryJson

  AtomicWriteAsciiFile("SD:/perform6-led-playback-status.json", json)
  AtomicWriteAsciiFile("SD:/perform6-xt-playback-status.json", json)
End Sub

Sub WriteLedBusHeartbeat(detail as String, src as String)
  q = Chr(34)
  json = "{"
  json = json + q + "type" + q + ":" + q + "led-bus" + q + ","
  json = json + q + "detail" + q + ":" + q + detail + q + ","
  json = json + q + "src" + q + ":" + q + src + q + ","
  json = json + q + "ts" + q + ":" + q + IntToStr(ProgressNowMs()) + q
  json = json + "}"
  WriteAsciiFile("SD:/perform6-led-bus.json", json)
  WriteAsciiFile("SD:/perform6-xt-bus.json", json)
End Sub

' Back-compat aliases used by ApplyNativePlayback / MediaEnded.




Sub ApplyOneLedPlaybackCommand(states as Object, msgPort as Object, aa as Object, reason as String)
  TraceFnEnter("ApplyOneLedPlaybackCommand", reason)
  if type(aa) <> "roAssociativeArray" then
    TraceFnBreak("ApplyOneLedPlaybackCommand", "bad-aa")
    return
  end if
  target = ResolveLedCommandTarget(aa)
  st = FindLedStateByKey(states, target)
  if type(st) <> "roAssociativeArray" then
    TraceFnBreak("ApplyOneLedPlaybackCommand", "no-led-state|" + target)
    WriteLedBusHeartbeat("no-led-state-" + target, reason)
    return
  end if
  if type(st.vp) <> "roVideoPlayer" then
    TraceFnBreak("ApplyOneLedPlaybackCommand", "no-vp|" + target)
    WriteLedBusHeartbeat("no-video-player-" + target, reason)
    WriteLedPlaybackStatus(st, "no video player", false)
    return
  end if

  src = PayloadString(aa, "src")
  fallbackSrc = PayloadString(aa, "fallbackSrc")
  playSrc = src
  if not IsPlayableNativeSrc(playSrc) then playSrc = fallbackSrc
  if not IsPlayableNativeSrc(playSrc) then
    TraceFnBreak("ApplyOneLedPlaybackCommand", "no-playable|" + src)
    WriteLedBusHeartbeat("no-playable-src-" + target, src)
    WriteLedPlaybackStatus(st, "no playable src", false)
    return
  end if

  sig = LedCmdSignature(aa)
  g = GetGlobalAA()
  sigKey = "p6PbSig_" + target
  lastSig = ""
  lastVal = g.Lookup(sigKey)
  if type(lastVal) = "roString" or type(lastVal) = "String" then lastSig = lastVal

  needApply = (sig <> lastSig)
  if Len(st.playingUrl) = 0 then needApply = true
  if st.idleShown = true then needApply = true
  if needApply <> true then
    TraceFnExit("ApplyOneLedPlaybackCommand", "skip-same-sig")
    WriteLedBusHeartbeat("playing-" + target, st.playingUrl)
    return
  end if

  g.AddReplace(sigKey, sig)
  WriteLedBusHeartbeat("apply-" + reason + "-" + target, playSrc)
  LedLog("=== Perform6: LED " + target + " command via SD file (" + reason + ") nonce " + IntToStr(PayloadInt(aa, "restartNonce", 0)) + " src " + playSrc + " ===")
  FlushLedLog()
  ApplyNativePlayback(st, aa, msgPort, states)

  if Len(st.playingUrl) = 0 or st.idleShown = true then
    g.AddReplace(sigKey, "")
    WriteLedPlaybackStatus(st, "file-play-pending", false)
    WriteLedBusHeartbeat("pending-" + target, playSrc)
    TraceFnExit("ApplyOneLedPlaybackCommand", "pending")
  else
    WriteLedPlaybackStatus(st, "file-play-" + reason, false)
    WriteLedBusHeartbeat("started-" + target, st.playingUrl)
    TraceFnExit("ApplyOneLedPlaybackCommand", "started")
  end if
  FlushLedLog()
End Sub

Sub MaybeResumePlaybackFromFile(states as Object, msgPort as Object, reason as String)
  if TraceVerboseEnabled() then TraceFnEnter("MaybeResumePlaybackFromFile", reason)
  aa = LoadLedPlaybackFileAA()
  if type(aa) <> "roAssociativeArray" then
    WriteLedBusHeartbeat("no-command-file", reason)
    if TraceVerboseEnabled() then TraceFnExit("MaybeResumePlaybackFromFile", "no-file")
    return
  end if

  typeStr = PayloadString(aa, "type")
  if typeStr = "led-playback" then
    cmds = aa.Lookup("commands")
    if type(cmds) <> "roArray" then
      TraceFnBreak("MaybeResumePlaybackFromFile", "bad-commands")
      WriteLedBusHeartbeat("bad-commands", reason)
      return
    end if
    if cmds.Count() = 0 then
      WriteLedBusHeartbeat("empty-commands", reason)
      return
    end if
    TraceLog("SD|resume|led-playback|n=" + IntToStr(cmds.Count()) + "|" + reason)
    for each cmd in cmds
      if type(cmd) = "roAssociativeArray" then
        ApplyOneLedPlaybackCommand(states, msgPort, cmd, reason)
      end if
    end for
    return
  end if

  if typeStr = "xt-playback" or typeStr = "xc-playback" then
    TraceLog("SD|resume|" + typeStr + "|" + reason)
    ApplyOneLedPlaybackCommand(states, msgPort, aa, reason)
    return
  end if

  TraceFnBreak("MaybeResumePlaybackFromFile", "bad-type|" + typeStr)
  WriteLedBusHeartbeat("bad-type", reason)
End Sub

' SD resume-only backup — zone PostBSMessage is primary; poll must stay slow.
Sub MaybePollLedPlaybackFile(states as Object, msgPort as Object)
  if type(states) <> "roArray" then return
  if states.Count() = 0 then return
  g = GetGlobalAA()
  if type(g.p6PbPollSpan) <> "roTimespan" then
    g.p6PbPollSpan = CreateObject("roTimespan")
    if type(g.p6PbPollSpan) = "roTimespan" then g.p6PbPollSpan.Mark()
  end if
  if type(g.p6PbPollSpan) <> "roTimespan" then return
  if g.p6PbPollSpan.TotalMilliseconds() < 15000 then return
  g.p6PbPollSpan.Mark()
  MaybeResumePlaybackFromFile(states, msgPort, "loop")
End Sub

' ---------------------------------------------------------------------------

' Packaged led-idle.png (or optional led-idle.mp4 override) loops on the LED
' until the first backend / touch video arrives - avoids "No signal".
' Paths: try SD:/… then /storage/sd/… (OS 9.1 Node mount alias).
Sub PlayIdleClip(st as Object)
  if type(st) <> "roAssociativeArray" then return
  if type(st.vp) <> "roVideoPlayer" then return

  st.playingUrl = ""

  if IdleFilePresent("led-idle.mp4") then
    st.vp.SetLoopMode(true)
    for each p in IdlePathCandidates("led-idle.mp4")
      if PlayLocalFile(st.vp, p) then
        st.idleShown = true
        LedLog("=== Perform6: LED " + st.key + " idle " + p + " ===")
        st.vp.Resume()
        return
      end if
    end for
    LedLog("=== Perform6: LED " + st.key + " idle FAILED led-idle.mp4 (SD:/) ===")
  end if

  if not IdleFilePresent("led-idle.png") then
    LedLog("=== Perform6: LED " + st.key + " no idle file on card — copy led-idle.png to SD root ===")
    return
  end if

  ' Full-screen 16:9 splash (3840x2160) - Fill keeps edges sharp on 1080p and 4K.
  st.vp.SetViewMode("FillScreenAndCentered")
  for each p in IdlePathCandidates("led-idle.png")
    ok = st.vp.PlayStaticImage(p)
    if ok <> true then
      aa = CreateObject("roAssociativeArray")
      aa.Filename = p
      ok = st.vp.PlayStaticImage(aa)
    end if
    if ok = true then
      st.idleShown = true
      LedLog("=== Perform6: LED " + st.key + " idle " + p + " ===")
      return
    end if
  end for

  st.vp.SetViewMode("FillScreenAndCentered")
  st.idleShown = false
  LedLog("=== Perform6: LED " + st.key + " idle FAILED led-idle.png (SD:/) ===")
End Sub


' Local DWS (docs): SetupDWS writes registry; BOS 9.1+ LDWS is off by default.
' Password = player serial (digest auth, user "admin").
' If SetupDWS returns true (reboot required), reboot once via marker — no loop.
Sub EnableDiagnosticWebServer()
  serial = ""
  di = CreateObject("roDeviceInfo")
  if type(di) = "roDeviceInfo" then serial = di.GetDeviceUniqueId()

  nc = CreateObject("roNetworkConfiguration", 0)
  if type(nc) <> "roNetworkConfiguration" then
    nc = CreateObject("roNetworkConfiguration", 1)
  end if
  if type(nc) <> "roNetworkConfiguration" then
    LedLog("=== Perform6: DWS skipped — no network config ===")
    return
  end if

  dws = CreateObject("roAssociativeArray")
  if type(dws) <> "roAssociativeArray" then return
  dws.port = "default"
  if Len(serial) > 0 then dws.open = serial

  needsReboot = nc.SetupDWS(dws)
  reason = nc.GetFailureReason()
  if type(reason) <> "roString" and type(reason) <> "String" then reason = ""

  reg = CreateObject("roRegistrySection", "networking")
  if type(reg) = "roRegistrySection" then
    reg.Write("dwse", "on")
    reg.Write("http_server", "80")
    reg.Flush()
  end if

  if Len(reason) > 0 then
    LedLog("=== Perform6: DWS SetupDWS note " + reason + " ===")
  end if

  alreadyRebooted = FileExistsIn("SD:/", "perform6-dws-rebooted")
  if needsReboot = true and alreadyRebooted = false then
    WriteAsciiFile("SD:/perform6-dws-rebooted", "1")
    LedLog("=== Perform6: DWS enabled — one-shot reboot for LDWS ===")
    RebootDeviceAfterOta()
    while true
      Sleep(10000)
    end while
  end if

  if needsReboot = true then
    LedLog("=== Perform6: DWS configured (reboot already done) password=serial ===")
  else
    LedLog("=== Perform6: DWS enabled password=serial (admin) ===")
  end if
End Sub

Function CollectDeviceIdentity() as Object
  info = CreateObject("roAssociativeArray")
  info.serial = ""
  info.model = ""
  info.fw = ""
  info.mac = ""
  info.ip = ""

  di = CreateObject("roDeviceInfo")
  if type(di) = "roDeviceInfo" then
    info.model = di.GetModel()
    info.fw = di.GetVersion()
    info.serial = di.GetDeviceUniqueId()
    SafePrint("=== Perform6: model=" + info.model + " fw=" + info.fw + " serial=" + info.serial + " ===")
  end if

  iface = 0
  while iface <= 1
    nc = CreateObject("roNetworkConfiguration", iface)
    if type(nc) = "roNetworkConfiguration" then
      cfg = nc.GetCurrentConfig()
      if type(cfg) = "roAssociativeArray" then
        if type(cfg.ethernet_mac) = "roString" and Len(cfg.ethernet_mac) > 0 then
          info.mac = cfg.ethernet_mac
        else if type(cfg.mac_address) = "roString" and Len(cfg.mac_address) > 0 then
          info.mac = cfg.mac_address
        end if
        if Len(info.ip) = 0 then
          if type(cfg.ip4_address) = "roString" and Len(cfg.ip4_address) > 0 then
            info.ip = cfg.ip4_address
          end if
        end if
      end if
    end if
    if Len(info.mac) > 0 and Len(info.ip) > 0 then
      exit while
    end if
    iface = iface + 1
  end while

  if Len(info.mac) > 0 then
    SafePrint("=== Perform6: mac=" + info.mac + " ===")
  end if
  if Len(info.ip) > 0 then
    LedLog("=== Perform6: lan ip=" + info.ip + " ===")
  else
    LedLog("=== Perform6: lan ip unavailable at boot ===")
  end if

  return info
End Function

Function UrlSafeToken(raw as String) as String
  out = ""
  i = 1
  while i <= Len(raw)
    ch = Mid(raw, i, 1)
    code = Asc(ch)
    keep = false
    if code >= 48 and code <= 57 then keep = true
    if code >= 65 and code <= 90 then keep = true
    if code >= 97 and code <= 122 then keep = true
    if ch = "-" or ch = "_" or ch = "." or ch = ":" then keep = true
    if keep then
      out = out + ch
    end if
    i = i + 1
  end while
  return out
End Function

Function BuildAppUrl(basePath as String, identity as Object, profile as String, outputRole as String) as String
  q = ""
  if Len(identity.serial) > 0 then
    q = q + "bs_serial=" + UrlSafeToken(identity.serial)
  end if
  if Len(identity.model) > 0 then
    if Len(q) > 0 then q = q + "&"
    q = q + "bs_model=" + UrlSafeToken(identity.model)
  end if
  if Len(identity.fw) > 0 then
    if Len(q) > 0 then q = q + "&"
    q = q + "bs_fw=" + UrlSafeToken(identity.fw)
  end if
  if Len(identity.mac) > 0 then
    if Len(q) > 0 then q = q + "&"
    q = q + "bs_mac=" + UrlSafeToken(identity.mac)
  end if
  if Len(identity.ip) > 0 then
    if Len(q) > 0 then q = q + "&"
    q = q + "bs_ip=" + UrlSafeToken(identity.ip)
  end if
  if Len(profile) > 0 then
    if Len(q) > 0 then q = q + "&"
    q = q + "bs_profile=" + UrlSafeToken(profile)
  end if
  if Len(outputRole) > 0 then
    if Len(q) > 0 then q = q + "&"
    q = q + "bs_output=" + UrlSafeToken(outputRole)
  end if
  if Len(q) = 0 then
    return basePath
  end if
  return basePath + "?" + q
End Function

Function ReadTextFile(path as String) as String
  f = CreateObject("roReadFile", path)
  if type(f) <> "roReadFile" then
    return ""
  end if
  line = f.ReadLine()
  if type(line) <> "roString" then
    return ""
  end if
  ' Trim CR/LF/spaces
  out = ""
  i = 1
  while i <= Len(line)
    ch = Mid(line, i, 1)
    if ch <> chr(13) and ch <> chr(10) and ch <> " " and ch <> chr(9) then
      out = out + ch
    end if
    i = i + 1
  end while
  return UCase(out)
End Function

Function ResolveHardwareProfile(identity as Object) as String
  return "XT2145"
End Function

' XT/XC always enable every wired HDMI (BrightAuthor / BrightSign multi-screen style).
' Only MULTI | MULTI_NOFULLRES are valid. auto / 4K / SINGLE strings are ignored → MULTI.
Function ReadDisplayMode() as String
  ' ReadTextFile already trims + UCase.
  mode = ReadTextFile("perform6-display.txt")
  if Len(mode) = 0 then
    mode = ReadTextFile("SD:/perform6-display.txt")
  end if
  if mode = "MULTI_NOFULLRES" then
    return "MULTI_NOFULLRES"
  end if
  if mode <> "MULTI" and Len(mode) > 0 then
    SafePrint("=== Perform6: perform6-display.txt '" + mode + "' ignored — BrightSign pattern uses MULTI (1080p fixed) ===")
  end if
  return "MULTI"
End Function

Function OpsFilePath() as String
  return "SD:/perform6-ops.json"
End Function

Function ReadRawFile(path as String) as String
  f = CreateObject("roReadFile", path)
  if type(f) <> "roReadFile" then
    return ""
  end if
  out = ""
  while true
    line = f.ReadLine()
    if type(line) <> "roString" and type(line) <> "String" then
      exit while
    end if
    if Len(out) > 0 then out = out + Chr(10)
    out = out + line
  end while
  return out
End Function

Sub WriteRawFile(path as String, content as String)
  WriteAsciiFile(path, content)
End Sub

Function OpsJsonFieldTrue(json as String, field as String) as Boolean
  if Len(json) = 0 then return false
  q = Chr(34)
  key = q + field + q
  if Instr(1, json, key + ":true") > 0 then return true
  if Instr(1, json, key + ": true") > 0 then return true
  if Instr(1, json, key + ":TRUE") > 0 then return true
  if Instr(1, json, key + ": TRUE") > 0 then return true
  return false
End Function

Function ReplaceJsonBool(hay as String, fromText as String, toText as String) as String
  idx = Instr(1, hay, fromText)
  if idx = 0 then return hay
  return Left(hay, idx - 1) + toText + Mid(hay, idx + Len(fromText))
End Function

Function OpsJsonSetFieldFalse(json as String, field as String) as String
  q = Chr(34)
  key = q + field + q
  out = json
  out = ReplaceJsonBool(out, key + ":true", key + ":false")
  out = ReplaceJsonBool(out, key + ": true", key + ": false")
  out = ReplaceJsonBool(out, key + ":TRUE", key + ":false")
  out = ReplaceJsonBool(out, key + ": TRUE", key + ": false")
  return out
End Function

Sub ProcessOpsOnBoot(states as Object)
  content = ReadRawFile(OpsFilePath())
  if Len(content) = 0 then return
  if OpsJsonFieldTrue(content, "traceAutorun") then
    LedLog("=== Perform6: traceAutorun requested (verbose off in docs-thin) ===")
  end if
  if OpsJsonFieldTrue(content, "clearCacheOnBoot") then
    LedLog("=== Perform6: clearCacheOnBoot ignored (use JS Node wipe) ===")
    content = OpsJsonSetFieldFalse(content, "clearCacheOnBoot")
    content = OpsJsonSetFieldFalse(content, "rebootAfterCacheClear")
    WriteRawFile(OpsFilePath(), content)
  end if
End Sub



Function FindScreenIndex(sm as Object, hdmiName as String) as Integer
  if type(sm) <> "roArray" then
    return -1
  end if
  i = 0
  while i < sm.Count()
    entry = sm[i]
    if type(entry) = "roAssociativeArray" then
      if type(entry.name) = "roString" then
        if UCase(entry.name) = UCase(hdmiName) then
          return i
        end if
      end if
    end if
    i = i + 1
  end while
  return -1
End Function


' Phase 4: prove whether hard-locked 60p was accepted by the real LED panel.

Function VideoEventName(code as Integer) as String
  if code = 3 then return "Playing"
  if code = 4 then return "Stopped"
  if code = 5 then return "Paused"
  if code = 6 then return "Resumed"
  if code = 8 then return "MediaEnded"
  if code = 14 then return "Underrun"
  if code = 16 then return "Error"
  return "code=" + IntToStr(code)
End Function

Function VideoModeMatches(actualMode as Dynamic, expectedMode as String) as Boolean
  if type(actualMode) <> "roString" and type(actualMode) <> "String" then
    return false
  end if

  actual = LCase(actualMode)
  expected = LCase(expectedMode)
  if Instr(1, actual, expected) > 0 then
    return true
  end if

  ' BrightSign may normalize modifier order when returning GetScreenModes().
  if Instr(1, expected, ":preferred") > 0 and Instr(1, actual, ":preferred") = 0 then
    return false
  end if

  baseEnd = Instr(1, expected, ":")
  if baseEnd > 0 then
    expectedBase = Left(expected, baseEnd - 1)
  else
    expectedBase = expected
  end if
  if Instr(1, actual, expectedBase) <> 1 then
    return false
  end if

  ' Accept 1920x1080x60p with or without :fullres when bases match.
  ' Strict :fullres-only matching caused endless SetScreenModes on some OS builds.
  return true
End Function

Function AsIntCoord(value as Dynamic) as Integer
  if type(value) = "roInt" or type(value) = "Integer" or type(value) = "Float" then
    return Int(value)
  end if
  if type(value) = "roString" or type(value) = "String" then
    if Len(value) > 0 then return Int(Val(value))
  end if
  return -999999
End Function

Function ScreenAlreadyMatches(entry as Object, videoMode as String, displayX as Integer, enabled as Boolean) as Boolean
  if type(entry) <> "roAssociativeArray" then
    return false
  end if
  if entry.enabled <> enabled then
    return false
  end if
  if enabled = false then
    return true
  end if
  if not VideoModeMatches(entry.video_mode, videoMode) then
    return false
  end if
  x = AsIntCoord(entry.display_x)
  y = AsIntCoord(entry.display_y)
  if x = -999999 then return false
  if x <> displayX then return false
  if y <> -999999 and y <> 0 then return false
  return true
End Function

Sub ConfigureOutput(entry as Object, videoMode as String, displayX as Integer, enabled as Boolean)
  if type(entry) <> "roAssociativeArray" then
    return
  end if
  entry.enabled = enabled
  if enabled then
    entry.video_mode = videoMode
    entry.transform = "normal"
    entry.display_x = displayX
    entry.display_y = 0
  end if
End Sub

' Returns true if SetScreenModes was called (player will reboot).
Function ApplyMultiScreenModes(vm as Object, profile as String, displayMode as String) as Boolean
  if type(vm) <> "roVideoMode" then
    return false
  end if


  sm = vm.GetScreenModes()
  if type(sm) <> "roArray" or sm.Count() < 2 then
    SafePrint("=== Perform6: GetScreenModes unavailable - keep default output ===")
    return false
  end if

  ' BrightSign multi-screen pattern (docs): fixed mode per HDMI, never "auto".
  ' Fleet default 1920x1080x60p — same class as BA multi-out examples; not max 4K.
  ' No :preferred / auto — EDID fallback (4K then 1080p120) breaks side-by-side canvas.
  ' :fullres = graphics plane 1:1 with video mode (BrightSign full-resolution graphics).
  mode1080 = "1920x1080x60p:fullres"
  if displayMode = "MULTI_NOFULLRES" then
    mode1080 = "1920x1080x60p"
  end if
  needChange = false
  SafePrint("=== Perform6: BrightSign pattern video_mode=" + mode1080 + " ===")

  if profile = "XT2145" then
    idx1 = FindScreenIndex(sm, "HDMI-1")
    idx2 = FindScreenIndex(sm, "HDMI-2")
    if idx1 < 0 then idx1 = 0
    if idx2 < 0 then idx2 = 1

    if not ScreenAlreadyMatches(sm[idx1], mode1080, 0, true) then needChange = true
    if not ScreenAlreadyMatches(sm[idx2], mode1080, 1920, true) then needChange = true

    i = 0
    while i < sm.Count()
      if i <> idx1 and i <> idx2 then
        if type(sm[i]) = "roAssociativeArray" and sm[i].enabled = true then
          needChange = true
        end if
      end if
      i = i + 1
    end while

    if needChange = false then
      SafePrint("=== Perform6: XT2145 dual HDMI already configured (1080p BrightSign pattern) ===")
      return false
    end if

    ConfigureOutput(sm[idx1], mode1080, 0, true)
    ConfigureOutput(sm[idx2], mode1080, 1920, true)
    i = 0
    while i < sm.Count()
      if i <> idx1 and i <> idx2 then
        ConfigureOutput(sm[i], mode1080, 0, false)
      end if
      i = i + 1
    end while

    SafePrint("=== Perform6: SetScreenModes XT2145 HDMI-1+HDMI-2 " + mode1080 + " (may reboot) ===")
    vm.SetScreenModes(sm)
    return true
  end if


  return false
End Function

Sub Main()
  SafePrint("=== Perform6: autorun start ===")
  DeleteFile("SD:/perform6-led.log")
  WriteBootCanary()
  TraceLog("MAIN|start")

  identity = CollectDeviceIdentity()
  profile = ResolveHardwareProfile(identity)
  LedLog("=== Perform6: hardware profile " + profile + " ===")
  TraceLog("MAIN|profile|" + profile)

  displayMode = ReadDisplayMode()
  ' XT/XC always BrightAuthor-style multi-output (React + native LED video).
  multiOutput = true
  SafePrint("=== Perform6: display mode " + displayMode + " ===")

  BootSleepSlices(500)

  msgPort = CreateObject("roMessagePort")
  if type(msgPort) <> "roMessagePort" then
    FatalHang("=== Perform6: FATAL no roMessagePort ===")
  end if


  ' Enable DWS before SetScreenModes so field logs still work during reboot.
  EnableDiagnosticWebServer()

  vm = CreateObject("roVideoMode")
  if type(vm) = "roVideoMode" then
    rebooting = ApplyMultiScreenModes(vm, profile, displayMode)
    if rebooting then
      ' BrightAuthor-style: apply layout then ALWAYS reboot. Never sit in a blank wait
      ' hoping the OS reboots on its own (OS 9.x often does not).
      SafePrint("=== Perform6: SetScreenModes applied - forcing reboot ===")
      LedLog("=== Perform6: SetScreenModes applied - forcing reboot ===")
      RebootDeviceAfterOta()
      while true
        Sleep(10000)
      end while
    end if
  end if

  ' Must be configured before any HTML/video player allocates an audio decoder.
  ConfigureAudioResources(profile)

  width = 1920
  height = 1080

  ' XT/XC use independent 1920x1080 HtmlWidgets per HDMI. HD226 uses native size.
  if profile <> "XT2145" and profile <> "XC4055" and type(vm) = "roVideoMode" then
    w = vm.GetResX()
    h = vm.GetResY()
    if w > 0 then width = w
    if h > 0 then height = h
  end if

  html = invalid
  htmlTouch = invalid
  htmlPrimary = invalid
  videoLed = invalid
  videoLed2 = invalid
  videoLed3 = invalid
  url = ""
  singleRole = ""
  touchUrl = ""
  primaryUrl = ""
  touchFallbackTried = false
  primaryFallbackTried = false
  htmlLoadFinished = false
  ledStates = CreateObject("roArray", 4, true)
  ledState = invalid
  led2State = invalid
  led3State = invalid
  ' Cache/OTA workers created AFTER HtmlWidget.Show (EnsureDeferredWorkers).

  ' XT2145-only package — BrightAuthor-style zones
  if true then
    ' Order (BrightSign multi-out + decoder budget): HtmlWidget Show FIRST, then
    ' exactly ONE HDMI-2 roVideoPlayer. Never allocate a pre-HTML LED player.
    SafePrint("=== Perform6: XT React HDMI-1 + native video HDMI-2 ===")
    touchRect = CreateObject("roRectangle", 0, 0, 1920, 1080)
    ledRect = CreateObject("roRectangle", 1920, 0, 1920, 1080)
    if type(touchRect) <> "roRectangle" or type(ledRect) <> "roRectangle" then
      FatalHang("=== Perform6: FATAL no XT output rectangles ===")
    end if

    ' Prefer SD:/ path first — avoids post-Show SetUrl that orphans BSMessagePort.
    touchUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "touch")
    SafePrint("=== Perform6: HDMI-1 touch widget " + touchUrl + " ===")
    htmlTouch = TryCreateHtmlWidget(touchRect, msgPort, touchUrl)
    if type(htmlTouch) <> "roHtmlWidget" then
      touchFallbackTried = true
      touchUrl = BuildAppUrl("file:///index.html", identity, profile, "touch")
      SafePrint("=== Perform6: retry HDMI-1 touch widget " + touchUrl + " ===")
      htmlTouch = TryCreateHtmlWidget(touchRect, msgPort, touchUrl)
    end if
    if type(htmlTouch) <> "roHtmlWidget" then
      FatalHang("=== Perform6: FATAL HDMI-1 touch HtmlWidget create failed ===")
    end if

    EnableJsObjectsSafe(htmlTouch)
    RoutePlayerAudio(htmlTouch, "none")
    SafePrint("=== Perform6: Show HDMI-1 touch HtmlWidget ===")
    htmlTouch.Show()
    gTouch = GetGlobalAA()
    gTouch.htmlTouch = htmlTouch
    RememberAppUrl("touch", touchUrl)
    ClearBootFailMarker()

    ' Exactly one XT HDMI-2 player — after HtmlWidget.Show (not before).
    WaitMsgSlices(msgPort, 5)
    LedLog("=== Perform6: HDMI-2 native roVideoPlayer (single, after HtmlWidget) ===")
    videoLed = TryCreateVideoPlayer(ledRect, msgPort, 2, "hdmi-2")
    if type(videoLed) <> "roVideoPlayer" then
      LedLog("=== Perform6: ERROR HDMI-2 roVideoPlayer create failed ===")
    else
      ledState = CreateLedState(videoLed, "led")
      ledStates.Push(ledState)
      PlayIdleClip(ledState)
      ' Minimal I/O after idle — enter loop ASAP. Never PostJSMessage here.
      WriteMainHeartbeat()
      WriteBootStepCanary("after-idle-led")
    end if

    RememberP6Html(htmlTouch)
    WriteBootStepCanary("after-remember-html")
    ScheduleDeferredBootResume()
    ScheduleDeferredWorkersAndOps()
    WriteBootStepCanary("after-schedule-deferred")
  end if

  ' DWS already enabled early (before SetScreenModes) for field recovery.
  ' Never PostJSMessage (storage hotplug / led-ready) before loop-enter.

  InitBridgeWatch()
  WriteBootStepCanary("after-init-bridge")
  gLoop = GetGlobalAA()
  gLoop.p6LoopAlive = true
  gLoop.p6LoopEnterSpan = CreateObject("roTimespan")
  if type(gLoop.p6LoopEnterSpan) = "roTimespan" then gLoop.p6LoopEnterSpan.Mark()
  gLoop.p6HtmlLoadFinished = false
  gLoop.p6DebugLoopTicks = 0
  WriteBootStepCanary("loop-enter")
  WriteMainHeartbeat()
  if type(gLoop.p6DebugTrail) = "roString" or type(gLoop.p6DebugTrail) = "String" then
    WriteAsciiFile("SD:/perform6-debug-f6ed41.txt", gLoop.p6DebugTrail)
  end if
  LedLog("=== Perform6: bridge observe-only (no recycle/reboot on silence) ===")
  LedLog("=== Perform6: zone-primary PostBSMessage; SD resume-only 15s ===")

  pbFileTimer = CreateObject("roTimer")
  if type(pbFileTimer) = "roTimer" then
    pbFileTimer.SetPort(msgPort)
    pbFileTimer.SetElapsed(15, 0)
    pbFileTimer.Start()
  end if

  hbTimer = CreateObject("roTimer")
  if type(hbTimer) = "roTimer" then
    hbTimer.SetPort(msgPort)
    hbTimer.SetElapsed(15, 0)
    hbTimer.Start()
  end if

  while true
    ' Poll/heartbeat first — deferred maintenance must not starve wait().
    ev = wait(100, msgPort)
    MaybeFlushLedLog()
    if profile = "XT2145" or profile = "XC4055" then MaybePollLedPlaybackFile(ledStates, msgPort)
    gTick = GetGlobalAA()
    ticks = gTick.p6DebugLoopTicks
    if type(ticks) <> "roInteger" and type(ticks) <> "Integer" then ticks = 0
    if ticks < 5 then
      WriteBootStepCanary("loop-tick-" + IntToStr(ticks))
      gTick.p6DebugLoopTicks = ticks + 1
    end if
    MaybeRunDeferredBootWork(ledStates, msgPort)
    DrainOnePostJs()
    if type(ev) = "roVideoEvent" then
      videoCode = ev.GetInt()
      if videoCode <> 8 then
        LedLog("=== Perform6: roVideoEvent " + VideoEventName(videoCode) + " ===")
      end if
      ' 8 = MediaEnded - notify touch UI for non-looping XT playback.
      if videoCode = 8 and profile = "XT2145" and type(htmlTouch) = "roHtmlWidget" then
        skipEnded = false
        if type(ledState) = "roAssociativeArray" and ledState.ignoreEnded = true then
          withinWindow = true
          if type(ledState.ignoreEndedSpan) = "roTimespan" then
            if ledState.ignoreEndedSpan.TotalMilliseconds() > 2500 then withinWindow = false
          end if
          if withinWindow then
            skipEnded = true
            LedLog("=== Perform6: ignore MediaEnded (restart) ===")
          else
            ledState.ignoreEnded = false
            ledState.ignoreEndedSpan = invalid
          end if
        end if
        if not skipEnded then
          ended = CreateObject("roAssociativeArray")
          ended.AddReplace("type", "xt-led-ended")
          ended.role = "led"
          PostJsMessage(htmlTouch, ended)
          if type(ledState) = "roAssociativeArray" then WriteXtPlaybackStatus(ledState, "media-ended", true)
          LedLog("=== Perform6: native LED media ended ===")
        end if
      end if
    else if type(ev) = "roTimerEvent" then
      isPbTimer = false
      isHbTimer = false
      if type(pbFileTimer) = "roTimer" then
        if ev.GetSourceIdentity() = pbFileTimer.GetIdentity() then isPbTimer = true
      end if
      if type(hbTimer) = "roTimer" then
        if ev.GetSourceIdentity() = hbTimer.GetIdentity() then isHbTimer = true
      end if
      if isHbTimer then
        WriteMainHeartbeat()
        MaybeFlushLedLog()
        if type(hbTimer) = "roTimer" then
          hbTimer.SetElapsed(15, 0)
          hbTimer.Start()
        end if
      else if isPbTimer then
        MaybeResumePlaybackFromFile(ledStates, msgPort, "poll")
        MaybeFlushLedLog()
        if type(pbFileTimer) = "roTimer" then
          pbFileTimer.SetElapsed(15, 0)
          pbFileTimer.Start()
        end if
      else
        MaybeResumePlaybackFromFile(ledStates, msgPort, "timer")
      end if
    else if type(ev) = "roHtmlWidgetEvent" then
      data = ev.GetData()
      if type(data) = "roAssociativeArray" then
        reason = HtmlWidgetEventReason(data)
        if reason = "load-error" then
          msg = AsBrString(EventLookup(data, "message"))
          if Len(msg) = 0 then msg = AsBrString(data.message)
          SafePrint("=== Perform6: HTML load-error: " + msg + " ===")
          LedLog("=== Perform6: HTML load-error: " + msg + " ===")
          failedUrl = AsBrString(EventLookup(data, "url"))
          if Len(failedUrl) = 0 then failedUrl = AsBrString(data.url)
          gLoad = GetGlobalAA()
          if gLoad.bridgeEverSeen = true or htmlLoadFinished = true then
            LedLog("=== Perform6: load-error after HTML/bridge — soft-alive (no SetUrl, no auto-reboot) ===")
            FlushLedLog()
            WriteMainHeartbeat()
          else if profile = "XT2145" then
            if Instr(1, failedUrl, "bs_output=touch") > 0 and touchFallbackTried = false and type(htmlTouch) = "roHtmlWidget" then
              touchFallbackTried = true
              touchUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "touch")
              LedLog("=== Perform6: HDMI-1 pre-JS SetUrl fallback (no port yet) ===")
              htmlTouch.SetUrl(touchUrl)
            else
              LedLog("=== Perform6: HTML load-error — soft-alive (no auto-reboot) ===")
              FlushLedLog()
              WriteMainHeartbeat()
            end if
          else if profile = "XC4055" then
            if Instr(1, failedUrl, "bs_output=primary") > 0 and primaryFallbackTried = false and type(htmlPrimary) = "roHtmlWidget" then
              primaryFallbackTried = true
              primaryUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "primary")
              LedLog("=== Perform6: HDMI-1 pre-JS SetUrl fallback (no port yet) ===")
              htmlPrimary.SetUrl(primaryUrl)
            else
              LedLog("=== Perform6: HTML load-error — soft-alive (no auto-reboot) ===")
              FlushLedLog()
              WriteMainHeartbeat()
            end if
          else
            LedLog("=== Perform6: HTML load-error — soft-alive (no auto-reboot) ===")
            FlushLedLog()
            WriteMainHeartbeat()
          end if
        else if reason = "load-finished" then
          htmlLoadFinished = true
          gLf = GetGlobalAA()
          gLf.p6HtmlLoadFinished = true
          DeleteFile("SD:/perform6-html-load-fail")
          SafePrint("=== Perform6: HTML load-finished ===")
          LedLog("=== Perform6: HTML load-finished ===")
          if profile = "XT2145" or profile = "XC4055" then MaybeResumePlaybackFromFile(ledStates, msgPort, "load-finished")
        else if reason = "message" or Len(reason) = 0 then
          payload = ExtractJsPayload(data)
          if type(payload) <> "roAssociativeArray" then
            LedLog("=== Perform6: JS message unparsed reason=" + reason + " ===")
            TraceFnBreak("HtmlWidgetMessage", "unparsed")
          else
            msgType = PayloadString(payload, "type")
            sender = PayloadString(payload, "role")
            target = PayloadString(payload, "target")
            TraceLog("BRIDGE|html-msg|" + msgType + "|role=" + sender + "|target=" + target)
            NoteBridgeActivity()
            if msgType = "led-bridge-ping" then
              HandleLedBridgePing(ledStates)
            else if msgType = "led-hello" then
              HandleLedHello(payload, ledStates)
            else if msgType = "xt-playback" or msgType = "xc-playback" then
              TraceFnEnter("BRIDGE|" + msgType, sender + "|" + target)
              if profile = "XT2145" then
                if sender = "touch" and msgType = "xt-playback" then
                  ApplyNativePlayback(ledState, payload, msgPort, ledStates)
                else
                  TraceFnBreak("BRIDGE|xt-playback", "ignored-sender|" + sender)
                end if
              else if profile = "XC4055" then
                if sender = "primary" and msgType = "xc-playback" then
                  if target = "led2" then
                    ApplyNativePlayback(led2State, payload, msgPort, ledStates)
                  else if target = "led3" then
                    ApplyNativePlayback(led3State, payload, msgPort, ledStates)
                  else
                    TraceFnBreak("BRIDGE|xc-playback", "bad-target|" + target)
                  end if
                else
                  TraceFnBreak("BRIDGE|xc-playback", "ignored-sender|" + sender)
                end if
              end if
            else if msgType = "led-bridge-heal" then
              HandleLedBridgeHeal(payload)
            else if msgType = "led-bridge-recycle-html" then
              HandleLedBridgeRecycle(payload, ledStates)
            else if msgType = "led-cache-prefetch" then
              HandleLedPrefetch(payload, msgPort, ledStates)
            else if msgType = "led-cache-clear-all" then
              HandleLedCacheClearAll(ledStates)
            else if msgType = "led-log-tail-request" then
              HandleLedLogTailRequest(payload, ledStates)
            else if msgType = "led-storage-info" then
              HandleLedStorageInfo(ledStates)
            else if msgType = "led-ota-ping" then
              HandleLedOtaPing(ledStates)
            else if msgType = "led-ota-install" then
              HandleLedOtaInstall(payload, msgPort, ledStates)
            else if msgType = "led-ota-reboot" then
              RebootDeviceAfterOta()
            else if Len(msgType) = 0 then
              LedLog("=== Perform6: JS message empty type ===")
            else
              LedLog("=== Perform6: JS unhandled type " + msgType + " ===")
            end if
          end if
        else if Len(reason) > 0 then
          LedLog("=== Perform6: HtmlWidgetEvent reason=" + reason + " ===")
        end if
      end if
    else if type(ev) = "roNodeJsEvent" then
      ' Defensive: some OS builds deliver @brightsign/messageport PostBSMessage here.
      TraceLog("BRIDGE|event=roNodeJsEvent")
      nodeData = invalid
      nodeData = ev.GetData()
      payload = invalid
      if type(nodeData) = "roAssociativeArray" then
        payload = ExtractJsPayload(nodeData)
        if type(payload) <> "roAssociativeArray" then payload = CoerceMessagePayload(nodeData)
      end if
      if type(payload) = "roAssociativeArray" then
        msgType = PayloadString(payload, "type")
        sender = PayloadString(payload, "role")
        target = PayloadString(payload, "target")
        TraceLog("BRIDGE|node-msg|" + msgType + "|role=" + sender)
        NoteBridgeActivity()
        if msgType = "led-bridge-ping" then
          HandleLedBridgePing(ledStates)
        else if msgType = "led-hello" then
          HandleLedHello(payload, ledStates)
        else if msgType = "xt-playback" and profile = "XT2145" then
          ApplyNativePlayback(ledState, payload, msgPort, ledStates)
        else if msgType = "xc-playback" and profile = "XC4055" then
          if target = "led2" then
            ApplyNativePlayback(led2State, payload, msgPort, ledStates)
          else if target = "led3" then
            ApplyNativePlayback(led3State, payload, msgPort, ledStates)
          end if
        else if msgType = "led-ota-reboot" then
          RebootDeviceAfterOta()
        else if Len(msgType) > 0 then
          LedLog("=== Perform6: NodeJs unhandled type " + msgType + " ===")
        end if
      else
        TraceFnBreak("roNodeJsEvent", "no-payload")
      end if
    else if type(ev) <> "Invalid" and type(ev) <> "roInvalid" then
      TraceLog("MAIN|other-event|" + type(ev))
    end if
  end while
End Sub
