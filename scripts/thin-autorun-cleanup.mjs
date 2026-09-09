import fs from 'node:fs';

const p = 'brightsign/autorun.brs';
let t = fs.readFileSync(p, 'utf8');

function rem(name, kind) {
  const lines = t.split(/\r?\n/);
  const re = new RegExp(`^${kind} ${name}\\(`);
  let s = -1;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      s = i;
      break;
    }
  }
  if (s < 0) {
    console.warn('miss', name);
    return;
  }
  let d = 0;
  let e = -1;
  for (let i = s; i < lines.length; i++) {
    if (/^(Sub|Function) /.test(lines[i])) d++;
    if (/^End Sub\b/.test(lines[i]) || /^End Function\b/.test(lines[i])) {
      d--;
      if (d === 0) {
        e = i;
        break;
      }
    }
  }
  if (e < 0) {
    console.warn('noclose', name);
    return;
  }
  console.log('rm', name, e - s + 1);
  lines.splice(s, e - s + 1);
  t = lines.join('\n');
}

for (const [n, k] of [
  ['ByteSizeToStr', 'Function'],
  ['ByteSizeEq', 'Function'],
  ['ByteSizeGt', 'Function'],
  ['ByteSizeGe', 'Function'],
  ['ByteSizeLt', 'Function'],
  ['ByteSizeSub', 'Function'],
  ['LegacyCacheDir', 'Function'],
  ['SdFreeMegabytes', 'Function'],
]) {
  rem(n, k);
}

t = t.replace(/\n' Abort zombie[\s\S]*?OS resumes from file length\.\n+/g, '\n');
t = t.replace(/\n' Range ignored[\s\S]*?corrupt partial\)\.\n+/g, '\n');
t = t.replace(/\n' BrightSign docs: use GetFreeInMegabytes[\s\S]*?\n+/g, '\n');
t = t.replace(/\n{4,}/g, '\n\n');
fs.writeFileSync(p, t);
console.log('lines', t.split(/\n/).length);
