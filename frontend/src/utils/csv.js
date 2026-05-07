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

const SOURCE_ID_COLUMNS = [
  "ID объявления",
  "№ объявления",
  "ID объявления (серверный)",
  "ID объявления (локальный)",
  "ID кампании",
  "ID кампании (серверный)",
  "ID кампании (локальный)",
  "ID группы",
  "id объявления",
  "id кампании",
  "id группы",
  "ID",
  "id"
];

function sourceValue(source = {}, variants = []) {
  const entries = Object.entries(source);
  for (const variant of variants) {
    const found = entries.find(([key]) => String(key).trim().toLowerCase() === String(variant).trim().toLowerCase());
    if (found && String(found[1] ?? "").trim()) return String(found[1]).trim();
  }
  return "";
}

function displayId(row, sourceLookup = new Map()) {
  const requestId = String(row?.request_id || "");
  if (requestId && !/^row-\d+$/i.test(requestId)) return requestId;
  const sourceRow = sourceLookup.get(requestId);
  return sourceValue(sourceRow?.source, SOURCE_ID_COLUMNS) || requestId;
}

export function toCsv(rows, sourceRows = []) {
  const sourceLookup = new Map(sourceRows.map((row) => [row.request_id, row]));
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
  const uniqueIssues = (issues = []) => {
    const map = new Map();
    for (const issue of issues) {
      const key = `${issue.normalized || issue.term.toLowerCase()}|${issue.category || ""}`;
      if (!map.has(key)) map.set(key, issue);
    }
    return [...map.values()];
  };
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const delimiter = ";";
  return [
    "\uFEFFsep=;",
    header.join(delimiter),
    ...rows.map((row) =>
      [
        displayId(row, sourceLookup),
        riskLabels[row.overall_risk] || row.overall_risk,
        row.manual_review_required ? "да" : "нет",
        uniqueIssues(row.issues)
          .map((issue) => {
            const sources = issue.sources?.length ? `, источники: ${issue.sources.join("; ")}` : "";
            return `${issue.term}: ${riskLabels[issue.risk] || issue.risk}${sources}`;
          })
          .join("; "),
        row.rewritten_text,
        localizeSystemText(row.summary)
      ]
        .map(escape)
        .join(delimiter)
    )
  ].join("\n");
}

function encodeUtf16LeWithBom(text) {
  const normalized = String(text ?? "").replace(/^\uFEFF/, "");
  const bytes = new Uint8Array(2 + normalized.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    bytes[2 + index * 2] = code & 0xff;
    bytes[3 + index * 2] = code >> 8;
  }
  return bytes;
}

export function toExcelCsvBlob(rows, sourceRows = []) {
  return new Blob([encodeUtf16LeWithBom(toCsv(rows, sourceRows))], { type: "text/csv;charset=utf-16le" });
}
