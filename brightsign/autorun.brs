' Perform6 platform startup — same file for all tenants/devices
' Deploy: copy this file + dist/ contents to player storage root

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
  Sleep(3000)

  EnableDiagnosticWebServer()

  msgPort = CreateObject("roMessagePort")

  touch = CreateObject("roTouchScreen")
  if type(touch) = "roTouchScreen" then
    touch.EnableCursor(true)
  end if

  vm = CreateObject("roVideoMode")
  rect = CreateObject("roRectangle", 0, 0, vm.GetResX(), vm.GetResY())

  config = {
    url: "file:///index.html"
    port: msgPort
    mouse_enabled: true
    brightsign_js_objects_enabled: true
  }

  html = CreateObject("roHtmlWidget", rect, config)
  html.Show()

  while true
    wait(0, msgPort)
  end while
End Sub
