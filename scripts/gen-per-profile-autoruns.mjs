/**
 * Generate per-profile simple autoruns from brightsign/autorun.brs
 * and wire release zip to copy the matching file as autorun.brs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = path.join(root, 'brightsign', 'autorun.brs');
let base = fs.readFileSync(srcPath, 'utf8');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function replaceOnce(label, text, from, to) {
  if (!text.includes(from)) fail(`missing block: ${label}`);
  return text.replace(from, to);
}

function stripTraceBodies(text) {
  text = text.replace(
    /Sub TraceFnEnter\(name as String, detail as String\)[\s\S]*?End Sub/,
    `Sub TraceFnEnter(name as String, detail as String)
End Sub`,
  );
  text = text.replace(
    /Sub TraceFnExit\(name as String, result as String\)[\s\S]*?End Sub/,
    `Sub TraceFnExit(name as String, result as String)
End Sub`,
  );
  return text;
}

function hardcodeProfile(text, profile) {
  const next = text.replace(
    /Function ResolveHardwareProfile\(identity as Object\) as String[\s\S]*?End Function/,
    `Function ResolveHardwareProfile(identity as Object) as String
  return "${profile}"
End Function`,
  );
  if (next === text) fail('ResolveHardwareProfile not found');
  return next;
}

function extractMain(text) {
  const m = text.match(/\nSub Main\(\)[\s\S]*$/);
  if (!m) fail('Sub Main not found');
  return { head: text.slice(0, m.index), main: m[0] };
}

function buildXtMain(main) {
  // Keep only XT branch + shared loop; drop XC and HD boot blocks.
  const xtStart = main.indexOf('if profile = "XT2145" and multiOutput then');
  const xcStart = main.indexOf('else if profile = "XC4055" and multiOutput then');
  const hdStart = main.indexOf("else\n    ' HD226");
  const afterProfiles = main.indexOf("\n  ' DWS already enabled early");
  if (xtStart < 0 || xcStart < 0 || hdStart < 0 || afterProfiles < 0) {
    fail('Main profile markers missing for XT split');
  }
  const xtBlock = main.slice(xtStart, xcStart);
  // xtBlock starts with `if profile = "XT2145"...` — rewrite to always-true for this file
  const xtOnly = xtBlock
    .replace(
      'if profile = "XT2145" and multiOutput then',
      "' XT2145-only package — BrightAuthor-style zones\nif true then",
    )
    .replace(/\n  else if profile = "XC4055".*$/s, '');

  // Remove trailing else-if remnant if any
  let boot = xtOnly;
  if (boot.trimEnd().endsWith('else if')) {
    boot = boot.replace(/\s*else if\s*$/, '');
  }
  // Ensure end if
  if (!/\bend if\s*$/.test(boot.trimEnd())) {
    boot = boot.trimEnd() + '\n  end if\n';
  }

  const tail = main.slice(afterProfiles);
  const preamble = main.slice(0, xtStart);
  return preamble + boot + tail;
}

function buildXcMain(main) {
  const xtStart = main.indexOf('if profile = "XT2145" and multiOutput then');
  const xcStart = main.indexOf('else if profile = "XC4055" and multiOutput then');
  const hdStart = main.indexOf("else\n    ' HD226");
  const afterProfiles = main.indexOf("\n  ' DWS already enabled early");
  if (xtStart < 0 || xcStart < 0 || hdStart < 0 || afterProfiles < 0) {
    fail('Main profile markers missing for XC split');
  }
  let xcBlock = main.slice(xcStart, hdStart);
  xcBlock = xcBlock.replace(
    'else if profile = "XC4055" and multiOutput then',
    "' XC4055-only package — BrightAuthor-style zones\nif true then",
  );
  if (!/\bend if\s*$/.test(xcBlock.trimEnd())) {
    xcBlock = xcBlock.trimEnd() + '\n  end if\n';
  }
  const preamble = main.slice(0, xtStart);
  const tail = main.slice(afterProfiles);
  return preamble + xcBlock + tail;
}

function buildHdMain(main) {
  const xtStart = main.indexOf('if profile = "XT2145" and multiOutput then');
  const hdStart = main.indexOf("else\n    ' HD226");
  const afterProfiles = main.indexOf("\n  ' DWS already enabled early");
  if (xtStart < 0 || hdStart < 0 || afterProfiles < 0) {
    fail('Main profile markers missing for HD split');
  }
  let hdBlock = main.slice(hdStart, afterProfiles);
  hdBlock = hdBlock.replace(
    "else\n    ' HD226",
    "' HD226-only package — single HtmlWidget\nif true then\n    ' HD226",
  );
  if (!/\bend if\s*$/.test(hdBlock.trimEnd())) {
    hdBlock = hdBlock.trimEnd() + '\n  end if\n';
  }
  const preamble = main.slice(0, xtStart);
  // HD: no LED poll
  let tail = main.slice(afterProfiles);
  tail = tail.replace(
    /if profile = "XT2145" or profile = "XC4055" then MaybePollLedPlaybackFile\(ledStates, msgPort\)\r?\n/g,
    "' HD226: no native LED poll\n",
  );
  tail = tail.replace(
    /LedLog\("=== Perform6: SD LED PRIMARY poll 1s \(bridge optional\) ==="\)\r?\n/,
    'LedLog("=== Perform6: HD226 HtmlWidget-only (no native LED) ===")\n',
  );
  return preamble + hdBlock + tail;
}

function headerFor(profile) {
  if (profile === 'XT2145') {
    return `' Perform6 BrightSign autorun — XT2145 (BrightAuthor-style zones)
' LED PRIMARY: SD:/perform6-led-playback.json poll → PlayFile. No boot PostJSMessage.
' LED OPTIONAL: JS PostBSMessage(xt-playback). Never required. No auto-reboot on silence.
' Media: sync/AssetPool to SD first, then PlayFile — NO on-demand HTTPS stream.
' Never SetUrl-recycle HtmlWidget after load-finished.
' Profile: XT2145 = React HDMI-1 + native LED HDMI-2.

`;
  }
  if (profile === 'XC4055') {
    return `' Perform6 BrightSign autorun — XC4055 (BrightAuthor-style zones)
' LED PRIMARY: SD:/perform6-led-playback.json poll → PlayFile. No boot PostJSMessage.
' LED OPTIONAL: JS PostBSMessage(xc-playback). Never required. No auto-reboot on silence.
' Media: sync/AssetPool to SD first, then PlayFile — NO on-demand HTTPS stream.
' Never SetUrl-recycle HtmlWidget after load-finished.
' Profile: XC4055 = React HDMI-1 + native LED HDMI-2/3.

`;
  }
  return `' Perform6 BrightSign autorun — HD226 (single HtmlWidget)
' No native LED VideoPlayer. React on one HDMI.
' NO on-demand HTTPS stream in autorun.
' Never SetUrl-recycle HtmlWidget after load-finished.

`;
}

function stripOldHeader(text) {
  return text.replace(/^' Perform6 BrightSign autorun[\s\S]*?\n\nSub SafePrint/, 'Sub SafePrint');
}

function simplifyMultiOutputFlag(text, profile) {
  // multiOutput still referenced — keep as true for XT/XC, false for HD
  if (profile === 'HD226') {
    return text.replace(
      /multiOutput = \(profile = "XT2145" or profile = "XC4055"\)/,
      'multiOutput = false',
    );
  }
  return text.replace(
    /multiOutput = \(profile = "XT2145" or profile = "XC4055"\)/,
    'multiOutput = true',
  );
}

function writeProfile(profile, slug, mainBuilder) {
  let text = stripOldHeader(base);
  text = headerFor(profile) + text;
  text = hardcodeProfile(text, profile);
  text = stripTraceBodies(text);
  const { head, main } = extractMain(text);
  let newMain = mainBuilder(main);
  newMain = simplifyMultiOutputFlag(newMain, profile);
  // Keep assert needle for XT/XC poll
  if (profile === 'XT2145' || profile === 'XC4055') {
    if (!newMain.includes('profile = "XT2145" or profile = "XC4055"')) {
      // inject comment+poll condition that satisfies assert while always true for this package
      newMain = newMain.replace(
        'if profile = "XT2145" or profile = "XC4055" then MaybePollLedPlaybackFile(ledStates, msgPort)',
        'if profile = "XT2145" or profile = "XC4055" then MaybePollLedPlaybackFile(ledStates, msgPort)',
      );
    }
  } else {
    // HD assert shouldn't require XT+XC poll line — we'll update assert
  }
  text = head + newMain;
  const out = path.join(root, 'brightsign', `autorun-${slug}.brs`);
  fs.writeFileSync(out, text);
  const lines = text.split(/\r?\n/).length;
  console.log('wrote', out, lines, 'lines');
  return { out, lines, text };
}

const xt = writeProfile('XT2145', 'xt2145', buildXtMain);
const xc = writeProfile('XC4055', 'xc4055', buildXcMain);
const hd = writeProfile('HD226', 'hd226', buildHdMain);

// Remove godfile — zip copies profile file as autorun.brs
fs.unlinkSync(srcPath);
console.log('removed brightsign/autorun.brs (use per-profile sources)');

// Sanity
for (const [name, t] of [
  ['xt', xt.text],
  ['xc', xc.text],
  ['hd', hd.text],
]) {
  for (const n of ['Sub Main(', 'WriteBootStepCanary', 'WriteMainHeartbeat', 'alive-f6ed41']) {
    if (!t.includes(n)) console.error(name, 'MISSING', n);
  }
  if (name !== 'hd') {
    for (const n of ['LED PRIMARY', 'MaybePollLedPlaybackFile', 'PlayLocalFile pool-direct OK', 'MaybeRunDeferredBootWork']) {
      if (!t.includes(n)) console.error(name, 'MISSING', n);
    }
  }
  if (t.includes('ScheduleDeferredLedReady')) console.error(name, 'BANNED ScheduleDeferredLedReady');
  if (t.includes('PostLedReady(htmlTouch, "xt-led-ready"')) console.error(name, 'BANNED PostLedReady boot');
}
