' Perform6 BrightSign autorun — BA-style zones + thin boot
' HtmlWidget (touch/primary) + roVideoPlayer LED zones in ONE Main (like a presentation).
' LED NORMAL PATH: JS PostBSMessage(xt-playback/xc-playback) → ApplyNativePlayback → ack.
' LED FALLBACK: SD:/perform6-led-playback.json poll (if bridge one-way / no port).
' Media: sync/AssetPool to SD first, then PlayFile — NO on-demand HTTPS stream.
' Never SetUrl-recycle HtmlWidget after load-finished (orphans BSMessagePort duplex).
' Profiles: XT2145 / XC4055 = React HDMI-1 + native LEDs; HD226 = one HtmlWidget.
' Content is deployment-driven (Fitness/Golf) — autorun never hardcodes site media.

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
  path = "SD:/perform6-led.log"
  existing = ReadAsciiFile(path)
  if type(existing) <> "roString" and type(existing) <> "String" then existing = ""
  if Len(existing) > 60000 then existing = Right(existing, 30000)
  WriteAsciiFile(path, existing + st.buf)
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
  if nowMs - lastMs < 5000 and st.lines < 20 then return
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
  if st.lines >= 20 then FlushLedLog()
End Sub

' --- Field debug: canary files + TRACE (rate-limited) → Admin ---
Function TraceVerboseEnabled() as Boolean
  g = GetGlobalAA()
  if g.p6Trace = true then return true
  return false
End Function

Sub SetTraceVerbose(enabled as Boolean)
  g = GetGlobalAA()
  g.p6Trace = enabled
End Sub

' Critical traces always; enter/exit spam only when traceAutorun=true.
Function ShouldEmitTrace(msg as String) as Boolean
  if TraceVerboseEnabled() then return true
  if Left(msg, 5) = "MAIN|" then return true
  if Left(msg, 5) = "WIPE|" then return true
  if Instr(1, msg, "FN|break|") > 0 then return true
  if Instr(1, msg, "PLAY|fail") > 0 then return true
  if Instr(1, msg, "PLAY|ok-") > 0 then return true
  if Instr(1, msg, "PLAY|ApplyNative") > 0 then return true
  if Instr(1, msg, "BRIDGE|html-msg|xt-playback") > 0 then return true
  if Instr(1, msg, "BRIDGE|html-msg|xc-playback") > 0 then return true
  if Instr(1, msg, "BRIDGE|node-msg|xt-playback") > 0 then return true
  if Instr(1, msg, "BRIDGE|node-msg|xc-playback") > 0 then return true
  if Instr(1, msg, "BRIDGE|event=roNodeJsEvent") > 0 then return true
  if Instr(1, msg, "SD|resume|") > 0 then return true
  return false
End Function

' One SD write (skip duplicate /storage/sd unless verbose) — less Main I/O.
Sub CanaryWrite(path as String, text as String)
  WriteAsciiFile(path, text)
  if TraceVerboseEnabled() then
    if Left(path, 4) = "SD:/" then
      WriteAsciiFile("/storage/sd/" + Mid(path, 5), text)
    end if
  end if
End Sub

Sub TraceLog(msg as String)
  if not ShouldEmitTrace(msg) then return
  LedLog("TRACE|" + msg)
End Sub

Sub TraceFnEnter(name as String, detail as String)
  if not TraceVerboseEnabled() then return
  if Len(detail) > 0 then
    TraceLog("FN|enter|" + name + "|" + detail)
  else
    TraceLog("FN|enter|" + name)
  end if
End Sub

Sub TraceFnExit(name as String, result as String)
  if not TraceVerboseEnabled() then return
  if Len(result) > 0 then
    TraceLog("FN|exit|" + name + "|" + result)
  else
    TraceLog("FN|exit|" + name)
  end if
End Sub

Sub TraceFnBreak(name as String, reason as String)
  ' Breaks always — needed to find LED play stops without full TRACE spam.
  TraceLog("FN|break|" + name + "|" + reason)
End Sub

Sub WriteBootCanary()
  CanaryWrite("SD:/perform6-boot-canary.txt", "boot-reached|" + IntToStr(ProgressNowMs()))
  TraceLog("MAIN|boot-canary|written")
End Sub

Sub WriteMainHeartbeat()
  ms = ProgressNowMs()
  CanaryWrite("SD:/perform6-heartbeat.txt", "alive-" + IntToStr(ms))
  TraceLog("MAIN|heartbeat|alive|" + IntToStr(ms))
  FlushLedLog()
End Sub

Sub WritePlayfileCanary(phase as String, path as String, okFlag as String)
  ' Skip noisy "trying|?" unless verbose — still log fail / ok.
  if phase = "trying" and not TraceVerboseEnabled() then return
  line = phase + "|" + path + "|ok=" + okFlag + "|ms=" + IntToStr(ProgressNowMs())
  CanaryWrite("SD:/perform6-playfile-attempt.txt", line)
  TraceLog("PLAY|" + line)
End Sub

Sub AttachStorageHotplug(msgPort as Object)
  hotplug = CreateObject("roStorageHotplug")
  if type(hotplug) <> "roStorageHotplug" then return
  hotplug.SetPort(msgPort)
  SafePrint("=== Perform6: storage hotplug monitor attached ===")
End Sub

Function StorageEventPath(ev as Object) as String
  path = ""
  if type(ev) = "roStorageAttached" or type(ev) = "roStorageDetached" then
    path = ev.GetString()
  end if
  if type(path) <> "roString" and type(path) <> "String" then path = ""
  return path
End Function

Function IsSdStoragePath(path as String) as Boolean
  if Len(path) = 0 then return true
  upper = UCase(path)
  if Instr(1, upper, "SD") > 0 then return true
  if Instr(1, upper, "MMC") > 0 then return true
  if Instr(1, upper, "/STORAGE/SD") > 0 then return true
  return false
End Function

Sub PostStorageHotplug(states as Object, attached as Boolean, path as String)
  if attached then
    state = "attached"
  else
    state = "detached"
  end if
  LedLog("=== Perform6: storage " + state + " " + path + " ===")
  html = ResolveBridgeHtml(states)
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-storage")
  msg.state = state
  msg.path = path
  PostJsMessage(html, msg)
End Sub

Sub HandleStorageHotplug(ev as Object, states as Object, attached as Boolean)
  path = StorageEventPath(ev)
  if not IsSdStoragePath(path) then
    SafePrint("=== Perform6: ignore non-SD storage event " + path + " ===")
    return
  end if
  PostStorageHotplug(states, attached, path)
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

' One PostJSMessage per event — BrightSign: one port per widget.
Sub PostJsMessage(html as Object, msg as Object)
  if type(msg) <> "roAssociativeArray" then return
  if type(html) = "roHtmlWidget" then
    PostJsToWidget(html, msg)
    return
  end if
  g = GetGlobalAA()
  if type(g.htmlTouch) = "roHtmlWidget" then
    PostJsToWidget(g.htmlTouch, msg)
    return
  end if
  if type(g.htmlPrimary) = "roHtmlWidget" then
    PostJsToWidget(g.htmlPrimary, msg)
    return
  end if
  if type(g.p6Html) = "roHtmlWidget" then
    PostJsToWidget(g.p6Html, msg)
    return
  end if
  if type(g.html) = "roHtmlWidget" then PostJsToWidget(g.html, msg)
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
  paths = CreateObject("roArray", 2, true)
  paths.Push("SD:/" + name)
  paths.Push("/storage/sd/" + name)
  return paths
End Function

Function IdleFilePresent(name as String) as Boolean
  if FileExistsIn("SD:/", name) then return true
  ' MatchFiles may not accept /storage/sd — try PlayStaticImage/PlayFile fallbacks instead.
  fs = CreateObject("roFileSystem")
  if type(fs) = "roFileSystem" then
    if fs.Exists("/storage/sd/" + name) = true then return true
  end if
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
Function ParseByteSize(value as Dynamic) as Float
  t = type(value)
  if t = "Invalid" then return 0.0
  if t = "roInteger" or t = "Integer" then return value * 1.0
  if t = "roFloat" or t = "Float" or t = "Double" then return value
  if t = "roLongInteger" or t = "LongInteger" then
    s = ""
    s = value.ToString()
    if type(s) = "roString" or type(s) = "String" then
      if Len(s) > 0 then return Val(s)
    end if
    n = value.GetLong()
    return ParseByteSize(n)
  end if
  if t = "roString" or t = "String" then
    if Len(value) = 0 then return 0.0
    return Val(value)
  end if
  s = Str(value)
  while Len(s) > 0 and Left(s, 1) = " "
    s = Mid(s, 2)
  end while
  if Len(s) = 0 then return 0.0
  return Val(s)
