' Perform6 BrightSign autorun — multi-HDMI aware bootstrap
' Profiles: XT2145 / XC4055 MULTI = React HtmlWidget on HDMI-1 + native roVideoPlayer on LEDs
'           (BrightAuthor-style: one Chromium, hardware video on secondary outputs).
'           HD226 = one HtmlWidget only.
' Reads perform6-display.txt: MULTI (default) | MULTI_NOFULLRES.
' XT/XC always use BrightAuthor-style MULTI (React on HDMI-1 + native video on LEDs).
' SetScreenModes only when config differs (avoids reboot loop). Do NOT call SetMode.
' Do NOT set trusted_iframes_enabled. Do NOT call roTouchScreen.Enable.

Sub SafePrint(msg as String)
  print msg
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

Function TryCreateVideoPlayer(rect as Object, msgPort as Object, userTag as Integer) as Object
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
  end if
  if type(value) = "roString" or type(value) = "String" then
    return value
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
  end if
  if type(value) = "Boolean" or type(value) = "roBoolean" then
    return value
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
  end if
  if type(value) = "roInt" or type(value) = "Integer" or type(value) = "Float" then
    return Int(value)
  end if
  return fallback
End Function

Function IsPlayableNativeSrc(src as String) as Boolean
  if Len(src) = 0 then
    return false
  end if
  if Left(src, 5) = "blob:" then
    return false
  end if
  return true
End Function

Sub ApplyNativePlayback(vp as Object, payload as Object, lastNonce as Object, nonceKey as String)
  if type(vp) <> "roVideoPlayer" then
    return
  end if

  src = PayloadString(payload, "src")
  fallbackSrc = PayloadString(payload, "fallbackSrc")
  if not IsPlayableNativeSrc(src) then
    src = fallbackSrc
  end if
  if not IsPlayableNativeSrc(src) then
    SafePrint("=== Perform6: native LED skip — no http/file src ===")
    vp.StopClear()
    return
  end if

  loopMode = PayloadBool(payload, "loop", true)
  paused = PayloadBool(payload, "paused", false)
  restartNonce = PayloadInt(payload, "restartNonce", 0)
  forceRestart = false
  if type(lastNonce) = "roAssociativeArray" then
    previous = 0
    if nonceKey = "led" then
      if type(lastNonce.led) = "roInt" or type(lastNonce.led) = "Integer" then previous = lastNonce.led
      if restartNonce <> previous then
        forceRestart = true
        lastNonce.led = restartNonce
      end if
    else if nonceKey = "led2" then
      if type(lastNonce.led2) = "roInt" or type(lastNonce.led2) = "Integer" then previous = lastNonce.led2
      if restartNonce <> previous then
        forceRestart = true
        lastNonce.led2 = restartNonce
      end if
    else if nonceKey = "led3" then
      if type(lastNonce.led3) = "roInt" or type(lastNonce.led3) = "Integer" then previous = lastNonce.led3
      if restartNonce <> previous then
        forceRestart = true
        lastNonce.led3 = restartNonce
      end if
    end if
  end if

  vp.SetLoopMode(loopMode)

  if forceRestart then
    vp.StopClear()
  end if

  ok = vp.PlayFile(src)
  if ok = false then
    aa = CreateObject("roAssociativeArray")
    aa.Filename = src
    ok = vp.PlayFile(aa)
  end if

  if ok = false then
    SafePrint("=== Perform6: native PlayFile failed ===")
    return
  end if

  SafePrint("=== Perform6: native PlayFile ok ===")
  if paused then
    vp.Pause()
  else
    vp.Resume()
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

  identity = CollectDeviceIdentity()
  profile = ResolveHardwareProfile(identity)
  SafePrint("=== Perform6: hardware profile " + profile + " ===")

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
  lastVideoNonce = CreateObject("roAssociativeArray")
  lastVideoNonce.led = 0
  lastVideoNonce.led2 = 0
  lastVideoNonce.led3 = 0

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
    SafePrint("=== Perform6: Show HDMI-1 touch HtmlWidget ===")
    htmlTouch.Show()

    ' Let the first plane settle before enabling the second video port.
    Sleep(1500)
    SafePrint("=== Perform6: HDMI-2 native roVideoPlayer ===")
    videoLed = TryCreateVideoPlayer(ledRect, msgPort, 2)
    if type(videoLed) <> "roVideoPlayer" then
      SafePrint("=== Perform6: ERROR HDMI-2 roVideoPlayer create failed ===")
    else
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
    SafePrint("=== Perform6: Show HDMI-1 primary HtmlWidget ===")
    htmlPrimary.Show()

    Sleep(1500)
    SafePrint("=== Perform6: HDMI-2 native roVideoPlayer ===")
    videoLed2 = TryCreateVideoPlayer(led2Rect, msgPort, 2)
    if type(videoLed2) <> "roVideoPlayer" then
      SafePrint("=== Perform6: ERROR HDMI-2 roVideoPlayer create failed ===")
    else
      PostLedReady(htmlPrimary, "xc-led-ready", "led2")
    end if

    Sleep(1500)
    SafePrint("=== Perform6: HDMI-3 native roVideoPlayer ===")
    videoLed3 = TryCreateVideoPlayer(led3Rect, msgPort, 3)
    if type(videoLed3) <> "roVideoPlayer" then
      SafePrint("=== Perform6: ERROR HDMI-3 roVideoPlayer create failed ===")
    else
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
    SafePrint("=== Perform6: Show HtmlWidget ===")
    html.Show()
  end if

  EnableDiagnosticWebServer()

  while true
    ev = wait(0, msgPort)
    if type(ev) = "roVideoEvent" then
      ' 8 = MediaEnded — notify touch UI for non-looping XT playback.
      if ev.GetInt() = 8 and profile = "XT2145" and type(htmlTouch) = "roHtmlWidget" then
        ended = CreateObject("roAssociativeArray")
        ended.type = "xt-led-ended"
        ended.role = "led"
        htmlTouch.PostJSMessage(ended)
        SafePrint("=== Perform6: native LED media ended ===")
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
            if profile = "XT2145" then
              if sender = "touch" and msgType = "xt-playback" then
                ApplyNativePlayback(videoLed, payload, lastVideoNonce, "led")
              end if
            else if profile = "XC4055" then
              if sender = "primary" and msgType = "xc-playback" then
                if target = "led2" then
                  ApplyNativePlayback(videoLed2, payload, lastVideoNonce, "led2")
                else if target = "led3" then
                  ApplyNativePlayback(videoLed3, payload, lastVideoNonce, "led3")
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
    end if
  end while
End Sub
