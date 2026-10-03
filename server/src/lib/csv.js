// RFC 4180 CSV. `columns` = [{ key, header }]. A leading UTF-8 BOM keeps Excel
// happy with the peso sign; \r\n line ends are what spreadsheets expect.
const cell = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows, columns) {
  const head = columns.map((c) => cell(c.header)).join(',')
  const body = rows.map((r) => columns.map((c) => cell(r[c.key])).join(',')).join('\r\n')
  return '﻿' + head + '\r\n' + body + (body ? '\r\n' : '')
}

// Send a report ({ rows, columns, filename }) as CSV. `attachment` toggles the
// download disposition — the token feed serves it inline so Sheets can read it.
export function sendCsv(res, report, { attachment = true } = {}) {
  res.type('text/csv; charset=utf-8')
  if (attachment) res.set('Content-Disposition', `attachment; filename="${report.filename}.csv"`)
  res.send(toCsv(report.rows, report.columns))
}
