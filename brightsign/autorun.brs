' Perform6 BrightSign autorun - thin boot + deferred SD workers
' BOOT ONLY: identity, DWS, SetScreenModes, HtmlWidget Show, native LED idle/playback, reboot.
' DEFERRED (after Show / when JS asks): cache prefetch (legacy fallback), OTA install, clearCache.
' MEDIA (preferred): JS @brightsign/assetpool → sd/perform6-media-pool; fallback SD:/perform6-cache.
' OTA (preferred): JS @brightsign/assetpool → SD:/perform6-ota-pool → copy to SD:/{path}; HTTP worker = fallback.
' Clear-cache wipes only perform6-cache + perform6-media-pool — NEVER perform6-ota-pool or package files.
' Policy (pair, heartbeat, sync, OTA trigger) lives in React + API — not in this file.
' Profiles: XT2145 / XC4055 = React on HDMI-1 + roVideoPlayer on LEDs; HD226 = one HtmlWidget.
' Reads perform6-display.txt: MULTI (default) | MULTI_NOFULLRES.
' SetScreenModes only when config differs. Do NOT call SetMode / trusted_iframes / roTouchScreen.Enable.
' Legacy media cache: SD:/perform6-cache (autorun prefetch fallback only).

Sub SafePrint(msg as String)
  print msg
End Sub

' Buffered SD log — avoid ReadAsciiFile+WriteAsciiFile on every line.
' Flush every 20 lines or ~5s from the main loop; always flush before log-tail.
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
    SafePrint("=== Perform6: HtmlWidget modern config OK (nodejs) ===")
    return html
  end if

  cfg2 = CreateObject("roAssociativeArray")
  cfg2.url = url
  cfg2.port = msgPort
  cfg2.brightsign_js_objects_enabled = true
  html = CreateObject("roHtmlWidget", rect, cfg2)
  if type(html) = "roHtmlWidget" then
    SafePrint("=== Perform6: HtmlWidget minimal config OK ===")
    return html
  end if

  cfg3 = CreateObject("roAssociativeArray")
  cfg3.url = url
  html = CreateObject("roHtmlWidget", rect, cfg3)
  if type(html) = "roHtmlWidget" then
    SafePrint("=== Perform6: HtmlWidget url-only config OK ===")
    return html
  end if

  html = CreateObject("roHtmlWidget", rect)
  if type(html) = "roHtmlWidget" then
    SafePrint("=== Perform6: HtmlWidget classic constructor OK ===")
    html.SetPort(msgPort)
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

Sub PostJsMessage(html as Object, msg as Object)
  if type(msg) <> "roAssociativeArray" then return
  PostJsToWidget(html, msg)
  g = GetGlobalAA()
  if type(g.p6Html) = "roHtmlWidget" then PostJsToWidget(g.p6Html, msg)
  if type(g.htmlTouch) = "roHtmlWidget" then PostJsToWidget(g.htmlTouch, msg)
  if type(g.htmlPrimary) = "roHtmlWidget" then PostJsToWidget(g.htmlPrimary, msg)
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

' HtmlWidget uses file:///SD:/... - roVideoPlayer wants SD:/...
Function NormalizeLocalSrc(src as String) as String
  if Left(src, 15) = "file:///SD:/" then
    return "SD:/" + Mid(src, 16)
  end if
  if Left(src, 14) = "file://SD:/" then
    return "SD:/" + Mid(src, 15)
  end if
  return src
End Function

Function IntToStr(value as Integer) as String
  s = StrI(value)
  while Len(s) > 0 and Left(s, 1) = " "
    s = Mid(s, 2)
  end while
  return s
End Function

Function SimpleHash(text as String) as String
  h = 5381
  for i = 1 to Len(text)
    h = (h * 33 + Asc(Mid(text, i, 1))) mod 10000000
  end for
  return IntToStr(h) + "-" + IntToStr(Len(text))
End Function

Function UrlExtension(url as String) as String
  base = url
  q = Instr(1, base, "?")
  if q > 0 then base = Left(base, q - 1)
  dot = 0
  for i = Len(base) to 1 step -1
    ch = Mid(base, i, 1)
    if ch = "." then
      dot = i
      exit for
    else if ch = "/" then
      exit for
    end if
  end for
  if dot > 0 then
    ext = LCase(Mid(base, dot))
    if Len(ext) >= 3 and Len(ext) <= 5 then return ext
  end if
  return ".mp4"
End Function

Function CacheDir() as String
  return "SD:/perform6-cache"
End Function

Function MediaPoolDir() as String
  return "SD:/perform6-media-pool"
End Function

Function OtaPoolDir() as String
  return "SD:/perform6-ota-pool"
End Function

' Only allow wipe of known media roots — never SD:/, OTA pool, or package files.
Function IsSafeMediaWipePath(path as String) as Boolean
  if path = CacheDir() then return true
  if path = MediaPoolDir() then return true
  ' Explicitly refuse OTA pool even if called by mistake.
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

' Nested wipe for BrightSign asset pools (hash subdirs). DeleteDirectory alone
' is recursive on modern BOS; DeleteTree covers older builds / partial fails.
Sub DeleteTree(path as String)
  if Len(path) < 8 then return
  if Instr(1, path, "..") > 0 then return
  if Left(path, 4) <> "SD:/" then return

  dir = path
  if Right(dir, 1) <> "/" then dir = dir + "/"

  names = MatchFiles(dir, "*")
  if type(names) = "roList" or type(names) = "roArray" then
    for each name in names
      if Len(name) > 0 and name <> "." and name <> ".." then
        full = dir + name
        if PathLooksLikeDirectory(full) then
          DeleteTree(full)
        else
          DeleteFile(full)
        end if
      end if
    end for
  end if

  DeleteDirectory(path)
End Sub

Sub WipeMediaDirectory(path as String)
  if not IsSafeMediaWipePath(path) then
    LedLog("=== Perform6: refuse wipe of unsafe path " + path + " ===")
    return
  end if

  ' Prefer OS recursive delete; always follow with DeleteTree for leftovers.
  DeleteDirectory(path)
  DeleteTree(path)
  CreateDirectory(path)
  LedLog("=== Perform6: wiped+recreated " + path + " ===")
End Sub

Function FileExistsIn(dir as String, name as String) as Boolean
  files = MatchFiles(dir, name)
  if type(files) = "roList" or type(files) = "roArray" then
    return files.Count() > 0
  end if
  return false
End Function

Function PartFileBytes(path as String) as Integer
  fs = CreateObject("roFileSystem")
  if type(fs) <> "roFileSystem" then return 0
  stat = fs.Stat(path)
  if type(stat) <> "roAssociativeArray" then return 0
  size = stat.size
  if type(size) = "roInteger" or type(size) = "Integer" then return size
  return 0
End Function

Function HexHashesMatch(a as String, b as String) as Boolean
  if Len(a) = 0 or Len(b) = 0 then return false
  return LCase(a) = LCase(b)
End Function

' Abort zombie transfers sooner so the prefetch/OTA queue cannot sit blocked.
' (Large VOD on gym Wi-Fi needs a longer average window than tiny assets.)
Sub ConfigureDownloadTransfer(xfer as Object, msgPort as Object, url as String, userKey as String)
  xfer.SetUrl(url)
  xfer.SetPort(msgPort)
  xfer.SetUserData(userKey)
  xfer.SetMinimumTransferRate(512, 300)
End Sub

' Docs-compliant downloads (do NOT mix resume_file with a hash-only pipe):
' - resumeBytes > 0 → response_body_resume_file only (Range in place)
' - fresh → response_pipe [hash SHA256, output_file] then fallbacks
Function StartResumableGet(xfer as Object, dest as String, resumeBytes as Integer) as Boolean
  params = CreateObject("roAssociativeArray")
  params.method = "GET"

  if resumeBytes > 0 then
    params.response_body_resume_file = dest
    if xfer.AsyncMethod(params) then return true
    LedLog("=== Perform6: resume AsyncMethod failed — " + xfer.GetFailureReason() + " ===")
    return false
  end if

  pipe = CreateObject("roArray", 2, true)
  hashFilter = CreateObject("roAssociativeArray")
  hashFilter.hash = "SHA256"
  pipe.Push(hashFilter)
  outFilter = CreateObject("roAssociativeArray")
  outFilter.output_file = dest
  pipe.Push(outFilter)
  params.response_pipe = pipe
  if xfer.AsyncMethod(params) then return true

  reason = xfer.GetFailureReason()
  if type(reason) <> "roString" and type(reason) <> "String" then reason = ""
  if Len(reason) > 0 then LedLog("=== Perform6: hash pipe failed — " + reason + " ===")

  params.Delete("response_pipe")
  params.response_body_file = dest
  if xfer.AsyncMethod(params) then return true
  return xfer.AsyncGetToFile(dest)
End Function

Function EventSha256(ev as Object) as String
  hex = ev.GetHash()
  if type(hex) = "roString" or type(hex) = "String" then return hex
  return ""
End Function

' Range ignored + append → file larger than expected (classic corrupt partial).
Function IsRangeIgnoredCorruption(resumed as Boolean, code as Integer, actual as Integer, expected as Integer) as Boolean
  if resumed <> true then return false
  if expected <= 0 then return false
  if actual > expected then return true
  return false
End Function

Function UrlRetryCount(worker as Object, url as String) as Integer
  if type(worker) <> "roAssociativeArray" then return 0
  if type(worker.retryCounts) <> "roAssociativeArray" then return 0
  n = worker.retryCounts.Lookup(url)
  if type(n) = "roInteger" or type(n) = "Integer" then return n
  return 0
End Function

Sub SetUrlRetryCount(worker as Object, url as String, count as Integer)
  if type(worker) <> "roAssociativeArray" then return
  if type(worker.retryCounts) <> "roAssociativeArray" then
    worker.retryCounts = CreateObject("roAssociativeArray")
  end if
  worker.retryCounts.AddReplace(url, count)
End Sub

Sub ClearUrlRetryCount(worker as Object, url as String)
  if type(worker) <> "roAssociativeArray" then return
  if type(worker.retryCounts) <> "roAssociativeArray" then return
  worker.retryCounts.Delete(url)
End Sub

Function SdFreeBytes() as Integer
  si = CreateObject("roStorageInfo", "SD:/")
  if type(si) <> "roStorageInfo" then return -1
  freeMb = si.GetFreeInMegabytes()
  if type(freeMb) <> "roInteger" and type(freeMb) <> "Integer" then return -1
  return freeMb * 1048576
End Function

Function HasSdSpaceForBytes(needed as Integer) as Boolean
  margin = 10485760
  if needed < 0 then needed = 0
  required = needed + margin
  freeBytes = SdFreeBytes()
  if freeBytes < 0 then return needed <= 0
  return freeBytes >= required
End Function

Function HttpFailureIsRetryable(code as Integer) as Boolean
  if code = 416 then return false
  if code = 408 then return true
  if code = 429 then return true
  if code >= 500 and code <= 599 then return true
  if code < 0 then return true
  if code >= 400 and code <= 499 then return false
  return true
End Function

Function CacheHttpErrorText(code as Integer, reason as String) as String
  if code = 404 then return "HTTP 404 not found"
  if code = 403 then return "HTTP 403 forbidden"
  if code = 410 then return "HTTP 410 gone"
  if code = 401 then return "HTTP 401 unauthorized"
  if code < 0 then
    if Len(reason) > 0 then return "network error: " + reason
    return "network error"
  end if
  if Len(reason) > 0 then return "HTTP " + IntToStr(code) + ": " + reason
  return "HTTP " + IntToStr(code)
End Function

