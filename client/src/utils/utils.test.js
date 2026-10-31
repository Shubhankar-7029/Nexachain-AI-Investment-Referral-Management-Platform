import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from './csv.js';

test('csv: formula-looking text is neutralised, quotes escaped', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
  for (const bad of ['+1', '-1', '@sum', '\tx']) assert.ok(csvCell(bad).startsWith(`"'`), bad);
  assert.equal(csvCell('Starter Plan'), '"Starter Plan"');
  assert.equal(csvCell(1000), '"1000"');
  assert.equal(csvCell(null), '""');
  assert.equal(toCsv([['a', 'b'], [1, '=x']]), '"a","b"\r\n"1","\'=x"');
});
