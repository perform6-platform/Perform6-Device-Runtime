' Perform6 platform startup - crash-safe autorun (ASCII only)
' Docs-compliant: HtmlWidget mouse_enabled (no roTouchScreen.Enable)
' Deploy to SD ROOT: autorun.brs + index.html + assets/

Sub EnableDiagnosticWebServer()
  ' Setup only - avoid Apply() on every boot (causes display/network flash).
  nc = CreateObject("roNetworkConfiguration", 0)
  if type(nc) <> "roNetworkConfiguration" then
    nc = CreateObject("roNetworkConfiguration", 1)
  end if

  if type(nc) = "roNetworkConfiguration" then
    dws = CreateObject("roAssociativeArray")
    dws.port = "80"
    nc.SetupDWS(dws)
    print "=== Perform6: DWS configured (no Apply) ==="
  end if
End Sub

Sub AllowLocalJsObjects(html as Object)
  if type(html) <> "roHtmlWidget" then
    return
  end if
  urls = CreateObject("roAssociativeArray")
  if type(urls) <> "roAssociativeArray" then
    return
  end if
  urls.all = "*"
  html.AllowJavaScriptUrls(urls)
End Sub

Sub Main()
  print "=== Perform6: autorun start ==="

  ' Short settle - long Sleep leaves a black gap after BrightSign splash.
  Sleep(500)

  msgPort = CreateObject("roMessagePort")
  if type(msgPort) <> "roMessagePort" then
    print "=== Perform6: FATAL no roMessagePort ==="
    while true
      Sleep(10000)
    end while
  end if

  vm = CreateObject("roVideoMode")
  if type(vm) <> "roVideoMode" then
    print "=== Perform6: FATAL no roVideoMode ==="
    while true
      Sleep(10000)
    end while
  end if

  ' Do not call SetMode - mode change flashes the HDMI output.
  width = vm.GetResX()
  height = vm.GetResY()
  if width <= 0 then
    width = 1920
  end if
  if height <= 0 then
    height = 1080
  end if
  print "=== Perform6: resolution "; width; "x"; height

  rect = CreateObject("roRectangle", 0, 0, width, height)
  if type(rect) <> "roRectangle" then
    print "=== Perform6: FATAL no roRectangle ==="
    while true
      Sleep(10000)
    end while
  end if

  config = CreateObject("roAssociativeArray")
  config.url = "file:///index.html"
  config.port = msgPort
  config.mouse_enabled = true
  config.brightsign_js_objects_enabled = true
  config.javascript_enabled = true

  html = CreateObject("roHtmlWidget", rect, config)
  if type(html) <> "roHtmlWidget" then
    print "=== Perform6: config HtmlWidget failed - trying classic ==="
    html = CreateObject("roHtmlWidget", rect)
    if type(html) = "roHtmlWidget" then
      html.SetPort(msgPort)
      html.EnableJavascript(true)
      html.EnableMouseEvents(true)
      html.SetUrl("file:///index.html")
    end if
  end if

  if type(html) <> "roHtmlWidget" then
    print "=== Perform6: FATAL HtmlWidget create failed ==="
    while true
      Sleep(10000)
    end while
  end if

  AllowLocalJsObjects(html)

  print "=== Perform6: Show HtmlWidget ==="
  html.Show()

  ' DWS after first paint so Apply-like side effects do not blank the screen first.
  EnableDiagnosticWebServer()

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
