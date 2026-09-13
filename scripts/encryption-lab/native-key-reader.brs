' ISOLATED PROTOTYPE ONLY. Not included by autorun or an OTA package.
' No Main, startup, player, network, registry write, or filesystem operation.
' Caller must already verify signed media metadata and ciphertext identity.
' Returning invalid must deny encrypted playback, never trigger a reboot.

Function P6LabIsHex32(value as Dynamic) as Boolean
  if type(value) <> "roString" and type(value) <> "String" then return false
  if Len(value) <> 32 then return false
  for i = 1 to 32
    if Instr(1, "0123456789abcdef", Mid(value, i, 1)) = 0 then return false
  end for
  return true
End Function

Function P6LabReadPlaybackKey(assetId as String) as Dynamic
  if Len(assetId) < 1 or Len(assetId) > 80 then return invalid
  for i = 1 to Len(assetId)
    if Instr(1, "abcdefghijklmnopqrstuvwxyz0123456789_-", Mid(assetId, i, 1)) = 0 then return invalid
  end for
  section = CreateObject("roRegistrySection", "perform6_media_keys")
  if type(section) <> "roRegistrySection" then return invalid
  name = "asset_" + assetId
  if section.Exists(name) <> true then return invalid
  raw = section.Read(name)
  if Len(raw) = 0 then return invalid
  record = ParseJSON(raw)
  if type(record) <> "roAssociativeArray" then return invalid
  if record.version <> 1 then return invalid
  if record.algorithm <> "AesCtr" then return invalid
  if not P6LabIsHex32(record.keyHex) then return invalid
  if not P6LabIsHex32(record.ivHex) then return invalid
  if Left(record.keyHex, 16) = Right(record.keyHex, 16) then return invalid
  material = CreateObject("roByteArray")
  if type(material) <> "roByteArray" then return invalid
  material.FromHexString(record.keyHex + record.ivHex)
  if material.Count() <> 32 then return invalid
  return material
End Function
