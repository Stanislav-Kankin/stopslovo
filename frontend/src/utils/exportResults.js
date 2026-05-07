import XLSX from "xlsx-js-style";

const RISK_FILL = {
  high: "FDEAEA",
  medium: "FEF6E0",
  low: "E8F2FC",
  safe: "E8F5E8"
};
const RISK_FONT = {
  high: "CC3333",
  medium: "9A6800",
  low: "1A5FA0",
  safe: "2A7A2A"
};

const RISK_LABELS = {
  high: "высокий",
  medium: "средний",
  low: "низкий",
  safe: "без замечаний"
};

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

function localizeSystemText(value) {
  return String(value ?? "")
    .replace(/\boverall risk\b/gi, "общий риск")
    .replace(/\bLLM[- ]?анализ\b/gi, "нейросетевой анализ")
    .replace(/\bLLM[- ]?разбор\b/gi, "нейросетевой разбор")
    .replace(/\bLLM\b/g, "нейросетевой разбор")
    .replace(/\bDeepSeek\b/g, "нейросетевой сервис")
    .replace(/\bhigh\b/gi, RISK_LABELS.high)
    .replace(/\bmedium\b/gi, RISK_LABELS.medium)
    .replace(/\blow\b/gi, RISK_LABELS.low)
    .replace(/\bsafe\b/gi, RISK_LABELS.safe);
}

function issueTerms(issues) {
  return uniqueIssues(issues).map((issue) => issue.term).join(", ");
}

function issueDetails(issues) {
  return uniqueIssues(issues)
    .map((issue) => {
      const replacements = issue.replacements?.length ? `; замены: ${issue.replacements.join(", ")}` : "";
      const sources = issue.sources?.length ? `; источники: ${issue.sources.join("; ")}` : "";
      return `${issue.term} (${RISK_LABELS[issue.risk] || issue.risk}): ${issue.reason}${replacements}${sources}`;
    })
    .join("\n");
}

function uniqueIssues(issues = []) {
  const map = new Map();
  const riskWeight = { high: 4, medium: 3, low: 2, safe: 1 };
  for (const issue of issues) {
    const key = `${issue.normalized || issue.term.toLowerCase()}|${issue.category || ""}`;
    const current = map.get(key);
    if (!current || riskWeight[issue.risk] > riskWeight[current.risk]) {
      map.set(key, { ...issue });
      continue;
    }
    if (current && !current.replacements?.length && issue.replacements?.length) {
      current.replacements = issue.replacements;
    }
  }
  return [...map.values()];
}

function sourceValue(source = {}, variants = []) {
  const entries = Object.entries(source);
  for (const variant of variants) {
    const found = entries.find(([key]) => String(key).trim().toLowerCase() === String(variant).trim().toLowerCase());
    if (found && String(found[1] ?? "").trim()) return String(found[1]).trim();
  }
  return "";
}

function sourceRowsByRequestId(sourceRows = []) {
  return new Map(sourceRows.map((row) => [row.request_id, row]));
}

function displayId(row, sourceLookup = new Map()) {
  const requestId = String(row?.request_id || "");
  if (requestId && !/^row-\d+$/i.test(requestId)) return requestId;
  const sourceRow = sourceLookup.get(requestId);
  return sourceValue(sourceRow?.source, SOURCE_ID_COLUMNS) || requestId;
}

