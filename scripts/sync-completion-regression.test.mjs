import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('src/services/syncEngine.ts', 'utf8');

test('sync success is blocked by incomplete cache or failed completion reports', () => {
  assert.match(source, /const hasIncompleteDownloads =/);
  assert.match(source, /expectedDownloads > 0 && cachedCount < expectedDownloads/);
  assert.match(source, /const hasUnreportedCompletions = completeReportFailures > 0/);
  assert.match(
    source,
    /hasIncompleteDownloads \|\| hasUnreportedCompletions[\s\S]*?'FAILED'[\s\S]*?: 'SUCCESS'/,
  );
});

test('the status message exposes completion-report failures for retry diagnostics', () => {
  assert.match(source, /completion report\(s\) failed/);
});
