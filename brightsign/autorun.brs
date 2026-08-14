' Perform6 BrightSign autorun — multi-HDMI aware bootstrap
' Profiles: XT2145 (HDMI-1 touch + HDMI-2 LED), XC4055 (HDMI-1/2/3 LEDs), HD226 (single)
' Reads perform6-profile.txt from SD root when present; else uses roDeviceInfo model.
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

Function BuildAppUrl(basePath as String, identity as Object, profile as String) as String
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
  if type(entry.video_mode) = "roString" then
    if Instr(1, LCase(entry.video_mode), LCase(videoMode)) = 0 then
      return false
    end if
  end if
  if type(entry.display_x) = "roInt" or type(entry.display_x) = "Integer" or type(entry.display_x) = "Float" then
    if Int(entry.display_x) <> displayX then
      return false
    end if
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
Function ApplyMultiScreenModes(vm as Object, profile as String) as Boolean
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

  mode1080 = "1920x1080x60p"
  needChange = false

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

    SafePrint("=== Perform6: SetScreenModes XT2145 HDMI-1+HDMI-2 (may reboot) ===")
    vm.SetScreenModes(sm)
    return true
  end if

  if profile = "XC4055" then
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

    SafePrint("=== Perform6: SetScreenModes XC4055 HDMI-1/2/3 (may reboot) ===")
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
    rebooting = ApplyMultiScreenModes(vm, profile)
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
  if type(vm) = "roVideoMode" then
    w = vm.GetResX()
    h = vm.GetResY()
    if w > 0 then width = w
    if h > 0 then height = h
  end if

  ' Safety: ensure canvas spans expected outputs even if GetResX is stale.
  if profile = "XT2145" and width < 3000 then
    width = 3840
  end if
  if profile = "XC4055" and width < 5000 then
    width = 5760
  end if

  SafePrint("=== Perform6: canvas " + StrI(width) + "x" + StrI(height) + " ===")

  rect = CreateObject("roRectangle", 0, 0, width, height)
  if type(rect) <> "roRectangle" then
    SafePrint("=== Perform6: FATAL no roRectangle ===")
    while true
      Sleep(10000)
    end while
  end if

  url = BuildAppUrl("file:///index.html", identity, profile)
  SafePrint("=== Perform6: HtmlWidget url " + url + " ===")
  html = TryCreateHtmlWidget(rect, msgPort, url)

  if type(html) <> "roHtmlWidget" then
    url = BuildAppUrl("file:///SD:/index.html", identity, profile)
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

  EnableDiagnosticWebServer()

  while true
    ev = wait(0, msgPort)
    if type(ev) = "roHtmlWidgetEvent" then
      data = ev.GetData()
      if type(data) = "roAssociativeArray" then
        reason = ""
        if type(data.reason) = "roString" then
          reason = data.reason
        end if
        if reason = "load-error" then
          msg = ""
          if type(data.message) = "roString" then
            msg = data.message
          end if
          SafePrint("=== Perform6: HTML load-error: " + msg + " ===")
          if Left(url, 17) = "file:///index.html" then
            url = BuildAppUrl("file:///SD:/index.html", identity, profile)
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