End Function

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
  if PartFileBytes(path) > 0 then return true
  alt = ""
  if Left(path, 4) = "SD:/" then
    alt = "/storage/sd/" + Mid(path, 5)
  else if Left(path, 12) = "/storage/sd/" then
    alt = "SD:/" + Mid(path, 13)
  end if
  if Len(alt) > 0 and PartFileBytes(alt) > 0 then return true
  fs = CreateObject("roFileSystem")
  if type(fs) = "roFileSystem" then
    if fs.Exists(path) = true then return true
    if Len(alt) > 0 and fs.Exists(alt) = true then return true
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

Function TryPlayFileOnce(vp as Object, p as String) as Boolean
  TraceFnEnter("TryPlayFileOnce", p)
  WritePlayfileCanary("trying", p, "?")
  ok = vp.PlayFile(p)
  if ok = true then
    WritePlayfileCanary("ok-string", p, "1")
    TraceFnExit("TryPlayFileOnce", "ok-string")
    return true
  end if
  ' BrightAuthor pattern: PlayFile({Filename: GetPoolFilePath(...)})
  aa = CreateObject("roAssociativeArray")
  aa.Filename = p
  ok = vp.PlayFile(aa)
  if ok = true then
    WritePlayfileCanary("ok-filename", p, "1")
    TraceFnExit("TryPlayFileOnce", "ok-filename")
    return true
  end if
  ' Extensionless pool: ProbeString often unlocks PlayFile without CopyFile alias.
  if IsExtensionlessPoolPath(p) then
    aa2 = CreateObject("roAssociativeArray")
    aa2.Filename = p
    aa2.ProbeString = "mp4"
    ok = vp.PlayFile(aa2)
    if ok = true then
      WritePlayfileCanary("ok-probe-mp4", p, "1")
      TraceFnExit("TryPlayFileOnce", "ok-probe-mp4")
      return true
    end if
    aa3 = CreateObject("roAssociativeArray")
    aa3.Filename = p
    aa3.ProbeString = ".mp4"
    ok = vp.PlayFile(aa3)
    if ok = true then
      WritePlayfileCanary("ok-probe-dotmp4", p, "1")
      TraceFnExit("TryPlayFileOnce", "ok-probe-dotmp4")
      return true
    end if
  end if
  WritePlayfileCanary("fail", p, "0")
  TraceFnExit("TryPlayFileOnce", "false")
  return false
End Function

' Pool play: existing .mp4 alias-hit, else pool-direct + ProbeString (no CopyFile).
Function PlayLocalFile(vp as Object, path as String) as Boolean
  TraceFnEnter("PlayLocalFile", path)
  path = NormalizeLocalSrc(path)
  isPool = IsExtensionlessPoolPath(path)

  if isPool then
    existingAlias = PoolMp4AliasPath(path)
    if Len(existingAlias) > 0 and LocalMediaExists(existingAlias) then
      if TryPlayFileOnce(vp, existingAlias) then
        LedLog("=== Perform6: PlayLocalFile alias-hit " + existingAlias + " ===")
        TraceFnExit("PlayLocalFile", "alias-hit")
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
      TraceFnExit("PlayLocalFile", "ok|" + p)
      return true
    end if
  end for
  LedLog("=== Perform6: PlayLocalFile exhausted " + path + " ===")
  TraceFnExit("PlayLocalFile", "exhausted")
  return false
End Function

' After HtmlWidget.Show — attach cache/OTA workers so boot never blocks on SD downloads.
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
Function NowEpochSeconds() as Integer
  dt = CreateObject("roDateTime")
  if type(dt) <> "roDateTime" then return 0
  secs = dt.ToSecondsSinceEpoch()
  if type(secs) = "roInteger" or type(secs) = "Integer" then return secs
  return 0
End Function

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


Sub EnsureLedIdleForStates(states as Object)
  if type(states) <> "roArray" then return
  for each st in states
    if type(st) = "roAssociativeArray" then
      if type(st.vp) = "roVideoPlayer" then
        if st.idleShown <> true and Len(st.playingUrl) = 0 then
          PlayIdleClip(st)
        end if
      end if
    end if
  end for
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

Sub HandleLedBridgeHealthy()
  NoteBridgeActivity()
End Sub

Sub HandleLedBridgeRecycle(payload as Object, states as Object)
  ' BA-simple / BrightAuthor-style: never soft-reload HtmlWidget via SetUrl.
  ' That orphans the JS BSMessagePort (outbound ok, inbound dead). Ops must reboot.
  NoteBridgeActivity()
  reason = PayloadString(payload, "reason")
  if Len(reason) = 0 then reason = "js requested"
  LedLog("=== Perform6: html recycle refused (BA-simple — use reboot) — " + reason + " ===")
  html = ResolveBridgeHtml(states)
  ack = CreateObject("roAssociativeArray")
  ack.AddReplace("type", "led-bridge-recycle-ack")
  ack.reason = reason
  ack.detail = "refused-ba-simple"
  PostJsMessage(html, ack)
  EnsureLedIdleForStates(states)
  FlushLedLog()
End Sub


' One automatic recovery reboot after a fatal boot error; avoids silent blank forever.
Function ShouldAutoRebootOnce(markerName as String) as Boolean
  if FileExistsIn("SD:/", markerName) then
    DeleteFile("SD:/" + markerName)
    return false
  end if
  WriteAsciiFile("SD:/" + markerName, "1")
  return true
End Function

Sub ClearBootFailMarker()
  DeleteFile("SD:/perform6-boot-fail")
End Sub

Sub FatalHang(msg as String)
  LedLog(msg)
  SafePrint(msg)
  TraceLog("MAIN|FATAL|" + msg)
  CanaryWrite("SD:/perform6-fatal-canary.txt", msg)
  if ShouldAutoRebootOnce("perform6-boot-fail") then
    LedLog("=== Perform6: FATAL - auto reboot once ===")
    FlushLedLog()
    RebootDeviceAfterOta()
  end if
  ' Soft-alive: do NOT silent-sleep forever — heartbeat/canary keep updating for Admin.
  LedLog("=== Perform6: FATAL soft-alive (heartbeat continues; fix SD package / reboot) ===")
  FlushLedLog()
  while true
    WriteMainHeartbeat()
    CanaryWrite("SD:/perform6-fatal-canary.txt", "soft-alive|" + IntToStr(ProgressNowMs()))
    FlushLedLog()
    Sleep(15000)
  end while
End Sub


' --- Thin: no HTTP prefetch/OTA in autorun. Keep media wipe + storage + log-tail. ---
Function LegacyCacheDir() as String
  return "SD:/perform6-cache"
End Function

Function OtaPoolDir() as String
  return "SD:/perform6-ota-pool"
End Function

Function IsSafeMediaWipePath(path as String) as Boolean
  if path = CacheDir() then return true
  if path = LegacyCacheDir() then return true
  if path = MediaPoolDir() then return true
  if path = OtaPoolDir() then return false
  return false
End Function

Function PathLooksLikeDirectory(fullPath as String) as Boolean
  fs = CreateObject("roFileSystem")
  if type(fs) <> "roFileSystem" then return false
  st = fs.Stat(fullPath)
  if type(st) <> "roAssociativeArray" then return false
  if type(st.type) = "roString" or type(st.type) = "String" then
    return Instr(1, LCase(st.type), "dir") > 0
  end if
  return false
End Function

Sub DeleteTree(path as String)
  DeleteTreeBudgeted(path, 100000)
End Sub

