import * as XLSX from "xlsx";

const CONTEXT_TYPES = new Set([
  "реклама",
  "карточка_товара",
  "баннер",
  "упаковка",
  "сайт",
  "презентация",
  "b2b_документ"
]);

const ID_COLUMNS = ["id", "ид", "номер", "объявление", "ad id", "ad_id"];
const CONTEXT_COLUMNS = ["context_type", "контекст", "тип контента", "тип_контента"];
const TEXT_COLUMN_HINTS = [
  "text",
  "текст",
  "заголовок",
  "подзаголовок",
  "описание",
  "быстрая ссылка",
  "быстрые ссылки",
  "уточнение",
  "уточнения",
  "название",
  "промо",
  "ссылка",
  "callout",
  "headline",
  "description",
  "title"
];
const SKIP_COLUMN_HINTS = [
  "url",
  "href",
  "utm",
  "ставка",
  "бюджет",
  "показы",
  "клики",
  "ctr",
  "цена",
  "расход",
  "конверс",
  "статус",
  "дата"
];

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replaceAll("ё", "е");
}

function isContext(value) {
  return CONTEXT_TYPES.has(String(value || "").trim());
}

function pickColumn(headers, variants) {
  return headers.find((header) => variants.some((variant) => normalizeHeader(header) === normalizeHeader(variant)));
}

function isTextColumn(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) return false;
  if (CONTEXT_COLUMNS.some((item) => normalized === normalizeHeader(item))) return false;
  if (ID_COLUMNS.some((item) => normalized === normalizeHeader(item))) return false;
  if (SKIP_COLUMN_HINTS.some((hint) => normalized.includes(normalizeHeader(hint)))) return false;
  return TEXT_COLUMN_HINTS.some((hint) => normalized.includes(normalizeHeader(hint)));
}

function rowToText(row, textColumns) {
  return textColumns
    .map((column) => String(row[column] ?? "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(". ");
}

function normalizeRows(rawRows) {
  if (!rawRows.length) {
    return { rows: [], summary: "Файл пустой или не содержит строк с данными.", columns: [] };
  }

  const headers = Object.keys(rawRows[0]);
  const idColumn = pickColumn(headers, ID_COLUMNS);
  const contextColumn = pickColumn(headers, CONTEXT_COLUMNS);
  let textColumns = headers.filter(isTextColumn);

  if (!textColumns.length && headers.includes("text")) {
    textColumns = ["text"];
  }

  if (!textColumns.length) {
    textColumns = headers.filter((header) => {
      const normalized = normalizeHeader(header);
      return (
        normalized &&
        header !== idColumn &&
        header !== contextColumn &&
        !SKIP_COLUMN_HINTS.some((hint) => normalized.includes(normalizeHeader(hint)))
      );
    });
  }

  const rows = rawRows
    .map((row, index) => {
      const text = rowToText(row, textColumns);
      const contextValue = contextColumn ? row[contextColumn] : "";
      return {
        request_id: String((idColumn && row[idColumn]) || `row-${index + 1}`),
        text,
        context_type: isContext(contextValue) ? String(contextValue).trim() : "реклама"
      };
    })
    .filter((row) => row.text);

  return {
    rows,
    columns: textColumns,
    summary: `Импортировано строк: ${rows.length}. В текст объединены колонки: ${textColumns.join(", ") || "не найдены"}.`
  };
}

function parseCsvWorkbook(text) {
  return XLSX.read(text, { type: "string", raw: false });
}

function parseBinaryWorkbook(buffer) {
  return XLSX.read(buffer, { type: "array", raw: false });
}

export async function importRowsFromFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const workbook = extension === "csv"
    ? parseCsvWorkbook(await file.text())
    : parseBinaryWorkbook(await file.arrayBuffer());
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], summary: "В файле не найдено листов.", columns: [] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return normalizeRows(rawRows);
}