function aggregateByTerm(rows, sourceRows = []) {
  const riskWeight = { high: 4, medium: 3, low: 2, safe: 1 };
  const map = {};
  const sourceLookup = sourceRowsByRequestId(sourceRows);
  for (const row of rows) {
    for (const issue of uniqueIssues(row.issues || [])) {
      const key = issue.normalized || issue.term.toLowerCase();
      if (!map[key]) {
        map[key] = {
          term: issue.term,
          risk: issue.risk,
          replacements: issue.replacements || [],
          sources: issue.sources || [],
          count: 0,
          ads: []
        };
      }
      map[key].count += 1;
      const id = displayId(row, sourceLookup);
      if (id && !map[key].ads.includes(id)) {
        map[key].ads.push(id);
      }
      for (const source of issue.sources || []) {
        if (!map[key].sources.includes(source)) {
          map[key].sources.push(source);
        }
      }
      if (riskWeight[issue.risk] > riskWeight[map[key].risk]) {
        map[key].risk = issue.risk;
      }
      if (!map[key].replacements.length && issue.replacements?.length) {
        map[key].replacements = issue.replacements;
      }
    }
  }
  return Object.values(map).sort((a, b) => riskWeight[b.risk] - riskWeight[a.risk] || b.count - a.count);
}

function sheetFromRows(rows) {
  return XLSX.utils.json_to_sheet(rows);
}

function sheetFromTable(table) {
  return XLSX.utils.aoa_to_sheet(table);
}

function applyResultStyles(worksheet, rows) {
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
  for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIndex });
    if (!worksheet[cellRef]) continue;
    worksheet[cellRef].s = {
      fill: { fgColor: { rgb: "F0F0EC" } },
      font: { bold: true, color: { rgb: "1A1A18" } },
      alignment: { vertical: "top", wrapText: true }
    };
  }
  for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex += 1) {
    const risk = rows[rowIndex - 1]?.overall_risk || "safe";
    const fill = RISK_FILL[risk] || RISK_FILL.safe;
    const font = RISK_FONT[risk] || RISK_FONT.safe;
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      if (!worksheet[cellRef]) continue;
      worksheet[cellRef].s = {
        fill: { fgColor: { rgb: fill } },
        font: { color: { rgb: font } },
        alignment: { vertical: "top", wrapText: true }
      };
    }
  }
}

function replacementKey(issue) {
  return String(issue?.normalized || issue?.term || "").toLowerCase();
}

function replaceCellText(value, issues = [], replacementChoices = {}) {
  let next = String(value ?? "");
  for (const issue of uniqueIssues(issues)) {
    if (!["high", "medium"].includes(issue.risk)) continue;
    const replacement = replacementChoices[replacementKey(issue)] || issue.replacements?.[0];
    if (!replacement) continue;
    const variants = [issue.term, issue.normalized].filter(Boolean);
    for (const variant of variants) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "giu");
      next = next.replace(pattern, replacement);
    }
  }
  return next;
}

function updatedSourceTable(rows, sourceRows = [], sourceMeta = {}, replacementChoices = {}) {
  const resultsById = new Map(rows.map((row) => [row.request_id, row]));
  const sourceTable = sourceMeta.source_table;
  if (Array.isArray(sourceTable) && sourceTable.length) {
    const table = sourceTable.map((row) => [...row]);
    for (const sourceRow of sourceRows) {
      const result = resultsById.get(sourceRow.request_id);
      if (!result || sourceRow.source_row_index == null || !table[sourceRow.source_row_index]) continue;
      for (const columnIndex of sourceRow.text_column_indexes || []) {
        table[sourceRow.source_row_index][columnIndex] = replaceCellText(
          table[sourceRow.source_row_index][columnIndex],
          result.issues,
          replacementChoices
        );
      }
    }
    return table;
  }

  const objects = sourceRows.map((sourceRow) => {
    const original = { ...(sourceRow.source || {}) };
    const result = resultsById.get(sourceRow.request_id);
    if (!result) return original;
    for (const column of sourceRow.text_columns || []) {
      if (Object.prototype.hasOwnProperty.call(original, column)) {
        original[column] = replaceCellText(original[column], result.issues, replacementChoices);
      }
    }
    return original;
  });
  return objects.length ? objects : rows.map((row) => [row.request_id, row.rewritten_text]);
}

