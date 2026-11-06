import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLive } from './live.ts';
import { advanceNight, clockLabel, NIGHT_END_MINUTE, nightClockStep } from './nightClock.ts';

test('60 game minutes take 10 real minutes at 1x, 5 at 2x and 2.5 at 4x', () => {
  for (const [speed, realMs] of [[1, 600_000], [2, 300_000], [4, 150_000]]) {
    const step = nightClockStep(realMs, speed, 0);
    assert.equal(step.minutes, NIGHT_END_MINUTE);
    assert.equal(step.pendingMs, 0);
  }
});
test('fractional elapsed time carries through pauses and speed changes', () => {
  const first = nightClockStep(2400, 1, 0);
  assert.deepEqual(first, { minutes: 0, pendingMs: 2400 });
  const second = nightClockStep(1900, 4, first.pendingMs);
  assert.deepEqual(second, { minutes: 1, pendingMs: 0 });
  assert.equal(clockLabel(150), '2:30');
  assert.equal(clockLabel(0), '0:00');
});
test('cannot advance the closed night or silently generate orders after minute 60', () => {
  const nearEnd = advanceNight(createLive(2026, 'busy'), 59);
  const done = advanceNight(nearEnd, 500);
  assert.equal(done.minute, 60);
  assert.strictEqual(advanceNight(done, 2), done);
  assert.deepEqual(done, advanceNight(createLive(2026, 'busy'), 60));
});
test('invalid timing input is rejected', () => {
  assert.throws(() => nightClockStep(-1, 1, 0));
  assert.throws(() => nightClockStep(1, 3, 0));
  assert.throws(() => advanceNight(createLive(), -1));
});
