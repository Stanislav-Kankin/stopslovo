import { AlertTriangle, Check, Clipboard, FileText, LogIn, LogOut, Moon, Search, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";

import { BatchSummary } from "./components/BatchSummary";
import { Footer } from "./components/Footer";
import { QuotaWidget } from "./components/QuotaWidget";
import { Admin } from "./pages/Admin";
import { Login } from "./pages/Login";
import { Pricing } from "./pages/Pricing";
import { Register } from "./pages/Register";
import { Terms } from "./pages/Terms";
import { toCsv } from "./utils/csv";
import { exportResultsXlsx } from "./utils/exportResults";
import { importRowsFromFile } from "./utils/importRows";

const BATCH_CHUNK_SIZE = 100;
const DEFAULT_CONTEXT = "реклама";

const riskLabels = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  safe: "Без замечаний"
};

const riskSummaryLabels = {
  high: "высокий",
  medium: "средний",
  low: "низкий",
  safe: "без замечаний"
};

const riskClass = {
  high: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800",
  medium: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800",
  low: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-[#25394a] dark:text-[#d6e6ef] dark:border-[#48687a]",
  safe: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800"
};

const riskWeight = { high: 4, medium: 3, low: 2, safe: 1 };

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function parseResponse(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = data?.detail || data;
    const message = detail?.message || detail?.detail || text || "Ошибка запроса";
    const error = new Error(message);
    error.payload = detail;
    throw error;
  }
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function getJson(url) {
  const response = await fetch(url, { credentials: "include" });
  return parseResponse(response);
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parseExcludedTerms(value) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function RiskBadge({ risk }) {
  return <span className={`badge border ${riskClass[risk] || riskClass.safe}`}>{riskLabels[risk] || risk}</span>;
}

function localizeSystemText(value) {
  if (!value) return "";
  return String(value)
    .replace(/\boverall risk\b/gi, "общий риск")
    .replace(/\bLLM[- ]?анализ\b/gi, "нейросетевой анализ")
    .replace(/\bLLM[- ]?разбор\b/gi, "нейросетевой разбор")
    .replace(/\bLLM\b/g, "нейросетевой разбор")
    .replace(/\bDeepSeek\b/g, "нейросетевой сервис")
    .replace(/\bhigh\b/gi, riskSummaryLabels.high)
    .replace(/\bmedium\b/gi, riskSummaryLabels.medium)
    .replace(/\blow\b/gi, riskSummaryLabels.low)
    .replace(/\bsafe\b/gi, riskSummaryLabels.safe);
}

function uniqueIssues(issues = []) {
  const map = new Map();
  for (const issue of issues) {
    const key = `${issue.normalized || issue.term.toLowerCase()}|${issue.category || ""}`;
    const current = map.get(key);
    if (!current || riskWeight[issue.risk] > riskWeight[current.risk]) {
      map.set(key, issue);
    }
  }
  return [...map.values()];
}

function issueKey(issue) {
  return `${issue.normalized || issue.term.toLowerCase()}|${issue.category || ""}`;
}

function replaceIssue(issues = [], refined) {
  const targetKey = issueKey(refined);
  let replaced = false;
  const next = issues.map((issue) => {
    if (issueKey(issue) !== targetKey) return issue;
    replaced = true;
    return { ...issue, ...refined };
  });
  return replaced ? next : [...next, refined];
}

function HighlightedText({ text, issues }) {
  const terms = uniqueIssues(issues).filter((issue) => ["high", "medium"].includes(issue.risk)).map((issue) => issue.term);
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

  if (!replacements.length) return <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{text}</p>;

  const pattern = new RegExp(`(${replacements.map(escapeRegex).join("|")})`, "gi");
  return (
    <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">
      {text.split(pattern).map((part, index) => {
        const changed = replacements.some((item) => item.toLowerCase() === part.toLowerCase());
        if (!changed) return <span key={`${part}-${index}`}>{part}</span>;
        return <mark key={`${part}-${index}`} className="rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800">{part}</mark>;
      })}
    </p>
  );
}

function ResultView({ result, onRefineIssue, refiningIssue }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  const issues = uniqueIssues(result.issues);
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
        {issues.length === 0 ? (
          <p className="text-slate-600 dark:text-slate-300">Автоматическая проверка не нашла слов из зоны риска.</p>
        ) : (
          <div className="grid gap-3">
            {issues.map((issue, index) => (
              <article key={`${issue.term}-${index}`} className="rounded-md border border-slate-200 p-4 dark:border-[#38505c]">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <strong className="text-slate-950 dark:text-white">{issue.term}</strong>
                  <RiskBadge risk={issue.risk} />
                  <span className="text-sm text-slate-500 dark:text-slate-400">{issue.normalized}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">{issue.reason}</p>
                {issue.replacements.length > 0 && <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">Замены: {issue.replacements.join(", ")}</p>}
                {issue.sources?.length > 0 && (
                  <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Источники: {issue.sources.join("; ")}
                  </p>
                )}
                <button
                  className="secondary-button mt-3 text-sm"
                  disabled={refiningIssue === issueKey(issue)}
                  onClick={() => onRefineIssue?.(issue)}
                >
                  {refiningIssue === issueKey(issue) ? "Уточняем..." : "Уточнить через ИИ"}
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <p className="eyebrow">резюме</p>
        <h2 className="section-title">Краткое резюме</h2>
        <p className="text-slate-700 dark:text-slate-200">{localizeSystemText(result.summary)}</p>
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Это автоматическая оценка риска, не юридическое заключение. Для спорных случаев обратитесь к юристу.</span>
        </div>
      </div>
    </section>
  );
}

function HomePage({ me, refreshMe }) {
  const [mode, setMode] = useState("single");
  const [text, setText] = useState("Big sale и кешбэк на premium товары только сегодня");
  const [excludedTermsText, setExcludedTermsText] = useState("");
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
  const [selectedTerm, setSelectedTerm] = useState("");
  const [refiningIssue, setRefiningIssue] = useState("");

  const excludedTerms = useMemo(() => parseExcludedTerms(excludedTermsText), [excludedTermsText]);
  const filteredResults = useMemo(
    () => selectedTerm ? batchResults.filter((item) => item.issues.some((issue) => (issue.normalized || issue.term.toLowerCase()) === selectedTerm)) : batchResults,
    [batchResults, selectedTerm]
  );
  const sortedResults = useMemo(
    () => [...filteredResults].sort((a, b) => (sortDesc ? riskWeight[b.overall_risk] - riskWeight[a.overall_risk] : riskWeight[a.overall_risk] - riskWeight[b.overall_risk])),
    [filteredResults, sortDesc]
  );
  const totalPages = Math.max(1, Math.ceil(sortedResults.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleResults = sortedResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const currentUser = me?.authenticated ? me.user : null;
  const rowsRemaining = currentUser?.rows_remaining;

  const checkSingle = async () => {
    setLoading(true);
    setError("");
    try {
      setResult(await postJson("/api/v1/check/text", { text, context_type: DEFAULT_CONTEXT, excluded_terms: excludedTerms }));
      await refreshMe();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refineSingleIssue = async (issue) => {
    const key = issueKey(issue);
    setRefiningIssue(key);
    setError("");
    try {
      const data = await postJson("/api/v1/check/refine", { text: result.original_text, context_type: DEFAULT_CONTEXT, issue });
      setResult((current) => ({
        ...current,
        issues: replaceIssue(current.issues, data.issue),
        rewritten_text: data.rewritten_text || current.rewritten_text,
        summary: data.summary || current.summary,
        manual_review_required: data.manual_review_required,
        manual_review_reason: data.manual_review_reason
      }));
      await refreshMe();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefiningIssue("");
    }
  };

  const refineBatchTerm = async (term) => {
    const targetKey = `${term.normalized || term.term.toLowerCase()}|${term.category || ""}`;
    const sourceRow = batchResults.find((row) =>
      uniqueIssues(row.issues).some((issue) => issueKey(issue) === targetKey)
    );
    const sourceIssue = sourceRow?.issues.find((issue) => issueKey(issue) === targetKey);
    if (!sourceRow || !sourceIssue) return;

    setRefiningIssue(targetKey);
    setError("");
    try {
      const data = await postJson("/api/v1/check/refine", { text: sourceRow.original_text, context_type: DEFAULT_CONTEXT, issue: sourceIssue });
      setBatchResults((rows) =>
        rows.map((row) => {
          if (!row.issues.some((issue) => issueKey(issue) === targetKey)) return row;
          return {
            ...row,
            issues: replaceIssue(row.issues, data.issue),
            manual_review_required: data.manual_review_required || row.manual_review_required,
            manual_review_reason: data.manual_review_reason || row.manual_review_reason
          };
        })
      );
      await refreshMe();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefiningIssue("");
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
        context_type: DEFAULT_CONTEXT,
        request_id: /^row-\d+$/.test(row.request_id) ? `row-${index + 1}` : row.request_id
      }));
      setBatchRows(normalizedRows);
      setBatchImportSummary(imported.summary);
      setBatchImportColumns(imported.columns);
      setBatchResults([]);
      setSelectedTerm("");
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
    setSelectedTerm("");
    setExpandedResults(new Set());
    setPage(1);
    try {
      const allowedRows = typeof rowsRemaining === "number" && rowsRemaining >= 0 ? rowsRemaining : batchRows.length;
      if (allowedRows <= 0) {
        setError("Лимит строк для файлов исчерпан. Обновите тариф или дождитесь следующего месяца.");
        setLoading(false);
        return;
      }
      const rowsToProcess = batchRows.slice(0, Math.min(batchRows.length, allowedRows));
      if (rowsToProcess.length < batchRows.length) {
        setError(`По текущему лимиту будут обработаны первые ${rowsToProcess.length} строк из ${batchRows.length}.`);
      }
      const chunks = chunkItems(rowsToProcess, BATCH_CHUNK_SIZE);
      const collected = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const data = await postJson("/api/v1/check/batch", {
          items: chunks[index].map((item) => ({ ...item, context_type: DEFAULT_CONTEXT, use_llm: false, excluded_terms: excludedTerms }))
        });
        collected.push(...data.items);
        setBatchResults([...collected]);
        setProgress(Math.round(((index + 1) / chunks.length) * 100));
        await refreshMe();
      }
      setProgress(100);
      await refreshMe();
    } catch (err) {
      setError(err.message);
      setProgress(0);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(batchResults)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "стопслово-результаты.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportXlsx = () => {
    exportResultsXlsx(batchResults, batchRows);
  };

  const toggleResult = (requestId) => {
    setExpandedResults((current) => {
      const next = new Set(current);
      next.has(requestId) ? next.delete(requestId) : next.add(requestId);
      return next;
    });
  };

  return (
    <section className="space-y-6">
      <div className="segmented">
        <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>
          <Search className="h-4 w-4" /> Один текст
        </button>
        <button className={mode === "batch" ? "active" : ""} onClick={() => setMode("batch")}>
          <FileText className="h-4 w-4" /> Загрузить файл
        </button>
      </div>

      <section className="panel">
        <div className="grid gap-3 lg:grid-cols-[220px_1fr] lg:items-start">
          <div>
            <p className="eyebrow">исключения</p>
            <h2 className="section-title">Белый список</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Слова и словосочетания из этого списка не будут попадать в замечания.</p>
          </div>
          <div className="grid gap-2">
            <textarea className="input min-h-[86px] resize-y" value={excludedTermsText} onChange={(event) => setExcludedTermsText(event.target.value)} placeholder="Например, WB, Wildberries, Ozon, Nike, Apple" />
            <div className="flex flex-wrap gap-2">
              {excludedTerms.length > 0 ? excludedTerms.map((term) => (
                <span key={term} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-[#5aa978] dark:bg-[#203c34] dark:text-[#bdf2cf]">{term}</span>
              )) : <span className="text-xs text-slate-500 dark:text-slate-400">Список пуст. Проверка будет идти без пользовательских исключений.</span>}
            </div>
          </div>
        </div>
      </section>

      {mode === "single" ? (
        <>
          <section className="panel">
            <div className="grid gap-4">
              <textarea className="input min-h-[140px] resize-y" value={text} onChange={(event) => setText(event.target.value)} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-slate-500 dark:text-slate-400">{text.length} символов</span>
                <button className="primary-button" disabled={loading || !text.trim()} onClick={checkSingle}>
                  {loading ? "Проверяем..." : "Проверить"}
                </button>
              </div>
            </div>
          </section>
          {error && <div className="error-box">{error}</div>}
        <ResultView result={result} onRefineIssue={refineSingleIssue} refiningIssue={refiningIssue} />
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
            <div className="mt-4 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-slate-700 dark:border-[#3d6880] dark:bg-[#1e3442] dark:text-[#d6eef8]">
              Загрузите Excel или CSV из рекламного кабинета. Подойдут колонки с заголовками, описаниями, подзаголовками, быстрыми ссылками и уточнениями.
            </div>
            {batchImportSummary && (
              <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-[#5aa978] dark:bg-[#203c34] dark:text-[#bdf2cf]">
                {batchImportSummary}
                <span className="block pt-1 text-xs opacity-80">Пакетная проверка работает в быстром словарном режиме без нейросетевого разбора. Для детального разбора используйте проверку одного текста.</span>
              </div>
            )}
            {batchRows.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-md border border-slate-200 dark:border-[#38505c]">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 dark:border-[#38505c] dark:bg-[#1b2a34] dark:text-[#c7d5d1]">Предпросмотр импорта</div>
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {batchRows.slice(0, 3).map((row) => (
                    <div key={row.request_id} className="grid gap-1 px-3 py-2 text-sm md:grid-cols-[120px_1fr]">
                      <span className="font-medium text-slate-500 dark:text-slate-400">{row.request_id}</span>
                      <span className="line-clamp-2 text-slate-800 dark:text-slate-100">{row.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {batchImportColumns.length > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Колонки для анализа: {batchImportColumns.join(", ")}</p>}
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-[#2c4050]">
              <div className="h-full bg-accent-light transition-all dark:bg-accent-dark" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {error && <div className="error-box">{error}</div>}
          <BatchSummary
            results={batchResults}
            selectedTerm={selectedTerm}
            onSelectTerm={(term) => { setSelectedTerm(term); setPage(1); }}
            onDownloadXlsx={exportXlsx}
            onDownloadCsv={exportCsv}
            onRefineTerm={refineBatchTerm}
            refiningTerm={refiningIssue}
          />

          {batchResults.length > 0 && (
            <div className="panel">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-600 dark:text-slate-300">Показано {visibleResults.length} из {sortedResults.length}. Страница {currentPage} из {totalPages}.</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input h-10 w-28" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                    <option value={20}>20 строк</option>
                    <option value={50}>50 строк</option>
                    <option value={100}>100 строк</option>
                  </select>
                  <button className="secondary-button" onClick={() => setSortDesc((value) => !value)}>Сортировать по риску</button>
                  <button className="secondary-button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Назад</button>
                  <button className="secondary-button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Вперед</button>
                </div>
              </div>
              <div className="grid gap-3">
                {visibleResults.map((item) => {
                  const expanded = expandedResults.has(item.request_id);
                  return (
                    <article key={item.request_id} className="cursor-pointer rounded-[10px] border border-[#e0e0da] bg-white transition hover:border-[#c8c8c0] dark:border-[#38505c] dark:bg-[#22313b] dark:hover:border-[#5d7b89]" onClick={() => toggleResult(item.request_id)}>
                      <div className="p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <strong className="font-mono text-sm text-[#1a1a18] dark:text-[#f4f7f2]">{item.request_id}</strong>
                          <RiskBadge risk={item.overall_risk} />
                          <span className="rounded-full border border-[#e0e0da] px-2.5 py-1 text-xs font-semibold text-[#7a7a70] dark:border-[#496574] dark:text-[#c1d0cc]">{uniqueIssues(item.issues).length} замечаний</span>
                          <span className="ml-auto text-lg text-[#7a7a70] dark:text-[#c1d0cc]">{expanded ? "▲" : "▼"}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">{item.original_text.slice(0, 160)}{item.original_text.length > 160 ? "..." : ""}</p>
                      </div>
                      <div className={`overflow-hidden border-t border-[#e0e0da] transition-all duration-200 dark:border-[#38505c] ${expanded ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
                        <div className="space-y-4 p-4">
                          <div>
                            <p className="eyebrow mb-2">текст</p>
                            <HighlightedText text={item.original_text} issues={item.issues} />
                          </div>
                          <div>
                            <p className="eyebrow mb-2">замечания</p>
                            {uniqueIssues(item.issues).length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">Замечаний не найдено.</p> : (
                              <div className="grid gap-2">
                                {uniqueIssues(item.issues).map((issue, index) => (
                                  <div key={`${item.request_id}-${issue.term}-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-[#38505c]">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <strong>{issue.term}</strong>
                                      <RiskBadge risk={issue.risk} />
                                      {issue.replacements.length > 0 && <span className="text-slate-600 dark:text-slate-300">→ замены: {issue.replacements.join(", ")}</span>}
                                    </div>
                                    {issue.sources?.length > 0 && (
                                      <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                        Источники: {issue.sources.join("; ")}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="eyebrow mb-2">резюме</p>
                            <p className="text-sm text-slate-700 dark:text-slate-200">{localizeSystemText(item.summary)}</p>
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
    </section>
  );
}

export default function App() {
  const [dark, setDark] = useState(false);
  const [me, setMe] = useState(null);

  const refreshMe = async () => {
    const data = await getJson("/api/auth/me");
    setMe(data);
    return data;
  };

  useEffect(() => {
    refreshMe().catch(() => setMe({ authenticated: false, plan: "anon" }));
  }, []);

  const login = async (email, password) => {
    await postJson("/api/auth/login", { email, password });
    await refreshMe();
  };

  const register = async (email, password) => {
    await postJson("/api/auth/register", { email, password });
    await refreshMe();
  };

  const logout = async () => {
    await postJson("/api/auth/logout", {});
    await refreshMe();
  };

  const user = me?.authenticated ? me.user : null;

  return (
    <div className={dark ? "dark" : ""}>
      <main className="flex min-h-screen flex-col bg-[#f5f5f2] text-[#1a1a18] transition-colors dark:bg-[#17232d] dark:text-[#f4f7f2]">
        <header className="site-header">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5">
            <Link to="/">
              <img src="/logo.svg" alt="СтопСлово" className="h-9 dark:hidden" />
              <img src="/logo-dark.svg" alt="СтопСлово" className="hidden h-9 dark:block" />
              <p className="mt-2 text-sm font-medium text-[#7a7a70] dark:text-[#c1d0cc]">Автоматическая оценка риска для рекламных текстов</p>
            </Link>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Link className="secondary-button hidden sm:inline-flex" to="/">На главную</Link>
              <Link className="secondary-button hidden sm:inline-flex" to="/pricing">Тарифы</Link>
              {user?.is_admin && <Link className="secondary-button hidden sm:inline-flex" to="/admin">Админка</Link>}
              {user ? (
                <div className="flex items-center gap-2">
                  <span className="hidden max-w-[180px] truncate rounded-full border border-[#e0e0da] px-3 py-1.5 text-xs font-medium text-[#7a7a70] dark:border-[#496574] dark:text-[#c1d0cc] lg:inline">{user.email}</span>
                  <button className="secondary-button" onClick={logout}><LogOut className="h-4 w-4" /> Выйти</button>
                </div>
              ) : (
                <Link className="primary-button" to="/login"><LogIn className="h-4 w-4" /> Войти</Link>
              )}
              <button className="icon-button header-theme-button" onClick={() => setDark((value) => !value)} title="Переключить тему">
                {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </header>
        {user && <QuotaWidget user={user} />}

        <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8">
          <Routes>
            <Route path="/" element={<HomePage me={me} refreshMe={refreshMe} />} />
            <Route path="/login" element={<Login onLogin={login} />} />
            <Route path="/register" element={<Register onRegister={register} />} />
            <Route path="/pricing" element={<Pricing user={user} />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/admin" element={<Admin user={user} />} />
          </Routes>
        </div>
        <Footer />
      </main>
    </div>
  );
}
