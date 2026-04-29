export function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);

  const [header = [], ...data] = rows;
  const keys = header.map((cell) => cell.trim());
  return data.map((cells) =>
    Object.fromEntries(keys.map((key, index) => [key, (cells[index] || "").trim()]))
  );
}

export function toCsv(rows) {
  const header = ["request_id", "overall_risk", "manual_review_required", "issues", "rewritten_text", "summary"];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    header.join(","),
    ...rows.map((row) =>
      [
        row.request_id,
        row.overall_risk,
        row.manual_review_required,
        row.issues.map((issue) => `${issue.term}:${issue.risk}`).join("; "),
        row.rewritten_text,
        row.summary
      ]
        .map(escape)
        .join(",")
    )
  ].join("\n");
}
