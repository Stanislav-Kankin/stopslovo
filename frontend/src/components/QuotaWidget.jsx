import { Link } from "react-router-dom";

const planNames = {
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Команда",
  agency_m: "Агентство",
  one_time: "Разовая",
};

function fmt(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

function MiniBar({ label, used, limit, remaining }) {
  const isUnlimited = remaining === -1 || limit === -1;
  const progress = isUnlimited || limit <= 0
    ? 100
    : Math.min(100, (used / limit) * 100);

  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[10px] leading-none text-[#5a8a1a] dark:text-[#a8d870]">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <div className="h-[3px] w-[48px] overflow-hidden rounded-full bg-[#c8dfa0] dark:bg-[#315020]">
          <div
            className="h-full rounded-full bg-[#4a7c10] dark:bg-[#7ed59a]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="whitespace-nowrap text-[10px] text-[#5a8a1a] dark:text-[#a8d870]">
          {isUnlimited ? "∞" : fmt(remaining ?? 0)}
        </span>
      </div>
    </div>
  );
}

export function QuotaWidget({ user }) {
  if (!user) return null;

  return (
    <Link
      to="/pricing"
      className="flex cursor-pointer items-center gap-2.5 rounded-full border border-[#c2d99a] bg-[#eef5e6] px-3 py-1.5 no-underline transition hover:border-[#4a7c10] dark:border-[#3d6020] dark:bg-[#1a2e12]"
    >
      <span className="text-xs font-medium text-[#3d6b10] dark:text-[#a8d870]">
        {planNames[user.plan] ?? "Бесплатный"}
      </span>

      <div className="h-3 w-px bg-[#c2d99a] dark:bg-[#3d6020]" />

      <MiniBar
        label="слова"
        used={user.chars_used ?? 0}
        limit={user.chars_limit ?? 0}
        remaining={user.chars_remaining ?? null}
      />

      <div className="h-3 w-px bg-[#c2d99a] dark:bg-[#3d6020]" />

      <MiniBar
        label="строки"
        used={user.rows_used ?? 0}
        limit={user.rows_limit ?? 0}
        remaining={user.rows_remaining ?? null}
      />
    </Link>
  );
}
