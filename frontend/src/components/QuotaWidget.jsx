const planLabels = {
  anon: "Без регистрации",
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Агентство S",
  agency_m: "Агентство M"
};

function formatLimit(value) {
  return value < 0 ? "∞" : value.toLocaleString("ru-RU");
}

export function QuotaWidget({ user }) {
  if (!user) return null;
  const limit = user.chars_limit ?? 0;
  const used = user.chars_used ?? 0;
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;

  return (
    <div className="hidden min-w-[190px] text-xs text-[#7a7a70] dark:text-[#c1d0cc] md:block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span>{planLabels[user.plan] || user.plan}</span>
        <span>{formatLimit(used)} / {formatLimit(limit)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#d8d8d1] dark:bg-[#2c4050]">
        <div className="h-full rounded-full bg-[#4a7c10] transition-all dark:bg-[#7ed59a]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
