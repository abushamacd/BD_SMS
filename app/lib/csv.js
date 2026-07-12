// CSV serialisation.
//
// SMS bodies routinely contain commas, quotes, newlines and Bangla text — all of
// which corrupt a naively joined CSV. Fields are quoted and inner quotes are
// doubled, per RFC 4180.

function escapeField(value) {
  if (value === null || value === undefined) return "";

  const text = String(value);

  // A leading =, +, - or @ makes Excel treat the cell as a formula. Prefix with
  // a quote so a message body can never execute in a merchant's spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;

  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * @param {Array<{key: string, label: string}>} columns
 * @param {Array<object>} rows
 */
export function toCsv(columns, rows) {
  const header = columns.map((column) => escapeField(column.label)).join(",");

  const body = rows.map((row) =>
    columns.map((column) => escapeField(row[column.key])).join(","),
  );

  // \r\n line endings, and a UTF-8 BOM so Excel opens Bangla text correctly
  // instead of mojibake.
  return `\uFEFF${[header, ...body].join("\r\n")}`;
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
