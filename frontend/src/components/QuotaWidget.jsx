const planLabels = {
  anon: "Без регистрации",
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Агентство S",
  agency_m: "Агентство M"
};

function formatLimit(value) {
  return value < 0 ? "∞" : Number(value || 0).toLocaleString("ru-RU");
}

function Meter({ label, used, limit }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs text-[#7a7a70] dark:text-[#c1d0cc]">
        <span>{label}</span>
        <span>{formatLimit(used)} / {formatLimit(limit)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#d8d8d1] dark:bg-[#2c4050]">
        <div className="h-full rounded-full bg-[#4a7c10] transition-all dark:bg-[#7ed59a]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function QuotaWidget({ user }) {
  if (!user) return null;
  return (
    <section className="border-b border-[#e0e0da] bg-[#f0f0ec]/55 px-4 py-3 dark:border-[#38505c] dark:bg-[#1d2a34]/65">
      <div className="mx-auto grid max-w-6xl gap-3 md:grid-cols-[220px_1fr_1fr] md:items-center">
        <div>
          <p className="eyebrow">лимиты</p>
          <p className="text-sm font-semibold text-[#1a1a18] dark:text-[#f4f7f2]">{planLabels[user.plan] || user.plan}</p>
        </div>
        <Meter label="Символы в месяц" used={user.chars_used ?? 0} limit={user.chars_limit ?? 0} />
        <Meter label="Строки файлов в месяц" used={user.rows_used ?? 0} limit={user.rows_limit ?? 0} />
      </div>
    </section>
  );
}
