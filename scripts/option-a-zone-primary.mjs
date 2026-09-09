/**
 * Option A: zone-primary PostBSMessage; SD resume-only (15s); load-finished resume.
 */
import fs from 'node:fs';

const files = ['autorun-xt2145.brs', 'autorun-xc4055.brs', 'autorun-hd226.brs'];

for (const f of files) {
  let t = fs.readFileSync(`brightsign/${f}`, 'utf8');

  t = t.replace(
    /' LED PRIMARY: SD:\/perform6-led-playback\.json poll → BA PlayFile on-demand\. No boot PostJSMessage\./,
    "' ZONE PRIMARY: PostBSMessage → PlayFile (BA zone). SD resume-only. No boot PostJSMessage.",
  );
  t = t.replace(
    /' LED PRIMARY: SD:\/perform6-led-playback\.json poll → PlayFile\. No boot PostJSMessage\./,
    "' ZONE PRIMARY: PostBSMessage → PlayFile (BA zone). SD resume-only. No boot PostJSMessage.",
  );

  t = t.replace(
    /' --- LED on-demand \(BrightAuthor Connected style\) ------------------------------\r?\n' JS: AssetPool GetPoolFilePath → write SD command \(\+ optional PostBSMessage\)\.\r?\n' Autorun: PlayFile\(\{Filename: SD:\/pool\/…, ProbeString: "mp4"\}\) — no HTTPS stream\.\r?\n' SD bus PRIMARY \(poll ~500ms\)\. Bridge PostBSMessage is best-effort \/ same ApplyNative\.\r?\n' Legacy SD:\/perform6-xt-playback\.json still accepted \(maps to target "led"\)\./,
    `' --- LED Option A (BA zone semantics, no BSN) -----------------------------------
' ZONE PRIMARY: JS PostBSMessage(xt/xc-playback) → ApplyNativePlayback → PlayFile.
' src = JS AssetPool getPath (GetPoolFilePath equivalent). ProbeString for pool.
' SD RESUME-ONLY: perform6-led-playback.json on boot / 15s backup if bridge one-way.
' Legacy SD:/perform6-xt-playback.json still accepted (maps to target "led").`,
  );

  t = t.replace(
    /' BA on-demand SD poll — ~500ms so button→PlayFile feels like a zone switch\./,
    "' SD resume-only backup — zone PostBSMessage is primary; poll must stay slow.",
  );
  t = t.replace(
    /if g\.p6PbPollSpan\.TotalMilliseconds\(\) < 500 then return/,
    'if g.p6PbPollSpan.TotalMilliseconds() < 15000 then return',
  );
  t = t.replace(
    /LedLog\("=== Perform6: SD LED BA on-demand poll 500ms \(bridge optional\) ==="\)/,
    'LedLog("=== Perform6: zone-primary PostBSMessage; SD resume-only 15s ===")',
  );
  t = t.replace(/pbFileTimer\.SetElapsed\(1, 0\)/g, 'pbFileTimer.SetElapsed(15, 0)');

  if (!t.includes('MaybeResumePlaybackFromFile(ledStates, msgPort, "load-finished")')) {
    t = t.replace(
      /else if reason = "load-finished" then\r?\n          htmlLoadFinished = true\r?\n          gLf = GetGlobalAA\(\)\r?\n          gLf\.p6HtmlLoadFinished = true\r?\n          DeleteFile\("SD:\/perform6-html-load-fail"\)\r?\n          SafePrint\("=== Perform6: HTML load-finished ==="\)\r?\n          LedLog\("=== Perform6: HTML load-finished ==="\)/,
      `else if reason = "load-finished" then
          htmlLoadFinished = true
          gLf = GetGlobalAA()
          gLf.p6HtmlLoadFinished = true
          DeleteFile("SD:/perform6-html-load-fail")
          SafePrint("=== Perform6: HTML load-finished ===")
          LedLog("=== Perform6: HTML load-finished ===")
          if profile = "XT2145" or profile = "XC4055" then MaybeResumePlaybackFromFile(ledStates, msgPort, "load-finished")`,
    );
  }

  if (!t.includes('assetName = PayloadString(payload, "assetName")')) {
    t = t.replace(
      /src = PayloadString\(payload, "src"\)\r?\n  fallbackSrc = PayloadString\(payload, "fallbackSrc"\)\r?\n  mediaId = PayloadString\(payload, "mediaVersionId"\)\r?\n  TraceLog\("PLAY\|ApplyNative\|src=" \+ src \+ "\|fb=" \+ fallbackSrc \+ "\|id=" \+ mediaId\)/,
      `src = PayloadString(payload, "src")
  fallbackSrc = PayloadString(payload, "fallbackSrc")
  assetName = PayloadString(payload, "assetName")
  mediaId = PayloadString(payload, "mediaVersionId")
  ' src = JS GetPoolFilePath (AssetPoolFiles.getPath) — BA media path.
  TraceLog("PLAY|ApplyNative|src=" + src + "|asset=" + assetName + "|fb=" + fallbackSrc + "|id=" + mediaId)`,
    );
  }

  fs.writeFileSync(`brightsign/${f}`, t);
  console.log(JSON.stringify({
    file: f,
    zone: t.includes('ZONE PRIMARY'),
    resume15: t.includes('< 15000'),
    timer15: (t.match(/pbFileTimer\.SetElapsed\(15, 0\)/g) || []).length,
    loadResume: t.includes('"load-finished"'),
    assetName: t.includes('assetName = PayloadString'),
    optionA: t.includes('LED Option A'),
  }));
}
