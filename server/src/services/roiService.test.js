const test = require('node:test');
const assert = require('node:assert/strict');
const { utcDayBounds, roiWindow } = require('./roiService');

test('utcDayBounds returns midnight UTC and next midnight', () => {
  const { start, end } = utcDayBounds(new Date('2026-10-28T17:26:57.000Z'));
  assert.equal(start.toISOString(), '2026-10-28T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-10-29T00:00:00.000Z');
});

test('roiWindow: a 10-day plan covers exactly 10 UTC days, whatever the time of day', () => {
  for (const startIso of ['2026-10-28T00:00:00.000Z', '2026-10-28T18:30:00.000Z', '2026-10-28T23:59:59.000Z']) {
    const startDate = new Date(startIso);
    const w = roiWindow({ startDate, endDate: new Date(startDate.getTime() + 10 * 86400000) });
    assert.equal(w.firstDay.toISOString(), '2026-10-28T00:00:00.000Z');
    assert.equal((w.endExclusive - w.firstDay) / 86400000, 10);
  }
});
