import * as XLSX from "xlsx";

function issueTerms(issues) {
  return issues.map((issue) => issue.term).join(", ");
}

function issueDetails(issues) {
  return issues
    .map((issue) => {
      const replacements = issue.replacements?.length ? `; замены: ${issue.replacements.join(", ")}` : "";
      return `${issue.term} (${issue.risk}): ${issue.reason}${replacements}`;
    })
    .join("\n");
}

export function exportResultsXlsx(rows, filename = "stopslovo-results.xlsx") {
  const data = rows.map((row) => ({
    ID: row.request_id,
    "Общий риск": row.overall_risk,
    "Ручная проверка": row.manual_review_required ? "Да" : "Нет",
    "Проблемные слова": issueTerms(row.issues),
    "Детали замечаний": issueDetails(row.issues),
    "Исходный текст": row.original_text,
    "Переписанный текст": row.rewritten_text,
    "Резюме": row.summary,
    "Дата проверки": row.processed_at
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet["!cols"] = [
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
  XLSX.utils.book_append_sheet(workbook, worksheet, "Результаты");
  XLSX.writeFile(workbook, filename, { compression: true });
}
