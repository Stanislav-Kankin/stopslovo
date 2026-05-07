import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Share2 } from "lucide-react";

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
const SOURCE_ID_COLUMNS = [
  "ID объявления",
  "№ объявления",
  "ID объявления (серверный)",
  "ID объявления (локальный)",
  "ID кампании",
  "ID кампании (серверный)",
  "ID кампании (локальный)",
  "ID группы",
  "id объявления",
  "id кампании",
  "id группы",
  "ID",
  "id"
];

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
        {open ? "Скрыть методику" : "Методика проверки"}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-[#e0e0da] bg-[#f7f7f3] px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-[#38505c] dark:bg-[#182630] dark:text-slate-400">
          <p className="mb-1 font-medium text-[#62625a] dark:text-[#c1d0cc]">Проверка опирается на словари риска сервиса и подключённые нормативные словари. Это не юридическое заключение.</p>
          <ul className="grid gap-1">
            {sources.map((source) => <li key={source}>• {source}</li>)}
          </ul>
        </div>
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

function formatAdIds(ids = []) {
  const visible = ids.slice(0, 12);
  const rest = ids.length - visible.length;
  return `${visible.join(", ")}${rest > 0 ? ` и ещё ${rest}` : ""}`;
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

function sourceValue(source = {}, variants = []) {
  const entries = Object.entries(source || {});
  for (const variant of variants) {
    const found = entries.find(([key]) => String(key).trim().toLowerCase() === String(variant).trim().toLowerCase());
    if (found && String(found[1] ?? "").trim()) return String(found[1]).trim();
  }
  return "";
}

function sourceRowsByRequestId(sourceRows = []) {
  return new Map(sourceRows.map((row) => [row.request_id, row]));
}

function displayId(row, sourceLookup = new Map()) {
  if (row?.display_id) return String(row.display_id);
  const requestId = String(row?.request_id || "");
  if (requestId && !/^row-\d+$/i.test(requestId)) return requestId;
  const sourceRow = sourceLookup.get(requestId);
  return sourceValue(sourceRow?.source, SOURCE_ID_COLUMNS) || requestId;
}

function MethodologyBanner() {
  return (
    <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm dark:border-[#3d6880] dark:bg-[#1e3442]">
      <p className="mb-1 font-semibold text-[#17445b] dark:text-[#d6eef8]">Источники и методика проверки</p>
      <p className="leading-relaxed text-slate-700 dark:text-[#d6eef8]">
        На первом уровне используются официальные словари: орфографический и орфоэпический словари РАН,
        словарь иностранных слов РАН и толковый словарь государственного языка. Затем применяются словарь
        риска СтопСлово, белый список и результаты ИИ-уточнений.
      </p>
      <p className="mt-1 leading-relaxed text-slate-700 dark:text-[#d6eef8]">
        Источники по каждому слову можно раскрыть в карточке через кнопку «Методика проверки».
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-[#b9d9e6]">
        Это автоматическая оценка риска, не юридическое заключение.
      </p>
    </div>
  );
}

export function aggregateByTerm(results, sourceRows = []) {
  const map = {};
  const sourceLookup = sourceRowsByRequestId(sourceRows);
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
      const id = displayId(result, sourceLookup);
      if (id && !map[key].ads.includes(id)) {
        map[key].ads.push(id);
      }
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

export function BatchSummary({
  results,
  selectedTerm,
  onSelectTerm,
  onDownloadXlsx,
  onDownloadCsv,
  onDownloadUpdatedXlsx,
  onDownloadUpdatedCsv,
  onShare,
  shareUrl = "",
  shareError = "",
  replacementChoices = {},
  sourceRows = [],
  onSelectReplacement,
  onRefineTerm,
  onIgnoreTerm,
  refiningTerm,
  canUseAi,
  aiUnavailableReason
}) {
  const terms = aggregateByTerm(results, sourceRows);
  const adsWithIssues = results.filter((item) => item.issues.length > 0).length;
  const [shareFlash, setShareFlash] = useState(false);

  useEffect(() => {
    if (!shareUrl) return undefined;
    setShareFlash(true);
    const timer = window.setTimeout(() => setShareFlash(false), 1400);
    return () => window.clearTimeout(timer);
  }, [shareUrl]);

  if (!results.length) return null;

  return (
    <section className="panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <strong>Найдено проблемных слов: {terms.length}</strong>
          <span className="mx-2 text-slate-400">·</span>
          Объявлений с замечаниями: {adsWithIssues} / {results.length}
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {onShare && (
            <div className="relative min-w-[240px]">
              <button className={`secondary-button ${shareFlash ? "animate-pulse border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100" : ""}`} onClick={onShare}>
                <Share2 className="h-4 w-4" /> {shareUrl ? "Ссылка готова" : "Поделиться"}
              </button>
              {shareUrl && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-[min(78vw,620px)] rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 shadow-lg dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
                  <span className="font-semibold">Отчёт:</span>{" "}
                  <a className="underline" href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
                </div>
              )}
              {shareError && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-[min(78vw,520px)] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                  Не удалось создать ссылку: {shareError}
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#c8e6a0] bg-[#f5faf0] p-1.5 dark:border-[#3d6020] dark:bg-[#1a2810]">
            <span className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4a7c10] dark:text-[#a8d870]">
              для загрузки
            </span>
            {onDownloadUpdatedCsv && (
              <button className="primary-button" onClick={onDownloadUpdatedCsv}>
                <Download className="h-4 w-4" /> CSV
              </button>
            )}
            {onDownloadUpdatedXlsx && (
              <button className="secondary-button" onClick={onDownloadUpdatedXlsx}>
                <FileSpreadsheet className="h-4 w-4" /> XLSX
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e0e0da] bg-[#f7f7f3] p-1.5 dark:border-[#38505c] dark:bg-[#182630]">
            <span className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              отчёт
            </span>
            {onDownloadXlsx && (
              <button className="secondary-button" onClick={onDownloadXlsx}>
                <FileSpreadsheet className="h-4 w-4" /> XLSX
              </button>
            )}
            {onDownloadCsv && (
              <button className="secondary-button" onClick={onDownloadCsv}>
                <Download className="h-4 w-4" /> CSV
              </button>
            )}
          </div>
        </div>
      </div>

      <MethodologyBanner />

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
                        if (onSelectReplacement) {
                          onSelectReplacement(term, replacement);
                        } else {
                          navigator.clipboard.writeText(replacement);
                        }
                      }}
                      title={onSelectReplacement ? "Использовать эту замену в файле для загрузки" : "Скопировать"}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                        replacementChoices[String(term.normalized || term.term || "").toLowerCase()] === replacement
                          ? "border-[#4a7c10] bg-[#eef5e6] font-semibold text-[#3d6b10] dark:border-[#7ed59a] dark:bg-[#1a2e12] dark:text-[#a8d870]"
                          : "border-[#e0e0da] bg-[#f7f7f3] text-[#1a1a18] hover:border-[#4a7c10] hover:text-[#4a7c10] dark:border-[#38505c] dark:bg-[#182630] dark:text-[#f4f7f2] dark:hover:border-[#7ed59a] dark:hover:text-[#7ed59a]"
                      }`}
                    >
                      {replacement}
                    </button>
                  ))}
                  {onSelectReplacement && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {replacementChoices[String(term.normalized || term.term || "").toLowerCase()]
                        ? "выбрана для экспорта"
                        : "по умолчанию будет первая"}
                    </span>
                  )}
                </div>
              )}

              {term.ai_refined && term.ai_summary && (
                <p className="mb-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                  {term.ai_summary}
                </p>
              )}

              {term.ads?.length > 0 && (
                <p className="mb-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">ID объявлений:</span>{" "}
                  {formatAdIds(term.ads)}
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

                {onIgnoreTerm && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onIgnoreTerm(term);
                    }}
                    className="inline-flex items-center rounded-lg border border-[#d6d6cf] bg-white px-3 py-1.5 text-xs font-medium text-[#62625a] transition hover:border-[#4a7c10] hover:text-[#4a7c10] dark:border-[#38505c] dark:bg-[#182630] dark:text-[#c1d0cc] dark:hover:border-[#7ed59a] dark:hover:text-[#7ed59a]"
                  >
                    Игнорировать
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