Sub FinishCacheFailure(st as Object, worker as Object, url as String, name as String, mediaId as String, tmp as String, errorText as String, retryable as Boolean, msgPort as Object, states as Object)
  st.xfer = invalid
  st.xferUrl = ""
  partialBytes = PartFileBytes(tmp)
  expected = LookupUrlExpectedSize(worker, url)
  if retryable then
    retries = UrlRetryCount(worker, url) + 1
    if type(worker) = "roAssociativeArray" and retries <= 3 then
      SetUrlRetryCount(worker, url, retries)
      LedLog("=== Perform6: cache retry " + IntToStr(retries) + " for " + url + " (" + errorText + ") ===")
      QueueInsertFront(worker.queue, url)
      ' Do not Sleep here - blocking the message port freezes playback / UI events.
      st.xferName = ""
      DrainPrefetchQueue(msgPort, states)
      return
    end if
  end if
  DeleteFile(tmp)
  st.xferName = ""
  if type(worker) = "roAssociativeArray" then
    ClearUrlRetryCount(worker, url)
    worker.prefetchDone = worker.prefetchDone + 1
  end if
  PostCacheProgress(states, "failed", url, name, mediaId, errorText, CacheDir() + "/" + name, partialBytes, expected)
  DrainPrefetchQueue(msgPort, states)
End Sub

Function CacheNameFor(url as String) as String
  return SimpleHash(url) + UrlExtension(url)
End Function

Function CachedPathFor(url as String) as String
  name = CacheNameFor(url)
  if FileExistsIn(CacheDir(), name) then
    return CacheDir() + "/" + name
  end if
  return ""
End Function

Function LookupUrlExpectedSize(worker as Object, url as String) as Integer
  if type(worker) <> "roAssociativeArray" then return 0
  if type(worker.urlSizes) <> "roAssociativeArray" then return 0
  n = worker.urlSizes.Lookup(url)
  if type(n) = "roInteger" or type(n) = "Integer" then return n
  if type(n) = "roString" or type(n) = "String" then
    if Len(n) > 0 then return Int(Val(n))
  end if
  return 0
End Function

Function IsCacheFileValid(url as String, worker as Object) as Boolean
  path = CachedPathFor(url)
  if Len(path) = 0 then return false
  actual = PartFileBytes(path)
  ' Empty or stub files must never count as cached.
  if actual < 1024 then
    LedLog("=== Perform6: cache too small " + IntToStr(actual) + " " + url + " ===")
    return false
  end if
  expected = LookupUrlExpectedSize(worker, url)
  if expected <= 0 then return true
  if actual = expected then return true
  LedLog("=== Perform6: cache size mismatch " + IntToStr(actual) + "/" + IntToStr(expected) + " " + url + " ===")
  return false
End Function

Sub InvalidateCacheForUrl(url as String)
  name = CacheNameFor(url)
  path = CacheDir() + "/" + name
  DeleteFile(path)
  DeleteFile(path + ".part")
  LedLog("=== Perform6: invalidate cache " + name + " ===")
End Sub

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

Function PlayLocalFile(vp as Object, path as String) as Boolean
  ok = false
  ok = vp.PlayFile(path)
  if ok <> true then
    aa = CreateObject("roAssociativeArray")
    aa.Filename = path
    ok = vp.PlayFile(aa)
  end if
  return (ok = true)
End Function

Function PlayNetworkStream(st as Object, url as String) as Boolean
  stream = CreateObject("roRtspStream", url)
  if type(stream) <> "roRtspStream" then
    LedLog("=== Perform6: roRtspStream unavailable ===")
    return false
  end if
  ' Keep the stream object alive for as long as it plays.
  st.stream = stream
  aa = CreateObject("roAssociativeArray")
  aa.rtsp = stream
  ok = st.vp.PlayFile(aa)
  return (ok = true)
End Function

Function FindPrefetchWorker(states as Object) as Object
  for each st in states
    if type(st) = "roAssociativeArray" then
      if st.key = "prefetch" then return st
    end if
  end for
  return invalid
End Function

Function FindKeepNames(states as Object) as Object
  worker = FindPrefetchWorker(states)
  if type(worker) = "roAssociativeArray" then
    if type(worker.keepNames) = "roAssociativeArray" then return worker.keepNames
  end if
  return invalid
End Function

Function CreatePrefetchWorker() as Object
  st = CreateObject("roAssociativeArray")
  st.vp = invalid
  st.key = "prefetch"
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
  st.xferResumed = false
  st.queue = CreateObject("roArray", 0, true)
  st.keepNames = CreateObject("roAssociativeArray")
  st.urlIds = CreateObject("roAssociativeArray")
  st.urlSizes = CreateObject("roAssociativeArray")
  st.notifyHtml = invalid
  st.prefetchTotal = 0
  st.prefetchDone = 0
  st.retryCounts = CreateObject("roAssociativeArray")
  return st
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
  pref = FindPrefetchWorker(states)
  if type(pref) = "roAssociativeArray" then
    if type(pref.notifyHtml) = "roHtmlWidget" then return pref.notifyHtml
  end if
  return invalid
End Function

Sub EnsureOtaWorker(states as Object)
  if type(FindOtaWorker(states)) = "roAssociativeArray" then return
  states.Push(CreateOtaWorker())
End Sub

Sub EnsureDeferredWorkers(states as Object, html as Object)
  RememberP6Html(html)
  ' AssetPool + autorun cache both need these folders on SD before first fetch.
  CreateDirectory(CacheDir())
  CreateDirectory(MediaPoolDir())
  LedLog("=== Perform6: media dirs ready " + CacheDir() + " + " + MediaPoolDir() + " ===")
  if type(FindPrefetchWorker(states)) <> "roAssociativeArray" then
    states.Push(CreatePrefetchWorker())
  end if
  EnsureOtaWorker(states)
  SetCacheNotifyHtml(states, html)
  SetOtaNotifyHtml(states, html)
End Sub

