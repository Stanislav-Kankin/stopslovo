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
  return issues.map((issue) => issue.term).join(", ");
}

function issueDetails(issues) {
  return issues
    .map((issue) => {
      const replacements = issue.replacements?.length ? `; замены: ${issue.replacements.join(", ")}` : "";
      return `${issue.term} (${RISK_LABELS[issue.risk] || issue.risk}): ${issue.reason}${replacements}`;
    })
    .join("\n");
}

function sheetFromRows(rows) {
  return XLSX.utils.json_to_sheet(rows);
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

export function exportResultsXlsx(rows, sourceRows = [], filename = "stopslovo-results.xlsx") {
  const resultData = rows.map((row) => ({
    ID: row.request_id,
    "Общий риск": RISK_LABELS[row.overall_risk] || row.overall_risk,
    "Ручная проверка": row.manual_review_required ? "Да" : "Нет",
    "Проблемные слова": issueTerms(row.issues),
    "Детали замечаний": issueDetails(row.issues),
    "Исходный текст": row.original_text,
    "Переписанный текст": row.rewritten_text,
    "Резюме": localizeSystemText(row.summary),
    "Дата проверки": row.processed_at
  }));

  const workbook = XLSX.utils.book_new();
  const sourceData = sourceRows.map((row) => ({
    ID: row.request_id,
    "Текст для проверки": row.text,
    "Тип контекста": row.context_type,
    ...row.source
  }));

  const sourceSheet = sheetFromRows(sourceData);
  sourceSheet["!cols"] = [{ wch: 16 }, { wch: 80 }, { wch: 18 }, ...Array(30).fill({ wch: 24 })];
  XLSX.utils.book_append_sheet(workbook, sourceSheet, "Исходник");

  const resultSheet = sheetFromRows(resultData);
  resultSheet["!cols"] = [
    { wch: 16 },
    { wch: 12 },
    { wch: 16 },
    { wch: 32 },
    { wch: 80 },
    { wch: 80 },
    { wch: 80 },
    { wch: 80 },
    { wch: 24 }
  ];
  applyResultStyles(resultSheet, rows);
  XLSX.utils.book_append_sheet(workbook, resultSheet, "Результат");
  XLSX.writeFile(workbook, filename, { compression: true, cellStyles: true });
}
