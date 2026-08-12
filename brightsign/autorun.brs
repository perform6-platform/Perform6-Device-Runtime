' Perform6 platform startup — hardened for mixed BrightSignOS (Series 5/6)
' Deploy: copy this file + index.html + assets/ to SD card ROOT (not a subfolder).
' BrightSign looks for autorun.brs at the storage root.
'
' Design goals:
' - Never call methods on invalid objects (avoids ERR LED x10 script crash)
' - EnableZoneSupport + auto video mode before HtmlWidget
' - Dual HtmlWidget create paths (config AA, then classic SetUrl)
' - Optional touch only; skip EnableCursor (HTML mouse_enabled is enough)
' - Best-effort DWS on :80 for browser debugging without serial

Sub EnableDiagnosticWebServer()
  nc = CreateObject("roNetworkConfiguration", 0)
  if type(nc) <> "roNetworkConfiguration" then
    nc = CreateObject("roNetworkConfiguration", 1)
  end if

  if type(nc) = "roNetworkConfiguration" then
    dws = {
      port: "80"
      password: ""
    }
    nc.SetupDWS(dws)
    nc.Apply()
  end if
End Sub

Sub Main()
  print "=== Perform6: autorun start ==="
  Sleep(2000)

  EnableZoneSupport(1)

  EnableDiagnosticWebServer()

  msgPort = CreateObject("roMessagePort")
  if type(msgPort) <> "roMessagePort" then
    print "=== Perform6: FATAL — no roMessagePort ==="
    HangForever()
  end if

  InitTouchSafe()

  vm = CreateObject("roVideoMode")
  if type(vm) <> "roVideoMode" then
    print "=== Perform6: FATAL — no roVideoMode ==="
    HangForever()
  end if

  ' Let HDMI/EDID settle on a real mode before sizing the widget
  vm.SetMode("auto")
  Sleep(1000)

  size = GetVideoSize(vm)
  width = size.width
  height = size.height
  print "=== Perform6: resolution "; width; "x"; height

  rect = CreateObject("roRectangle", 0, 0, width, height)
  if type(rect) <> "roRectangle" then
    print "=== Perform6: FATAL — no roRectangle ==="
    HangForever()
  end if

  html = CreateHtmlWidgetSafe(rect, msgPort)
  if type(html) <> "roHtmlWidget" then
    print "=== Perform6: FATAL — HtmlWidget create failed ==="
    HangForever()
  end if

  EnableDiagnosticWebServer()

  print "=== Perform6: Show() HtmlWidget ==="
  html.Show()

  ' Stay alive; print HTML load events for serial / console debugging
  while true
    ev = wait(0, msgPort)
    if type(ev) = "roHtmlWidgetEvent" then
      data = ev.GetData()
      if type(data) = "roAssociativeArray" and type(data.reason) = "roString" then
        if data.reason = "load-error" then
          print "=== Perform6: HTML load-error: "; data.message
        else if data.reason = "load-finished" then
          print "=== Perform6: HTML load-finished ==="
        end if
      end if
    end if
  end while
End Sub

Sub HangForever()
  while true
    Sleep(10000)
  end while
End Sub

' Touch hardware is optional (e.g. HD226 display-only). Never call EnableCursor —
' that method has caused issues on builds without a cursor bitmap / mouse.
Sub InitTouchSafe()
  touch = CreateObject("roTouchScreen")
  if type(touch) <> "roTouchScreen" then
    print "=== Perform6: no touch hardware (ok) ==="
    return
  end if
  touch.Enable(true)
  print "=== Perform6: touch enabled ==="
End Sub

Function GetVideoSize(vm as Object) as Object
  size = CreateObject("roAssociativeArray")
  size.width = 1920
  size.height = 1080

  i = 0
  while i < 12
    w = vm.GetResX()
    h = vm.GetResY()
    if w > 0 and h > 0 then
      size.width = w
      size.height = h
      return size
    end if
    print "=== Perform6: waiting for video resolution ==="
    Sleep(500)
    i = i + 1
  end while

  print "=== Perform6: using fallback 1920x1080 ==="
  return size
End Function

' Classic SetUrl first (widest OS support, avoids 3-arg ctor aborts on older BOS).
' Config AA second (enables brightsign_js_objects when available).
Function CreateHtmlWidgetSafe(rect as Object, msgPort as Object) as Object
  url$ = "file:///index.html"

  html = CreateHtmlWidgetClassic(rect, msgPort, url$)
  if type(html) = "roHtmlWidget" then
    print "=== Perform6: HtmlWidget path = classic ==="
    return html
  end if

  print "=== Perform6: classic failed — trying config AA ==="
  html = CreateHtmlWidgetConfig(rect, msgPort, url$)
  if type(html) = "roHtmlWidget" then
    print "=== Perform6: HtmlWidget path = config AA ==="
    return html
  end if

  return invalid
End Function

Function CreateHtmlWidgetConfig(rect as Object, msgPort as Object, url$ as String) as Object
  config = CreateObject("roAssociativeArray")
  if type(config) <> "roAssociativeArray" then
    return invalid
  end if

  config.url = url$
  config.port = msgPort
  config.mouse_enabled = true
  config.brightsign_js_objects_enabled = true

  html = CreateObject("roHtmlWidget", rect, config)
  if type(html) = "roHtmlWidget" then
    return html
  end if
  return invalid
End Function

Function CreateHtmlWidgetClassic(rect as Object, msgPort as Object, url$ as String) as Object
  html = CreateObject("roHtmlWidget", rect)
  if type(html) <> "roHtmlWidget" then
    return invalid
  end if

  html.SetPort(msgPort)
  html.EnableSecurity(false)
  html.EnableJavascript(true)
  html.EnableMouseEvents(true)
  html.SetUrl(url$)
  return html
End Function

' Helps debugging via http://<player-ip>/ without a serial cable.
Sub EnableDiagnosticWebServer()
  nc = CreateObject("roNetworkConfiguration", 0)
  if type(nc) <> "roNetworkConfiguration" then
    nc = CreateObject("roNetworkConfiguration", 1)
  end if
  if type(nc) <> "roNetworkConfiguration" then
    print "=== Perform6: DWS skipped (no network iface) ==="
    return
  end if

  dws = CreateObject("roAssociativeArray")
  if type(dws) <> "roAssociativeArray" then
    return
  end if

  dws.port = "80"
  ok = nc.SetupDWS(dws)
  nc.Apply()
  print "=== Perform6: DWS setup port 80 (ok="; ok; ") ==="
End Sub
