import { AlertTriangle, Check, Clipboard, Download, FileText, Moon, Search, Sun } from "lucide-react";
import { useMemo, useState } from "react";

import { toCsv } from "./utils/csv";
import { exportResultsXlsx } from "./utils/exportResults";
import { importRowsFromFile } from "./utils/importRows";

const BATCH_CHUNK_SIZE = 100;

const contextOptions = [
  ["реклама", "Рекламное объявление"],
  ["карточка_товара", "Карточка товара"],
  ["баннер", "Баннер / визуал"],
  ["упаковка", "Упаковка продукта"],
  ["сайт", "Текст на сайте"],
  ["презентация", "Презентация"],
  ["b2b_документ", "B2B документ"]
];

const riskLabels = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  safe: "Без замечаний"
};

const riskClass = {
  high: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800",
  medium: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800",
  low: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
  safe: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800"
};

const riskWeight = { high: 4, medium: 3, low: 2, safe: 1 };

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Ошибка запроса");
  }
  return response.json();
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function RiskBadge({ risk }) {
  return <span className={`badge border ${riskClass[risk] || riskClass.safe}`}>{riskLabels[risk] || risk}</span>;
}

function HighlightedText({ text, issues }) {
  const terms = issues.filter((issue) => ["high", "medium"].includes(issue.risk)).map((issue) => issue.term);
  if (!terms.length) return <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{text}</p>;
  const pattern = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
  return (
    <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">
      {text.split(pattern).map((part, index) => {
        const issue = issues.find((item) => item.term.toLowerCase() === part.toLowerCase());
        if (!issue) return <span key={`${part}-${index}`}>{part}</span>;
        const color = issue.risk === "high" ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100";
        return <mark key={`${part}-${index}`} className={`rounded px-1 ${color}`}>{part}</mark>;
      })}
    </p>
  );
}

function HighlightedRewrite({ text, issues }) {
  const replacements = issues
    .filter((issue) => ["high", "medium"].includes(issue.risk))
    .flatMap((issue) => issue.replacements || [])
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (!replacements.length) {
    return <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{text}</p>;
  }

  const pattern = new RegExp(`(${replacements.map(escapeRegex).join("|")})`, "gi");
  return (
    <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">
      {text.split(pattern).map((part, index) => {
        const changed = replacements.some((item) => item.toLowerCase() === part.toLowerCase());
        if (!changed) return <span key={`${part}-${index}`}>{part}</span>;
        return (
          <mark key={`${part}-${index}`} className="rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800">
            {part}
          </mark>
        );
      })}
    </p>
  );
}