' Returns true if more work remains (call again later — keeps Main responsive).
Function DeleteTreeBudgeted(path as String, budget as Integer) as Boolean
  if Len(path) < 8 then return false
  if Instr(1, path, "..") > 0 then return false
  if Left(path, 4) <> "SD:/" then return false
  if budget <= 0 then return true

  dir = path
  if Right(dir, 1) <> "/" then dir = dir + "/"

  names = MatchFiles(dir, "*")
  if type(names) <> "roList" and type(names) <> "roArray" then
    DeleteDirectory(path)
    return false
  end if

  used = 0
  for each name in names
    if used >= budget then return true
    if Len(name) > 0 and name <> "." and name <> ".." then
      full = dir + name
      if PathLooksLikeDirectory(full) then
        if DeleteTreeBudgeted(full, budget - used) then return true
        used = used + 1
      else
        DeleteFile(full)
        used = used + 1
      end if
    end if
  end for

  DeleteDirectory(path)
  return false
End Function

Sub WipeMediaDirectory(path as String)
  if not IsSafeMediaWipePath(path) then
    LedLog("=== Perform6: refuse wipe of unsafe path " + path + " ===")
    return
  end if
  ' Full wipe can block Main for minutes — prefer ScheduleDeferredMediaWipe.
  DeleteDirectory(path)
  DeleteTree(path)
  CreateDirectory(path)
  LedLog("=== Perform6: wiped+recreated " + path + " ===")
End Sub

Sub ScheduleDeferredMediaWipe()
  g = GetGlobalAA()
  g.p6WipeActive = true
  g.p6WipePath = ""
  g.p6WipeQueue = CreateObject("roArray", 3, true)
  g.p6WipeQueue.Push(CacheDir())
  g.p6WipeQueue.Push(MediaPoolDir())
  g.p6WipeQueue.Push(LegacyCacheDir())
  g.p6WipeIdx = 0
  TraceLog("WIPE|scheduled|dirs=3")
  LedLog("=== Perform6: media wipe DEFERRED (budgeted; Main stays responsive) ===")
End Sub

' Heartbeat tick: delete up to ~40 entries then return (no multi-minute Main block).
Sub MaybeProcessDeferredWipe()
  g = GetGlobalAA()
  if g.p6WipeActive <> true then return
  if type(g.p6WipeQueue) <> "roArray" then
    g.p6WipeActive = false
    return
  end if
  idx = 0
  if type(g.p6WipeIdx) = "roInteger" or type(g.p6WipeIdx) = "Integer" then idx = g.p6WipeIdx
  if idx >= g.p6WipeQueue.Count() then
    g.p6WipeActive = false
    TraceLog("WIPE|done")
    LedLog("=== Perform6: deferred media wipe complete ===")
    FlushLedLog()
    return
  end if

  path = g.p6WipeQueue[idx]
  if not IsSafeMediaWipePath(path) then
    g.p6WipeIdx = idx + 1
    return
  end if

  TraceLog("WIPE|tick|" + path)
  CreateDirectory(path)
  more = DeleteTreeBudgeted(path, 40)
  if more then
    ' Same dir next tick.
    return
  end if
  CreateDirectory(path)
  LedLog("=== Perform6: deferred wiped " + path + " ===")
  g.p6WipeIdx = idx + 1
  if g.p6WipeIdx >= g.p6WipeQueue.Count() then
    g.p6WipeActive = false
    TraceLog("WIPE|done")
    LedLog("=== Perform6: deferred media wipe complete ===")
    FlushLedLog()
    if g.p6WipeRebootWhenDone = true then
      g.p6WipeRebootWhenDone = false
      LedLog("=== Perform6: rebootAfterCacheClear after deferred wipe ===")
      FlushLedLog()
      RebootDeviceAfterOta()
    end if
  end if
End Sub

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

Sub EnsureDeferredWorkers(states as Object, html as Object)
  RememberP6Html(html)
  ' JS AssetPool owns/creates SD:/perform6-media-pool. Re-opening that active
  ' pool directory here can block Main before its playback-command loop.
  LedLog("=== Perform6: thin autorun — JS owns media dirs (no HTTP workers) ===")
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
  ' MEDIA ONLY — never wipe OTA pool.
  ' Do NOT sync DeleteTree here (multi-GB blocks Main). JS Node wipe is primary;
  ' autorun schedules budgeted deferred wipe + idle.
  EnsureLedIdleForStates(states)
  DeleteFile("SD:/perform6-mp4-alias-queue.json")
  DeleteFile("/storage/sd/perform6-mp4-alias-queue.json")
  ScheduleDeferredMediaWipe()
  LedLog("=== Perform6: media clear requested (deferred wipe; OTA untouched) ===")
  FlushLedLog()
End Sub

Sub HandleLedOtaInstall(payload as Object, msgPort as Object, states as Object)
  LedLog("=== Perform6: led-ota-install ignored (use JS OTA AssetPool) ===")
End Sub

Sub HandleLedOtaPing(states as Object)
  html = ResolveBridgeHtml(states)
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-ota-pong")
  msg.ok = "1"
  msg.detail = "thin-autorun-js-ota"
  PostJsMessage(html, msg)
End Sub

Sub HandleLedOtaAuth(payload as Object, states as Object)
End Sub

Sub HandleLedOtaCancel(states as Object)
End Sub

Sub HandleLedBridgeHeal(payload as Object)
  LedLog("=== Perform6: bridge heal ignored (BA-simple — reboot only) ===")
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
      Sleep(100)
    end if
    ' AssetRealizer files are visible to the HTML/Node filesystem immediately,
    ' while roFileSystem Stat/Exists can report a false negative on exFAT. The
    ' precheck is advisory only; roVideoPlayer.PlayFile is authoritative.
    if not LocalMediaExists(src) then
      TraceLog("PLAY|existence-probe-miss|trying-PlayFile|" + src)
      LedLog("=== Perform6: LED " + st.key + " existence probe missed; trying PlayFile " + src + " ===")
    end if
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
  mediaId = PayloadString(payload, "mediaVersionId")
  TraceLog("PLAY|ApplyNative|src=" + src + "|fb=" + fallbackSrc + "|id=" + mediaId)
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
  ' XT field logs show outbound HtmlWidget messages can block the native loop.
  ' Playback status is already persisted to SD and polled by the touch app.
  g = GetGlobalAA()
  if g.p6Profile = "XT2145" then
    TraceLog("BRIDGE|ack-via-sd|" + st.key + "|" + detail)
    return
  end if
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

' --- LED playback SD bus (FALLBACK when bridge one-way / no port) --------------
' NORMAL path: JS PostBSMessage xt-playback / xc-playback (BA HTML↔zone style).
' Fallback: JS writes SD:/perform6-led-playback.json; autorun polls ~2s.
' JS writes SD:/perform6-led-playback.json (commands[] per LED target).
' Legacy SD:/perform6-xt-playback.json still accepted (maps to target "led").
' Bridge PostBSMessage is best-effort only — never required for LED play.

Function LoadLedPlaybackFileAA() as Object
  paths = CreateObject("roArray", 4, true)
  paths.Push("SD:/perform6-led-playback.json")
  paths.Push("/storage/sd/perform6-led-playback.json")
  paths.Push("SD:/perform6-xt-playback.json")
  paths.Push("/storage/sd/perform6-xt-playback.json")
  for each path in paths
    text = ReadAsciiFile(path)
    if type(text) = "roString" or type(text) = "String" then
      if Len(text) > 0 then
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
  paths = CreateObject("roArray", 2, true)
  paths.Push("SD:/perform6-led-playback-status.json")
  paths.Push("/storage/sd/perform6-led-playback-status.json")
  for each path in paths
    text = ReadAsciiFile(path)
    if Len(text) > 0 then
      parsed = ParseJSON(text)
      if type(parsed) = "roAssociativeArray" then return parsed
    end if
  end for
  return invalid
End Function

