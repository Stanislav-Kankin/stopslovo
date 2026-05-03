import { Link } from "react-router-dom";

const planNames = {
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Агентство S",
  agency_m: "Агентство M",
  one_time: "Разовая",
};

function formatLimit(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

export function QuotaWidget({ user }) {
  if (!user) return null;
  const charsLeft = user.chars_remaining ?? null;
  const isUnlimited = charsLeft === -1;

  return (
    <Link
      to="/pricing"
      className="flex items-center gap-2 rounded-lg border border-[#e0e0da] bg-white/60 px-3 py-1.5 text-sm transition hover:border-[#4a7c10] dark:border-[#38505c] dark:bg-[#182630]/60 dark:hover:border-[#7ed59a]"
    >
      <span className="font-medium text-[#4a7c10] dark:text-[#7ed59a]">
        {planNames[user.plan] ?? "Бесплатный"}
      </span>
      <span className="text-[#7a7a70] dark:text-[#94aaa3]">
        {isUnlimited ? "без ограничений" : charsLeft !== null ? `${formatLimit(charsLeft)} слов осталось` : ""}
      </span>
    </Link>
  );
}
