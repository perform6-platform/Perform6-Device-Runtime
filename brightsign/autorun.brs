' Perform6 BrightSign autorun — multi-HDMI aware bootstrap
' Profiles: XT2145 / XC4055 MULTI = React HtmlWidget on HDMI-1 + native roVideoPlayer on LEDs
'           (BrightAuthor-style: one Chromium, hardware video on secondary outputs).
'           HD226 = one HtmlWidget only.
' Reads perform6-display.txt: MULTI (default) | MULTI_NOFULLRES.
' XT/XC always use BrightAuthor-style MULTI (React on HDMI-1 + native video on LEDs).
' SetScreenModes only when config differs (avoids reboot loop). Do NOT call SetMode.
' Do NOT set trusted_iframes_enabled. Do NOT call roTouchScreen.Enable.
' Media cache: SD:/perform6-cache only (no whole-SD EncryptStorage — breaks HtmlWidget).

Sub SafePrint(msg as String)
  print msg
End Sub

' LED playback trail also lands on the card: BrightScript prints do not always
' show up in the DWS log view, and this is the only output we can read remotely.
Sub LedLog(msg as String)
  SafePrint(msg)
  path = "SD:/perform6-led.log"
  existing = ReadAsciiFile(path)
  if type(existing) <> "roString" and type(existing) <> "String" then existing = ""
  if Len(existing) > 60000 then existing = ""
  WriteAsciiFile(path, existing + msg + Chr(10))
End Sub

Sub AttachStorageHotplug(msgPort as Object)
  hotplug = CreateObject("roStorageHotplug")
  if type(hotplug) <> "roStorageHotplug" then return
  hotplug.SetPort(msgPort)
  SafePrint("=== Perform6: storage hotplug monitor attached ===")
End Sub

Sub HandleStorageDetached(ev as Object)
  LedLog("=== Perform6: SECURITY storage detached ===")
  SafePrint("=== Perform6: SECURITY storage detached ===")
End Sub

Function TryCreateHtmlWidget(rect as Object, msgPort as Object, url as String) as Object
  html = invalid

  cfg = CreateObject("roAssociativeArray")
  cfg.url = url
  cfg.port = msgPort
  cfg.mouse_enabled = true
  cfg.brightsign_js_objects_enabled = true
  cfg.javascript_enabled = true
  html = CreateObject("roHtmlWidget", rect, cfg)
  if type(html) = "roHtmlWidget" then
    SafePrint("=== Perform6: HtmlWidget modern config OK ===")
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
  if type(html) <> "roHtmlWidget" then
    return
  end if

  urls = CreateObject("roAssociativeArray")
  if type(urls) <> "roAssociativeArray" then
    return
  end if

  urls.all = "local"
  html.AllowJavaScriptUrls(urls)

  urls2 = CreateObject("roAssociativeArray")
  if type(urls2) = "roAssociativeArray" then
    urls2.all = "*"
    html.AllowJavaScriptUrls(urls2)
  end if
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
    value = payload.type
  else if key = "role" then
    value = payload.role
  else if key = "target" then
    value = payload.target
  else if key = "urls" then
    value = payload.urls
  end if
  if type(value) = "roString" or type(value) = "String" then
    return value
  end if
  return ""
End Function

' BSMessagePort may deliver JS booleans/numbers as strings, so every control
' value has to be accepted in both forms or Pause/Restart/Volume silently no-op.
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
  return true
End Function

' BrightScript reads "https://x" as drive "https" — network URLs must never be
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

' HtmlWidget uses file:///SD:/… — roVideoPlayer wants SD:/…
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

Function FileExistsIn(dir as String, name as String) as Boolean
  files = MatchFiles(dir, name)
  if type(files) = "roList" or type(files) = "roArray" then
    return files.Count() > 0
  end if
  return false
End Function

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
  st.queue = CreateObject("roArray", 0, true)
  st.keepNames = CreateObject("roAssociativeArray")
  st.urlIds = CreateObject("roAssociativeArray")
  st.notifyHtml = invalid
  st.prefetchTotal = 0
  st.prefetchDone = 0
  return st
End Function

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