Sub SetCacheNotifyHtml(states as Object, html as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  worker.notifyHtml = html
End Sub

Function LookupUrlMediaId(worker as Object, url as String) as String
  if type(worker) <> "roAssociativeArray" then return ""
  if type(worker.urlIds) <> "roAssociativeArray" then return ""
  id = worker.urlIds.Lookup(url)
  if type(id) = "roString" or type(id) = "String" then return id
  return ""
End Function

Sub RecalcPrefetchTotals(worker as Object)
  if type(worker) <> "roAssociativeArray" then return
  active = 0
  if type(worker.xfer) = "roUrlTransfer" then active = 1
  queued = 0
  if type(worker.queue) = "roArray" then queued = worker.queue.Count()
  done = worker.prefetchDone
  if type(done) <> "roInteger" and type(done) <> "Integer" then done = 0
  worker.prefetchTotal = done + queued + active
End Sub

Sub ScheduleDeferredCacheComplete(states as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  worker.deferCompleteAtMs = ProgressNowMs() + 75
End Sub

Sub FlushDeferredCacheComplete(states as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  atMs = worker.deferCompleteAtMs
  if type(atMs) <> "roInteger" and type(atMs) <> "Integer" then return
  if ProgressNowMs() < atMs then return
  worker.deferCompleteAtMs = invalid
  if type(worker.xfer) = "roUrlTransfer" then return
  if type(worker.queue) = "roArray" and worker.queue.Count() > 0 then return
  RecalcPrefetchTotals(worker)
  PostCacheProgress(states, "complete", "", "", "", "", "", worker.prefetchDone, worker.prefetchTotal)
  LedLog("=== Perform6: prefetch queue empty (complete posted) ===")
End Sub

Sub PostCacheProgress(states as Object, status as String, url as String, name as String, mediaVersionId as String, errorText as String, destPath as String, bytesDownloaded as Integer, bytesTotal as Integer)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  RecalcPrefetchTotals(worker)
  html = worker.notifyHtml
  if type(html) <> "roHtmlWidget" then html = ResolveP6Html(states, worker)
  if type(html) <> "roHtmlWidget" then
    LedLog("=== Perform6: cache progress dropped (no html) status=" + status + " ===")
    return
  end if
  worker.notifyHtml = html

  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-cache-progress")
  msg.status = status
  msg.url = url
  msg.name = name
  msg.mediaVersionId = mediaVersionId
  msg.error = errorText
  msg.destPath = destPath
  msg.bytesDownloaded = IntToStr(bytesDownloaded)
  msg.bytesTotal = IntToStr(bytesTotal)
  msg.doneCount = worker.prefetchDone
  msg.totalCount = worker.prefetchTotal
  PostJsMessage(html, msg)
End Sub

' One clock for the whole autorun - a fresh roTimespan is always ~0ms and
' breaks progress throttling + deferred cache-complete.
Function ProgressNowMs() as Integer
  g = GetGlobalAA()
  if type(g.progressClock) <> "roTimespan" then
    g.progressClock = CreateObject("roTimespan")
  end if
  return g.progressClock.TotalMilliseconds()
End Function

Sub MaybePostCacheProgress(states as Object, status as String, url as String, name as String, mediaVersionId as String, destPath as String, bytesDownloaded as Integer, bytesTotal as Integer)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then
    PostCacheProgress(states, status, url, name, mediaVersionId, "", destPath, bytesDownloaded, bytesTotal)
    return
  end if
  if status = "progress" then
    lastMs = worker.progressPostMs
    if type(lastMs) = "roInteger" or type(lastMs) = "Integer" then
      if ProgressNowMs() - lastMs < 500 then return
    end if
    worker.progressPostMs = ProgressNowMs()
  end if
  PostCacheProgress(states, status, url, name, mediaVersionId, "", destPath, bytesDownloaded, bytesTotal)
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

Sub HandleLedLogTailRequest(payload as Object, states as Object)
  FlushLedLog()
  html = ResolveBridgeHtml(states)
  tail = ReadLogTail("SD:/perform6-led.log", 48000)
  PostLedLogTail(html, PayloadString(payload, "requestId"), tail)
End Sub

' --- Mini-DWS: thin SD list/read/write/delete (message handlers only; never on boot) ---

Function NormalizeSdPath(raw as String) as String
  path = raw
  if type(path) <> "roString" and type(path) <> "String" then path = ""
  while Len(path) > 0 and Left(path, 1) = " "
    path = Mid(path, 2)
  end while
  if Len(path) = 0 then return "SD:/"
  if Instr(1, path, "..") > 0 then return ""
  upper = UCase(path)
  if Left(upper, 3) <> "SD:" then
    if Left(path, 1) = "/" then return "SD:" + path
    return "SD:/" + path
  end if
  if Len(path) = 3 then return "SD:/"
  if Mid(path, 4, 1) <> "/" then return "SD:/" + Mid(path, 4)
  return path
End Function

Sub PostLedFsResult(states as Object, requestId as String, action as String, ok as Boolean, path as String, entriesText as String, content as String, errorText as String)
  html = ResolveBridgeHtml(states)
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-fs-result")
  msg.requestId = requestId
  msg.action = action
  if ok then msg.ok = "1" else msg.ok = "0"
  msg.path = path
  msg.entries = entriesText
  msg.content = content
  msg.encoding = "utf8"
  msg.error = errorText
  msg.sizeBytes = Len(content)
  PostJsMessage(html, msg)
End Sub

' SD capacity for Admin heartbeat (free / size / used in megabytes).
Sub HandleLedStorageInfo(states as Object)
  html = ResolveBridgeHtml(states)

  freeMb = 0
  sizeMb = 0
  si = CreateObject("roStorageInfo", "SD:/")
  if type(si) = "roStorageInfo" then
    freeVal = si.GetFreeInMegabytes()
    if type(freeVal) = "roInteger" or type(freeVal) = "Integer" then freeMb = freeVal
    ' GetSizeInMegabytes exists on modern BOS; ignore if missing.
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

' BrightSign docs: ListDir(path) returns directory entries (files + folders).
' MatchFiles is a fallback for older behavior / pattern filters.
Function ListSdDirectoryNames(dir as String) as Object
  names = ListDir(dir)
  if type(names) = "roList" or type(names) = "roArray" then
    if names.Count() > 0 then return names
  end if
  ' Some firmwares prefer no trailing slash.
  trimmed = dir
  if Right(trimmed, 1) = "/" and Len(trimmed) > 4 then
    trimmed = Left(trimmed, Len(trimmed) - 1)
    names = ListDir(trimmed)
    if type(names) = "roList" or type(names) = "roArray" then
      if names.Count() > 0 then return names
    end if
  end if
  matched = MatchFiles(dir, "*")
  if type(matched) = "roList" or type(matched) = "roArray" then return matched
  return CreateObject("roArray", 0, true)
End Function

Function SdPathIsDirectory(path as String) as Boolean
  listing = ListDir(path)
  if type(listing) = "roList" or type(listing) = "roArray" then return true
  if Right(path, 1) <> "/" then
    listing = ListDir(path + "/")
    if type(listing) = "roList" or type(listing) = "roArray" then return true
  end if
  return false
End Function

Sub HandleLedFsList(payload as Object, states as Object)
  requestId = PayloadString(payload, "requestId")
  path = NormalizeSdPath(PayloadString(payload, "path"))
  if Len(path) = 0 then
    PostLedFsResult(states, requestId, "SD_LIST", false, "", "", "", "invalid path")
    return
  end if
  dir = path
  if Right(dir, 1) <> "/" then dir = dir + "/"
  files = ListSdDirectoryNames(dir)
  entriesText = ""
  count = 0
  if type(files) = "roList" or type(files) = "roArray" then
    for each name in files
      if count >= 200 then exit for
      if Len(name) > 0 and Left(name, 1) <> "." then
        full = dir + name
        kind = "file"
        if SdPathIsDirectory(full) then kind = "dir"
        size = 0
        if kind = "file" then size = PartFileBytes(full)
        line = name + "|" + IntToStr(size) + "|" + kind
        if Len(entriesText) > 0 then entriesText = entriesText + Chr(10)
        entriesText = entriesText + line
        count = count + 1
      end if
    end for
  end if
  LedLog("=== Perform6: FS list " + path + " n=" + IntToStr(count) + " ===")
  PostLedFsResult(states, requestId, "SD_LIST", true, path, entriesText, "", "")
End Sub

Sub HandleLedFsRead(payload as Object, states as Object)
  requestId = PayloadString(payload, "requestId")
  path = NormalizeSdPath(PayloadString(payload, "path"))
  if Len(path) = 0 or path = "SD:/" then
    PostLedFsResult(states, requestId, "SD_READ", false, path, "", "", "invalid path")
    return
  end if
  text = ReadAsciiFile(path)
  if type(text) <> "roString" and type(text) <> "String" then text = ""
  if Len(text) = 0 and PartFileBytes(path) <= 0 then
    PostLedFsResult(states, requestId, "SD_READ", false, path, "", "", "not found or empty")
    return
  end if
  if Len(text) > 32000 then text = Left(text, 32000)
  PostLedFsResult(states, requestId, "SD_READ", true, path, "", text, "")
End Sub

Sub HandleLedFsWrite(payload as Object, states as Object)
  requestId = PayloadString(payload, "requestId")
  path = NormalizeSdPath(PayloadString(payload, "path"))
  content = PayloadString(payload, "content")
  if Len(path) = 0 or path = "SD:/" or path = "SD:" then
    PostLedFsResult(states, requestId, "SD_WRITE", false, path, "", "", "invalid path")
    return
  end if
  if Len(content) = 0 then
    PostLedFsResult(states, requestId, "SD_WRITE", false, path, "", "", "empty content")
    return
  end if
  if Len(content) > 32000 then
    PostLedFsResult(states, requestId, "SD_WRITE", false, path, "", "", "too large (max 32KB) — use OTA for big files")
    return
  end if
  WriteAsciiFile(path, content)
  LedLog("=== Perform6: FS write " + path + " ===")
  PostLedFsResult(states, requestId, "SD_WRITE", true, path, "", "", "")
End Sub

Sub HandleLedFsDelete(payload as Object, states as Object)
  requestId = PayloadString(payload, "requestId")
  path = NormalizeSdPath(PayloadString(payload, "path"))
  if Len(path) = 0 or path = "SD:/" or path = "SD:" then
    PostLedFsResult(states, requestId, "SD_DELETE", false, path, "", "", "invalid path")
    return
  end if
  DeleteFile(path)
  DeleteFile(path + ".part")
  LedLog("=== Perform6: FS delete " + path + " ===")
  PostLedFsResult(states, requestId, "SD_DELETE", true, path, "", "", "")
End Sub

Function CreateOtaWorker() as Object
  st = CreateObject("roAssociativeArray")
  st.key = "ota"
  st.xfer = invalid
  st.xferUrl = ""
  st.xferTmp = ""
  st.xferDest = ""
  st.xferPath = ""
  st.xferExpected = 0
  st.xferHash = ""
  st.xferResumed = false
  st.authBearer = ""
  st.deviceId = ""
  st.queue = CreateObject("roArray", 0, true)
  st.otaTotal = 0
  st.otaDone = 0
  st.progressPostMs = 0
  st.notifyHtml = invalid
  return st
End Function

Function FindOtaWorker(states as Object) as Object
  for each st in states
    if type(st) = "roAssociativeArray" then
      if st.key = "ota" then return st
    end if
  end for
  return invalid
End Function

Sub SetOtaNotifyHtml(states as Object, html as Object)
  worker = FindOtaWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  worker.notifyHtml = html
End Sub

Sub PostOtaProgressBytes(states as Object, status as String, path as String, detail as String, bytesDownloaded as Integer, bytesTotal as Integer)
  EnsureOtaWorker(states)
  worker = FindOtaWorker(states)
  if type(worker) <> "roAssociativeArray" then
    LedLog("=== Perform6: OTA progress dropped (no worker) " + status + " ===")
    return
  end if

  fileNum = worker.otaDone + 1
  if status = "done" or status = "failed" then fileNum = worker.otaDone

  logMsg = "OTA " + status + " [" + IntToStr(worker.otaDone) + "/" + IntToStr(worker.otaTotal) + "]"
  if fileNum > 0 and worker.otaTotal > 0 then logMsg = logMsg + " #" + IntToStr(fileNum)
  if Len(path) > 0 then logMsg = logMsg + " path=" + path
  if bytesDownloaded >= 0 and bytesTotal > 0 then
    logMsg = logMsg + " bytes=" + IntToStr(bytesDownloaded) + "/" + IntToStr(bytesTotal)
  else if bytesTotal > 0 then
    logMsg = logMsg + " size=" + IntToStr(bytesTotal)
  end if
  if Len(detail) > 0 then logMsg = logMsg + " " + detail
  ' Byte progress is high-frequency — console only; SD log on milestones.
  if status = "progress" then
    SafePrint("=== Perform6: " + logMsg + " ===")
  else
    LedLog("=== Perform6: " + logMsg + " ===")
  end if

  html = ResolveP6Html(states, worker)
  if type(html) <> "roHtmlWidget" then
    if status <> "progress" then
      LedLog("=== Perform6: OTA JS notify skipped (no HtmlWidget) ===")
    end if
    return
  end if
  worker.notifyHtml = html

  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-ota-progress")
  msg.status = status
  msg.path = path
  msg.error = detail
  msg.doneCount = IntToStr(worker.otaDone)
  msg.totalCount = IntToStr(worker.otaTotal)
  msg.fileIndex = IntToStr(fileNum)
  if bytesDownloaded >= 0 then msg.bytesDownloaded = IntToStr(bytesDownloaded)
  if bytesTotal > 0 then msg.bytesTotal = IntToStr(bytesTotal)
  PostJsMessage(html, msg)
End Sub

Sub PostOtaProgress(states as Object, status as String, path as String, detail as String)
  PostOtaProgressBytes(states, status, path, detail, -1, -1)
End Sub

Sub MaybePostOtaProgress(states as Object, path as String, bytesDownloaded as Integer, bytesTotal as Integer)
  worker = FindOtaWorker(states)
  if type(worker) <> "roAssociativeArray" then
    PostOtaProgressBytes(states, "progress", path, "", bytesDownloaded, bytesTotal)
    return
  end if
  lastMs = worker.progressPostMs
  if type(lastMs) = "roInteger" or type(lastMs) = "Integer" then
    if ProgressNowMs() - lastMs < 1000 then return
  end if
  worker.progressPostMs = ProgressNowMs()
  PostOtaProgressBytes(states, "progress", path, "", bytesDownloaded, bytesTotal)
End Sub

Sub EnsureDirTree(dirPath as String)
  if Len(dirPath) <= 4 then return
  lastSlash = 0
  i = 1
  while i <= Len(dirPath)
    if Mid(dirPath, i, 1) = "/" then lastSlash = i
    i = i + 1
  end while
  if lastSlash > 4 then
    EnsureDirTree(Left(dirPath, lastSlash - 1))
  end if
  CreateDirectory(dirPath)
End Sub

Sub EnsureParentDir(filePath as String)
  lastSlash = 0
  i = 1
  while i <= Len(filePath)
    if Mid(filePath, i, 1) = "/" then lastSlash = i
    i = i + 1
  end while
  if lastSlash > 1 then
    parent = Left(filePath, lastSlash - 1)
    if Len(parent) > 0 then EnsureDirTree(parent)
  end if
End Sub

Function OtaDestForPath(relPath as String) as String
  cleaned = relPath
  while Left(cleaned, 1) = "/" or Left(cleaned, 1) = "\\"
    cleaned = Right(cleaned, Len(cleaned) - 1)
  end while
  if Instr(1, cleaned, "..") > 0 then return ""
  if Len(cleaned) = 0 then return ""
  return "SD:/" + cleaned
End Function

Sub CancelOtaTransfer(worker as Object)
  if type(worker) <> "roAssociativeArray" then return
  if type(worker.xfer) = "roUrlTransfer" then
    worker.xfer.AsyncCancel()
    worker.xfer = invalid
  end if
  worker.xferUrl = ""
  worker.xferTmp = ""
  worker.xferDest = ""
  worker.xferPath = ""
  worker.xferExpected = 0
End Sub

Sub HandleLedOtaCancel(states as Object)
  worker = FindOtaWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  CancelOtaTransfer(worker)
  if type(worker.queue) = "roArray" then
    worker.queue = CreateObject("roArray", 0, true)
  end if
  worker.otaDone = 0
  worker.otaTotal = 0
  LedLog("=== Perform6: OTA cancelled by JS ===")
  PostOtaProgress(states, "failed", "", "cancelled")
  PostOtaProgress(states, "complete", "", "")
End Sub

Sub StartOtaDownload(worker as Object, item as Object, msgPort as Object, states as Object)
  if type(worker) <> "roAssociativeArray" then return
  if type(worker.xfer) = "roUrlTransfer" then return
  if type(item) <> "roAssociativeArray" then return

  url = item.url
  relPath = item.path
  expected = item.size
  dest = OtaDestForPath(relPath)
  if Len(dest) = 0 then
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, "invalid path")
    DrainOtaQueue(msgPort, states)
    return
  end if

  tmp = dest + ".part"
  EnsureParentDir(dest)
  already = PartFileBytes(tmp)
  if expected > 0 and PartFileBytes(dest) = expected then
    worker.otaDone = worker.otaDone + 1
    LedLog("=== Perform6: OTA already on SD " + dest + " ===")
    DeleteFile(tmp)
    PostOtaProgressBytes(states, "done", relPath, "already-present", expected, expected)
    DrainOtaQueue(msgPort, states)
    return
  end if
  if expected > 0 and already > expected then
    LedLog("=== Perform6: OTA partial oversized — deleting " + tmp + " ===")
    DeleteFile(tmp)
    already = 0
  end if
  bytesNeeded = expected - already
  if bytesNeeded < 0 then bytesNeeded = 0
  if not HasSdSpaceForBytes(bytesNeeded) then
    LedLog("=== Perform6: OTA skipped - SD card full for " + relPath + " ===")
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, "SD card full")
    DrainOtaQueue(msgPort, states)
    return
  end if

  xfer = CreateObject("roUrlTransfer")
  if type(xfer) <> "roUrlTransfer" then
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, "roUrlTransfer unavailable")
    DrainOtaQueue(msgPort, states)
    return
  end if

  ConfigureDownloadTransfer(xfer, msgPort, url, "ota")
  if Len(worker.authBearer) > 0 then
    xfer.AddHeader("Authorization", "Bearer " + worker.authBearer)
    if Len(worker.deviceId) > 0 then xfer.AddHeader("X-Device-Id", worker.deviceId)
  end if

  if StartResumableGet(xfer, tmp, already) then
    worker.xfer = xfer
    worker.xferUrl = url
    worker.xferTmp = tmp
    worker.xferDest = dest
    worker.xferPath = relPath
    worker.xferExpected = expected
    worker.xferHash = ""
    if type(item.sha256) = "roString" or type(item.sha256) = "String" then worker.xferHash = item.sha256
    worker.xferResumed = (already > 0)
    PostOtaProgressBytes(states, "start", relPath, "dest=" + dest + " resume=" + IntToStr(already), already, expected)
  else
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, "download start failed")
    DrainOtaQueue(msgPort, states)
  end if
