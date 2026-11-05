// Calling minutes: never unlimited, count only calls after the last top-up, and the guard blocks finished admins.
import assert from 'node:assert';
import MinutesService, { describe, allottedMinutes, requireMinutes, MINUTES_EXHAUSTED_MESSAGE } from '../services/minutes_service.js';

// Nothing assigned = 0 minutes (never unlimited)
assert.strictEqual(allottedMinutes({}), 0);
assert.strictEqual(allottedMinutes({ minutesAllotted: '' }), 0);
assert.strictEqual(allottedMinutes({ minutesAllotted: null }), 0);
assert.strictEqual(allottedMinutes({ minutesAllotted: -5 }), 0);
assert.strictEqual(allottedMinutes({ minutesAllotted: '120' }), 120);
assert.strictEqual(describe({}, 0).exhausted, true, 'an admin with no minutes assigned cannot call');
assert.strictEqual(describe({ name: 'x' }, 0).allottedMinutes, 0);

function run(exhausted) {
    const orig = MinutesService.isExhausted;
    MinutesService.isExhausted = async () => exhausted;
    return new Promise((resolve) => {
        const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve({ res: this, next: false }); } };
        requireMinutes({ user: { id: 'u1' } }, res, () => resolve({ res, next: true })).finally(() => { MinutesService.isExhausted = orig; });
    });
}

const blocked = await run(true);
assert.strictEqual(blocked.next, false);
assert.strictEqual(blocked.res.code, 403);
assert.strictEqual(blocked.res.body.code, 'MINUTES_EXHAUSTED');
assert.strictEqual(blocked.res.body.message, MINUTES_EXHAUSTED_MESSAGE);
assert.strictEqual((await run(false)).next, true, 'minutes left = request goes through');

// Top-up maths used by the owner panel: the count restarts at the moment minutes are given,
// so the new allotment is what was left + what is added, and earlier calls are ignored.
const topUp = (given, usedSeconds, add) => Math.round((Math.max(0, given - usedSeconds / 60) + add) * 100) / 100;
assert.strictEqual(topUp(1, 60, 1), 1, '1 given, all used, add 1 -> 1 fresh minute');
assert.strictEqual(topUp(1, 62.4, 1), 1, 'an overshoot is forgiven');
assert.strictEqual(topUp(10, 120, 5), 13, 'unused minutes are kept (8 left + 5)');

const before = describe({ minutesAllotted: 1 }, 120);
assert.strictEqual(before.exhausted, true, '2 min of calls against 1 given = finished');
// Owner adds 1: base = 120s of earlier calls, which no longer count.
const after = describe({ minutesAllotted: 1, minutesBaseSeconds: 120 }, 120);
assert.strictEqual(after.exhausted, false);
assert.strictEqual(after.usedMinutes, 0);
assert.strictEqual(after.remainingMinutes, 1);
// A call of 30s made after the top-up counts, the earlier ones still do not.
const later = describe({ minutesAllotted: 1, minutesBaseSeconds: 120 }, 150);
assert.strictEqual(later.usedSeconds, 30);
assert.strictEqual(later.remainingMinutes, 0.5);
assert.strictEqual(describe({ minutesAllotted: 1, minutesBaseSeconds: 120 }, 180).exhausted, true, 'a full minute after the top-up finishes it');

console.log('minutes.test.js: all passed');
process.exit(0);
