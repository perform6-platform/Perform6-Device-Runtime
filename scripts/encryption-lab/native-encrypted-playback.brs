' Isolated native encrypted-media playback primitive.
' No Main and no production caller. This must remain outside the boot path until
' the exact packaged candidate passes the release gate and receives approval.

Function P6LabEncryptedMediaPath(assetId as String) as String
  if Len(assetId) < 1 or Len(assetId) > 80 then return ""
  for i = 1 to Len(assetId)
    if Instr(1, "abcdefghijklmnopqrstuvwxyz0123456789_-", Mid(assetId, i, 1)) = 0 then return ""
  end for
  return "SD:/perform6-encrypted-media/" + assetId + ".p6enc"
End Function

' Returns a fixed, secret-free result. It never logs or returns key material.
' Missing key, invalid asset ID, wrong path, or native rejection all fail closed.
Function P6LabPlayEncryptedAsset(vp as Object, assetId as String, requestedPath as String) as Object
  result = CreateObject("roAssociativeArray")
  result.ok = false
  result.assetId = assetId
  result.state = "rejected"

  if type(vp) <> "roVideoPlayer" then
    result.state = "no-video-player"
    return result
  end if

  expectedPath = P6LabEncryptedMediaPath(assetId)
  if Len(expectedPath) = 0 or requestedPath <> expectedPath then
    result.state = "invalid-reference"
    return result
  end if

  material = P6LabReadPlaybackKey(assetId)
  if type(material) <> "roByteArray" or material.Count() <> 32 then
    result.state = "key-unavailable"
    return result
  end if

  params = CreateObject("roAssociativeArray")
  params.Filename = expectedPath
  params.EncryptionAlgorithm = "AesCtr"
  params.EncryptionKey = material
  played = vp.PlayFile(params)

  ' Drop references immediately. The registry remains the offline source.
  params = invalid
  material = invalid
  if played = true then
    result.ok = true
    result.state = "started-encrypted"
  else
    result.state = "native-play-rejected"
  end if
  return result
End Function
