const planLabels = {
  anon: "Без регистрации",
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Агентство S",
  agency_m: "Агентство M",
  one_time: "Разовая проверка"
};

function formatLimit(value) {
  return value < 0 ? "∞" : Number(value || 0).toLocaleString("ru-RU");
}

function Meter({ label, used, limit }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const remaining = limit < 0 ? -1 : Math.max((limit || 0) - (used || 0), 0);
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm font-medium text-[#65655d] dark:text-[#c1d0cc]">
        <span>{label}</span>
        <span>осталось {formatLimit(remaining)} / {formatLimit(limit)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border border-[#cbd0c2] bg-[#dfe3d8] shadow-inner dark:border-[#3b5361] dark:bg-[#2a3c4a]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#3f760e] via-[#4f8e18] to-[#6cae35] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_4px_rgba(74,124,16,0.35)] transition-all dark:from-[#63c384] dark:via-[#7ed59a] dark:to-[#a6ebba]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function QuotaWidget({ user }) {
  if (!user) return null;
  return (
    <section className="border-b border-[#e0e0da] bg-[#f7f7f4]/85 px-4 py-4 dark:border-[#38505c] dark:bg-[#1d2a34]/75">
      <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-[220px_1fr_1fr_1fr] md:items-center">
        <div>
          <p className="eyebrow">лимиты</p>
          <p className="text-base font-semibold leading-tight text-[#1a1a18] dark:text-[#f4f7f2]">{planLabels[user.plan] || user.plan}</p>
        </div>
        <Meter label="Лимит слов" used={user.chars_used ?? 0} limit={user.chars_limit ?? 0} />
        <Meter label="Лимит строк файлов" used={user.rows_used ?? 0} limit={user.rows_limit ?? 0} />
        <Meter label="ИИ-подсказки" used={user.ai_used ?? 0} limit={user.ai_limit ?? 0} />
      </div>
    </section>
  );
}