End Sub

Sub DrainOtaQueue(msgPort as Object, states as Object)
  worker = FindOtaWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  if type(worker.xfer) = "roUrlTransfer" then return
  if type(worker.queue) <> "roArray" then return

  while worker.queue.Count() > 0
    item = worker.queue[0]
    worker.queue.Delete(0)
    StartOtaDownload(worker, item, msgPort, states)
    return
  end while

  PostOtaProgress(states, "complete", "", "")
  LedLog("=== Perform6: OTA install complete ===")
End Sub

Sub HandleLedOtaAuth(payload as Object, states as Object)
  EnsureOtaWorker(states)
  worker = FindOtaWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  worker.authBearer = PayloadString(payload, "authBearer")
  worker.deviceId = PayloadString(payload, "deviceId")
  LedLog("=== Perform6: OTA auth received ===")
  PostOtaProgress(states, "start", "", "auth-ok")
End Sub

Sub HandleLedOtaPing(states as Object)
  EnsureOtaWorker(states)
  PostOtaProgress(states, "start", "", "pong")
End Sub

Sub HandleLedOtaInstall(payload as Object, msgPort as Object, states as Object)
  ' Never silent-return — JS 90s watchdog depends on an immediate start ack.
  EnsureOtaWorker(states)
  worker = FindOtaWorker(states)
  html = ResolveP6Html(states, worker)
  if type(worker) = "roAssociativeArray" and type(html) = "roHtmlWidget" then
    worker.notifyHtml = html
  end if
  PostOtaProgressBytes(states, "start", "", "ack", 0, 0)

  if type(worker) <> "roAssociativeArray" then
    LedLog("=== Perform6: OTA FATAL no worker after ensure ===")
    PostOtaProgress(states, "failed", "", "no ota worker")
    PostOtaProgress(states, "complete", "", "")
    return
  end if

  if type(worker.xfer) = "roUrlTransfer" then
    LedLog("=== Perform6: OTA cancel prior transfer (new install) ===")
    CancelOtaTransfer(worker)
  end if

  ' Prefer singular keys (small BSMessagePort payloads); fall back to pipe lists.
  singleUrl = PayloadString(payload, "fileUrl")
  singlePath = PayloadString(payload, "filePath")
  singleSize = PayloadString(payload, "fileSize")
  if Len(singleUrl) > 0 then
    urls = CreateObject("roArray", 1, true)
    paths = CreateObject("roArray", 1, true)
    sizes = CreateObject("roArray", 1, true)
    urls.Push(singleUrl)
    paths.Push(singlePath)
    sizes.Push(singleSize)
  else
    urls = SplitPipeUrls(PayloadString(payload, "fileUrls"))
    paths = SplitPipeUrls(PayloadString(payload, "filePaths"))
    sizes = SplitPipeUrls(PayloadString(payload, "fileSizes"))
  end if

  auth = PayloadString(payload, "authBearer")
  if Len(auth) > 0 then worker.authBearer = auth
  did = PayloadString(payload, "deviceId")
  if Len(did) > 0 then worker.deviceId = did
  otaVersion = PayloadString(payload, "version")
  worker.queue = CreateObject("roArray", 0, true)
  worker.otaDone = 0
  worker.otaTotal = urls.Count()
  if worker.otaTotal = 0 then
    LedLog("=== Perform6: OTA empty manifest (no fileUrls) ===")
    PostOtaProgress(states, "failed", "", "empty manifest")
    PostOtaProgress(states, "complete", "", "")
    return
  end if

  i = 0
  while i < urls.Count()
    item = CreateObject("roAssociativeArray")
    item.url = urls[i]
    if i < paths.Count() then
      item.path = paths[i]
    else
      item.path = ""
    end if
    item.size = 0
    if i < sizes.Count() then item.size = Val(sizes[i])
    item.sha256 = PayloadString(payload, "fileSha256")
    worker.queue.Push(item)
    i = i + 1
  end while

  LedLog("=== Perform6: OTA queue v" + otaVersion + " total=" + IntToStr(worker.otaTotal) + " files ===")
  PostOtaProgressBytes(states, "start", PayloadString(payload, "filePath"), "queued v" + otaVersion, 0, 0)
  DrainOtaQueue(msgPort, states)
End Sub

Sub HandleOtaEvent(worker as Object, ev as Object, msgPort as Object, states as Object)
  eventType = ev.GetInt()
  if eventType = 2 then return

  tmp = worker.xferTmp
  dest = worker.xferDest
  relPath = worker.xferPath
  expected = worker.xferExpected
  expectedHash = ""
  if type(worker.xferHash) = "roString" or type(worker.xferHash) = "String" then expectedHash = worker.xferHash

  if eventType <> 1 then
    reason = ev.GetFailureReason()
    if type(reason) <> "roString" and type(reason) <> "String" then reason = ""
    code = ev.GetResponseCode()
    errorText = CacheHttpErrorText(code, reason)
    LedLog("=== Perform6: OTA transfer failed " + errorText + " " + relPath + " ===")
    worker.xfer = invalid
    worker.xferUrl = ""
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, errorText)
    DrainOtaQueue(msgPort, states)
    return
  end if

  code = ev.GetResponseCode()
  worker.xfer = invalid
  worker.xferUrl = ""
  actual = PartFileBytes(tmp)

  if code = 416 and expected > 0 and actual = expected then
    code = 200
  end if

  resumed = false
  if worker.xferResumed = true then resumed = true
  worker.xferResumed = false

  if IsRangeIgnoredCorruption(resumed, code, actual, expected) then
    LedLog("=== Perform6: OTA Range ignored (file oversized) — delete " + relPath + " ===")
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, "range ignored — redeploy API Range support")
    DeleteFile(tmp)
    DrainOtaQueue(msgPort, states)
    return
  end if

  if code < 200 or code > 299 then
    reason = ev.GetFailureReason()
    if type(reason) <> "roString" and type(reason) <> "String" then reason = ""
    errorText = CacheHttpErrorText(code, reason)
    LedLog("=== Perform6: OTA HTTP failed " + errorText + " " + relPath + " ===")
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, errorText)
    if code = 416 then DeleteFile(tmp)
    DrainOtaQueue(msgPort, states)
    return
  end if

  if expected > 1023 and actual < 1024 then
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, "file too small")
    DeleteFile(tmp)
    DrainOtaQueue(msgPort, states)
    return
  end if
  if expected > 0 and actual <> expected then
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, "size mismatch")
    DeleteFile(tmp)
    DrainOtaQueue(msgPort, states)
    return
  end if

  gotHash = EventSha256(ev)
  if resumed = true then
    LedLog("=== Perform6: OTA resumed — size check only " + relPath + " ===")
  else if Len(expectedHash) > 0 and Len(gotHash) > 0 then
    if not HexHashesMatch(expectedHash, gotHash) then
      LedLog("=== Perform6: OTA hash mismatch " + relPath + " ===")
      worker.otaDone = worker.otaDone + 1
      PostOtaProgress(states, "failed", relPath, "hash mismatch")
      DeleteFile(tmp)
      DrainOtaQueue(msgPort, states)
      return
    end if
  else if Len(expectedHash) > 0 and Len(gotHash) = 0 then
    LedLog("=== Perform6: OTA SHA-256 not returned — size check only " + relPath + " ===")
  end if

  DeleteFile(dest)
  moved = MoveFile(tmp, dest)
  if moved <> true then
    worker.otaDone = worker.otaDone + 1
    PostOtaProgress(states, "failed", relPath, "move failed")
    DeleteFile(tmp)
    DrainOtaQueue(msgPort, states)
    return
  end if

  worker.otaDone = worker.otaDone + 1
  LedLog("=== Perform6: OTA wrote " + dest + " bytes=" + IntToStr(actual) + " ===")
  PostOtaProgressBytes(states, "done", relPath, "saved=" + dest, actual, expected)
  DrainOtaQueue(msgPort, states)
End Sub

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

Function ShouldBridgeHealReboot() as Boolean
  healCooldownSec = 21600
  now = NowEpochSeconds()
  if FileExistsIn("SD:/", "perform6-bridge-heal") then
    raw = ReadAsciiFile("SD:/perform6-bridge-heal")
    prev = Val(raw)
    if now > 0 and prev > 0 and (now - prev) >= healCooldownSec then
      DeleteFile("SD:/perform6-bridge-heal")
      LedLog("=== Perform6: bridge heal marker expired (" + IntToStr(healCooldownSec) + "s) ===")
    else
      return false
    end if
  end if
  stamp = "1"
  if now > 0 then stamp = IntToStr(now)
  WriteAsciiFile("SD:/perform6-bridge-heal", stamp)
  return true
End Function

Function ShouldAllowHtmlRecycle(force as Boolean) as Boolean
  recycleCooldownSec = 900
  now = NowEpochSeconds()
  if force = true then
    stamp = "1"
    if now > 0 then stamp = IntToStr(now)
    WriteAsciiFile("SD:/perform6-bridge-recycle", stamp)
    return true
  end if
  if FileExistsIn("SD:/", "perform6-bridge-recycle") then
    raw = ReadAsciiFile("SD:/perform6-bridge-recycle")
    prev = Val(raw)
    if now > 0 and prev > 0 and (now - prev) >= recycleCooldownSec then
      DeleteFile("SD:/perform6-bridge-recycle")
    else
      return false
    end if
  end if
  stamp = "1"
  if now > 0 then stamp = IntToStr(now)
  WriteAsciiFile("SD:/perform6-bridge-recycle", stamp)
  return true
End Function

Sub ClearBridgeHealMarker()
  if FileExistsIn("SD:/", "perform6-bridge-heal") then
    DeleteFile("SD:/perform6-bridge-heal")
    LedLog("=== Perform6: bridge heal marker cleared (round-trip ok) ===")
  end if
End Sub

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

Function HasActiveTransfer(states as Object) as Boolean
  if type(states) <> "roArray" then return false
  for each st in states
    if type(st) = "roAssociativeArray" then
      if type(st.xfer) = "roUrlTransfer" then return true
    end if
  end for
  return false
End Function

