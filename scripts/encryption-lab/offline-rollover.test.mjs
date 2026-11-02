import test from 'node:test';
import assert from 'node:assert/strict';
import { rotationDayForInstant } from '../../src/services/scheduleClock.ts';

test('a cached 36-day schedule rolls from day 36 to day 1 on the next civil date', () => {
  const start = '2026-01-01';
  const day36 = new Date('2026-02-05T15:00:00.000Z');
  const day1 = new Date('2026-02-06T15:00:00.000Z');
  assert.equal(rotationDayForInstant(start, day36, 'UTC', 36), 36);
  assert.equal(rotationDayForInstant(start, day1, 'UTC', 36), 1);
});

test('gym local midnight changes the cached day before UTC midnight', () => {
  const start = '2026-01-01';
  const evening = new Date('2026-02-06T03:30:00.000Z');
  assert.equal(rotationDayForInstant(start, evening, 'UTC', 36), 1);
  assert.equal(rotationDayForInstant(start, evening, 'America/New_York', 36), 36);
});

test('offline slot selection uses the recomputed day instead of the first cached clip', () => {
  const items = [
    { day: 36, mediaVersionId: 'day-36' },
    { day: 1, mediaVersionId: 'day-1' },
  ];
  const pick = (rotationDay) => items.find((item) => item.day === rotationDay) ?? items[0];
  const start = '2026-01-01';
  const today = rotationDayForInstant(start, new Date('2026-02-06T15:00:00.000Z'), 'UTC', 36);
  assert.equal(pick(today).mediaVersionId, 'day-1');
  assert.notEqual(pick(today).mediaVersionId, items[0].mediaVersionId);
});
