const riskLabels = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  safe: "Без замечаний"
};

const riskWeight = { high: 4, medium: 3, low: 2, safe: 1 };

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
      if (!map[key].replacements.length && issue.replacements?.length) {
        map[key].replacements = issue.replacements;
      }
      if (issue.ai_refined) {
        map[key].ai_refined = true;
        map[key].ai_summary = issue.ai_summary || map[key].ai_summary;
      }
    }
  }
  return Object.values(map).sort((a, b) => riskWeight[b.risk] - riskWeight[a.risk] || b.count - a.count);
}

export function BatchSummary({ results, selectedTerm, onSelectTerm, onDownloadXlsx, onDownloadCsv, onRefineTerm, refiningTerm }) {
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

      <div className="overflow-hidden rounded-md border border-slate-200 dark:border-[#38505c]">
        <div className="hidden grid-cols-[1fr_100px_80px_1.2fr_1.4fr_130px] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-[#38505c] dark:bg-[#1b2a34] dark:text-[#c7d5d1] md:grid">
          <span>Слово</span>
          <span>Риск</span>
          <span>Встреч.</span>
          <span>Замены</span>
          <span>Источники</span>
          <span>ИИ</span>
        </div>
        <div className="max-h-[360px] divide-y divide-slate-200 overflow-auto dark:divide-[#38505c]">
          {terms.map((term) => {
            const selected = selectedTerm === term.normalized;
            const termKey = `${term.normalized || term.term.toLowerCase()}|${term.category || ""}`;
            return (
              <div
                key={term.normalized}
                className={`grid w-full cursor-pointer grid-cols-1 gap-2 px-3 py-3 text-left text-sm transition md:grid-cols-[1fr_100px_80px_1.2fr_1.4fr_130px] md:gap-3 md:py-2 ${selected ? "bg-emerald-50 dark:bg-[#203c34]" : "hover:bg-slate-50 dark:hover:bg-[#1b2a34]"}`}
                onClick={() => onSelectTerm(selected ? "" : term.normalized)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{term.term}</strong>
                  {term.ai_refined && (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100">
                      Уточнено
                    </span>
                  )}
                </div>
                <span>{riskLabels[term.risk] || term.risk}</span>
                <span>{term.count}</span>
                <span className="text-slate-600 dark:text-slate-300">{term.replacements.length ? term.replacements.join(", ") : "Проверить вручную"}</span>
                <span className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {term.sources.length ? term.sources.join("; ") : "Источник не указан"}
                  {term.ai_refined && term.ai_summary && (
                    <span className="mt-1 block rounded-md border border-sky-100 bg-sky-50 px-2 py-1 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                      ИИ: {term.ai_summary}
                    </span>
                  )}
                </span>
                <button
                  className="secondary-button text-xs"
                  disabled={refiningTerm === termKey}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRefineTerm?.(term);
                  }}
                >
                  {refiningTerm === termKey ? "Уточняем..." : "Уточнить ИИ"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {selectedTerm && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Ниже показаны объявления, где встречается выбранное слово.
        </p>
      )}
    </section>
  );
}
