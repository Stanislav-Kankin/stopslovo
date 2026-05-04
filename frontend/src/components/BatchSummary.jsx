import { useState } from "react";

const riskLabels = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  safe: "Без замечаний",
};

const riskClass = {
  high: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800",
  medium: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800",
  low: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-[#25394a] dark:text-[#d6e6ef] dark:border-[#48687a]",
  safe: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800",
};

const riskBorderLeft = {
  high: "border-l-[#e24b4a]",
  medium: "border-l-[#ef9f27]",
  low: "border-l-[#888780]",
  safe: "border-l-[#639922]",
};

const riskWeight = { high: 4, medium: 3, low: 2, safe: 1 };

function RiskBadge({ risk }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${riskClass[risk] || riskClass.safe}`}>
      {riskLabels[risk] || risk}
    </span>
  );
}

function AiRobotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="#7ed59a" strokeWidth="1.2" />
      <circle cx="5.8" cy="7.2" r="1" fill="#7ed59a" />
      <circle cx="10.2" cy="7.2" r="1" fill="#7ed59a" />
      <path d="M5.5 10.5 Q8 12.5 10.5 10.5" stroke="#7ed59a" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <line x1="8" y1="2" x2="8" y2="2.5" stroke="#a8d870" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="1.5" r="0.8" fill="#a8d870" />
    </svg>
  );
}

function SourcesToggle({ sources }) {
  const [open, setOpen] = useState(false);
  if (!sources?.length) return null;
  return (
    <div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="text-[11px] text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
      >
        {open ? "Скрыть источники" : "Источники"}
      </button>
      {open && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          {sources.join(" · ")}
        </p>
      )}
    </div>
  );
}

function adsLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "объявление";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "объявления";
  return "объявлений";
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

export function aggregateByTerm(results) {
  const map = {};
  for (const result of results) {
    for (const issue of uniqueIssues(result.issues)) {
      const key = issue.normalized || issue.term.toLowerCase();
      if (!map[key]) {
        map[key] = {
          term: issue.term,
          normalized: issue.normalized,
          category: issue.category,
          risk: issue.risk,
          sort_risk: issue.sort_risk || issue.risk,
          replacements: issue.replacements || [],
          sources: issue.sources || [],
          ai_refined: Boolean(issue.ai_refined),
          ai_summary: issue.ai_summary || "",
          count: 0,
          ads: []
        };
      }
      map[key].count += 1;
      map[key].ads.push(result.request_id);
      for (const source of issue.sources || []) {
        if (!map[key].sources.includes(source)) {
          map[key].sources.push(source);
        }
      }
      if (riskWeight[issue.risk] > riskWeight[map[key].risk]) {
        map[key].risk = issue.risk;
      }
      if (riskWeight[issue.sort_risk || issue.risk] > riskWeight[map[key].sort_risk]) {
        map[key].sort_risk = issue.sort_risk || issue.risk;
      }
      if (!map[key].replacements.length && issue.replacements?.length) {
        map[key].replacements = issue.replacements;
      }
      if (issue.ai_refined) {
        map[key].ai_refined = true;
        map[key].ai_summary = issue.ai_summary || map[key].ai_summary;
      }
    }
  }
  return Object.values(map).sort((a, b) => riskWeight[b.sort_risk || b.risk] - riskWeight[a.sort_risk || a.risk] || b.count - a.count);
}

export function BatchSummary({ results, selectedTerm, onSelectTerm, onDownloadXlsx, onDownloadCsv, onRefineTerm, refiningTerm, canUseAi, aiUnavailableReason }) {
  const terms = aggregateByTerm(results);
  const adsWithIssues = results.filter((item) => item.issues.length > 0).length;

  if (!results.length) return null;

  return (
    <section className="panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <strong>Найдено проблемных слов: {terms.length}</strong>
          <span className="mx-2 text-slate-400">·</span>
          Объявлений с замечаниями: {adsWithIssues} / {results.length}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="primary-button" onClick={onDownloadXlsx}>Скачать XLSX</button>
          <button className="secondary-button" onClick={onDownloadCsv}>Скачать CSV</button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {terms.map((term) => {
          const selected = selectedTerm === term.normalized;
          const termKey = `${term.normalized || term.term.toLowerCase()}|${term.category || ""}`;
          const isRefining = refiningTerm === term.normalized || refiningTerm === termKey;

          return (
            <div
              key={term.normalized}
              onClick={() => onSelectTerm(selected ? "" : term.normalized)}
              className={`cursor-pointer rounded-xl border border-l-4 border-[#e0e0da] bg-white px-4 py-3 transition dark:border-[#38505c] dark:bg-[#22313b] ${riskBorderLeft[term.risk] || riskBorderLeft.low} ${selected ? "ring-1 ring-[#4a7c10] dark:ring-[#7ed59a]" : "hover:bg-[#f7f7f3] dark:hover:bg-[#1b2a34]"}`}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[15px] font-medium text-[#1a1a18] dark:text-[#f4f7f2]">
                  {term.term}
                </span>
                <RiskBadge risk={term.risk} />
                {term.ai_refined && (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100">
                    Уточнено ИИ
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                  {term.count} {adsLabel(term.count)}
                </span>
              </div>

              {term.replacements.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Замены:</span>
                  {term.replacements.map((replacement) => (
                    <button
                      key={replacement}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigator.clipboard.writeText(replacement);
                      }}
                      title="Скопировать"
                      className="rounded-full border border-[#e0e0da] bg-[#f7f7f3] px-2.5 py-0.5 text-xs text-[#1a1a18] transition hover:border-[#4a7c10] hover:text-[#4a7c10] dark:border-[#38505c] dark:bg-[#182630] dark:text-[#f4f7f2] dark:hover:border-[#7ed59a] dark:hover:text-[#7ed59a]"
                    >
                      {replacement}
                    </button>
                  ))}
                </div>
              )}

              {term.ai_refined && term.ai_summary && (
                <p className="mb-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                  {term.ai_summary}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <SourcesToggle sources={term.sources} />

                {canUseAi && onRefineTerm && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRefineTerm(term);
                    }}
                    disabled={isRefining}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#4a7c10] bg-[#1a2e12] px-3 py-1.5 text-xs font-medium text-[#a8d870] transition hover:bg-[#213d17] disabled:opacity-50 dark:bg-[#0f1f0a] dark:hover:bg-[#1a2e12]"
                  >
                    <AiRobotIcon />
                    {isRefining ? "Анализирую…" : "Уточнить через ИИ"}
                  </button>
                )}

                {!canUseAi && aiUnavailableReason && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {aiUnavailableReason}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTerm && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Ниже показаны объявления, где встречается выбранное слово.
        </p>
      )}
    </section>
  );
}