Sub PostCacheProgress(states as Object, status as String, url as String, name as String, mediaVersionId as String, errorText as String)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  html = worker.notifyHtml
  if type(html) <> "roHtmlWidget" then return

  msg = CreateObject("roAssociativeArray")
  msg.type = "led-cache-progress"
  msg.status = status
  msg.url = url
  msg.name = name
  msg.mediaVersionId = mediaVersionId
  msg.error = errorText
  msg.doneCount = IntToStr(worker.prefetchDone)
  msg.totalCount = IntToStr(worker.prefetchTotal)
  html.PostJSMessage(msg)
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
    if not isPart then
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

  xfer = CreateObject("roUrlTransfer")
  if type(xfer) <> "roUrlTransfer" then return
  xfer.SetUrl(url)
  xfer.SetPort(msgPort)

  DeleteFile(tmp)
  if xfer.AsyncGetToFile(tmp) then
    st.xfer = xfer
    st.xferUrl = url
    st.xferTmp = tmp
    st.xferDest = dest
    st.xferName = name
    LedLog("=== Perform6: LED " + st.key + " caching " + url + " ===")
    worker = FindPrefetchWorker(states)
    mediaId = LookupUrlMediaId(worker, url)
    PostCacheProgress(states, "start", url, name, mediaId, "")
    PruneCache(states)
  end if
End Sub