function ResultView({ result }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  const copy = async () => {
    await navigator.clipboard.writeText(result.rewritten_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section className="space-y-5">
      <div className="panel flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Общий риск</p>
          <RiskBadge risk={result.overall_risk} />
        </div>
        {result.manual_review_required && (
          <div className="flex max-w-xl items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{result.manual_review_reason || "Требуется ручная проверка"}</span>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <div className="panel">
          <p className="eyebrow">текст</p>
          <h2 className="section-title">Исходный текст</h2>
          <HighlightedText text={result.original_text} issues={result.issues} />
        </div>
        <div className="panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">результат</p>
              <h2 className="section-title">Переписанный текст</h2>
            </div>
            <button className="icon-button" onClick={copy} title="Скопировать">
              {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
            </button>
          </div>
          <HighlightedRewrite text={result.rewritten_text} issues={result.issues} />
        </div>
      </div>

      <div className="panel">
        <p className="eyebrow">замечания</p>
        <h2 className="section-title">Замечания</h2>
        {result.issues.length === 0 ? (
          <p className="text-slate-600 dark:text-slate-300">Автоматическая проверка не нашла слов из зоны риска.</p>
        ) : (
          <div className="grid gap-3">
            {result.issues.map((issue, index) => (
              <article key={`${issue.term}-${index}`} className="rounded-md border border-slate-200 p-4 dark:border-slate-800">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <strong className="text-slate-950 dark:text-white">{issue.term}</strong>
                  <RiskBadge risk={issue.risk} />
                  <span className="text-sm text-slate-500 dark:text-slate-400">{issue.normalized}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">{issue.reason}</p>
                {issue.replacements.length > 0 && (
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">Замены: {issue.replacements.join(", ")}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <p className="eyebrow">резюме</p>
        <h2 className="section-title">Краткое резюме</h2>
        <p className="text-slate-700 dark:text-slate-200">{result.summary}</p>
      </div>
    </section>
  );
}

export default function App() {
  const [dark, setDark] = useState(false);
  const [mode, setMode] = useState("single");
  const [text, setText] = useState("Big sale и кешбэк на premium товары только сегодня");
  const [contextType, setContextType] = useState("реклама");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [batchRows, setBatchRows] = useState([]);
  const [batchResults, setBatchResults] = useState([]);
  const [batchImportSummary, setBatchImportSummary] = useState("");
  const [batchImportColumns, setBatchImportColumns] = useState([]);
  const [progress, setProgress] = useState(0);
  const [sortDesc, setSortDesc] = useState(true);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [expandedResults, setExpandedResults] = useState(new Set());

  const sortedResults = useMemo(
    () => [...batchResults].sort((a, b) => (sortDesc ? riskWeight[b.overall_risk] - riskWeight[a.overall_risk] : riskWeight[a.overall_risk] - riskWeight[b.overall_risk])),
    [batchResults, sortDesc]
  );
  const totalPages = Math.max(1, Math.ceil(sortedResults.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleResults = sortedResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const checkSingle = async () => {
    setLoading(true);
    setError("");
    try {
      setResult(await postJson("/api/v1/check/text", { text, context_type: contextType }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBatchFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const imported = await importRowsFromFile(file);
      const normalizedRows = imported.rows.map((row, index) => ({
        ...row,
        request_id: /^row-\d+$/.test(row.request_id) ? `row-${index + 1}` : row.request_id
      }));
      setBatchRows(normalizedRows);
      setBatchImportSummary(imported.summary);
      setBatchImportColumns(imported.columns);
      setBatchResults([]);
      setExpandedResults(new Set());
      setPage(1);
      setProgress(0);
    } catch (err) {
      setBatchRows([]);
      setBatchImportSummary("");
      setBatchImportColumns([]);
      setError(`Не удалось импортировать файл: ${err.message}`);
    }
  };

  const checkBatch = async () => {
    setLoading(true);
    setError("");
    setProgress(0);
    setBatchResults([]);
    setExpandedResults(new Set());
    setPage(1);
    try {
      const chunks = chunkItems(batchRows, BATCH_CHUNK_SIZE);
      const collected = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const data = await postJson("/api/v1/check/batch", {
          items: chunks[index].map((item) => ({ ...item, use_llm: false }))
        });
        collected.push(...data.items);
        setBatchResults([...collected]);
        setProgress(Math.round(((index + 1) / chunks.length) * 100));
      }
      setProgress(100);
    } catch (err) {
      setError(err.message);
      setProgress(0);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(sortedResults)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "проверка-результаты.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportXlsx = () => {
    exportResultsXlsx(sortedResults, batchRows);
  };

  const toggleResult = (requestId) => {
    setExpandedResults((current) => {
      const next = new Set(current);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  };

  return (
    <div className={dark ? "dark" : ""}>
      <main className="min-h-screen bg-[#f5f5f2] text-[#1a1a18] transition-colors dark:bg-[#121512] dark:text-[#f4f4ee]">
        <header className="site-header">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
            <div>
              <div className="flex items-center gap-3">
                <img src="/logo.svg" alt="СтопСлово" className="h-8 dark:hidden" />
                <img src="/logo-dark.svg" alt="СтопСлово" className="hidden h-8 dark:block" />
              </div>
              <p className="mt-2 text-sm font-medium text-[#7a7a70] dark:text-[#b8b8ad]">Автоматическая оценка риска для рекламных текстов</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full border border-[#c8c8c0] bg-[#f0f0ec] px-3 py-1.5 font-mono text-xs font-medium text-[#7a7a70] dark:border-[#3a453b] dark:bg-[#1b211c] dark:text-[#b8b8ad] sm:inline-flex">
                149-ФЗ · рекламные тексты
              </span>
              <button className="icon-button header-theme-button" onClick={() => setDark((value) => !value)} title="Переключить тему">
                {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="segmented">
            <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>
              <Search className="h-4 w-4" /> Один текст
            </button>
            <button className={mode === "batch" ? "active" : ""} onClick={() => setMode("batch")}>
              <FileText className="h-4 w-4" /> Загрузить файл
            </button>
          </div>

          {mode === "single" ? (
            <>
              <section className="panel">
                <div className="grid gap-4">
                  <textarea className="input min-h-[140px] resize-y" value={text} onChange={(event) => setText(event.target.value)} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm text-slate-500 dark:text-slate-400">{text.length} символов</span>
                    <div className="flex flex-wrap items-center gap-3">
                      <select className="input w-64" value={contextType} onChange={(event) => setContextType(event.target.value)}>
                        {contextOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <button className="primary-button" disabled={loading || !text.trim()} onClick={checkSingle}>
                        {loading ? "Проверяем..." : "Проверить"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
              {error && <div className="error-box">{error}</div>}
              <ResultView result={result} />
            </>
          ) : (
            <section className="space-y-5">
              <div className="panel">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <input className="input max-w-lg" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={loadBatchFile} />
                  <button className="primary-button" disabled={loading || batchRows.length === 0} onClick={checkBatch}>
                    {loading ? `Обрабатываем ${progress}%` : `Проверить ${batchRows.length || ""}`}
                  </button>
                </div>
                <div className="mt-4 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-slate-700 dark:border-sky-900/60 dark:bg-slate-950/40 dark:text-sky-100">
                  Загрузите Excel или CSV из рекламного кабинета. Подойдут колонки с заголовками, описаниями, подзаголовками, быстрыми ссылками и уточнениями.
                </div>
                {batchImportSummary && (
                  <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
                    {batchImportSummary}
                    <span className="block pt-1 text-xs opacity-80">Batch-проверка работает в быстром словарном режиме без LLM. Для детального LLM-разбора используйте проверку одного текста.</span>
                  </div>
                )}
                {batchRows.length > 0 && (
                  <div className="mt-4 overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                      Предпросмотр импорта
                    </div>
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {batchRows.slice(0, 3).map((row) => (
                        <div key={row.request_id} className="grid gap-1 px-3 py-2 text-sm md:grid-cols-[120px_140px_1fr]">
                          <span className="font-medium text-slate-500 dark:text-slate-400">{row.request_id}</span>
                          <span className="text-slate-600 dark:text-slate-300">{row.context_type}</span>
                          <span className="line-clamp-2 text-slate-800 dark:text-slate-100">{row.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {batchImportColumns.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Колонки для анализа: {batchImportColumns.join(", ")}
                  </p>
                )}
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-accent-light transition-all dark:bg-accent-dark" style={{ width: `${progress}%` }} />
                </div>
              </div>
              {error && <div className="error-box">{error}</div>}
              {batchResults.length > 0 && (
                <div className="panel">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-slate-600 dark:text-slate-300">
                      Показано {visibleResults.length} из {sortedResults.length}. Страница {currentPage} из {totalPages}.
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="input h-10 w-28"
                        value={pageSize}
                        onChange={(event) => {
                          setPageSize(Number(event.target.value));
                          setPage(1);
                        }}
                      >
                        <option value={20}>20 строк</option>
                        <option value={50}>50 строк</option>
                        <option value={100}>100 строк</option>
                      </select>
                      <button className="secondary-button" onClick={() => setSortDesc((value) => !value)}>Сортировать по риску</button>
                      <button className="secondary-button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Назад</button>
                      <button className="secondary-button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Вперед</button>
                    </div>
                    <button className="primary-button" onClick={exportXlsx}><Download className="h-4 w-4" /> Скачать XLSX</button>
                    <button className="secondary-button" onClick={exportCsv}><Download className="h-4 w-4" /> Скачать CSV</button>
                  </div>
                  <div className="grid gap-3">
                    {visibleResults.map((item) => {
                      const expanded = expandedResults.has(item.request_id);
                      return (
                        <article
                          key={item.request_id}
                          className="cursor-pointer rounded-[10px] border border-[#e0e0da] bg-white transition hover:border-[#c8c8c0] dark:border-[#30372f] dark:bg-[#181d18] dark:hover:border-[#3a453b]"
                          onClick={() => toggleResult(item.request_id)}
                        >
                          <div className="p-4">
                            <div className="flex flex-wrap items-center gap-3">
                              <strong className="font-mono text-sm text-[#1a1a18] dark:text-[#f4f4ee]">{item.request_id}</strong>
                              <RiskBadge risk={item.overall_risk} />
                              <span className="rounded-full border border-[#e0e0da] px-2.5 py-1 text-xs font-semibold text-[#7a7a70] dark:border-[#30372f] dark:text-[#b8b8ad]">
                                {item.issues.length} замечаний
                              </span>
                              <span className="ml-auto text-lg text-[#7a7a70] dark:text-[#b8b8ad]">{expanded ? "▲" : "▼"}</span>
                            </div>
                            <p className="mt-2 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                              {item.original_text.slice(0, 160)}{item.original_text.length > 160 ? "..." : ""}
                            </p>
                          </div>
                          <div className={`overflow-hidden border-t border-[#e0e0da] transition-all duration-200 dark:border-[#30372f] ${expanded ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
                            <div className="space-y-4 p-4">
                              <div>
                                <p className="eyebrow mb-2">текст</p>
                                <HighlightedText text={item.original_text} issues={item.issues} />
                              </div>
                              <div>
                                <p className="eyebrow mb-2">замечания</p>
                                {item.issues.length === 0 ? (
                                  <p className="text-sm text-slate-600 dark:text-slate-300">Замечаний не найдено.</p>
                                ) : (
                                  <div className="grid gap-2">
                                    {item.issues.map((issue, index) => (
                                      <div key={`${item.request_id}-${issue.term}-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <strong>{issue.term}</strong>
                                          <RiskBadge risk={issue.risk} />
                                          {issue.replacements.length > 0 && (
                                            <span className="text-slate-600 dark:text-slate-300">→ замены: {issue.replacements.join(", ")}</span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="eyebrow mb-2">резюме</p>
                                <p className="text-sm text-slate-700 dark:text-slate-200">{item.summary}</p>
                              </div>
                              {item.manual_review_required && (
                                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                  <span>{item.manual_review_reason || "Требуется ручная проверка"}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

