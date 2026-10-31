// CSV export that is safe to open in Excel/Sheets: user-controlled text such as a plan name
// starting with = + - @ would otherwise run as a formula (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;
export function csvCell(value) {
  let s = String(value ?? '');
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export const toCsv = (rows) => rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