Function RecycleHtmlWidget(states as Object, reason as String, force as Boolean) as Boolean
  if ShouldAllowHtmlRecycle(force) = false then
    LedLog("=== Perform6: html recycle refused (cooldown) — " + reason + " ===")
    return false
  end if
  g = GetGlobalAA()
  html = ResolveBridgeHtml(states)
  appUrl = ""
  if type(g.appUrlTouch) = "roString" or type(g.appUrlTouch) = "String" then
    if type(g.htmlTouch) = "roHtmlWidget" then
      html = g.htmlTouch
      appUrl = g.appUrlTouch
    end if
  end if
  if Len(appUrl) = 0 then
    if type(g.appUrlPrimary) = "roString" or type(g.appUrlPrimary) = "String" then
      if type(g.htmlPrimary) = "roHtmlWidget" then
        html = g.htmlPrimary
        appUrl = g.appUrlPrimary
      end if
    end if
  end if
  if Len(appUrl) = 0 then
    if type(g.appUrlSingle) = "roString" or type(g.appUrlSingle) = "String" then
      if type(g.html) = "roHtmlWidget" then
        html = g.html
        appUrl = g.appUrlSingle
      end if
    end if
  end if
  if type(html) <> "roHtmlWidget" or Len(appUrl) = 0 then
    LedLog("=== Perform6: html recycle failed — no widget/url — " + reason + " ===")
    return false
  end if
  ack = CreateObject("roAssociativeArray")
  ack.AddReplace("type", "led-bridge-recycle-ack")
  ack.reason = reason
  PostJsMessage(html, ack)
  LedLog("=== Perform6: html soft recycle SetUrl — " + reason + " ===")
  FlushLedLog()
  html.SetUrl(appUrl)
  return true
End Function

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

Sub MaybeBridgeWatchdogHeal(states as Object)
  g = GetGlobalAA()
  silenceMs = 0
  bootMs = 0
  if type(g.bridgeLastSpan) = "roTimespan" then silenceMs = g.bridgeLastSpan.TotalMilliseconds()
  if type(g.bridgeBootSpan) = "roTimespan" then bootMs = g.bridgeBootSpan.TotalMilliseconds()

  needHeal = false
  reason = ""
  if g.bridgeEverSeen = true then
    if silenceMs > 240000 then
      needHeal = true
      reason = "js silent " + IntToStr(silenceMs) + "ms"
    end if
  else
    if bootMs > 600000 then
      needHeal = true
      reason = "no js messages " + IntToStr(bootMs) + "ms after boot"
    end if
  end if

  if needHeal = false then return
  if RecycleHtmlWidget(states, "watchdog:" + reason, false) = true then
    if type(g.bridgeLastSpan) = "roTimespan" then g.bridgeLastSpan.Mark()
    return
  end if
  if ShouldBridgeHealReboot() = false then
    refuseAge = 0
    if type(g.healRefuseLogSpan) = "roTimespan" then refuseAge = g.healRefuseLogSpan.TotalMilliseconds()
    if refuseAge > 300000 or type(g.healRefuseLogSpan) <> "roTimespan" then
      LedLog("=== Perform6: bridge heal waiting cooldown — " + reason + " ===")
      if type(g.healRefuseLogSpan) <> "roTimespan" then g.healRefuseLogSpan = CreateObject("roTimespan")
      if type(g.healRefuseLogSpan) = "roTimespan" then g.healRefuseLogSpan.Mark()
    end if
    return
  end if
  LedLog("=== Perform6: bridge watchdog heal — " + reason + " ===")
  FlushLedLog()
  RebootDeviceAfterOta()
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
  msg.AddReplace("features", "ota-ping,ota-reboot,cache-cancel,bridge-heal,bridge-recycle,fs,playback-ack")
  if HasActiveTransfer(states) then msg.busy = "1" else msg.busy = "0"
  PostJsMessage(html, msg)
  LedLog("=== Perform6: led-bridge-pong ===")
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
  msg.AddReplace("features", "ota-ping,ota-reboot,cache-cancel,bridge-heal,bridge-recycle,fs,playback-ack")
  msg.AddReplace("autorunRelease", "1.0.88")
  PostJsMessage(html, msg)
  if Len(jsVersion) > 0 then
    LedLog("=== Perform6: led-hello-ack protocol=2 js=" + jsVersion + " ===")
  else
    LedLog("=== Perform6: led-hello-ack protocol=2 ===")
  end if
End Sub

Sub HandleLedBridgeHealthy()
  NoteBridgeActivity()
  ClearBridgeHealMarker()
End Sub

Sub PostBridgeTick(states as Object)
  html = ResolveBridgeHtml(states)
  msg = CreateObject("roAssociativeArray")
  msg.AddReplace("type", "led-bridge-tick")
  msg.AddReplace("protocolVersion", "2")
  if HasActiveTransfer(states) then msg.busy = "1" else msg.busy = "0"
  PostJsMessage(html, msg)
End Sub

Sub HandleLedBridgeRecycle(payload as Object, states as Object)
  NoteBridgeActivity()
  reason = PayloadString(payload, "reason")
  if Len(reason) = 0 then reason = "js requested"
  force = false
  if PayloadString(payload, "force") = "1" then force = true
  RecycleHtmlWidget(states, reason, force)
End Sub

Sub HandleLedBridgeHeal(payload as Object)
  NoteBridgeActivity()
  reason = PayloadString(payload, "reason")
  if Len(reason) = 0 then reason = "js requested"
  force = PayloadString(payload, "force")
  if force = "1" then
    if FileExistsIn("SD:/", "perform6-bridge-heal") then DeleteFile("SD:/perform6-bridge-heal")
    LedLog("=== Perform6: bridge heal FORCE reboot — " + reason + " ===")
    FlushLedLog()
    RebootDeviceAfterOta()
    return
  end if
  if ShouldBridgeHealReboot() = false then
    LedLog("=== Perform6: bridge heal refused (marker) — " + reason + " ===")
    return
  end if
  LedLog("=== Perform6: bridge heal reboot — " + reason + " ===")
  FlushLedLog()
  RebootDeviceAfterOta()
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
  if ShouldAutoRebootOnce("perform6-boot-fail") then
    LedLog("=== Perform6: FATAL - auto reboot once ===")
    FlushLedLog()
    RebootDeviceAfterOta()
  end if
  FlushLedLog()
  while true
    Sleep(10000)
  end while
End Sub

Function SplitPipeUrls(text as String) as Object
  out = CreateObject("roArray", 0, true)
  if Len(text) = 0 then return out
  start = 1
  while start <= Len(text)
    pipe = Instr(start, text, "|")
    if pipe = 0 then
      part = Mid(text, start)
      if Len(part) > 0 then out.Push(part)
      exit while
    end if
    if pipe > start then
      out.Push(Mid(text, start, pipe - start))
    end if
    start = pipe + 1
  end while
  return out
End Function

' Drop files that are neither sync-assigned nor in active use.
Sub PruneCache(states as Object)
  files = MatchFiles(CacheDir(), "*")
  if type(files) <> "roList" and type(files) <> "roArray" then return

  keepNames = FindKeepNames(states)

  for each name in files
    isPart = false
    if Right(name, 5) = ".part" then isPart = true

    if isPart then
      baseName = Left(name, Len(name) - 5)
      keepPart = false
      if type(keepNames) = "roAssociativeArray" then
        flag = keepNames.Lookup(baseName)
        if type(flag) <> "Invalid" then keepPart = true
      end if
      for each st in states
        if type(st) = "roAssociativeArray" then
          if name = st.xferTmp or baseName = st.xferName then keepPart = true
        end if
      end for
      ' Stale partial when the final file already exists.
      if FileExistsIn(CacheDir(), baseName) then
        DeleteFile(CacheDir() + "/" + name)
      else if not keepPart then
        DeleteFile(CacheDir() + "/" + name)
      end if
    else
      keep = false
      if type(keepNames) = "roAssociativeArray" then
        flag = keepNames.Lookup(name)
        if type(flag) <> "Invalid" then keep = true
      end if
      for each st in states
        if type(st) = "roAssociativeArray" then
          if name = st.localName or name = st.xferName then keep = true
        end if
      end for
      if not keep then DeleteFile(CacheDir() + "/" + name)
    end if
  end for
End Sub

Sub StartCacheDownload(st as Object, url as String, msgPort as Object, states as Object)
  if type(st.xfer) = "roUrlTransfer" and st.xferUrl = url then return
  if type(st.xfer) = "roUrlTransfer" then return

  CreateDirectory(CacheDir())
  name = CacheNameFor(url)
  dest = CacheDir() + "/" + name
  tmp = dest + ".part"
  worker = FindPrefetchWorker(states)
  mediaId = LookupUrlMediaId(worker, url)
  expected = LookupUrlExpectedSize(worker, url)
  alreadyComplete = PartFileBytes(dest)
  if expected > 0 and alreadyComplete = expected then
    LedLog("=== Perform6: LED " + st.key + " cache already on SD " + dest + " ===")
    DeleteFile(tmp)
    if type(worker) = "roAssociativeArray" then
      ClearUrlRetryCount(worker, url)
      worker.prefetchDone = worker.prefetchDone + 1
    end if
    PostCacheProgress(states, "skip", url, name, mediaId, "", dest, alreadyComplete, expected)
    DrainPrefetchQueue(msgPort, states)
    return
  end if
  already = PartFileBytes(tmp)
  if expected > 0 and already > expected then
    LedLog("=== Perform6: cache partial oversized — deleting " + tmp + " ===")
    DeleteFile(tmp)
    already = 0
  end if
  resumeAt = already
  bytesNeeded = expected - already
  if bytesNeeded < 0 then bytesNeeded = 0
  if not HasSdSpaceForBytes(bytesNeeded) then
    LedLog("=== Perform6: cache skipped - SD card full for " + url + " ===")
    if type(worker) = "roAssociativeArray" then worker.prefetchDone = worker.prefetchDone + 1
    PostCacheProgress(states, "failed", url, name, mediaId, "SD card full", dest, 0, expected)
    DrainPrefetchQueue(msgPort, states)
    return
  end if

  xfer = CreateObject("roUrlTransfer")
  if type(xfer) <> "roUrlTransfer" then
    LedLog("=== Perform6: roUrlTransfer unavailable for " + url + " ===")
    FinishCacheFailure(st, worker, url, name, mediaId, tmp, "download start failed", true, msgPort, states)
    return
  end if
  ConfigureDownloadTransfer(xfer, msgPort, url, st.key)

  if StartResumableGet(xfer, tmp, resumeAt) then
    st.xfer = xfer
    st.xferUrl = url
    st.xferTmp = tmp
    st.xferDest = dest
    st.xferName = name
    st.xferResumed = (resumeAt > 0)
    LedLog("=== Perform6: LED " + st.key + " caching " + url + " resume=" + IntToStr(resumeAt) + " ===")
    PostCacheProgress(states, "start", url, name, mediaId, "", dest, resumeAt, expected)
    PruneCache(states)
  else
    LedLog("=== Perform6: cache start failed for " + url + " ===")
    FinishCacheFailure(st, worker, url, name, mediaId, tmp, "download start failed", true, msgPort, states)
  end if
End Sub