Function LoadLedStatusSidecarEntry(roleKey as String) as Object
  if Len(roleKey) = 0 then return invalid
  paths = CreateObject("roArray", 2, true)
  paths.Push("SD:/perform6-led-playback-status-" + roleKey + ".json")
  paths.Push("/storage/sd/perform6-led-playback-status-" + roleKey + ".json")
  for each path in paths
    text = ReadAsciiFile(path)
    if Len(text) > 0 then
      parsed = ParseJSON(text)
      if type(parsed) = "roAssociativeArray" then
        migrated = RoleStatusEntryFromFlat(parsed)
        if type(migrated) = "roAssociativeArray" then return migrated
        return parsed
      end if
    end if
  end for
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
  AtomicWriteAsciiFile("/storage/sd/perform6-led-playback-status-" + roleKey + ".json", entryJson)

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
  AtomicWriteAsciiFile("/storage/sd/perform6-led-playback-status.json", json)
  AtomicWriteAsciiFile("SD:/perform6-xt-playback-status.json", json)
  AtomicWriteAsciiFile("/storage/sd/perform6-xt-playback-status.json", json)
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
Sub WriteXtPlaybackStatus(st as Object, detail as String, ended as Boolean)
  WriteLedPlaybackStatus(st, detail, ended)
End Sub

Sub WriteXtBusHeartbeat(detail as String, src as String)
  WriteLedBusHeartbeat(detail, src)
End Sub

Function LoadXtPlaybackFileAA() as Object
  return LoadLedPlaybackFileAA()
End Function

Function XtPlaybackSignature(aa as Object) as String
  return LedCmdSignature(aa)
End Function

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

' Fallback SD poll — BA-style bridge is primary; keep this slow to avoid fighting zone msgs.
Sub MaybePollLedPlaybackFile(states as Object, msgPort as Object)
  if type(states) <> "roArray" then return
  if states.Count() = 0 then return
  g = GetGlobalAA()
  if type(g.p6PbPollSpan) <> "roTimespan" then
    g.p6PbPollSpan = CreateObject("roTimespan")
    if type(g.p6PbPollSpan) = "roTimespan" then g.p6PbPollSpan.Mark()
  end if
  if type(g.p6PbPollSpan) <> "roTimespan" then return
  if g.p6PbPollSpan.TotalMilliseconds() < 2000 then return
  g.p6PbPollSpan.Mark()
  MaybeResumePlaybackFromFile(states, msgPort, "loop")
End Sub

Sub MaybePollXtPlaybackFile(states as Object, msgPort as Object)
  MaybePollLedPlaybackFile(states, msgPort)
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
    LedLog("=== Perform6: LED " + st.key + " idle FAILED led-idle.mp4 (SD:/ + /storage/sd/) ===")
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
  LedLog("=== Perform6: LED " + st.key + " idle FAILED led-idle.png (SD:/ + /storage/sd/) ===")
End Sub

Sub PostLedReady(html as Object, msgType as String, role as String)
  ' Do not make XT boot depend on an outbound HtmlWidget message. Readiness is
  ' represented by the SD heartbeat/status bus once Main enters its poll loop.
  g = GetGlobalAA()
  if g.p6Profile = "XT2145" then return
  if type(html) <> "roHtmlWidget" then
    return
  end if
  ready = CreateObject("roAssociativeArray")
  ready.AddReplace("type", msgType)
  ready.AddReplace("role", role)
  PostJsMessage(html, ready)
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

Function ReleaseVersionToken() as String
  raw = ReadRawFile("SD:/perform6-release.json")
  if Len(raw) = 0 then raw = ReadRawFile("perform6-release.json")
  if Len(raw) = 0 then return ""

  release = ParseJson(raw)
  if type(release) <> "roAssociativeArray" then return ""
  version = release.version
  if type(version) <> "roString" and type(version) <> "String" then return ""
  return UrlSafeToken(version)
End Function

Function BuildAppUrl(basePath as String, identity as Object, profile as String, outputRole as String) as String
  q = ""
  releaseVersion = ReleaseVersionToken()
  if Len(releaseVersion) > 0 then
    q = "p6v=" + releaseVersion
  end if
  if Len(identity.serial) > 0 then
    if Len(q) > 0 then q = q + "&"
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
  ' Prefer package marker written by release zip (authoritative for this SD image).
  profile = ReadTextFile("perform6-profile.txt")
  if Len(profile) = 0 then
    profile = ReadTextFile("SD:/perform6-profile.txt")
  end if
  if profile = "XT2145" or profile = "XC4055" or profile = "HD226" then
    SafePrint("=== Perform6: profile from perform6-profile.txt = " + profile + " ===")
    return profile
  end if

  model = UCase(identity.model)
  if Instr(1, model, "XC4055") > 0 or Instr(1, model, "XC5") > 0 then
    return "XC4055"
  end if
  if Instr(1, model, "XT2145") > 0 or Instr(1, model, "XT5") > 0 then
    return "XT2145"
  end if
  if Instr(1, model, "HD226") > 0 or Instr(1, model, "HD5") > 0 then
    return "HD226"
  end if

  SafePrint("=== Perform6: unknown model - single-output fallback ===")
  return "HD226"
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
    SafePrint("=== Perform6: perform6-display.txt '" + mode + "' ignored — BrightSign pattern uses MULTI (4K60) ===")
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
  ' BrightSign roReadFile.ReadLine() can keep returning an empty roString at EOF.
  ' The previous type-based exit therefore trapped Main here forever while
  ' reading perform6-ops.json, after the HDMI-2 logo but before the event loop.
  while not f.AtEof()
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
  if Len(content) = 0 then
    SetTraceVerbose(false)
    TraceLog("OPS|missing-ops|trace=off-default")
    return
  end if

  ' Verbose TRACE only when traceAutorun:true (critical MAIN/PLAY/break always emit).
  if OpsJsonFieldTrue(content, "traceAutorun") then
    SetTraceVerbose(true)
  else
    SetTraceVerbose(false)
  end if
  TraceLog("OPS|traceAutorun|" + BoolToStr(TraceVerboseEnabled()))

  modified = false
  if OpsJsonFieldTrue(content, "clearCacheOnBoot") then
    LedLog("=== Perform6: perform6-ops clearCacheOnBoot (deferred wipe) ===")
    HandleLedCacheClearAll(states)
    content = OpsJsonSetFieldFalse(content, "clearCacheOnBoot")
    modified = true
    if OpsJsonFieldTrue(content, "rebootAfterCacheClear") then
      ' Reboot after wipe finishes — flag for heartbeat; avoid reboot mid-DeleteTree.
      g = GetGlobalAA()
      g.p6WipeRebootWhenDone = true
      content = OpsJsonSetFieldFalse(content, "rebootAfterCacheClear")
      modified = true
    end if
  end if

  if modified then
    WriteRawFile(OpsFilePath(), content)
    LedLog("=== Perform6: perform6-ops.json one-shot flags consumed ===")
  end if
End Sub

Sub HandleLedOpsReload(payload as Object, states as Object)
  html = ResolveBridgeHtml(states)
  content = ReadRawFile(OpsFilePath())
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-ops-config")
  msg.requestId = PayloadString(payload, "requestId")
  msg.content = content
  PostJsMessage(html, msg)
End Sub

Sub HandleLedOpsWrite(payload as Object)
  content = PayloadString(payload, "content")
  if Len(content) = 0 then return
  WriteRawFile(OpsFilePath(), content)
  LedLog("=== Perform6: perform6-ops.json updated ===")
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

Sub LogDisplayIdentity(vm as Object, hdmiName as String)
  if type(vm) <> "roVideoMode" then
    return
  end if

  edid = vm.GetEdidIdentity(hdmiName)
  if type(edid) <> "roAssociativeArray" then
    SafePrint("=== Perform6: " + hdmiName + " EDID unavailable ===")
    LedLog("=== Perform6: " + hdmiName + " EDID unavailable ===")
    return
  end if

  manufacturer = "unknown"
  monitorName = "unknown"
  if type(edid.manufacturer) = "roString" then manufacturer = edid.manufacturer
  if type(edid.monitor_name) = "roString" then monitorName = edid.monitor_name
  SafePrint("=== Perform6: " + hdmiName + " EDID " + manufacturer + " / " + monitorName + " ===")
  LedLog("=== Perform6: " + hdmiName + " EDID " + manufacturer + " / " + monitorName + " ===")
End Sub

