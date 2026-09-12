' Regression fixture reduced from the field-failed XT2145 1.5.33 autorun.
' JsonEscape was called during boot but was never defined.
Sub WriteSdEncryptionStatus(state as String, detail as String)
  q = Chr(34)
  json = "{" + q + "state" + q + ":" + q + JsonEscape(state) + q + "," + _
    q + "detail" + q + ":" + q + JsonEscape(detail) + q + "}"
  WriteAsciiFile("SD:/perform6-encryption-status.json", json)
End Sub
