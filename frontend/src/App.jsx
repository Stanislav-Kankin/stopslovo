import { AlertTriangle, Check, Clipboard, FileText, LogIn, LogOut, Moon, Search, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";

import { BatchSummary } from "./components/BatchSummary";
import { Footer } from "./components/Footer";
import { QuotaWidget } from "./components/QuotaWidget";
import { Admin } from "./pages/Admin";
import { AllowlistAdmin } from "./pages/AllowlistAdmin";
import { Login } from "./pages/Login";
import { Pricing } from "./pages/Pricing";
import { Register } from "./pages/Register";
import { Terms } from "./pages/Terms";
import { toCsv } from "./utils/csv";
import { humanizeApiError } from "./utils/errors";
import { exportResultsXlsx } from "./utils/exportResults";
import { importRowsFromFile } from "./utils/importRows";

const BATCH_CHUNK_SIZE = 100;
const DEFAULT_CONTEXT = "реклама";
const HOME_STATE_DB = "stopslovo-state";
const HOME_STATE_STORE = "kv";
const HOME_STATE_KEY = "home-page-v1";
const DEFAULT_SINGLE_TEXT = "Big sale и кешбэк на premium товары только сегодня";

function openStateDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(HOME_STATE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(HOME_STATE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSavedState(key) {
  try {
    const db = await openStateDb();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(HOME_STATE_STORE, "readonly");
      const request = transaction.objectStore(HOME_STATE_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function writeSavedState(key, value) {
  try {
    const db = await openStateDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(HOME_STATE_STORE, "readwrite");
      transaction.objectStore(HOME_STATE_STORE).put(value, key);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Autosave is best-effort. If the browser blocks storage, the app should keep working.
  }
}

async function deleteSavedState(key) {
  try {
    const db = await openStateDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(HOME_STATE_STORE, "readwrite");
      transaction.objectStore(HOME_STATE_STORE).delete(key);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Clearing cached workspace is best-effort.
  }
}

function readBooleanPreference(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

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
    const message = humanizeApiError({ message: text, payload: detail });
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
  const fullKey = issueKey(refined);
  const softKey = refined.normalized || refined.term.toLowerCase();

  let replaced = false;
  const next = issues.map((issue) => {
    const match =
      issueKey(issue) === fullKey ||
      (issue.normalized || issue.term.toLowerCase()) === softKey;
    if (!match) return issue;
    replaced = true;
    return { ...issue, ...refined };
  });
  return replaced ? next : next;
}

function markAiRefined(issue, summary = "") {
  return {
    ...issue,
    ai_refined: true,
    ai_summary: summary
  };
}

function AiRobotIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="#7ed59a" strokeWidth="1.2" />
      <circle cx="5.8" cy="7.2" r="1" fill="#7ed59a" />
      <circle cx="10.2" cy="7.2" r="1" fill="#7ed59a" />
      <path d="M5.5 10.5 Q8 12.5 10.5 10.5" stroke="#7ed59a" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <line x1="8" y1="2" x2="8" y2="2.5" stroke="#a8d870" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="1.5" r="0.8" fill="#a8d870" />
    </svg>
  );
}

function AiRefineButton({ disabled, loading, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#4a7c10] bg-[#1a2e12] px-3 py-1.5 text-xs font-medium text-[#a8d870] transition hover:bg-[#213d17] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0f1f0a] dark:hover:bg-[#1a2e12]"
    >
      <AiRobotIcon />
      {loading ? "Уточняем..." : "Уточнить через ИИ"}
    </button>
  );
}

function ReplacementChips({ replacements = [] }) {
  if (!replacements.length) return null;
  return (
    <div className="mb-2 mt-1.5 flex flex-wrap gap-1.5">
      {replacements.map((replacement) => (
        <button
          key={replacement}
          type="button"
          onClick={() => navigator.clipboard.writeText(replacement)}
          className="rounded-full border border-[#e0e0da] bg-[#f7f7f3] px-2.5 py-1 text-xs text-[#1a1a18] transition hover:border-[#4a7c10] hover:text-[#4a7c10] dark:border-[#38505c] dark:bg-[#182630] dark:text-[#f4f7f2] dark:hover:border-[#7ed59a] dark:hover:text-[#7ed59a]"
          title="Копировать"
        >
          {replacement}
        </button>
      ))}
    </div>
  );
}

function IssueSources({ sources = [] }) {
  const [showSources, setShowSources] = useState(false);
  if (!sources.length) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setShowSources((value) => !value)}
        className="text-[11px] text-slate-500 underline-offset-2 transition hover:underline dark:text-slate-400"
      >
        {showSources ? "Скрыть источники" : "Источники"}
      </button>
      {showSources && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          {sources.join(" · ")}
        </p>
      )}
    </div>
  );
}

const issueBorderLeft = {
  high: "border-l-4 border-l-[#e24b4a]",
  medium: "border-l-4 border-l-[#ef9f27]",
  low: "border-l-4 border-l-[#888780]",
  safe: "border-l-4 border-l-[#639922]",
};

const summaryRiskColor = {
  high: "text-[#a32d2d] dark:text-red-200",
  medium: "text-[#854f0b] dark:text-amber-200",
  low: "text-[#585852] dark:text-slate-200",
  safe: "text-[#3d6b10] dark:text-emerald-200",
};

function StatCell({ num, label, color }) {
  return (
    <div className="rounded-lg bg-[#f7f7f3] p-2 text-center dark:bg-[#182630]">
      <p className="text-lg font-medium" style={{ color }}>{num}</p>
      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

function RiskIcon({ risk }) {
  const color = {
    high: "#e24b4a",
    medium: "#ef9f27",
    low: "#888780",
    safe: "#639922",
  }[risk] || "#888780";
  return (
    <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border-4 bg-white dark:bg-[#182630]" style={{ borderColor: color }}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function QuotaExceededBanner() {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[#c8e6a0] bg-[#f0f7e6] p-5 dark:border-[#3d6020] dark:bg-[#1e2d10]">
      <div>
        <p className="font-semibold text-[#2d5010] dark:text-[#a8d870]">Лимит на этот месяц исчерпан</p>
        <p className="mt-1 text-sm text-[#4a7c10] dark:text-[#7eb850]">Обновите тариф чтобы продолжить проверку</p>
      </div>
      <Link to="/pricing" className="primary-button whitespace-nowrap">Смотреть тарифы</Link>
    </div>
  );
}

function UpgradeAfterCheckBanner({ user, result }) {
  if (!result || result.overall_risk === "safe" || user?.plan !== "free") return null;
  return (
    <div className="mt-4 rounded-[10px] border border-[#c8e6a0] bg-[#f5faf0] px-4 py-3 text-sm dark:border-[#3d6020] dark:bg-[#1a2810]">
      <span className="text-[#4a7c10] dark:text-[#7eb850]">
        Нашли нарушения? На тарифе «Фрилансер» можно проверить весь рекламный аккаунт за раз.
      </span>
      <Link to="/pricing" className="ml-2 font-semibold text-[#4a7c10] underline dark:text-[#7ed59a]">
        Смотреть тарифы →
      </Link>
    </div>
  );
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

function ResultView({ result, onRefineIssue, refiningIssue, canUseAi, aiUnavailableReason }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  const issues = uniqueIssues(result.issues);
  const highCount = issues.filter((issue) => issue.risk === "high").length;
  const mediumCount = issues.filter((issue) => issue.risk === "medium").length;
  const safeCount = issues.filter((issue) => issue.risk === "safe" || issue.risk === "low").length;
  const copy = async () => {
    await navigator.clipboard.writeText(result.rewritten_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
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

      <div className="grid gap-4 md:grid-cols-[1fr_280px] md:items-start">
        <div className="space-y-5">
        <div className="panel">
          <p className="eyebrow">замечания</p>
          <h2 className="section-title">Замечания</h2>
          {issues.length === 0 ? (
            <p className="text-slate-600 dark:text-slate-300">Автоматическая проверка не нашла слов из зоны риска.</p>
          ) : (
            <div className="grid gap-3">
              {issues.map((issue, index) => (
                <article key={`${issue.term}-${index}`} className={`panel rounded-l-none p-4 ${issueBorderLeft[issue.risk] || issueBorderLeft.low}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <strong className="text-slate-950 dark:text-white">{issue.term}</strong>
                    <RiskBadge risk={issue.risk} />
                    {issue.ai_refined && (
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100">
                        Уточнено ИИ
                      </span>
                    )}
                    <span className="text-sm text-slate-500 dark:text-slate-400">{issue.normalized}</span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{issue.reason}</p>
                  {issue.ai_refined && issue.ai_summary && (
                    <p className="mt-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                      Вывод ИИ: {localizeSystemText(issue.ai_summary)}
                    </p>
                  )}
                  <ReplacementChips replacements={issue.replacements} />
                  <IssueSources sources={issue.sources} />
                  <div className="mt-3">
                    {canUseAi ? (
                      <AiRefineButton
                        disabled={refiningIssue === issueKey(issue)}
                        loading={refiningIssue === issueKey(issue)}
                        onClick={() => onRefineIssue?.(issue)}
                      />
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">{aiUnavailableReason}</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

        <aside className="flex flex-col gap-3 md:sticky md:top-4">
        <div className="panel">
          <p className="eyebrow">общий результат</p>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className={`text-xl font-medium ${summaryRiskColor[result.overall_risk] || summaryRiskColor.low}`}>
                {riskLabels[result.overall_risk] || result.overall_risk}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">риск нарушения</p>
            </div>
            <RiskIcon risk={result.overall_risk} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCell num={highCount} label="высокий" color="#a32d2d" />
            <StatCell num={mediumCount} label="средний" color="#854f0b" />
            <StatCell num={safeCount} label="ок" color="#3d6b10" />
          </div>
          {result.manual_review_required && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{result.manual_review_reason || "Требуется ручная проверка"}</span>
            </div>
          )}
        </div>

        <div className="panel">
          <p className="eyebrow">резюме</p>
          <h2 className="section-title">Краткое резюме</h2>
          <p className="text-sm text-slate-700 dark:text-slate-200">{localizeSystemText(result.summary)}</p>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Это автоматическая оценка риска, не юридическое заключение. Для спорных случаев обратитесь к юристу.</span>
        </div>
        </aside>
      </div>
    </section>
  );
}

function HomePage({ me, refreshMe }) {
  const [mode, setMode] = useState("single");
  const [text, setText] = useState(DEFAULT_SINGLE_TEXT);
  const [excludedTermsText, setExcludedTermsText] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [quotaExceeded, setQuotaExceeded] = useState(false);
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
  const [stateRestored, setStateRestored] = useState(false);

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
  const aiRemaining = currentUser?.ai_remaining;
  const singleTextLimit = Number(currentUser?.chars_limit && currentUser.chars_limit > 0 ? currentUser.chars_limit : 1000);
  const singleTextRatio = singleTextLimit > 0 ? text.length / singleTextLimit : 0;
  const singleTextCounterClass = singleTextRatio > 0.95
    ? "text-[#a32d2d]"
    : singleTextRatio >= 0.8
      ? "text-[#854f0b]"
      : "text-slate-500 dark:text-slate-400";
  const canUseAi = Boolean(currentUser) && (aiRemaining === -1 || (typeof aiRemaining === "number" && aiRemaining > 0));
  const aiUnavailableReason = !currentUser
    ? "ИИ-подсказки доступны после входа."
    : "Лимит ИИ-подсказок на бесплатном тарифе исчерпан.";

  useEffect(() => {
    let active = true;
    readSavedState(HOME_STATE_KEY).then((saved) => {
      if (!active) return;
      if (saved) {
        setMode(saved.mode || "single");
        setText(saved.text ?? DEFAULT_SINGLE_TEXT);
        setExcludedTermsText(saved.excludedTermsText || "");
        setResult(saved.result || null);
        setBatchRows(Array.isArray(saved.batchRows) ? saved.batchRows : []);
        setBatchResults(Array.isArray(saved.batchResults) ? saved.batchResults : []);
        setBatchImportSummary(saved.batchImportSummary || "");
        setBatchImportColumns(Array.isArray(saved.batchImportColumns) ? saved.batchImportColumns : []);
        setProgress(Number(saved.progress) || 0);
        setSortDesc(saved.sortDesc ?? true);
        setPageSize(Number(saved.pageSize) || 20);
        setPage(Number(saved.page) || 1);
        setExpandedResults(new Set(Array.isArray(saved.expandedResults) ? saved.expandedResults : []));
        setSelectedTerm(saved.selectedTerm || "");
      }
      setStateRestored(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!stateRestored) return undefined;
    const timeout = window.setTimeout(() => {
      writeSavedState(HOME_STATE_KEY, {
        mode,
        text,
        excludedTermsText,
        result,
        batchRows,
        batchResults,
        batchImportSummary,
        batchImportColumns,
        progress,
        sortDesc,
        pageSize,
        page,
        expandedResults: [...expandedResults],
        selectedTerm
      });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [
    mode,
    text,
    excludedTermsText,
    result,
    batchRows,
    batchResults,
    batchImportSummary,
    batchImportColumns,
    progress,
    sortDesc,
    pageSize,
    page,
    expandedResults,
    selectedTerm,
    stateRestored
  ]);

  const checkSingle = async () => {
    setLoading(true);
    setError("");
    setQuotaExceeded(false);
    try {
      setResult(await postJson("/api/v1/check/text", { text, context_type: DEFAULT_CONTEXT, use_llm: false, excluded_terms: excludedTerms }));
      await refreshMe();
    } catch (err) {
      if (err.payload?.error === "quota_exceeded") {
        setQuotaExceeded(true);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const refineSingleIssue = async (issue) => {
    const key = issueKey(issue);
    setRefiningIssue(key);
    setError("");
    setQuotaExceeded(false);
    try {
      const data = await postJson("/api/v1/check/refine", { text: result.original_text, context_type: DEFAULT_CONTEXT, issue });
      const refinedIssue = markAiRefined(data.issue, data.llm_explanation || data.summary);
      setResult((current) => ({
        ...current,
        issues: replaceIssue(current.issues, refinedIssue),
        manual_review_required: data.manual_review_required,
        manual_review_reason: data.manual_review_reason
      }));
      await refreshMe();
    } catch (err) {
      if (err.payload?.error === "quota_exceeded") {
        setQuotaExceeded(true);
      } else {
        setError(err.message);
      }
    } finally {
      setRefiningIssue("");
    }
  };

  const refineBatchTerm = async (term) => {
    const targetKey = `${term.normalized || term.term.toLowerCase()}|${term.category || ""}`;
    const softTarget = term.normalized || term.term.toLowerCase();
    const sourceRow = batchResults.find((row) =>
      row.issues.some((issue) => (issue.normalized || issue.term.toLowerCase()) === softTarget)
    );
    const sourceIssue = sourceRow?.issues.find(
      (issue) => (issue.normalized || issue.term.toLowerCase()) === softTarget
    );
    if (!sourceRow || !sourceIssue) return;

    setRefiningIssue(targetKey);
    setError("");
    setQuotaExceeded(false);
    try {
      const data = await postJson("/api/v1/check/refine", { text: sourceRow.original_text, context_type: DEFAULT_CONTEXT, issue: sourceIssue });
      const refinedIssue = {
        ...markAiRefined(data.issue, data.llm_explanation || data.summary),
        sort_risk: term.sort_risk || term.risk
      };
      setBatchResults((rows) =>
        rows.map((row) => {
          const hasIssue = row.issues.some(
            (issue) => (issue.normalized || issue.term.toLowerCase()) === softTarget
          );
          if (!hasIssue) return row;
          return {
            ...row,
            issues: replaceIssue(row.issues, refinedIssue),
            manual_review_required: data.manual_review_required || row.manual_review_required,
            manual_review_reason: data.manual_review_reason || row.manual_review_reason
          };
        })
      );
      await refreshMe();
    } catch (err) {
      if (err.payload?.error === "quota_exceeded") {
        setQuotaExceeded(true);
      } else {
        setError(err.message);
      }
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
    setQuotaExceeded(false);
    setProgress(0);
    setBatchResults([]);
    setSelectedTerm("");
    setExpandedResults(new Set());
    setPage(1);
    try {
      const allowedRows = typeof rowsRemaining === "number" && rowsRemaining >= 0 ? rowsRemaining : batchRows.length;
      if (allowedRows <= 0) {
        setQuotaExceeded(true);
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
      if (err.payload?.error === "quota_exceeded") {
        setQuotaExceeded(true);
      } else {
        setError(err.message);
      }
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
            <textarea className="input check-textarea min-h-[140px] resize-y" value={text} onChange={(event) => setText(event.target.value)} />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`text-sm ${singleTextCounterClass}`}>{text.length} символов</span>
                <button className="primary-button" disabled={loading || !text.trim()} onClick={checkSingle}>
                  <Search className="h-4 w-4" />
                  {loading ? "Проверяем..." : "Проверить"}
                </button>
              </div>
            </div>
          </section>
          {quotaExceeded && <QuotaExceededBanner />}
          {error && <div className="error-box">{error}</div>}
          <ResultView result={result} onRefineIssue={refineSingleIssue} refiningIssue={refiningIssue} canUseAi={canUseAi} aiUnavailableReason={aiUnavailableReason} />
          <UpgradeAfterCheckBanner user={currentUser} result={result} />
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

          {quotaExceeded && <QuotaExceededBanner />}
          {error && <div className="error-box">{error}</div>}
          <BatchSummary
            results={batchResults}
            selectedTerm={selectedTerm}
            onSelectTerm={(term) => { setSelectedTerm(term); setPage(1); }}
            onDownloadXlsx={exportXlsx}
            onDownloadCsv={exportCsv}
            onRefineTerm={refineBatchTerm}
            refiningTerm={refiningIssue}
            canUseAi={canUseAi}
            aiUnavailableReason={aiUnavailableReason}
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
                                      {issue.ai_refined && (
                                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100">
                                          Уточнено ИИ
                                        </span>
                                      )}
                                      {issue.replacements.length > 0 && <span className="text-slate-600 dark:text-slate-300">→ замены: {issue.replacements.join(", ")}</span>}
                                    </div>
                                    {issue.ai_refined && issue.ai_summary && (
                                      <p className="mt-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                                        Вывод ИИ: {localizeSystemText(issue.ai_summary)}
                                      </p>
                                    )}
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
  const [dark, setDark] = useState(() => readBooleanPreference("stopslovo-dark", false));
  const [me, setMe] = useState(null);

  const refreshMe = async () => {
    const data = await getJson("/api/auth/me");
    setMe(data);
    return data;
  };

  useEffect(() => {
    refreshMe().catch(() => setMe({ authenticated: false, plan: "anon" }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("stopslovo-dark", String(dark));
    } catch {
      // Theme persistence is optional.
    }
  }, [dark]);

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
    await deleteSavedState(HOME_STATE_KEY);
    try {
      sessionStorage.clear();
    } catch {
      // Ignore storage failures on logout.
    }
    setMe({ authenticated: false, plan: "anon" });
    window.location.replace("/");
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
                  <QuotaWidget user={user} />
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

        <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8">
          <Routes>
            <Route path="/" element={<HomePage me={me} refreshMe={refreshMe} />} />
            <Route path="/login" element={<Login onLogin={login} />} />
            <Route path="/register" element={<Register onRegister={register} />} />
            <Route path="/pricing" element={<Pricing user={user} />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/admin" element={<Admin user={user} />} />
            <Route path="/admin/allowlist" element={<AllowlistAdmin user={user} />} />
          </Routes>
        </div>
        <Footer />
      </main>
    </div>
  );
}
