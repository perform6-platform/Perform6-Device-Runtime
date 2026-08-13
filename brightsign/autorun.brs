' Perform6 BrightSign autorun — firmware-tolerant HtmlWidget bootstrap
' Compatible pattern: try modern config AA, then strip unknown keys, then classic APIs.
' Do NOT set trusted_iframes_enabled (breaks OS < 9.1).
' Do NOT call roTouchScreen.Enable (invalid on many OS builds).
' Deploy to SD ROOT: autorun.brs + index.html + assets/

Sub SafePrint(msg as String)
  print msg
End Sub

Function TryCreateHtmlWidget(rect as Object, msgPort as Object, url as String) as Object
  html = invalid

  ' --- Attempt 1: modern config (OS 8.2+ / 9.x) ---
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

  ' --- Attempt 2: minimal config (older builds reject unknown keys) ---
  cfg2 = CreateObject("roAssociativeArray")
  cfg2.url = url
  cfg2.port = msgPort
  cfg2.brightsign_js_objects_enabled = true
  html = CreateObject("roHtmlWidget", rect, cfg2)
  if type(html) = "roHtmlWidget" then
    SafePrint("=== Perform6: HtmlWidget minimal config OK ===")
    return html
  end if

  ' --- Attempt 3: url-only config ---
  cfg3 = CreateObject("roAssociativeArray")
  cfg3.url = url
  html = CreateObject("roHtmlWidget", rect, cfg3)
  if type(html) = "roHtmlWidget" then
    SafePrint("=== Perform6: HtmlWidget url-only config OK ===")
    return html
  end if

  ' --- Attempt 4: classic constructor + method calls (legacy) ---
  html = CreateObject("roHtmlWidget", rect)
  if type(html) = "roHtmlWidget" then
    SafePrint("=== Perform6: HtmlWidget classic constructor OK ===")
    html.SetPort(msgPort)
    html.EnableJavascript(true)
    ' Do not call EnableMouseEvents — missing on some firmwares (runtime &hf4).
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

  ' Prefer local pages only (works on more firmwares than "*").
  urls.all = "local"
  html.AllowJavaScriptUrls(urls)

  ' Also allow all URLs for builds that need "*" with file://
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
  ' SetupDWS only — never Apply() here (display/network flash on many OS builds).
  nc.SetupDWS(dws)
  SafePrint("=== Perform6: DWS configured (no Apply) ===")
End Sub

Sub Main()
  SafePrint("=== Perform6: autorun start ===")

  di = CreateObject("roDeviceInfo")
  if type(di) = "roDeviceInfo" then
    SafePrint("=== Perform6: model=" + di.GetModel() + " fw=" + di.GetVersion() + " ===")
  end if

  Sleep(500)

  msgPort = CreateObject("roMessagePort")
  if type(msgPort) <> "roMessagePort" then
    SafePrint("=== Perform6: FATAL no roMessagePort ===")
    while true
      Sleep(10000)
    end while
  end if

  vm = CreateObject("roVideoMode")
  width = 1920
  height = 1080
  if type(vm) = "roVideoMode" then
    ' Do not call SetMode — HDMI flash on many firmwares.
    w = vm.GetResX()
    h = vm.GetResY()
    if w > 0 then
      width = w
    end if
    if h > 0 then
      height = h
    end if
  end if
  SafePrint("=== Perform6: resolution " + StrI(width) + "x" + StrI(height) + " ===")

  rect = CreateObject("roRectangle", 0, 0, width, height)
  if type(rect) <> "roRectangle" then
    SafePrint("=== Perform6: FATAL no roRectangle ===")
    while true
      Sleep(10000)
    end while
  end if

  ' Primary SD-root URL used by BrightSign HTML apps.
  url = "file:///index.html"
  html = TryCreateHtmlWidget(rect, msgPort, url)

  if type(html) <> "roHtmlWidget" then
    ' Alternate path style used on some OS builds.
    url = "file:///SD:/index.html"
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
          ' One-shot fallback URL if first path failed.
          if url = "file:///index.html" then
            url = "file:///SD:/index.html"
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
