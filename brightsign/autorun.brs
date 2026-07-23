' Perform6 platform startup — same file for all tenants/devices
' Deploy: copy this file + dist/ contents to player storage root

Sub Main()
  Sleep(3000)

  msgPort = CreateObject("roMessagePort")

  touch = CreateObject("roTouchScreen")
  touch.Enable(true)

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
