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

  const charsUsed = Math.max(Number(user.chars_used || 0), 0);
  const charsLimit = Number(user.chars_limit ?? 0);
  const charsRemaining = user.chars_remaining ?? null;
  const isUnlimited = charsRemaining === -1 || charsLimit === -1;
  const progress = isUnlimited || charsLimit <= 0 ? 100 : Math.min(100, (charsUsed / charsLimit) * 100);

  return (
    <Link
      to="/pricing"
      className="flex cursor-pointer items-center gap-2 rounded-full border border-[#c2d99a] bg-[#eef5e6] px-3 py-1.5 no-underline transition hover:border-[#4a7c10] dark:border-[#3d6020] dark:bg-[#1a2e12]"
    >
      <span className="text-xs font-medium text-[#3d6b10] dark:text-[#a8d870]">
        {planNames[user.plan] ?? "Бесплатный"}
      </span>
      <div className="flex flex-col gap-[3px]">
        <span className="text-[10px] leading-none text-[#5a8a1a] dark:text-[#a8d870]">слова</span>
        <div className="h-[3px] w-[60px] overflow-hidden rounded-full bg-[#c8dfa0] dark:bg-[#315020]">
          <div className="h-full rounded-full bg-[#4a7c10] dark:bg-[#7ed59a]" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <span className="whitespace-nowrap text-[11px] text-[#5a8a1a] dark:text-[#a8d870]">
        {isUnlimited ? "без ограничений" : charsRemaining !== null ? `${formatLimit(charsRemaining)} осталось` : ""}
      </span>
    </Link>
  );
}
