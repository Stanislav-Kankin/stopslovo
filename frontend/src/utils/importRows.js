import XLSX from "xlsx-js-style";

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
const DIRECT_TEXT_PATTERNS = [
  /^заголовок\s*1$/i,
  /^заголовок\s*2$/i,
  /^заголовок\s*[1-7]$/i,
  /^текст$/i,
  /^текст\s*[1-7]$/i,
  /^текст объявления$/i,
  /^заголовки быстрых ссылок$/i,
  /^описания быстрых ссылок$/i,
  /^уточнения$/i,
  /^headline\s*1$/i,
  /^headline\s*2$/i,
  /^description$/i,
  /^sitelink/i,
  /^quick link/i,
  /^callout/i
];
const TEXT_COLUMN_HINTS = ["text", "текст", "заголовок", "описание", "быстрая ссылка", "быстрые ссылки", "уточнение", "уточнения", "headline", "description", "sitelink", "quick link", "callout"];
const SKIP_COLUMN_HINTS = [
  "url",
  "href",
  "utm",
  "фраз",
  "минус",
  "ключев",
  "поисков",
  "ставка",
  "бюджет",
  "показы",
  "клики",
  "ctr",
  "цена",
  "расход",
  "конверс",
  "статус",
  "дата",
  "название кампании",
  "название группы",
  "кампания",
  "группа",
  "ссылка",
  "отображаемая ссылка",
  "трекинговая ссылка"
];
const EMPTY_VALUES = new Set(["", "-", "—", "–", "нет", "n/a", "none", "null"]);

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replaceAll("ё", "е").replace(/_\d+$/, "");
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
  if (DIRECT_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return TEXT_COLUMN_HINTS.some((hint) => normalized === normalizeHeader(hint));
}

