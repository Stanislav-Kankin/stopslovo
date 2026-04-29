import { AlertTriangle, Check, Clipboard, Download, FileText, Moon, Search, Sun } from "lucide-react";
import { useMemo, useState } from "react";

import { parseCsv, toCsv } from "./utils/csv";

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

function RiskBadge({ risk }) {
  return <span className={`badge border ${riskClass[risk] || riskClass.safe}`}>{riskLabels[risk] || risk}</span>;
}

function HighlightedText({ text, issues }) {
  const terms = issues.filter((issue) => ["high", "medium"].includes(issue.risk)).map((issue) => issue.term);
  if (!terms.length) return <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{text}</p>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
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
          <h2 className="section-title">Исходный текст</h2>
          <HighlightedText text={result.original_text} issues={result.issues} />
        </div>
        <div className="panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="section-title">Переписанный текст</h2>
            <button className="icon-button" onClick={copy} title="Скопировать">
              {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
            </button>
          </div>
          <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{result.rewritten_text}</p>
        </div>
      </div>

      <div className="panel">
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
  const [progress, setProgress] = useState(0);
  const [sortDesc, setSortDesc] = useState(true);

  const sortedResults = useMemo(
    () => [...batchResults].sort((a, b) => (sortDesc ? riskWeight[b.overall_risk] - riskWeight[a.overall_risk] : riskWeight[a.overall_risk] - riskWeight[b.overall_risk])),
    [batchResults, sortDesc]
  );

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

  const loadCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseCsv(await file.text()).map((row, index) => ({
      request_id: row.id || `row-${index + 1}`,
      text: row.text,
      context_type: row.context_type || "сайт"
    }));
    setBatchRows(parsed);
    setBatchResults([]);
    setProgress(0);
  };

  const checkBatch = async () => {
    setLoading(true);
    setError("");
    setProgress(15);
    try {
      const data = await postJson("/api/v1/check/batch", { items: batchRows });
      setBatchResults(data.items);
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
    link.download = "stopslovo-results.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={dark ? "dark" : ""}>
      <main className="min-h-screen bg-sky-50/40 text-slate-950 transition-colors dark:bg-slate-950 dark:text-white">
        <header className="site-header">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
            <div>
              <h1 className="font-serif text-5xl leading-none tracking-normal text-slate-950 dark:text-white">СтопСлово</h1>
              <p className="mt-2 text-sm font-medium text-slate-600 dark:text-sky-100/80">Автоматическая оценка риска для рекламных текстов</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden rounded-md border border-sky-200 bg-white/65 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm dark:border-sky-800/70 dark:bg-slate-950/35 dark:text-sky-100 sm:inline-flex">
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
              <FileText className="h-4 w-4" /> Batch CSV
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
                  <input className="input max-w-lg" type="file" accept=".csv,text/csv" onChange={loadCsv} />
                  <button className="primary-button" disabled={loading || batchRows.length === 0} onClick={checkBatch}>
                    {loading ? "Обрабатываем..." : `Проверить ${batchRows.length || ""}`}
                  </button>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-accent-light transition-all dark:bg-accent-dark" style={{ width: `${progress}%` }} />
                </div>
              </div>
              {error && <div className="error-box">{error}</div>}
              {batchResults.length > 0 && (
                <div className="panel overflow-x-auto">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <button className="secondary-button" onClick={() => setSortDesc((value) => !value)}>Сортировать по риску</button>
                    <button className="secondary-button" onClick={exportCsv}><Download className="h-4 w-4" /> CSV</button>
                  </div>
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="py-2 pr-3">ID</th>
                        <th className="py-2 pr-3">Риск</th>
                        <th className="py-2 pr-3">Замечаний</th>
                        <th className="py-2 pr-3">Ручная проверка</th>
                        <th className="py-2 pr-3">Резюме</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((item) => (
                        <tr key={item.request_id} className="border-t border-slate-200 dark:border-slate-800">
                          <td className="py-3 pr-3">{item.request_id}</td>
                          <td className="py-3 pr-3"><RiskBadge risk={item.overall_risk} /></td>
                          <td className="py-3 pr-3">{item.issues.length}</td>
                          <td className="py-3 pr-3">{item.manual_review_required ? "Да" : "Нет"}</td>
                          <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">{item.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