' Report configured multi-screen modes honestly. On XT, GetActiveMode/GetFPS
' describe the combined canvas and are not per-output evidence. Verify each HDMI
' from GetScreenModes and derive its refresh rate from the configured mode.
Sub LogActiveDisplayModes(vm as Object, profile as String)
  if type(vm) <> "roVideoMode" then return

  bluefinModeText = ""
  ledModeText = ""
  if profile = "XT2145" then
    bluefinModeText = GetConfiguredScreenMode(vm, "HDMI-1")
    ledModeText = GetConfiguredScreenMode(vm, "HDMI-2")
  end if

  modeText = ""
  colorText = ""
  depthText = ""
  active = vm.GetActiveMode()
  if type(active) = "roAssociativeArray" then
    if type(active.videomode) = "roString" then modeText = active.videomode
    if type(active.colorspace) = "roString" then colorText = active.colorspace
    if type(active.colordepth) = "roString" then depthText = active.colordepth
    LedLog("=== Perform6: GetActiveMode " + modeText + " " + colorText + " " + depthText + " ===")
    if profile = "XT2145" then
      LedLog("OUT|CANVAS|mode=" + modeText + "|depth=" + depthText + "|note=combined-multiscreen")
    else if profile <> "XT2145" and ModeLooks4k60(modeText) then
      LedLog("OUT|PRIMARY|ok=1|mode=" + modeText + "|depth=" + depthText)
    else
      LedLog("OUT|ISSUE|primary output mode unexpected|mode=" + modeText + "|depth=" + depthText)
    end if
  else
    LedLog("=== Perform6: GetActiveMode unavailable ===")
    LedLog("OUT|ISSUE|GetActiveMode unavailable")
  end if

  fpsText = ""
  if profile = "XT2145" then
    fpsText = ModeRefreshText(ledModeText)
    if ModeLooks60p(ledModeText) then
      LedLog("OUT|FPS|HDMI-2|ok=1|fps=" + fpsText + "|source=screen-mode")
    else
      LedLog("OUT|ISSUE|HDMI-2 configured refresh is not 59.94/60|mode=" + ledModeText)
    end if
    if ModeLooks1080p60(bluefinModeText) then
      LedLog("OUT|HDMI-1|ok=1|mode=" + bluefinModeText)
    else
      LedLog("OUT|ISSUE|HDMI-1 configured mode unexpected|mode=" + bluefinModeText)
    end if
  else
    fps = vm.GetFPS()
    if type(fps) = "roInteger" or type(fps) = "Integer" then
      fpsText = IntToStr(fps)
      LedLog("=== Perform6: GetFPS " + fpsText + " ===")
      if fps < 59 or fps > 60 then
        LedLog("OUT|ISSUE|output fps is not 59.94/60|fps=" + fpsText)
      else
        LedLog("OUT|FPS|ok=1|fps=" + fpsText)
      end if
    end if
  end if

  rx = vm.GetResX()
  ry = vm.GetResY()
  if rx > 0 and ry > 0 then
    LedLog("OUT|GRAPHICS|" + IntToStr(rx) + "x" + IntToStr(ry))
  end if

  ledBestText = ""
  if profile = "XT2145" then ledBestText = BestModeForConnector(vm, "HDMI-2")
  WriteOutputDiagFile(profile, modeText, bluefinModeText, ledModeText, ledBestText, colorText, depthText, fpsText)

  ' GetBestMode docs list "hdmi"/"vga"; multi-output also accepts HDMI-N names.
  connectors = CreateObject("roArray", 4, true)
  if profile = "XT2145" then
    connectors.Push("HDMI-1")
    connectors.Push("HDMI-2")
  else if profile = "XC4055" then
    connectors.Push("HDMI-1")
    connectors.Push("HDMI-2")
    connectors.Push("HDMI-3")
  else
    connectors.Push("hdmi")
  end if

  i = 0
  while i < connectors.Count()
    name = connectors[i]
    best = BestModeForConnector(vm, name)
    if Len(best) = 0 then best = "(blank/no EDID)"
    LedLog("=== Perform6: GetBestMode " + name + "=" + best + " ===")
    if ModeLooks4k60(best) then
      LedLog("OUT|" + name + "|best=4K60|" + best)
    else if profile = "XT2145" and name = "HDMI-1" and Instr(1, LCase(best), "1920x1080") > 0 then
      LedLog("OUT|HDMI-1|best=1080p|" + best)
    else if Instr(1, best, "(blank") = 0 then
      LedLog("OUT|" + name + "|best=" + best + "|note=1080p60-safe-fallback")
    end if
    LogDisplayIdentity(vm, name)
    i = i + 1
  end while
End Sub

Function BestModeForConnector(vm as Object, hdmiName as String) as String
  best = vm.GetBestMode(hdmiName)
  if type(best) <> "roString" and type(best) <> "String" then best = ""
  if Len(best) = 0 and Left(UCase(hdmiName), 4) = "HDMI" then
    fallback = vm.GetBestMode("hdmi")
    if type(fallback) = "roString" or type(fallback) = "String" then best = fallback
  end if
  return best
End Function

Function GetConfiguredScreenMode(vm as Object, hdmiName as String) as String
  sm = vm.GetScreenModes()
  idx = FindScreenIndex(sm, hdmiName)
  if idx < 0 then return ""
  entry = sm[idx]
  if type(entry) <> "roAssociativeArray" then return ""
  if type(entry.video_mode) <> "roString" and type(entry.video_mode) <> "String" then return ""
  modeText = entry.video_mode
  LedLog("OUT|CONFIG|" + hdmiName + "|mode=" + modeText)
  return modeText
End Function

Sub WriteOutputDiagFile(profile as String, primaryModeText as String, bluefinModeText as String, ledModeText as String, ledBestText as String, colorText as String, depthText as String, fpsText as String)
  q = Chr(34)
  ok = "0"
  healthy = "0"
  if ModeLooks4k60(ledModeText) then ok = "1"
  if ModeLooks60p(ledModeText) then healthy = "1"
  json = "{"
  json = json + q + "type" + q + ":" + q + "output-diag" + q + ","
  json = json + q + "profile" + q + ":" + q + profile + q + ","
  json = json + q + "primaryMode" + q + ":" + q + primaryModeText + q + ","
  json = json + q + "bluefinMode" + q + ":" + q + bluefinModeText + q + ","
  json = json + q + "ledMode" + q + ":" + q + ledModeText + q + ","
  json = json + q + "ledEdidBest" + q + ":" + q + ledBestText + q + ","
  json = json + q + "colorspace" + q + ":" + q + colorText + q + ","
  json = json + q + "colordepth" + q + ":" + q + depthText + q + ","
  json = json + q + "fps" + q + ":" + q + fpsText + q + ","
  json = json + q + "configured4k60" + q + ":" + q + ok + q + ","
  json = json + q + "outputHealthy" + q + ":" + q + healthy + q
  json = json + "}"
  WriteAsciiFile("SD:/perform6-output-diag.json", json)
  WriteAsciiFile("/storage/sd/perform6-output-diag.json", json)
End Sub

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

' Restore the previous active package when a newly activated OTA cannot load
' its HtmlWidget. The marker exists only after staging and size validation.
Function RollbackPendingOta(reason as String) as Boolean
  text = ReadAsciiFile("SD:/perform6-ota-pending.json")
  if Len(text) = 0 then return false
  pending = ParseJSON(text)
  if type(pending) <> "roAssociativeArray" then return false
  backupRoot = AsBrString(pending.backupRoot)
  paths = pending.paths
  if Len(backupRoot) = 0 or type(paths) <> "roArray" then return false

  restored = 0
  for each relValue in paths
    rel = AsBrString(relValue)
    if Len(rel) > 0 then
      backup = backupRoot + "/" + rel
      active = "SD:/" + rel
      if PartFileBytes(backup) > 0 then
        if CopyFile(backup, active) then restored = restored + 1
      end if
    end if
  end for
  LedLog("=== Perform6: OTA rollback " + reason + " restored=" + IntToStr(restored) + " ===")
  FlushLedLog()
  if restored > 0 then
    DeleteFile("SD:/perform6-ota-pending.json")
    return true
  end if
  return false
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

  ' Accept 3840x2160x60p with or without :fullres when bases match.
  ' Strict :fullres-only matching caused endless SetScreenModes on some OS builds.
  return true
