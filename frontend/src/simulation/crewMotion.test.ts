import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseMotionMode, idleMicroGesture, smoothMotionWeight } from './crewMotion.ts';

test('visual FSM distinguishes waiting, walking, working and incident reactions', () => {
  assert.equal(chooseMotionMode('idle', false, false, false), 'idle');
  assert.equal(chooseMotionMode('assign', true, false, false), 'work');
  assert.equal(chooseMotionMode('carry', true, true, false), 'walk');
  assert.equal(chooseMotionMode('repair', true, false, false), 'react');
  assert.equal(chooseMotionMode('scan', true, false, false), 'react');
  assert.equal(chooseMotionMode('inspect', true, false, true), 'still');
  assert.equal(chooseMotionMode('repair', false, false, false), 'idle'); // pausa congela o trabalho
});

test('motion weights crossfade smoothly without snapping or FPS dependence', () => {
  let value = 0;
  for (let i = 0; i < 20; i++) {
    const next = smoothMotionWeight(value, 1, .016);
    assert.ok(next > value && next < 1);
    value = next;
  }
  assert.ok(Math.abs(smoothMotionWeight(0, 1, .32) - value) < 1e-10);
  assert.equal(smoothMotionWeight(.6, 1, 0), .6);
  assert.ok(smoothMotionWeight(value, 0, .016) < value);
});

test('each monster has deterministic, bounded, visibly different waiting gestures', () => {
  const ids = ['coordinator', 'runner', 'scout', 'fixer', 'trace'] as const;
  const gestures = ids.map(id => idleMicroGesture(id, 5));
  assert.notDeepEqual(gestures[0], gestures[1]);
  assert.deepEqual(gestures[0], idleMicroGesture('coordinator', 5));
  for (const item of gestures) {
    assert.ok(Math.abs(item.glance) < .31);
    assert.ok(Math.abs(item.sway) <= .025);
    assert.ok(item.wave >= 0 && item.wave <= .22);
    assert.ok(item.toe >= 0 && item.toe <= .16);
  }
});
