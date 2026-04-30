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

function aggregateByTerm(rows) {
  const riskWeight = { high: 4, medium: 3, low: 2, safe: 1 };
  const map = {};
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
      map[key].ads.push(row.request_id);
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

export function exportResultsXlsx(rows, sourceRows = [], filename = "стопслово-результаты.xlsx") {
  const summaryData = aggregateByTerm(rows).map((item) => ({
    "Слово": item.term,
    "Риск": RISK_LABELS[item.risk] || item.risk,
    "Количество": item.count,
    "Рекомендуемая замена": item.replacements[0] || "",
    "Источники": item.sources.join("; "),
    "ID объявлений": item.ads.join(", ")
  }));

  const resultData = rows.map((row) => ({
    ID: row.request_id,
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