Sub DrainPrefetchQueue(msgPort as Object, states as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  if type(worker.xfer) = "roUrlTransfer" then return
  if type(worker.queue) <> "roArray" then return

  skipped = 0
  while worker.queue.Count() > 0 and skipped < 4
    url = worker.queue[0]
    worker.queue.Delete(0)
    name = CacheNameFor(url)
    mediaId = LookupUrlMediaId(worker, url)
    if Len(CachedPathFor(url)) > 0 and not IsCacheFileValid(url, worker) then
      InvalidateCacheForUrl(url)
    end if
    if IsCacheFileValid(url, worker) then
      LedLog("=== Perform6: prefetch already cached " + name + " ===")
      worker.prefetchDone = worker.prefetchDone + 1
      skipDest = CacheDir() + "/" + name
      skipExpected = LookupUrlExpectedSize(worker, url)
      PostCacheProgress(states, "skip", url, name, mediaId, "", skipDest, PartFileBytes(skipDest), skipExpected)
      skipped = skipped + 1
    else
      StartCacheDownload(worker, url, msgPort, states)
      return
    end if
  end while

  if worker.queue.Count() = 0 then
    ScheduleDeferredCacheComplete(states)
  end if
End Sub

Function QueueHasUrl(queue as Object, url as String) as Boolean
  if type(queue) <> "roArray" then return false
  for each qUrl in queue
    if qUrl = url then return true
  end for
  return false
End Function

Sub QueueInsertFront(queue as Object, url as String)
  if type(queue) <> "roArray" then return
  if QueueHasUrl(queue, url) then return
  nextQ = CreateObject("roArray", 0, true)
  nextQ.Push(url)
  for each qUrl in queue
    nextQ.Push(qUrl)
  end for
  while queue.Count() > 0
    queue.Delete(0)
  end while
  for each qUrl in nextQ
    queue.Push(qUrl)
  end for
End Sub

Sub HandleLedKeepSet(payload as Object, states as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return

  urls = SplitPipeUrls(PayloadString(payload, "urls"))
  appendFlag = PayloadString(payload, "append")
  pruneFlag = PayloadString(payload, "prune")

  if appendFlag <> "true" then
    worker.keepNames = CreateObject("roAssociativeArray")
  end if
  if type(worker.keepNames) <> "roAssociativeArray" then
    worker.keepNames = CreateObject("roAssociativeArray")
  end if

  for each url in urls
    if IsNetworkSrc(url) then
      name = CacheNameFor(url)
      worker.keepNames.AddReplace(name, true)
    end if
  end for

  if pruneFlag = "true" then
    PruneCache(states)
  end if
  LedLog("=== Perform6: keep-set urls " + IntToStr(urls.Count()) + " append=" + appendFlag + " prune=" + pruneFlag + " ===")
End Sub

Sub HandleLedPrefetch(payload as Object, msgPort as Object, states as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return

  urls = SplitPipeUrls(PayloadString(payload, "urls"))
  ids = SplitPipeUrls(PayloadString(payload, "ids"))
  appendFlag = PayloadString(payload, "append")
  busy = false
  if type(worker.xfer) = "roUrlTransfer" then busy = true
  if type(worker.queue) = "roArray" and worker.queue.Count() > 0 then busy = true
  appendMode = (appendFlag = "true") or busy

  if not appendMode then
    worker.keepNames = CreateObject("roAssociativeArray")
    worker.queue = CreateObject("roArray", 0, true)
    worker.urlIds = CreateObject("roAssociativeArray")
    worker.urlSizes = CreateObject("roAssociativeArray")
    worker.prefetchTotal = 0
    worker.prefetchDone = 0
    worker.deferCompleteAtMs = invalid
  else if type(worker.urlSizes) <> "roAssociativeArray" then
    worker.urlSizes = CreateObject("roAssociativeArray")
  end if

  sizes = SplitPipeUrls(PayloadString(payload, "sizes"))
  priorityFlag = PayloadString(payload, "priority")
  addedToQueue = 0
  i = 0
  for each url in urls
    if IsNetworkSrc(url) then
      name = CacheNameFor(url)
      worker.keepNames.AddReplace(name, true)
      mediaId = ""
      if i < ids.Count() then mediaId = ids[i]
      worker.urlIds.AddReplace(url, mediaId)
      expectedSize = 0
      if i < sizes.Count() then
        sizeText = sizes[i]
        if Len(sizeText) > 0 then expectedSize = Int(Val(sizeText))
      end if
      if expectedSize > 0 then worker.urlSizes.AddReplace(url, expectedSize)
      if Len(CachedPathFor(url)) > 0 and not IsCacheFileValid(url, worker) then
        InvalidateCacheForUrl(url)
      end if
      if IsCacheFileValid(url, worker) then
        worker.prefetchDone = worker.prefetchDone + 1
        skipDest = CacheDir() + "/" + name
        PostCacheProgress(states, "skip", url, name, mediaId, "", skipDest, PartFileBytes(skipDest), expectedSize)
      else
        if appendMode then
          if not QueueHasUrl(worker.queue, url) and url <> worker.xferUrl then
            if priorityFlag = "true" then
              QueueInsertFront(worker.queue, url)
            else
              worker.queue.Push(url)
            end if
            addedToQueue = addedToQueue + 1
          end if
        else
          if priorityFlag = "true" then
            QueueInsertFront(worker.queue, url)
          else
            worker.queue.Push(url)
          end if
          addedToQueue = addedToQueue + 1
        end if
      end if
    end if
    i = i + 1
  end for

  RecalcPrefetchTotals(worker)
  LedLog("=== Perform6: prefetch " + IntToStr(urls.Count()) + " urls, queue " + IntToStr(worker.queue.Count()) + " done=" + IntToStr(worker.prefetchDone) + " total=" + IntToStr(worker.prefetchTotal) + " append=" + appendFlag + " ===")
  if not appendMode then
    PruneCache(states)
  end if
  DrainPrefetchQueue(msgPort, states)
End Sub

Sub HandleLedCacheClearAll(states as Object)
  ' MEDIA ONLY — never cancel / clear OTA (separate path).
  worker = FindPrefetchWorker(states)
  if type(worker) = "roAssociativeArray" then
    if type(worker.xfer) = "roUrlTransfer" then
      worker.xfer.AsyncCancel()
      worker.xfer = invalid
    end if
    worker.xferUrl = ""
    worker.xferTmp = ""
    worker.xferDest = ""
    worker.xferName = ""
    worker.queue = CreateObject("roArray", 0, true)
    worker.prefetchDone = 0
    worker.prefetchTotal = 0
    worker.deferCompleteAtMs = invalid
    if type(worker.retryCounts) = "roAssociativeArray" then
      worker.retryCounts = CreateObject("roAssociativeArray")
    end if
  end if

  ' Flat legacy cache + nested asset-pool tree. OTA package files on SD:/ untouched.
  WipeMediaDirectory(CacheDir())
  WipeMediaDirectory(MediaPoolDir())
  LedLog("=== Perform6: media cache+pool cleared (OTA untouched) ===")
End Sub

Sub HandleLedCacheEvict(payload as Object, states as Object)
  urls = SplitPipeUrls(PayloadString(payload, "urls"))
  for each url in urls
    if IsNetworkSrc(url) then
      name = CacheNameFor(url)
      path = CacheDir() + "/" + name
      DeleteFile(path)
      DeleteFile(path + ".part")
      LedLog("=== Perform6: evict " + name + " ===")
    end if
  end for
End Sub

' Cancel active/queued cache downloads (JS stall/timeout). Thin — no Sleep.
' keepPart=true preserves .part so the next attempt can Range-resume.
Sub HandleLedCacheCancel(payload as Object, msgPort as Object, states as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return

  urls = SplitPipeUrls(PayloadString(payload, "urls"))
  cancelAll = (urls.Count() = 0)
  keepPart = (PayloadString(payload, "keepPart") = "true")

  if type(worker.xfer) = "roUrlTransfer" then
    activeUrl = worker.xferUrl
    shouldCancel = cancelAll
    if not shouldCancel then
      for each u in urls
        if u = activeUrl then shouldCancel = true
      end for
    end if
    if shouldCancel then
      tmp = worker.xferTmp
      name = worker.xferName
      mediaId = LookupUrlMediaId(worker, activeUrl)
      partialBytes = PartFileBytes(tmp)
      expected = LookupUrlExpectedSize(worker, activeUrl)
      worker.xfer.AsyncCancel()
      worker.xfer = invalid
      worker.xferUrl = ""
      worker.xferTmp = ""
      worker.xferDest = ""
      worker.xferName = ""
      if keepPart <> true and Len(tmp) > 0 then DeleteFile(tmp)
      worker.prefetchDone = worker.prefetchDone + 1
      PostCacheProgress(states, "failed", activeUrl, name, mediaId, "cancelled", "", partialBytes, expected)
      ClearUrlRetryCount(worker, activeUrl)
      LedLog("=== Perform6: cache cancel active keepPart=" + PayloadString(payload, "keepPart") + " " + activeUrl + " ===")
    end if
  end if

  if type(worker.queue) = "roArray" and worker.queue.Count() > 0 then
    nextQ = CreateObject("roArray", 0, true)
    for each qUrl in worker.queue
      drop = cancelAll
      if not drop then
        for each u in urls
          if u = qUrl then drop = true
        end for
      end if
      if drop then
        if keepPart <> true then
          DeleteFile(CacheDir() + "/" + CacheNameFor(qUrl) + ".part")
        end if
        LedLog("=== Perform6: cache cancel queued " + qUrl + " ===")
      else
        nextQ.Push(qUrl)
      end if
    end for
    worker.queue = nextQ
  end if

  RecalcPrefetchTotals(worker)
  DrainPrefetchQueue(msgPort, states)
End Sub

Function FindStateForUrlEvent(states as Object, ev as Object) as Object
  ud = ev.GetUserData()
  if type(ud) = "roString" or type(ud) = "String" then
    for each st in states
      if type(st) = "roAssociativeArray" then
        if st.key = ud then return st
      end if
    end for
  end if
  return invalid
End Function

Sub HandleDownloadProgressTick(msgPort as Object, states as Object)
  for each st in states
    if type(st) = "roAssociativeArray" then
      if type(st.xfer) = "roUrlTransfer" then
        path = st.xferTmp
        if type(path) <> "roString" and type(path) <> "String" then path = ""
        if Len(path) = 0 then path = st.xferDest
        downloaded = PartFileBytes(path)
        if st.key = "ota" then
          MaybePostOtaProgress(states, st.xferPath, downloaded, st.xferExpected)
        else
          worker = FindPrefetchWorker(states)
          url = st.xferUrl
          name = st.xferName
          mediaId = LookupUrlMediaId(worker, url)
          expected = LookupUrlExpectedSize(worker, url)
          MaybePostCacheProgress(states, "progress", url, name, mediaId, path, downloaded, expected)
        end if
      end if
    end if
  end for
  if type(msgPort) = "roMessagePort" then
    DrainPrefetchQueue(msgPort, states)
  end if
End Sub

Sub HandleCacheEvent(st as Object, ev as Object, msgPort as Object, states as Object)
  eventType = ev.GetInt()
  if eventType = 2 then return

  url = st.xferUrl
  tmp = st.xferTmp
  dest = st.xferDest
  name = st.xferName
  worker = FindPrefetchWorker(states)
  mediaId = LookupUrlMediaId(worker, url)
  expected = LookupUrlExpectedSize(worker, url)

  if eventType <> 1 then
    reason = ev.GetFailureReason()
    if type(reason) <> "roString" and type(reason) <> "String" then reason = ""
    code = ev.GetResponseCode()
    errorText = CacheHttpErrorText(code, reason)
    LedLog("=== Perform6: LED " + st.key + " cache transfer failed " + errorText + " ===")
    FinishCacheFailure(st, worker, url, name, mediaId, tmp, errorText, HttpFailureIsRetryable(code), msgPort, states)
    return
  end if

  code = ev.GetResponseCode()
  reason = ev.GetFailureReason()
  if type(reason) <> "roString" and type(reason) <> "String" then reason = ""
  st.xfer = invalid
  st.xferUrl = ""
  actual = PartFileBytes(tmp)

  if code = 416 and expected > 0 and actual = expected then
    code = 200
  end if

  resumed = false
  if st.xferResumed = true then resumed = true
  st.xferResumed = false

  if IsRangeIgnoredCorruption(resumed, code, actual, expected) then
    LedLog("=== Perform6: cache Range ignored (file oversized) — retry fresh ===")
    DeleteFile(tmp)
    FinishCacheFailure(st, worker, url, name, mediaId, tmp, "range ignored — redeploy API Range", true, msgPort, states)
    return
  end if

  if code < 200 or code > 299 then
    errorText = CacheHttpErrorText(code, reason)
    LedLog("=== Perform6: LED " + st.key + " cache failed " + errorText + " ===")
    if code = 416 then DeleteFile(tmp)
    FinishCacheFailure(st, worker, url, name, mediaId, tmp, errorText, HttpFailureIsRetryable(code), msgPort, states)
    return
  end if

  if expected > 0 then
    if actual <> expected then
      LedLog("=== Perform6: cache size mismatch after download " + IntToStr(actual) + "/" + IntToStr(expected) + " ===")
      DeleteFile(tmp)
      FinishCacheFailure(st, worker, url, name, mediaId, tmp, "size mismatch", true, msgPort, states)
      return
    end if
  end if

  DeleteFile(dest)
  moved = MoveFile(tmp, dest)
  if moved <> true then
    LedLog("=== Perform6: LED " + st.key + " cache move failed ===")
    moveError = "move failed"
    moveRetry = true
    if not HasSdSpaceForBytes(0) then
      moveError = "SD card full"
      moveRetry = false
    end if
    FinishCacheFailure(st, worker, url, name, mediaId, tmp, moveError, moveRetry, msgPort, states)
    return
  end if

  LedLog("=== Perform6: LED " + st.key + " cached " + dest + " ===")
  if type(worker) = "roAssociativeArray" then
    ClearUrlRetryCount(worker, url)
    worker.prefetchDone = worker.prefetchDone + 1
  end if
  PostCacheProgress(states, "done", url, name, mediaId, "", dest, PartFileBytes(dest), expected)

  ' Prefetch worker has no video player - only fill SD.
  if st.key <> "prefetch" and type(st.vp) = "roVideoPlayer" then
    ' Only take over when nothing is on screen - never interrupt a running stream.
    if st.wantUrl = url and Len(st.playingUrl) = 0 then
      if st.idleShown = true then
        st.vp.StopClear()
        st.vp.SetViewMode("FillScreenAndCentered")
        st.idleShown = false
      end if
      if PlayLocalFile(st.vp, dest) then
        st.playingUrl = url
        st.localName = name
        st.vp.SetLoopMode(st.loopMode)
        if st.paused then
          st.vp.Pause()
        else
          st.vp.Resume()
        end if
      end if
    end if
  end if

  DrainPrefetchQueue(msgPort, states)
End Sub

Sub PlayNativeSrc(st as Object, src as String, msgPort as Object, states as Object)
  ok = false
  st.localName = ""
  ' A fresh decoder session starts at default volume - force the next re-apply.
  st.volumePercent = -1
  src = NormalizeLocalSrc(src)

  wasIdle = (st.idleShown = true)

  if IsNetworkSrc(src) then
    cached = CachedPathFor(src)
    if Len(cached) > 0 then
      if wasIdle then
        st.vp.StopClear()
        st.vp.SetViewMode("FillScreenAndCentered")
        st.idleShown = false
      end if
      LedLog("=== Perform6: LED " + st.key + " play cached " + cached + " ===")
      ok = PlayLocalFile(st.vp, cached)
      if ok then st.localName = CacheNameFor(src)
    else if Left(LCase(src), 7) = "rtsp://" or Left(LCase(src), 6) = "rtp://" or Left(LCase(src), 6) = "udp://" then
      if wasIdle then
        st.vp.StopClear()
        st.vp.SetViewMode("FillScreenAndCentered")
        st.idleShown = false
      end if
      ok = PlayNetworkStream(st, src)
      if ok then LedLog("=== Perform6: LED " + st.key + " live " + src + " ===")
    else
      ' HTTPS VOD - never stream and never start a second roUrlTransfer on this LED.
      LedLog("=== Perform6: LED " + st.key + " wait cache (no HTTPS play) ===")
    end if
  else
    if wasIdle then
      st.vp.StopClear()
      st.vp.SetViewMode("FillScreenAndCentered")
      st.idleShown = false
    end if
    ok = PlayLocalFile(st.vp, src)
  end if

  if ok then
    st.playingUrl = src
    st.vp.SetLoopMode(st.loopMode)
    if st.paused then
      st.vp.Pause()
    else
      st.vp.Resume()
    end if
  else
    st.playingUrl = ""
    LedLog("=== Perform6: LED " + st.key + " play FAILED " + src + " ===")
    ' Keep splash on screen instead of a black LED after a failed swap.
    if wasIdle and st.idleShown = false then PlayIdleClip(st)
  end if
End Sub

Sub ApplyNativePlayback(st as Object, payload as Object, msgPort as Object, states as Object)
  if type(st) <> "roAssociativeArray" then return
  if type(st.vp) <> "roVideoPlayer" then
    PostPlaybackAck(states, st, payload, false, "no video player")
    return
  end if

  src = PayloadString(payload, "src")
  fallbackSrc = PayloadString(payload, "fallbackSrc")
  if not IsPlayableNativeSrc(src) then
    src = fallbackSrc
  end if
  if not IsPlayableNativeSrc(src) then
    LedLog("=== Perform6: LED " + st.key + " no playable src ===")
    PostPlaybackAck(states, st, payload, false, "no playable src")
    return
  end if

  st.loopMode = PayloadBool(payload, "loop", true)
  st.paused = PayloadBool(payload, "paused", false)
  restartNonce = PayloadInt(payload, "restartNonce", 0)
  forceRestart = restartNonce <> st.nonce
  st.nonce = restartNonce
  st.wantUrl = src

  if src = st.playingUrl and not forceRestart then
    st.vp.SetLoopMode(st.loopMode)
    ApplyLedVolume(st, payload)
    ApplyLedPauseState(st)
    PostPlaybackAck(states, st, payload, true, "transport")
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

' Packaged led-idle.png (or optional led-idle.mp4 override) loops on the LED
' until the first backend / touch video arrives - avoids "No signal".
Sub PlayIdleClip(st as Object)
  if type(st) <> "roAssociativeArray" then return
  if type(st.vp) <> "roVideoPlayer" then return

  if FileExistsIn("SD:/", "led-idle.mp4") then
    st.vp.SetLoopMode(true)
    if PlayLocalFile(st.vp, "SD:/led-idle.mp4") then
      st.idleShown = true
      LedLog("=== Perform6: LED " + st.key + " idle SD:/led-idle.mp4 ===")
      st.vp.Resume()
      return
    end if
    LedLog("=== Perform6: LED " + st.key + " idle FAILED SD:/led-idle.mp4 ===")
  end if

  if not FileExistsIn("SD:/", "led-idle.png") then
    LedLog("=== Perform6: LED " + st.key + " no idle file on card ===")
    return
  end if

  ' Full-screen 16:9 splash (3840x2160) - Fill keeps edges sharp on 1080p and 4K.
  st.vp.SetViewMode("FillScreenAndCentered")
  ok = st.vp.PlayStaticImage("SD:/led-idle.png")
  if ok <> true then
    aa = CreateObject("roAssociativeArray")
    aa.Filename = "SD:/led-idle.png"
    ok = st.vp.PlayStaticImage(aa)
  end if

  if ok = true then
    st.idleShown = true
    LedLog("=== Perform6: LED " + st.key + " idle SD:/led-idle.png ===")
  else
    st.vp.SetViewMode("FillScreenAndCentered")
    LedLog("=== Perform6: LED " + st.key + " idle FAILED SD:/led-idle.png ===")
  end if
End Sub

Sub PostLedReady(html as Object, msgType as String, role as String)
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

' XT/XC always enable every wired HDMI (BrightAuthor-style). MULTI_NOFULLRES
' drops :fullres only. Legacy "SINGLE" in the file is ignored for XT/XC.
Function ReadDisplayMode() as String
  mode = ReadTextFile("perform6-display.txt")
  if Len(mode) = 0 then
    mode = ReadTextFile("SD:/perform6-display.txt")
  end if
  if mode = "MULTI_NOFULLRES" then
    return mode
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

  modified = false
  if OpsJsonFieldTrue(content, "clearCacheOnBoot") then
    LedLog("=== Perform6: perform6-ops clearCacheOnBoot ===")
    HandleLedCacheClearAll(states)
    content = OpsJsonSetFieldFalse(content, "clearCacheOnBoot")
    modified = true
    if OpsJsonFieldTrue(content, "rebootAfterCacheClear") then
      content = OpsJsonSetFieldFalse(content, "rebootAfterCacheClear")
      WriteRawFile(OpsFilePath(), content)
      RebootDeviceAfterOta()
      return
    end if
  end if

  if modified then
    WriteRawFile(OpsFilePath(), content)
    LedLog("=== Perform6: perform6-ops.json one-shot flags consumed ===")
  end if
End Sub

Sub HandleLedOpsReload(payload as Object, states as Object)
  worker = FindPrefetchWorker(states)
  html = invalid
  if type(worker) = "roAssociativeArray" then html = worker.notifyHtml
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

' Phase 4: prove whether hard-locked 60p was accepted by the real LED panel.
Sub LogActiveDisplayModes(vm as Object, profile as String)
  if type(vm) <> "roVideoMode" then return

  active = vm.GetActiveMode()
  if type(active) = "roAssociativeArray" then
    modeText = ""
    if type(active.videomode) = "roString" then modeText = active.videomode
    colorText = ""
    if type(active.colorspace) = "roString" then colorText = active.colorspace
    depthText = ""
    if type(active.colordepth) = "roString" then depthText = active.colordepth
    LedLog("=== Perform6: GetActiveMode " + modeText + " " + colorText + " " + depthText + " ===")
  else
    LedLog("=== Perform6: GetActiveMode unavailable ===")
  end if

  fps = vm.GetFPS()
  if type(fps) = "roInteger" or type(fps) = "Integer" then
    LedLog("=== Perform6: GetFPS " + IntToStr(fps) + " ===")
  end if

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
    best = vm.GetBestMode(name)
    if type(best) <> "roString" and type(best) <> "String" then best = ""
    if Len(best) = 0 and Left(UCase(name), 4) = "HDMI" then
      ' Docs classic connector is "hdmi"; multi-output uses HDMI-N names.
      fallback = vm.GetBestMode("hdmi")
      if type(fallback) = "roString" or type(fallback) = "String" then
        if Len(fallback) > 0 then
          best = fallback
          LedLog("=== Perform6: GetBestMode " + name + " blank — used hdmi=" + best + " ===")
        end if
      end if
    end if
    if Len(best) = 0 then best = "(blank/no EDID)"
    LedLog("=== Perform6: GetBestMode " + name + "=" + best + " ===")
    LogDisplayIdentity(vm, name)
    i = i + 1
  end while
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

  if profile = "HD226" then
    SafePrint("=== Perform6: HD226 single-output - skip SetScreenModes ===")
    return false
  end if

  sm = vm.GetScreenModes()
  if type(sm) <> "roArray" or sm.Count() < 2 then
    SafePrint("=== Perform6: GetScreenModes unavailable - keep default output ===")
    return false
  end if

  ' Hard-locked mode. No :preferred and no auto - those let a display fall back
  ' to its own timing (LED negotiated 4K then 1080p120), which breaks the fixed
  ' side-by-side canvas. :fullres keeps HTML/graphics 1:1 per output.
  mode1080 = "1920x1080x60p:fullres"
  if displayMode = "MULTI_NOFULLRES" then
    mode1080 = "1920x1080x60p"
  end if
  needChange = false

  if profile = "XT2145" then
    LogDisplayIdentity(vm, "HDMI-1")
    LogDisplayIdentity(vm, "HDMI-2")
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
      SafePrint("=== Perform6: XT2145 dual HDMI already configured ===")
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

    SafePrint("=== Perform6: SetScreenModes XT2145 HDMI-1+HDMI-2 fullres (may reboot) ===")
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

    if not ScreenAlreadyMatches(sm[idx1], mode1080, 0, true) then needChange = true
    if not ScreenAlreadyMatches(sm[idx2], mode1080, 1920, true) then needChange = true
    if not ScreenAlreadyMatches(sm[idx3], mode1080, 3840, true) then needChange = true

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
      SafePrint("=== Perform6: XC4055 triple HDMI already configured ===")
      return false
    end if

    ConfigureOutput(sm[idx1], mode1080, 0, true)
    ConfigureOutput(sm[idx2], mode1080, 1920, true)
    ConfigureOutput(sm[idx3], mode1080, 3840, true)
    i = 0
    while i < sm.Count()
      if i <> idx1 and i <> idx2 and i <> idx3 then
        ConfigureOutput(sm[i], mode1080, 0, false)
      end if
      i = i + 1
    end while

    SafePrint("=== Perform6: SetScreenModes XC4055 HDMI-1/2/3 fullres (may reboot) ===")
    vm.SetScreenModes(sm)
    return true
  end if

  return false
End Function

Sub Main()
  SafePrint("=== Perform6: autorun start ===")
  DeleteFile("SD:/perform6-led.log")

  identity = CollectDeviceIdentity()
  profile = ResolveHardwareProfile(identity)
  LedLog("=== Perform6: hardware profile " + profile + " ===")

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
  ledStates = CreateObject("roArray", 4, true)
  ledState = invalid
  led2State = invalid
  led3State = invalid
  ' Cache/OTA workers created AFTER HtmlWidget.Show (EnsureDeferredWorkers).

  if profile = "XT2145" and multiOutput then
    SafePrint("=== Perform6: XT React HDMI-1 + native video HDMI-2 ===")
    touchRect = CreateObject("roRectangle", 0, 0, 1920, 1080)
    ledRect = CreateObject("roRectangle", 1920, 0, 1920, 1080)
    if type(touchRect) <> "roRectangle" or type(ledRect) <> "roRectangle" then
      FatalHang("=== Perform6: FATAL no XT output rectangles ===")
    end if

    touchUrl = BuildAppUrl("file:///index.html", identity, profile, "touch")
    SafePrint("=== Perform6: HDMI-1 touch widget " + touchUrl + " ===")
    htmlTouch = TryCreateHtmlWidget(touchRect, msgPort, touchUrl)
    if type(htmlTouch) <> "roHtmlWidget" then
      touchFallbackTried = true
      touchUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "touch")
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
    EnsureDeferredWorkers(ledStates, htmlTouch)
    ProcessOpsOnBoot(ledStates)

    ' Let the first plane settle before enabling the second video port.
    Sleep(1500)
    LedLog("=== Perform6: HDMI-2 native roVideoPlayer ===")
    videoLed = TryCreateVideoPlayer(ledRect, msgPort, 2, "hdmi-2")
    if type(videoLed) <> "roVideoPlayer" then
      LedLog("=== Perform6: ERROR HDMI-2 roVideoPlayer create failed ===")
    else
      ledState = CreateLedState(videoLed, "led")
      ledStates.Push(ledState)
      PlayIdleClip(ledState)
      PostLedReady(htmlTouch, "xt-led-ready", "led")
    end if
  else if profile = "XC4055" and multiOutput then
    SafePrint("=== Perform6: XC React HDMI-1 + native video HDMI-2/3 ===")
    primaryRect = CreateObject("roRectangle", 0, 0, 1920, 1080)
    led2Rect = CreateObject("roRectangle", 1920, 0, 1920, 1080)
    led3Rect = CreateObject("roRectangle", 3840, 0, 1920, 1080)
    if type(primaryRect) <> "roRectangle" or type(led2Rect) <> "roRectangle" or type(led3Rect) <> "roRectangle" then
      FatalHang("=== Perform6: FATAL no XC output rectangles ===")
    end if

    primaryUrl = BuildAppUrl("file:///index.html", identity, profile, "primary")
    SafePrint("=== Perform6: HDMI-1 primary widget " + primaryUrl + " ===")
    htmlPrimary = TryCreateHtmlWidget(primaryRect, msgPort, primaryUrl)
    if type(htmlPrimary) <> "roHtmlWidget" then
      primaryFallbackTried = true
      primaryUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "primary")
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
    EnsureDeferredWorkers(ledStates, htmlPrimary)
    ProcessOpsOnBoot(ledStates)

    Sleep(1500)
    LedLog("=== Perform6: HDMI-2 native roVideoPlayer ===")
    videoLed2 = TryCreateVideoPlayer(led2Rect, msgPort, 2, "hdmi-2")
    if type(videoLed2) <> "roVideoPlayer" then
      LedLog("=== Perform6: ERROR HDMI-2 roVideoPlayer create failed ===")
    else
      led2State = CreateLedState(videoLed2, "led2")
      ledStates.Push(led2State)
      PlayIdleClip(led2State)
      PostLedReady(htmlPrimary, "xc-led-ready", "led2")
    end if

    Sleep(1500)
    LedLog("=== Perform6: HDMI-3 native roVideoPlayer ===")
    videoLed3 = TryCreateVideoPlayer(led3Rect, msgPort, 3, "hdmi-3")
    if type(videoLed3) <> "roVideoPlayer" then
      LedLog("=== Perform6: ERROR HDMI-3 roVideoPlayer create failed ===")
    else
      led3State = CreateLedState(videoLed3, "led3")
      ledStates.Push(led3State)
      PlayIdleClip(led3State)
      PostLedReady(htmlPrimary, "xc-led-ready", "led3")
    end if
  else
    ' HD226 (and any non-multi profile): one HtmlWidget on the native canvas.
    SafePrint("=== Perform6: canvas " + StrI(width) + "x" + StrI(height) + " ===")
    rect = CreateObject("roRectangle", 0, 0, width, height)
    if type(rect) <> "roRectangle" then
      FatalHang("=== Perform6: FATAL no roRectangle ===")
    end if

    url = BuildAppUrl("file:///index.html", identity, profile, singleRole)
    SafePrint("=== Perform6: HtmlWidget url " + url + " ===")
    html = TryCreateHtmlWidget(rect, msgPort, url)
    if type(html) <> "roHtmlWidget" then
      url = BuildAppUrl("file:///SD:/index.html", identity, profile, singleRole)
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

  ' Running from SD — tell JS so Admin starts as Present until a detach event.
  PostStorageHotplug(ledStates, true, "SD:")

  ' DWS already enabled early (before SetScreenModes) for field recovery.

  InitBridgeWatch()
  LedLog("=== Perform6: bridge watchdog armed (silence 4m / no-js 10m) ===")

  progressTimer = CreateObject("roTimer")
  if type(progressTimer) = "roTimer" then
    progressTimer.SetPort(msgPort)
    progressTimer.SetElapsed(15, 0)
    progressTimer.Start()
  end if

  while true
    ev = wait(100, msgPort)
    FlushDeferredCacheComplete(ledStates)
    MaybeFlushLedLog()
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
          LedLog("=== Perform6: native LED media ended ===")
        end if
      end if
    else if type(ev) = "roTimerEvent" then
      HandleDownloadProgressTick(msgPort, ledStates)
      MaybeBridgeWatchdogHeal(ledStates)
      PostBridgeTick(ledStates)
      if type(progressTimer) = "roTimer" then
        progressTimer.SetElapsed(15, 0)
        progressTimer.Start()
      end if
    else if type(ev) = "roUrlEvent" then
      cacheState = FindStateForUrlEvent(ledStates, ev)
      if type(cacheState) = "roAssociativeArray" then
        if cacheState.key = "ota" then
          HandleOtaEvent(cacheState, ev, msgPort, ledStates)
        else
          HandleCacheEvent(cacheState, ev, msgPort, ledStates)
        end if
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
          if profile = "XT2145" then
            if Instr(1, failedUrl, "bs_output=touch") > 0 and touchFallbackTried = false and type(htmlTouch) = "roHtmlWidget" then
              touchFallbackTried = true
              touchUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "touch")
              SafePrint("=== Perform6: HDMI-1 SetUrl fallback " + touchUrl + " ===")
              htmlTouch.SetUrl(touchUrl)
            end if
          else if profile = "XC4055" then
            if Instr(1, failedUrl, "bs_output=primary") > 0 and primaryFallbackTried = false and type(htmlPrimary) = "roHtmlWidget" then
              primaryFallbackTried = true
              primaryUrl = BuildAppUrl("file:///SD:/index.html", identity, profile, "primary")
              SafePrint("=== Perform6: HDMI-1 SetUrl fallback " + primaryUrl + " ===")
              htmlPrimary.SetUrl(primaryUrl)
            end if
          else if type(html) = "roHtmlWidget" and Instr(1, url, "file:///index.html") = 1 then
            url = BuildAppUrl("file:///SD:/index.html", identity, profile, singleRole)
            SafePrint("=== Perform6: SetUrl fallback " + url + " ===")
            html.SetUrl(url)
          end if
        else if reason = "load-finished" then
          SafePrint("=== Perform6: HTML load-finished ===")
          LedLog("=== Perform6: HTML load-finished ===")
        else if reason = "message" or Len(reason) = 0 then
          payload = ExtractJsPayload(data)
          if type(payload) <> "roAssociativeArray" then
            LedLog("=== Perform6: JS message unparsed reason=" + reason + " ===")
          else
            msgType = PayloadString(payload, "type")
            sender = PayloadString(payload, "role")
            target = PayloadString(payload, "target")
            NoteBridgeActivity()
            if Len(msgType) = 0 then
              LedLog("=== Perform6: JS message empty type ===")
            else
              LedLog("=== Perform6: JS→autorun " + msgType + " ===")
            end if
            if msgType = "led-hello" then
              HandleLedHello(payload, ledStates)
            else if msgType = "led-bridge-ping" then
              HandleLedBridgePing(ledStates)
            else if msgType = "led-bridge-healthy" then
              HandleLedBridgeHealthy()
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
            else if msgType = "xt-playback" or msgType = "xc-playback" then
              pausedText = "play"
              if PayloadBool(payload, "paused", false) then pausedText = "paused"
              LedLog("=== Perform6: msg " + msgType + " from " + sender + " target " + target + " " + pausedText + " vol " + IntToStr(PayloadInt(payload, "volumePercent", 100)) + " nonce " + IntToStr(PayloadInt(payload, "restartNonce", 0)) + " src " + PayloadString(payload, "src") + " ===")
            else if Len(msgType) > 0 then
              LedLog("=== Perform6: JS unhandled type " + msgType + " ===")
            end if
            if profile = "XT2145" then
              if sender = "touch" and msgType = "xt-playback" then
                ApplyNativePlayback(ledState, payload, msgPort, ledStates)
              end if
            else if profile = "XC4055" then
              if sender = "primary" and msgType = "xc-playback" then
                if target = "led2" then
                  ApplyNativePlayback(led2State, payload, msgPort, ledStates)
                else if target = "led3" then
                  ApplyNativePlayback(led3State, payload, msgPort, ledStates)
                end if
              end if
            end if
          end if
        else if Len(reason) > 0 then
          LedLog("=== Perform6: HtmlWidgetEvent reason=" + reason + " ===")
        end if
      end if
    else if type(ev) = "roStorageAttached" then
      HandleStorageHotplug(ev, ledStates, true)
    else if type(ev) = "roStorageDetached" then
      HandleStorageHotplug(ev, ledStates, false)
    end if
  end while
End Sub