Sub DrainPrefetchQueue(msgPort as Object, states as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return
  if type(worker.xfer) = "roUrlTransfer" then return
  if type(worker.queue) <> "roArray" then return

  while worker.queue.Count() > 0
    url = worker.queue[0]
    worker.queue.Delete(0)
    name = CacheNameFor(url)
    mediaId = LookupUrlMediaId(worker, url)
    if Len(CachedPathFor(url)) > 0 then
      LedLog("=== Perform6: prefetch already cached " + name + " ===")
      worker.prefetchDone = worker.prefetchDone + 1
      PostCacheProgress(states, "skip", url, name, mediaId, "")
    else
      StartCacheDownload(worker, url, msgPort, states)
      return
    end if
  end while

  PostCacheProgress(states, "complete", "", "", "", "")
  LedLog("=== Perform6: prefetch queue empty ===")
End Sub

Sub HandleLedPrefetch(payload as Object, msgPort as Object, states as Object)
  worker = FindPrefetchWorker(states)
  if type(worker) <> "roAssociativeArray" then return

  urls = SplitPipeUrls(PayloadString(payload, "urls"))
  ids = SplitPipeUrls(PayloadString(payload, "ids"))
  worker.keepNames = CreateObject("roAssociativeArray")
  worker.queue = CreateObject("roArray", 0, true)
  worker.urlIds = CreateObject("roAssociativeArray")
  worker.prefetchTotal = urls.Count()
  worker.prefetchDone = 0

  i = 0
  for each url in urls
    if IsNetworkSrc(url) then
      name = CacheNameFor(url)
      worker.keepNames.AddReplace(name, true)
      mediaId = ""
      if i < ids.Count() then mediaId = ids[i]
      worker.urlIds.AddReplace(url, mediaId)
      if Len(CachedPathFor(url)) = 0 then
        worker.queue.Push(url)
      else
        worker.prefetchDone = worker.prefetchDone + 1
        PostCacheProgress(states, "skip", url, name, mediaId, "")
      end if
    end if
    i = i + 1
  end for

  LedLog("=== Perform6: prefetch " + IntToStr(urls.Count()) + " urls, queue " + IntToStr(worker.queue.Count()) + " ===")
  PruneCache(states)
  DrainPrefetchQueue(msgPort, states)
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

Function FindStateForUrlEvent(states as Object, ev as Object) as Object
  ident = ev.GetSourceIdentity()
  for each st in states
    if type(st) = "roAssociativeArray" then
      if type(st.xfer) = "roUrlTransfer" then
        if st.xfer.GetIdentity() = ident then return st
      end if
    end if
  end for
  return invalid
End Function

Sub HandleCacheEvent(st as Object, ev as Object, msgPort as Object, states as Object)
  ' 1 = transfer complete.
  if ev.GetInt() <> 1 then return

  code = ev.GetResponseCode()
  url = st.xferUrl
  tmp = st.xferTmp
  dest = st.xferDest
  name = st.xferName
  st.xfer = invalid
  st.xferUrl = ""

  if code < 200 or code > 299 then
    LedLog("=== Perform6: LED " + st.key + " cache failed HTTP " + IntToStr(code) + " ===")
    DeleteFile(tmp)
    st.xferName = ""
    worker = FindPrefetchWorker(states)
    if type(worker) = "roAssociativeArray" then
      worker.prefetchDone = worker.prefetchDone + 1
    end if
    mediaId = LookupUrlMediaId(worker, url)
    PostCacheProgress(states, "failed", url, name, mediaId, "HTTP " + IntToStr(code))
    DrainPrefetchQueue(msgPort, states)
    return
  end if

  DeleteFile(dest)
  moved = MoveFile(tmp, dest)
  if moved <> true then
    LedLog("=== Perform6: LED " + st.key + " cache move failed ===")
    DeleteFile(tmp)
    st.xferName = ""
    worker = FindPrefetchWorker(states)
    if type(worker) = "roAssociativeArray" then
      worker.prefetchDone = worker.prefetchDone + 1
    end if
    mediaId = LookupUrlMediaId(worker, url)
    PostCacheProgress(states, "failed", url, name, mediaId, "move failed")
    DrainPrefetchQueue(msgPort, states)
    return
  end if
  LedLog("=== Perform6: LED " + st.key + " cached " + dest + " ===")
  worker = FindPrefetchWorker(states)
  if type(worker) = "roAssociativeArray" then
    worker.prefetchDone = worker.prefetchDone + 1
  end if
  mediaId = LookupUrlMediaId(worker, url)
  PostCacheProgress(states, "done", url, name, mediaId, "")

  ' Prefetch worker has no video player — only fill SD.
  if st.key <> "prefetch" and type(st.vp) = "roVideoPlayer" then
    ' Only take over when nothing is on screen — never interrupt a running stream.
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
  ' A fresh decoder session starts at default volume — force the next re-apply.
  st.volumePercent = -1
  src = NormalizeLocalSrc(src)

  ' Leaving the idle logo: release the still image and restore video scaling.
  if st.idleShown = true then
    st.vp.StopClear()
    st.vp.SetViewMode("FillScreenAndCentered")
    st.idleShown = false
  end if

  if IsNetworkSrc(src) then
    cached = CachedPathFor(src)
    if Len(cached) > 0 then
      LedLog("=== Perform6: LED " + st.key + " play cached " + cached + " ===")
      ok = PlayLocalFile(st.vp, cached)
      if ok then st.localName = CacheNameFor(src)
    end if
    if not ok then
      ok = PlayNetworkStream(st, src)
      if ok then LedLog("=== Perform6: LED " + st.key + " streaming " + src + " ===")
      StartCacheDownload(st, src, msgPort, states)
    end if
  else
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
  end if
End Sub

Sub ApplyNativePlayback(st as Object, payload as Object, msgPort as Object, states as Object)
  if type(st) <> "roAssociativeArray" then return
  if type(st.vp) <> "roVideoPlayer" then return

  src = PayloadString(payload, "src")
  fallbackSrc = PayloadString(payload, "fallbackSrc")
  if not IsPlayableNativeSrc(src) then
    src = fallbackSrc
  end if
  if not IsPlayableNativeSrc(src) then
    ' Nothing playable yet — hold the current frame instead of going black.
    LedLog("=== Perform6: LED " + st.key + " no playable src ===")
    return
  end if

  st.loopMode = PayloadBool(payload, "loop", true)
  st.paused = PayloadBool(payload, "paused", false)
  restartNonce = PayloadInt(payload, "restartNonce", 0)
  forceRestart = restartNonce <> st.nonce
  st.nonce = restartNonce
  st.wantUrl = src

  ' Same clip, no restart requested: transport-only update, no reload.
  if src = st.playingUrl and not forceRestart then
    st.vp.SetLoopMode(st.loopMode)
    ApplyLedVolume(st, payload)
    ApplyLedPauseState(st)
    return
  end if

  if forceRestart and src = st.playingUrl then
    ' Restart must rewind: reloading the same file is the only reliable seek.
    ' StopClear fires MediaEnded — suppress it briefly so Full Program stays open.
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
End Sub

' Packaged led-idle.png (or optional led-idle.mp4 override) loops on the LED
' until the first backend / touch video arrives — avoids "No signal".
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

  ' Full-screen 16:9 splash (3840x2160) — Fill keeps edges sharp on 1080p and 4K.
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
  ready.type = msgType
  ready.role = role
  html.PostJSMessage(ready)
End Sub

Sub EnableDiagnosticWebServer()
  nc = CreateObject("roNetworkConfiguration", 0)
  if type(nc) <> "roNetworkConfiguration" then
    nc = CreateObject("roNetworkConfiguration", 1)
  end if
  if type(nc) <> "roNetworkConfiguration" then
    return
  end if

  dws = CreateObject("roAssociativeArray")
  if type(dws) <> "roAssociativeArray" then
    return
  end if
  dws.port = "80"
  nc.SetupDWS(dws)
  SafePrint("=== Perform6: DWS configured (no Apply) ===")
End Sub

Function CollectDeviceIdentity() as Object
  info = CreateObject("roAssociativeArray")
  info.serial = ""
  info.model = ""
  info.fw = ""
  info.mac = ""

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
      end if
    end if
    if Len(info.mac) > 0 then
      exit while
    end if
    iface = iface + 1
  end while

  if Len(info.mac) > 0 then
    SafePrint("=== Perform6: mac=" + info.mac + " ===")
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

  SafePrint("=== Perform6: unknown model — single-output fallback ===")
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
    return
  end if

  manufacturer = "unknown"
  monitorName = "unknown"
  if type(edid.manufacturer) = "roString" then manufacturer = edid.manufacturer
  if type(edid.monitor_name) = "roString" then monitorName = edid.monitor_name
  SafePrint("=== Perform6: " + hdmiName + " EDID " + manufacturer + " / " + monitorName + " ===")
End Sub

Function VideoModeMatches(actualMode as Dynamic, expectedMode as String) as Boolean
  if type(actualMode) <> "roString" then
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
  if Instr(1, expected, ":fullres") > 0 and Instr(1, actual, ":fullres") = 0 then
    return false
  end if

  baseEnd = Instr(1, expected, ":")
  if baseEnd > 0 then
    expectedBase = Left(expected, baseEnd - 1)
  else
    expectedBase = expected
  end if
  return Instr(1, actual, expectedBase) = 1
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
  if type(entry.display_x) <> "roInt" and type(entry.display_x) <> "Integer" and type(entry.display_x) <> "Float" then
    return false
  end if
  if Int(entry.display_x) <> displayX then
    return false
  end if
  if type(entry.display_y) <> "roInt" and type(entry.display_y) <> "Integer" and type(entry.display_y) <> "Float" then
    return false
  end if
  if Int(entry.display_y) <> 0 then
    return false
  end if
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
    SafePrint("=== Perform6: HD226 single-output — skip SetScreenModes ===")
    return false
  end if

  sm = vm.GetScreenModes()
  if type(sm) <> "roArray" or sm.Count() < 2 then
    SafePrint("=== Perform6: GetScreenModes unavailable — keep default output ===")
    return false
  end if

  ' Hard-locked mode. No :preferred and no auto — those let a display fall back
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
    SafePrint("=== Perform6: FATAL no roMessagePort ===")
    while true
      Sleep(10000)
    end while
  end if

  AttachStorageHotplug(msgPort)

  vm = CreateObject("roVideoMode")
  if type(vm) = "roVideoMode" then
    rebooting = ApplyMultiScreenModes(vm, profile, displayMode)
    if rebooting then
      ' SetScreenModes triggers reboot — wait; do not create HtmlWidget yet.
      SafePrint("=== Perform6: waiting for multi-screen reboot ===")
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
  ledStates = CreateObject("roArray", 4, true)
  ledState = invalid
  led2State = invalid
  led3State = invalid
  ledStates.Push(CreatePrefetchWorker())

  if profile = "XT2145" and multiOutput then
    SafePrint("=== Perform6: XT React HDMI-1 + native video HDMI-2 ===")
    touchRect = CreateObject("roRectangle", 0, 0, 1920, 1080)
    ledRect = CreateObject("roRectangle", 1920, 0, 1920, 1080)
    if type(touchRect) <> "roRectangle" or type(ledRect) <> "roRectangle" then
      SafePrint("=== Perform6: FATAL no XT output rectangles ===")
      while true
        Sleep(10000)
      end while
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
      SafePrint("=== Perform6: FATAL HDMI-1 touch HtmlWidget create failed ===")
      while true
        Sleep(10000)
      end while
    end if

    EnableJsObjectsSafe(htmlTouch)
    ' XT HDMI-1 is a touch UI only. All programme audio belongs to HDMI-2.
    RoutePlayerAudio(htmlTouch, "none")
    SafePrint("=== Perform6: Show HDMI-1 touch HtmlWidget ===")
    htmlTouch.Show()
    SetCacheNotifyHtml(ledStates, htmlTouch)

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
      SafePrint("=== Perform6: FATAL no XC output rectangles ===")
      while true
        Sleep(10000)
      end while
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
      SafePrint("=== Perform6: FATAL HDMI-1 primary HtmlWidget create failed ===")
      while true
        Sleep(10000)
      end while
    end if

    EnableJsObjectsSafe(htmlPrimary)
    ' XC HDMI-1 is also a programme display, so its HTML video owns HDMI-1 audio.
    RoutePlayerAudio(htmlPrimary, "hdmi-1")
    SafePrint("=== Perform6: Show HDMI-1 primary HtmlWidget ===")
    htmlPrimary.Show()
    SetCacheNotifyHtml(ledStates, htmlPrimary)

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
      SafePrint("=== Perform6: FATAL no roRectangle ===")
      while true
        Sleep(10000)
      end while
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
      SafePrint("=== Perform6: FATAL HtmlWidget create failed on this firmware ===")
      while true
        Sleep(10000)
      end while
    end if

    EnableJsObjectsSafe(html)
    ' HD226 has one physical LED output; route its HTML media to that HDMI.
    RoutePlayerAudio(html, "hdmi")
    SafePrint("=== Perform6: Show HtmlWidget ===")
    html.Show()
    SetCacheNotifyHtml(ledStates, html)
  end if

  EnableDiagnosticWebServer()

  while true
    ev = wait(0, msgPort)
    if type(ev) = "roVideoEvent" then
      ' 8 = MediaEnded — notify touch UI for non-looping XT playback.
      if ev.GetInt() = 8 and profile = "XT2145" and type(htmlTouch) = "roHtmlWidget" then
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
          ended.type = "xt-led-ended"
          ended.role = "led"
          htmlTouch.PostJSMessage(ended)
          LedLog("=== Perform6: native LED media ended ===")
        end if
      end if
    else if type(ev) = "roUrlEvent" then
      cacheState = FindStateForUrlEvent(ledStates, ev)
      if type(cacheState) = "roAssociativeArray" then
        HandleCacheEvent(cacheState, ev, msgPort, ledStates)
      end if
    else if type(ev) = "roHtmlWidgetEvent" then
      data = ev.GetData()
      if type(data) = "roAssociativeArray" then
        reason = ""
        if type(data.reason) = "roString" then
          reason = data.reason
        end if
        if reason = "message" then
          payload = data.message
          if type(payload) = "roAssociativeArray" then
            msgType = PayloadString(payload, "type")
            sender = PayloadString(payload, "role")
            target = PayloadString(payload, "target")
            if msgType = "led-cache-prefetch" then
              HandleLedPrefetch(payload, msgPort, ledStates)
            else if msgType = "led-cache-evict" then
              HandleLedCacheEvict(payload, ledStates)
            else if msgType = "xt-playback" or msgType = "xc-playback" then
              pausedText = "play"
              if PayloadBool(payload, "paused", false) then pausedText = "paused"
              LedLog("=== Perform6: msg " + msgType + " from " + sender + " target " + target + " " + pausedText + " vol " + IntToStr(PayloadInt(payload, "volumePercent", 100)) + " nonce " + IntToStr(PayloadInt(payload, "restartNonce", 0)) + " src " + PayloadString(payload, "src") + " ===")
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
        else if reason = "load-error" then
          msg = ""
          if type(data.message) = "roString" then
            msg = data.message
          end if
          SafePrint("=== Perform6: HTML load-error: " + msg + " ===")
          failedUrl = ""
          if type(data.url) = "roString" then failedUrl = data.url
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
        end if
      end if
    else if type(ev) = "roStorageDetached" then
      HandleStorageDetached(ev)
    end if
  end while
End Sub