End Function

Function FleetOutputWidth() as Integer
  return 3840
End Function

Function FleetOutputHeight() as Integer
  return 2160
End Function

Function FleetVideoMode(displayMode as String) as String
  if displayMode = "MULTI_NOFULLRES" then return "3840x2160x60p"
  return "3840x2160x60p:fullres"
End Function

Function BluefinVideoMode() as String
  ' Field-proven mode and the native resolution of the 15.6-inch controller.
  return "1920x1080x60p:fullres"
End Function

Function BluefinOutputWidth() as Integer
  return 1920
End Function

Function BluefinOutputHeight() as Integer
  return 1080
End Function

Function ModeLooks4k60(modeText as String) as Boolean
  low = LCase(modeText)
  if Instr(1, low, "3840x2160") = 0 then return false
  if Instr(1, low, "60") = 0 then return false
  return true
End Function

Function ModeLooks1080p60(modeText as String) as Boolean
  low = LCase(modeText)
  if Instr(1, low, "1920x1080") = 0 then return false
  if Instr(1, low, "60") = 0 then return false
  return true
End Function

Function ModeLooks60p(modeText as String) as Boolean
  low = LCase(modeText)
  if Instr(1, low, "x59.94p") > 0 then return true
  if Instr(1, low, "x60p") > 0 then return true
  return false
End Function

Function ModeRefreshText(modeText as String) as String
  low = LCase(modeText)
  if Instr(1, low, "x59.94p") > 0 then return "59.94"
  if Instr(1, low, "x60p") > 0 then return "60"
  if Instr(1, low, "x50p") > 0 then return "50"
  if Instr(1, low, "x30p") > 0 then return "30"
  if Instr(1, low, "x29.97p") > 0 then return "29.97"
  return "unknown"
End Function

Function OutputWidthForMode(modeText as String) as Integer
  low = LCase(modeText)
  if Instr(1, low, "3840x2160") > 0 then return 3840
  if Instr(1, low, "1920x1080") > 0 then return 1920
  return FleetOutputWidth()
End Function

Function OutputHeightForMode(modeText as String) as Integer
  low = LCase(modeText)
  if Instr(1, low, "3840x2160") > 0 then return 2160
  if Instr(1, low, "1920x1080") > 0 then return 1080
  return FleetOutputHeight()
End Function