function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanCellPreserveLines(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function isMeaningfulText(value) {
  const cleaned = cleanCell(value).toLowerCase();
  if (EMPTY_VALUES.has(cleaned)) return false;
  return /[a-zа-яё0-9]/i.test(cleaned);
}

function rowToText(row, textColumns) {
  return textColumns
    .map((column) => cleanCell(row[column]))
    .flatMap((value) => value.split("||").map(cleanCell))
    .filter(isMeaningfulText)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(". ");
}

function detectDelimiter(rows) {
  const candidates = [";", "\t", ","];
  const sample = rows
    .slice(0, 20)
    .map((row) => cleanCell(row[0]))
    .filter((cell) => cell);
  return candidates
    .map((delimiter) => ({
      delimiter,
      score: sample.reduce((sum, cell) => sum + cell.split(delimiter).length, 0)
    }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter;
}

function splitSingleColumnRows(rows) {
  const singleColumnRows = rows.filter((row) => row.filter((cell) => cleanCell(cell)).length === 1);
  if (singleColumnRows.length < Math.max(3, rows.length * 0.6)) return rows;
  const delimiter = detectDelimiter(singleColumnRows);
  if (!delimiter || delimiter === "," && !singleColumnRows.some((row) => cleanCell(row[0]).includes(","))) return rows;
  const averageParts = singleColumnRows.reduce((sum, row) => sum + cleanCell(row[0]).split(delimiter).length, 0) / singleColumnRows.length;
  if (averageParts < 2) return rows;
  return rows.map((row) => {
    const nonEmpty = row.filter((cell) => cleanCell(cell));
    return nonEmpty.length === 1 ? cleanCell(nonEmpty[0]).split(delimiter).map(cleanCell) : row;
  });
}

function headerScore(row) {
  const cells = row.map(normalizeHeader).filter(Boolean);
  const textHits = cells.filter((cell) => TEXT_COLUMN_HINTS.some((hint) => cell.includes(normalizeHeader(hint)))).length;
  const skipHits = cells.filter((cell) => SKIP_COLUMN_HINTS.some((hint) => cell.includes(normalizeHeader(hint)))).length;
  return textHits * 8 + Math.min(cells.length, 30) + skipHits;
}

function rowsFromSheet(sheet) {
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const table = splitSingleColumnRows(raw)
    .map((row) => row.map(cleanCellPreserveLines));
  const meaningfulTable = table.filter((row) => row.some((cell) => cleanCell(cell)));
  if (!meaningfulTable.length) return { rows: [], meta: { source_table: table } };

  const headerIndex = table
    .map((row, index) => ({ index, score: headerScore(row) }))
    .sort((a, b) => b.score - a.score)[0]?.index ?? 0;
  const headers = table[headerIndex].map((header, index) => cleanCell(header) || `column_${index + 1}`);
  const seen = new Map();
  const uniqueHeaders = headers.map((header) => {
    const count = seen.get(header) || 0;
    seen.set(header, count + 1);
    return count ? `${header}_${count + 1}` : header;
  });

  const rows = table.slice(headerIndex + 1).map((row, offset) => ({
    source_row_index: headerIndex + 1 + offset,
    source_cells: row,
    values: Object.fromEntries(uniqueHeaders.map((header, index) => [header, row[index] ?? ""]))
  }));

  return {
    rows,
    meta: {
      source_table: table,
      source_header_index: headerIndex,
      source_headers: headers,
      source_unique_headers: uniqueHeaders
    }
  };
}

function normalizeRows(rawRows, meta = {}) {
  if (!rawRows.length) {
    return { rows: [], summary: "Файл пустой или не содержит строк с данными.", columns: [], meta };
  }

  const headers = Object.keys(rawRows[0].values || rawRows[0]);
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
    .map((rawRow, index) => {
      const row = rawRow.values || rawRow;
      const text = rowToText(row, textColumns);
      const contextValue = contextColumn ? row[contextColumn] : "";
      const textColumnIndexes = textColumns
        .map((column) => headers.indexOf(column))
        .filter((columnIndex) => columnIndex >= 0);
      return {
        request_id: String((idColumn && row[idColumn]) || `row-${index + 1}`),
        text,
        context_type: isContext(contextValue) ? String(contextValue).trim() : "реклама",
        source: row,
        source_cells: rawRow.source_cells || [],
        source_row_index: rawRow.source_row_index,
        text_columns: textColumns,
        text_column_indexes: textColumnIndexes
      };
    })
    .filter((row) => isMeaningfulText(row.text));

  return {
    rows,
    columns: textColumns,
    meta,
    summary: `Импортировано строк: ${rows.length}. В текст объединены колонки: ${textColumns.join(", ") || "не найдены"}.`
  };
}

function detectTextEncoding(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  return "utf-8";
}

function decodeText(bytes) {
  const encoding = detectTextEncoding(bytes);
  return {
    encoding,
    text: new TextDecoder(encoding).decode(bytes)
  };
}

function detectTextDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const sample = lines.slice(0, 10).join("\n");
  const candidates = ["\t", ";", ","];
  return candidates
    .map((delimiter) => ({ delimiter, score: sample.split(delimiter).length }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter || ";";
}

function parseCsvWorkbook(text) {
  return XLSX.read(text, { type: "string", raw: false });
}

function parseBinaryWorkbook(buffer) {
  return XLSX.read(buffer, { type: "array", raw: false });
}

export async function importRowsFromFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const decoded = extension === "csv" ? decodeText(bytes) : null;
  const workbook = extension === "csv"
    ? parseCsvWorkbook(decoded.text)
    : parseBinaryWorkbook(buffer);
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], summary: "В файле не найдено листов.", columns: [] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const parsed = rowsFromSheet(sheet);
  const meta = {
    ...parsed.meta,
    original_filename: file.name,
    original_extension: extension || "",
    original_encoding: decoded?.encoding || "",
    original_delimiter: decoded ? detectTextDelimiter(decoded.text) : "",
  };
  return normalizeRows(parsed.rows, meta);
}