export function exportUpdatedSourceXlsx(rows, sourceRows = [], sourceMeta = {}, replacementChoices = {}, filename = "стопслово-для-загрузки.xlsx") {
  const table = updatedSourceTable(rows, sourceRows, sourceMeta, replacementChoices);
  const workbook = XLSX.utils.book_new();
  const sheet = Array.isArray(table[0]) ? sheetFromTable(table) : sheetFromRows(table);
  XLSX.utils.book_append_sheet(workbook, sheet, "Для загрузки");
  XLSX.writeFile(workbook, filename, { compression: true, cellStyles: true });
}

function escapeCsvCell(value, delimiter) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes("\n") || text.includes("\r") || text.includes(delimiter)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function serializeCsvTable(table, delimiter) {
  return table.map((row) => row.map((cell) => escapeCsvCell(cell, delimiter)).join(delimiter)).join("\r\n");
}

function encodeUtf16LeWithBom(text) {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[2 + index * 2] = code & 0xff;
    bytes[3 + index * 2] = code >> 8;
  }
  return bytes;
}

function encodeUtf8WithBom(text) {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(3 + encoded.length);
  bytes.set([0xef, 0xbb, 0xbf], 0);
  bytes.set(encoded, 3);
  return bytes;
}

export function exportUpdatedSourceCsv(rows, sourceRows = [], sourceMeta = {}, replacementChoices = {}, filename = "стопслово-для-загрузки.csv") {
  const table = updatedSourceTable(rows, sourceRows, sourceMeta, replacementChoices);
  const normalizedTable = Array.isArray(table[0])
    ? table
    : [
        Object.keys(table[0] || {}),
        ...table.map((row) => Object.values(row))
      ];
  const delimiter = sourceMeta.original_delimiter || ";";
  const csv = serializeCsvTable(normalizedTable, delimiter);
  const encoding = sourceMeta.original_encoding || "utf-8";
  const payload = encoding === "utf-16le"
    ? encodeUtf16LeWithBom(csv)
    : encodeUtf8WithBom(csv);
  const blob = new Blob([payload], { type: encoding === "utf-16le" ? "text/csv;charset=utf-16le" : "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportResultsXlsx(rows, sourceRows = [], filename = "стопслово-результаты.xlsx") {
  const sourceLookup = sourceRowsByRequestId(sourceRows);
  const summaryData = aggregateByTerm(rows, sourceRows).map((item) => ({
    "Слово": item.term,
    "Риск": RISK_LABELS[item.risk] || item.risk,
    "Количество": item.count,
    "Рекомендуемая замена": item.replacements[0] || "",
    "Источники": item.sources.join("; "),
    "ID объявлений": item.ads.join(", ")
  }));

  const resultData = rows.map((row) => ({
    ID: displayId(row, sourceLookup),
    "Общий риск": RISK_LABELS[row.overall_risk] || row.overall_risk,
    "Ручная проверка": row.manual_review_required ? "Да" : "Нет",
    "Количество замечаний": uniqueIssues(row.issues).length,
    "Проблемные слова": issueTerms(row.issues),
    "Детали замечаний": issueDetails(row.issues),
    "Исходный текст": row.original_text,
    "Переписанный текст": row.rewritten_text,
    "Резюме": localizeSystemText(row.summary),
    "Дата проверки": row.processed_at
  }));

  const workbook = XLSX.utils.book_new();
  const summarySheet = sheetFromRows(summaryData);
  summarySheet["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 70 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Сводка по словам");

  const resultSheet = sheetFromRows(resultData);
  resultSheet["!cols"] = [
    { wch: 16 },
    { wch: 12 },
    { wch: 16 },
    { wch: 18 },
    { wch: 32 },
    { wch: 80 },
    { wch: 80 },
    { wch: 80 },
    { wch: 80 },
    { wch: 24 }
  ];
  applyResultStyles(resultSheet, rows);
  XLSX.utils.book_append_sheet(workbook, resultSheet, "Все объявления");
  XLSX.writeFile(workbook, filename, { compression: true, cellStyles: true });
}
