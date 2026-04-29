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
  const riskLabels = {
    high: "высокий",
    medium: "средний",
    low: "низкий",
    safe: "без замечаний"
  };
  const localizeSystemText = (value) =>
    String(value ?? "")
      .replace(/\boverall risk\b/gi, "общий риск")
      .replace(/\bLLM[- ]?анализ\b/gi, "нейросетевой анализ")
      .replace(/\bLLM[- ]?разбор\b/gi, "нейросетевой разбор")
      .replace(/\bLLM\b/g, "нейросетевой разбор")
      .replace(/\bDeepSeek\b/g, "нейросетевой сервис")
      .replace(/\bhigh\b/gi, riskLabels.high)
      .replace(/\bmedium\b/gi, riskLabels.medium)
      .replace(/\blow\b/gi, riskLabels.low)
      .replace(/\bsafe\b/gi, riskLabels.safe);
  const header = ["ID", "Общий риск", "Ручная проверка", "Замечания", "Переписанный текст", "Резюме"];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const delimiter = ";";
  return [
    "\uFEFFsep=;",
    header.join(delimiter),
    ...rows.map((row) =>
      [
        row.request_id,
        riskLabels[row.overall_risk] || row.overall_risk,
        row.manual_review_required ? "да" : "нет",
        row.issues.map((issue) => `${issue.term}: ${riskLabels[issue.risk] || issue.risk}`).join("; "),
        row.rewritten_text,
        localizeSystemText(row.summary)
      ]
        .map(escape)
        .join(delimiter)
    )
  ].join("\n");
}