' Deterministic XT policy: use 4K60 only when HDMI-2 EDID advertises it;
' otherwise use the universally compatible 1080p60 fallback. Both outputs
' remain at the same refresh rate as required by BrightSign multiscreen mode.
Function SelectXtLedVideoMode(vm as Object, displayMode as String) as String
  best = BestModeForConnector(vm, "HDMI-2")
  if ModeLooks4k60(best) then
    selected = FleetVideoMode(displayMode)
    LedLog("OUT|EDID_SELECT|HDMI-2|best=" + best + "|selected=" + selected + "|fallback=0")
    return selected
  end if
  selected = "1920x1080x60p:fullres"
  if Len(best) = 0 then best = "unavailable"
  LedLog("OUT|EDID_SELECT|HDMI-2|best=" + best + "|selected=" + selected + "|fallback=1")
  return selected
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
  if type(sm) <> "roArray" or sm.Count() < 1 then
    if profile = "HD226" then
      mode4k = FleetVideoMode(displayMode)
      active = vm.GetActiveMode()
      current = ""
      if type(active) = "roAssociativeArray" then
        if type(active.videomode) = "roString" then current = active.videomode
      end if
      if ModeLooks4k60(current) then
        SafePrint("=== Perform6: HD226 SetMode already 4K60 ===")
        return false
      end if
      SafePrint("=== Perform6: HD226 SetMode " + mode4k + " (may reboot) ===")
      vm.SetMode(mode4k)
      return true
    end if
    SafePrint("=== Perform6: GetScreenModes unavailable - keep default output ===")
    return false
  end if

  ' BrightSign multi-screen pattern: fixed modes, never "auto".
  ' XT preserves the field-proven 1080p Bluefin and uses 4K60 only on HDMI-2.
  ' XC keeps its independent 4K60 tiles.
  ' :fullres = graphics plane 1:1 with video mode. HDMI color depth is
  ' negotiated with the sink and reported by diagnostics; it is not assumed.
  mode4k = FleetVideoMode(displayMode)
  tileW = FleetOutputWidth()
  needChange = false
  SafePrint("=== Perform6: BrightSign pattern video_mode=" + mode4k + " ===")

  if profile = "HD226" then
    idx0 = FindScreenIndex(sm, "HDMI-1")
    if idx0 < 0 then idx0 = FindScreenIndex(sm, "hdmi")
    if idx0 < 0 then idx0 = 0
    if not ScreenAlreadyMatches(sm[idx0], mode4k, 0, true) then needChange = true
    i = 0
    while i < sm.Count()
      if i <> idx0 then
        if type(sm[i]) = "roAssociativeArray" and sm[i].enabled = true then
          needChange = true
        end if
      end if
      i = i + 1
    end while
    if needChange = false then
      SafePrint("=== Perform6: HD226 already configured (4K60) ===")
      return false
    end if
    ConfigureOutput(sm[idx0], mode4k, 0, true)
    i = 0
    while i < sm.Count()
      if i <> idx0 then ConfigureOutput(sm[i], mode4k, 0, false)
      i = i + 1
    end while
    SafePrint("=== Perform6: SetScreenModes HD226 " + mode4k + " (may reboot) ===")
    vm.SetScreenModes(sm)
    return true
  end if

  if profile = "XT2145" then
    LogDisplayIdentity(vm, "HDMI-1")
    LogDisplayIdentity(vm, "HDMI-2")
    idx1 = FindScreenIndex(sm, "HDMI-1")
    idx2 = FindScreenIndex(sm, "HDMI-2")
    if idx1 < 0 then idx1 = 0
    if idx2 < 0 then idx2 = 1

    modeBluefin = BluefinVideoMode()
    modeLed = SelectXtLedVideoMode(vm, displayMode)
    bluefinW = BluefinOutputWidth()
    if not ScreenAlreadyMatches(sm[idx1], modeBluefin, 0, true) then needChange = true
    if not ScreenAlreadyMatches(sm[idx2], modeLed, bluefinW, true) then needChange = true

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
      SafePrint("=== Perform6: XT2145 EDID-compatible HDMI modes already configured ===")
      return false
    end if

    ConfigureOutput(sm[idx1], modeBluefin, 0, true)
    ConfigureOutput(sm[idx2], modeLed, bluefinW, true)
    i = 0
    while i < sm.Count()
      if i <> idx1 and i <> idx2 then
        ConfigureOutput(sm[i], mode4k, 0, false)
      end if
      i = i + 1
    end while

    SafePrint("=== Perform6: SetScreenModes XT2145 HDMI-1=" + modeBluefin + " HDMI-2=" + modeLed + " (may reboot) ===")
    vm.SetScreenModes(sm)
    return true
  end if

  if profile = "XC4055" then
    LogDisplayIdentity(vm, "HDMI-1")
    LogDisplayIdentity(vm, "HDMI-2")
    LogDisplayIdentity(vm, "HDMI-3")
    idx1 = FindScreenIndex(sm, "HDMI-1")
    idx2 = FindScreenIndex(sm, "HDMI-2")
    idx3 = FindScreenIndex(sm, "HDMI-3")
    if idx1 < 0 then idx1 = 0
    if idx2 < 0 then idx2 = 1
    if idx3 < 0 then idx3 = 2

    if not ScreenAlreadyMatches(sm[idx1], mode4k, 0, true) then needChange = true
    if not ScreenAlreadyMatches(sm[idx2], mode4k, tileW, true) then needChange = true
    if not ScreenAlreadyMatches(sm[idx3], mode4k, tileW * 2, true) then needChange = true

    i = 0
    while i < sm.Count()
      if i <> idx1 and i <> idx2 and i <> idx3 then
        if type(sm[i]) = "roAssociativeArray" and sm[i].enabled = true then
          needChange = true
        end if
      end if
      i = i + 1
    end while

    if needChange = false then
      SafePrint("=== Perform6: XC4055 triple HDMI already configured (4K60) ===")
      return false
    end if

    ConfigureOutput(sm[idx1], mode4k, 0, true)
    ConfigureOutput(sm[idx2], mode4k, tileW, true)
    ConfigureOutput(sm[idx3], mode4k, tileW * 2, true)
    i = 0
    while i < sm.Count()
      if i <> idx1 and i <> idx2 and i <> idx3 then
        ConfigureOutput(sm[i], mode4k, 0, false)
      end if
      i = i + 1
    end while

    SafePrint("=== Perform6: SetScreenModes XC4055 HDMI-1/2/3 " + mode4k + " (may reboot) ===")
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
  gProfile = GetGlobalAA()
  gProfile.p6Profile = profile
  LedLog("=== Perform6: hardware profile " + profile + " ===")
  TraceLog("MAIN|profile|" + profile)

  displayMode = ReadDisplayMode()
  ' XT/XC always BrightAuthor-style multi-output (React + native LED video).
  multiOutput = (profile = "XT2145" or profile = "XC4055")
  SafePrint("=== Perform6: display mode " + displayMode + " ===")

  Sleep(500)

  msgPort = CreateObject("roMessagePort")
  if type(msgPort) <> "roMessagePort" then
    FatalHang("=== Perform6: FATAL no roMessagePort ===")
  end if

  AttachStorageHotplug(msgPort)

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
    LogActiveDisplayModes(vm, profile)
  end if

  ' Must be configured before any HTML/video player allocates an audio decoder.
  ConfigureAudioResources(profile)

  tileW = FleetOutputWidth()
  tileH = FleetOutputHeight()
  if profile = "XT2145" and type(vm) = "roVideoMode" then
    configuredLedMode = GetConfiguredScreenMode(vm, "HDMI-2")
    tileW = OutputWidthForMode(configuredLedMode)
    tileH = OutputHeightForMode(configuredLedMode)
  end if
  width = tileW
  height = tileH

  ' XC uses 4K tiles. XT keeps its Bluefin HtmlWidget at native 1080p and
  ' reserves the following 4K canvas region for HDMI-2 native video.
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

  if profile = "XT2145" and multiOutput then
    ' Order (BrightSign multi-out + decoder budget): HtmlWidget Show FIRST, then
    ' exactly ONE HDMI-2 roVideoPlayer. Never allocate a pre-HTML LED player.
    SafePrint("=== Perform6: XT React HDMI-1 + native video HDMI-2 ===")
    bluefinW = BluefinOutputWidth()
    bluefinH = BluefinOutputHeight()
    touchRect = CreateObject("roRectangle", 0, 0, bluefinW, bluefinH)
    ledRect = CreateObject("roRectangle", bluefinW, 0, tileW, tileH)
    if type(touchRect) <> "roRectangle" or type(ledRect) <> "roRectangle" then
      FatalHang("=== Perform6: FATAL no XT output rectangles ===")
    end if
    LedLog("OUT|RECT|HDMI-1|0,0," + IntToStr(bluefinW) + "x" + IntToStr(bluefinH))
    LedLog("OUT|RECT|HDMI-2|" + IntToStr(bluefinW) + ",0," + IntToStr(tileW) + "x" + IntToStr(tileH))

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
    Sleep(500)
    LedLog("=== Perform6: HDMI-2 native roVideoPlayer (single, after HtmlWidget) ===")
    videoLed = TryCreateVideoPlayer(ledRect, msgPort, 2, "hdmi-2")
    if type(videoLed) <> "roVideoPlayer" then
      LedLog("=== Perform6: ERROR HDMI-2 roVideoPlayer create failed ===")
    else
      ledState = CreateLedState(videoLed, "led")
      ledStates.Push(ledState)
      PlayIdleClip(ledState)
      PostLedReady(htmlTouch, "xt-led-ready", "led")
      FlushLedLog()
    end if

    TraceLog("MAIN|xt|post-idle")
    FlushLedLog()
    EnsureDeferredWorkers(ledStates, htmlTouch)
    TraceLog("MAIN|xt|workers-ready")
    FlushLedLog()
    ProcessOpsOnBoot(ledStates)
    TraceLog("MAIN|xt|ops-ready")
    FlushLedLog()
    ' Resume last known content immediately — do not wait for the JS bridge.
    FlushLedLog()
    MaybeResumePlaybackFromFile(ledStates, msgPort, "boot")
    Sleep(1500)
    MaybeResumePlaybackFromFile(ledStates, msgPort, "boot2")
    FlushLedLog()
  else if profile = "XC4055" and multiOutput then
    ' Same order as XT: HtmlWidget Show first, then one player per LED output.
    SafePrint("=== Perform6: XC React HDMI-1 + native video HDMI-2/3 ===")
    primaryRect = CreateObject("roRectangle", 0, 0, tileW, tileH)
    led2Rect = CreateObject("roRectangle", tileW, 0, tileW, tileH)
    led3Rect = CreateObject("roRectangle", tileW * 2, 0, tileW, tileH)
    if type(primaryRect) <> "roRectangle" or type(led2Rect) <> "roRectangle" or type(led3Rect) <> "roRectangle" then
      FatalHang("=== Perform6: FATAL no XC output rectangles ===")
    end if
    LedLog("OUT|RECT|HDMI-1|0,0," + IntToStr(tileW) + "x" + IntToStr(tileH))
    LedLog("OUT|RECT|HDMI-2|" + IntToStr(tileW) + ",0," + IntToStr(tileW) + "x" + IntToStr(tileH))
    LedLog("OUT|RECT|HDMI-3|" + IntToStr(tileW * 2) + ",0," + IntToStr(tileW) + "x" + IntToStr(tileH))

    primaryUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "primary")
    SafePrint("=== Perform6: HDMI-1 primary widget " + primaryUrl + " ===")
    htmlPrimary = TryCreateHtmlWidget(primaryRect, msgPort, primaryUrl)
    if type(htmlPrimary) <> "roHtmlWidget" then
      primaryFallbackTried = true
      primaryUrl = BuildAppUrl("file:///index.html", identity, profile, "primary")
      SafePrint("=== Perform6: retry HDMI-1 primary widget " + primaryUrl + " ===")
      htmlPrimary = TryCreateHtmlWidget(primaryRect, msgPort, primaryUrl)
    end if
    if type(htmlPrimary) <> "roHtmlWidget" then
      FatalHang("=== Perform6: FATAL HDMI-1 primary HtmlWidget create failed ===")
    end if

    EnableJsObjectsSafe(htmlPrimary)
    RoutePlayerAudio(htmlPrimary, "hdmi-1")
    SafePrint("=== Perform6: Show HDMI-1 primary HtmlWidget ===")
    htmlPrimary.Show()
    gPrimary = GetGlobalAA()
    gPrimary.htmlPrimary = htmlPrimary
    RememberAppUrl("primary", primaryUrl)
    ClearBootFailMarker()

    Sleep(500)
    LedLog("=== Perform6: HDMI-2 native roVideoPlayer (single, after HtmlWidget) ===")
    videoLed2 = TryCreateVideoPlayer(led2Rect, msgPort, 2, "hdmi-2")
    if type(videoLed2) <> "roVideoPlayer" then
      LedLog("=== Perform6: ERROR HDMI-2 roVideoPlayer create failed ===")
    else
      led2State = CreateLedState(videoLed2, "led2")
      ledStates.Push(led2State)
      PlayIdleClip(led2State)
      PostLedReady(htmlPrimary, "xc-led-ready", "led2")
    end if

    Sleep(500)
    LedLog("=== Perform6: HDMI-3 native roVideoPlayer (single, after HtmlWidget) ===")
    videoLed3 = TryCreateVideoPlayer(led3Rect, msgPort, 3, "hdmi-3")
    if type(videoLed3) <> "roVideoPlayer" then
      LedLog("=== Perform6: ERROR HDMI-3 roVideoPlayer create failed ===")
    else
      led3State = CreateLedState(videoLed3, "led3")
      ledStates.Push(led3State)
      PlayIdleClip(led3State)
      PostLedReady(htmlPrimary, "xc-led-ready", "led3")
    end if

    EnsureDeferredWorkers(ledStates, htmlPrimary)
    ProcessOpsOnBoot(ledStates)
    FlushLedLog()
    MaybeResumePlaybackFromFile(ledStates, msgPort, "boot")
    Sleep(1500)
    MaybeResumePlaybackFromFile(ledStates, msgPort, "boot2")
    FlushLedLog()
  else
    ' HD226 (and any non-multi profile): one HtmlWidget on the native canvas.
    SafePrint("=== Perform6: canvas " + StrI(width) + "x" + StrI(height) + " ===")
    rect = CreateObject("roRectangle", 0, 0, width, height)
    if type(rect) <> "roRectangle" then
      FatalHang("=== Perform6: FATAL no roRectangle ===")
    end if

    url = BuildAppUrl("file:///SD:/index.html", identity, profile, singleRole)
    SafePrint("=== Perform6: HtmlWidget url " + url + " ===")
    html = TryCreateHtmlWidget(rect, msgPort, url)
    if type(html) <> "roHtmlWidget" then
      url = BuildAppUrl("file:///index.html", identity, profile, singleRole)
      SafePrint("=== Perform6: retry HtmlWidget with " + url + " ===")
      html = TryCreateHtmlWidget(rect, msgPort, url)
    end if
    if type(html) <> "roHtmlWidget" then
      FatalHang("=== Perform6: FATAL HtmlWidget create failed on this firmware ===")
    end if

    EnableJsObjectsSafe(html)
    ' HD226 has one physical LED output; route its HTML media to that HDMI.
    RoutePlayerAudio(html, "hdmi")
    SafePrint("=== Perform6: Show HtmlWidget ===")
    html.Show()
    gSingle = GetGlobalAA()
    gSingle.html = html
    RememberAppUrl("single", url)
    ClearBootFailMarker()
    EnsureDeferredWorkers(ledStates, html)
    ProcessOpsOnBoot(ledStates)
  end if

  ' XT observes the SD mount directly. Keep its native loop independent of an
  ' outbound HtmlWidget message; retain the proven behavior for other profiles.
  if profile <> "XT2145" then
    PostStorageHotplug(ledStates, true, "SD:")
  else
    LedLog("=== Perform6: SD present (native bus; outbound boot post skipped) ===")
  end if

  ' DWS already enabled early (before SetScreenModes) for field recovery.

  InitBridgeWatch()
  LedLog("=== Perform6: bridge observe-only (no recycle/reboot on silence) ===")
  TraceLog("MAIN|loop-enter")
  WriteMainHeartbeat()

  pbFileTimer = CreateObject("roTimer")
  if type(pbFileTimer) = "roTimer" then
    pbFileTimer.SetPort(msgPort)
    pbFileTimer.SetElapsed(2, 0)
    pbFileTimer.Start()
    LedLog("=== Perform6: SD LED fallback poll 2s (bridge primary BA-style) ===")
  end if

  hbTimer = CreateObject("roTimer")
  if type(hbTimer) = "roTimer" then
    hbTimer.SetPort(msgPort)
    hbTimer.SetElapsed(15, 0)
    hbTimer.Start()
    TraceLog("MAIN|heartbeat-timer|15s")
  end if

  while true
    ev = wait(100, msgPort)
    MaybeFlushLedLog()
    ' SD file = fallback only; bridge xt/xc-playback is the normal LED zone path.
    if profile = "XT2145" or profile = "XC4055" then MaybePollLedPlaybackFile(ledStates, msgPort)
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
        MaybeProcessDeferredWipe()
        if type(hbTimer) = "roTimer" then
          hbTimer.SetElapsed(15, 0)
          hbTimer.Start()
        end if
      else if isPbTimer then
        MaybeProcessDeferredWipe()
        MaybeResumePlaybackFromFile(ledStates, msgPort, "poll")
        if type(pbFileTimer) = "roTimer" then
          pbFileTimer.SetElapsed(2, 0)
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
          if RollbackPendingOta("html-load-error") then
            RebootDeviceAfterOta()
          end if
          failedUrl = AsBrString(EventLookup(data, "url"))
          if Len(failedUrl) = 0 then failedUrl = AsBrString(data.url)
          gLoad = GetGlobalAA()
          if gLoad.bridgeEverSeen = true or htmlLoadFinished = true then
            LedLog("=== Perform6: load-error after HTML/bridge — reboot (no SetUrl) ===")
            FlushLedLog()
            if ShouldAutoRebootOnce("perform6-html-load-fail") then
              RebootDeviceAfterOta()
            end if
          else if profile = "XT2145" then
            if Instr(1, failedUrl, "bs_output=touch") > 0 and touchFallbackTried = false and type(htmlTouch) = "roHtmlWidget" then
              touchFallbackTried = true
              touchUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "touch")
              LedLog("=== Perform6: HDMI-1 pre-JS SetUrl fallback (no port yet) ===")
              htmlTouch.SetUrl(touchUrl)
            else if ShouldAutoRebootOnce("perform6-html-load-fail") then
              FlushLedLog()
              RebootDeviceAfterOta()
            end if
          else if profile = "XC4055" then
            if Instr(1, failedUrl, "bs_output=primary") > 0 and primaryFallbackTried = false and type(htmlPrimary) = "roHtmlWidget" then
              primaryFallbackTried = true
              primaryUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "primary")
              LedLog("=== Perform6: HDMI-1 pre-JS SetUrl fallback (no port yet) ===")
              htmlPrimary.SetUrl(primaryUrl)
            else if ShouldAutoRebootOnce("perform6-html-load-fail") then
              FlushLedLog()
              RebootDeviceAfterOta()
            end if
          else if ShouldAutoRebootOnce("perform6-html-load-fail") then
            FlushLedLog()
            RebootDeviceAfterOta()
          end if
        else if reason = "load-finished" then
          htmlLoadFinished = true
          DeleteFile("SD:/perform6-ota-pending.json")
          DeleteFile("SD:/perform6-html-load-fail")
          SafePrint("=== Perform6: HTML load-finished ===")
          LedLog("=== Perform6: HTML load-finished ===")
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
            else if msgType = "led-bridge-healthy" then
              HandleLedBridgeHealthy()
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
            else if msgType = "led-cache-keep" then
              HandleLedKeepSet(payload, ledStates)
            else if msgType = "led-cache-evict" then
              HandleLedCacheEvict(payload, ledStates)
            else if msgType = "led-cache-cancel" then
              HandleLedCacheCancel(payload, msgPort, ledStates)
            else if msgType = "led-cache-clear-all" then
              HandleLedCacheClearAll(ledStates)
            else if msgType = "led-log-tail-request" then
              HandleLedLogTailRequest(payload, ledStates)
            else if msgType = "led-fs-list" then
              HandleLedFsList(payload, ledStates)
            else if msgType = "led-fs-read" then
              HandleLedFsRead(payload, ledStates)
            else if msgType = "led-fs-write" then
              HandleLedFsWrite(payload, ledStates)
            else if msgType = "led-fs-delete" then
              HandleLedFsDelete(payload, ledStates)
            else if msgType = "led-storage-info" then
              HandleLedStorageInfo(ledStates)
            else if msgType = "led-ota-ping" then
              HandleLedOtaPing(ledStates)
            else if msgType = "led-ota-auth" then
              HandleLedOtaAuth(payload, ledStates)
            else if msgType = "led-ota-install" then
              HandleLedOtaInstall(payload, msgPort, ledStates)
            else if msgType = "led-ota-cancel" then
              HandleLedOtaCancel(ledStates)
            else if msgType = "led-ota-reboot" then
              RebootDeviceAfterOta()
            else if msgType = "led-ops-reload" then
              HandleLedOpsReload(payload, ledStates)
            else if msgType = "led-ops-write" then
              HandleLedOpsWrite(payload)
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
    else if type(ev) = "roStorageAttached" then
      HandleStorageHotplug(ev, ledStates, true)
    else if type(ev) = "roStorageDetached" then
      HandleStorageHotplug(ev, ledStates, false)
    else if type(ev) <> "Invalid" and type(ev) <> "roInvalid" then
      TraceLog("MAIN|other-event|" + type(ev))
    end if
  end while
End Sub
