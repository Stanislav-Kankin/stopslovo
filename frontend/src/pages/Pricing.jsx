import { useEffect, useState } from "react";

const basePlans = [
  {
    id: "free",
    name: "Бесплатный",
    price: "0 ₽",
    period: "навсегда",
    highlight: false,
    features: ["1 800 слов в месяц", "200 строк файлов в месяц", "5 ИИ-анализов в месяц", "Экспорт CSV"],
  },
  {
    id: "freelancer",
    name: "Фрилансер",
    price: "1 990 ₽",
    period: "в месяц",
    highlight: false,
    features: ["10 000 слов в месяц", "5 000 строк файлов в месяц", "ИИ-анализ без ограничений", "Экспорт XLSX / CSV", "Для регулярной проверки рекламы"],
  },
  {
    id: "agency_s",
    name: "Команда",
    price: "5 990 ₽",
    period: "в месяц",
    highlight: true,
    badge: "Популярный",
    features: ["120 000 слов в месяц", "50 000 строк файлов в месяц", "ИИ-анализ без ограничений", "Экспорт XLSX / CSV", "Для небольших команд", "Приоритетная поддержка"],
  },
  {
    id: "agency_m",
    name: "Агентство",
    price: "12 990 ₽",
    period: "в месяц",
    highlight: false,
    features: ["Без лимита слов", "Без лимита строк файлов", "ИИ-анализ без ограничений", "Экспорт XLSX / CSV", "Для большого потока проверок", "Приоритетная поддержка"],
  },
  {
    id: "one_time",
    name: "Разовая проверка",
    price: "490 ₽",
    period: "за файл",
    highlight: false,
    features: ["Один файл до 2 000 строк", "До 5 000 слов в режиме текста", "ИИ-анализ без ограничений", "Отчёт XLSX / CSV"],
    note: "Идеально для разового аудита. После оплаты — ссылка на результат.",
  },
];

const planLabels = {
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Команда",
  agency_m: "Агентство",
  one_time: "Разовая проверка",
};

function formatLimit(value) {
  return value < 0 ? "∞" : Number(value || 0).toLocaleString("ru-RU");
}

function formatPriceKopecks(value) {
  const amount = Number(value || 0) / 100;
  return `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
}

async function fetchBillingPlans() {
  const response = await fetch("/api/billing/plans", { credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || "Не удалось загрузить тарифы.");
  }
  return payload.items || [];
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function daysUntil(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (diff <= 0) return "сегодня";
  return `${diff} дн.`;
}

async function createCheckout(plan) {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || "Не удалось создать ссылку на оплату.");
  }
  return payload;
}

async function syncPayment(paymentId) {
  const response = await fetch(`/api/billing/payments/${paymentId}/sync`, {
    method: "POST",
    credentials: "include",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || "Не удалось проверить оплату.");
  }
  return payload;
}

function Meter({ label, used, limit, rollover, rolloverExpiresAt }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-medium text-[#65655d] dark:text-[#c1d0cc]">
        <span>{label}</span>
        <span>{formatLimit(used)} / {formatLimit(limit)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border border-[#cbd0c2] bg-[#dfe3d8] shadow-inner dark:border-[#3b5361] dark:bg-[#2a3c4a]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#3f760e] via-[#4f8e18] to-[#6cae35] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_4px_rgba(74,124,16,0.35)] transition-all dark:from-[#63c384] dark:via-[#7ed59a] dark:to-[#a6ebba]"
          style={{ width: `${percent}%` }}
        />
      </div>
      {rollover > 0 && (
        <p className="text-xs text-[#7a7a70] dark:text-[#94aaa3]">
          + {formatLimit(rollover)} перенесённых{rolloverExpiresAt ? `, сгорают ${formatDate(rolloverExpiresAt)}` : ""}
        </p>
      )}
    </div>
  );
}

function CurrentPlan({ user, onRenew, isPaying }) {
  if (!user) return null;
  const renewalDate = user.plan === "free" ? user.quota_resets_at : user.plan_expires_at;
  const renewalText = renewalDate
    ? user.plan === "free"
      ? `до обновления: ${daysUntil(renewalDate)}`
      : `действует до: ${formatDate(renewalDate)}`
    : null;
  return (
    <section className="panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">текущий план</p>
          <h2 className="section-title">Ваш текущий тариф: {planLabels[user.plan] || user.plan}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {renewalText && <span className="rounded-full border border-[#d6d8cf] bg-white/70 px-3 py-1 text-xs font-medium text-[#65655d] dark:border-[#3b5361] dark:bg-[#243744]/70 dark:text-[#c1d0cc]">{renewalText}</span>}
          {user.plan !== "free" && user.plan !== "one_time" && (
            <button
              className="primary-button px-4 py-2 text-sm"
              disabled={isPaying === user.plan}
              onClick={() => onRenew(user.plan)}
            >
              {isPaying === user.plan ? "Готовим оплату..." : "Продлить доступ"}
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Meter label="Слова" used={user.chars_used ?? 0} limit={user.chars_limit ?? 0} rollover={user.chars_rollover ?? 0} rolloverExpiresAt={user.rollover_expires_at} />
        <Meter label="Строки файлов" used={user.rows_used ?? 0} limit={user.rows_limit ?? 0} rollover={user.rows_rollover ?? 0} rolloverExpiresAt={user.rollover_expires_at} />
        <Meter label="ИИ-анализ" used={user.ai_used ?? 0} limit={user.ai_limit ?? 0} rollover={user.ai_rollover ?? 0} rolloverExpiresAt={user.rollover_expires_at} />
      </div>
    </section>
  );
}

export function Pricing({ user }) {
  const [payingPlan, setPayingPlan] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [plans, setPlans] = useState(basePlans);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentId = params.get("payment_id");
    if (!paymentId) return;

    let cancelled = false;
    syncPayment(paymentId)
      .then((payload) => {
        if (cancelled) return;
        if (payload.status === "succeeded") {
          setPaymentNotice("Оплата прошла, тариф активирован. Обновляем данные...");
          window.history.replaceState({}, "", window.location.pathname);
          setTimeout(() => window.location.reload(), 900);
        } else {
          setPaymentNotice("Платёж создан. Если вы уже оплатили, статус обновится после уведомления ЮKassa.");
          window.history.replaceState({}, "", window.location.pathname);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setPaymentError(error.message || "Не удалось проверить оплату.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBillingPlans()
      .then((items) => {
        if (cancelled) return;
        const catalog = new Map(items.map((item) => [item.id, item]));
        setPlans(
          basePlans.map((plan) => {
            const paidPlan = catalog.get(plan.id);
            if (!paidPlan) return plan;
            return {
              ...plan,
              price: formatPriceKopecks(paidPlan.amount_kopecks),
              amount_kopecks: paidPlan.amount_kopecks,
            };
          })
        );
      })
      .catch(() => {
        if (!cancelled) setPlans(basePlans);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function startPayment(planId) {
    if (planId === "free") return;
    setPaymentError("");
    setPayingPlan(planId);
    try {
      const payload = await createCheckout(planId);
      if (payload.confirmation_url) {
        window.location.href = payload.confirmation_url;
        return;
      }
      setPaymentError("Ссылка на оплату не получена. Попробуйте ещё раз или напишите в поддержку.");
    } catch (error) {
      setPaymentError(error.message || "Не удалось создать ссылку на оплату.");
    } finally {
      setPayingPlan("");
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="eyebrow">тарифы</p>
        <h1 className="section-title">Выберите формат проверки</h1>
        <p className="text-slate-600 dark:text-slate-300">Сравните текущие лимиты и выберите тариф под объём рекламных текстов.</p>
      </div>

      <CurrentPlan user={user} onRenew={startPayment} isPaying={payingPlan} />

      {paymentError && (
        <div className="rounded-[12px] border border-[#f2c7c7] bg-[#fff0f0] px-4 py-3 text-sm text-[#a32d2d] dark:border-[#7c2f2f] dark:bg-[#321d1d] dark:text-[#f2b8b8]">
          {paymentError}
        </div>
      )}

      {paymentNotice && (
        <div className="rounded-[12px] border border-[#c8e6a0] bg-[#f0f7e6] px-4 py-3 text-sm text-[#2d5010] dark:border-[#3d6020] dark:bg-[#1e2d10] dark:text-[#a8d870]">
          {paymentNotice}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {plans.map((plan) => {
          const active = user?.plan === plan.id;
          const cardClass = `${plan.highlight ? "panel-featured" : "plan-card"} flex min-h-[340px] flex-col ${active ? "ring-2 ring-[#4a7c10] dark:ring-[#7ed59a]" : ""}`;
          return (
            <article key={plan.id} className={cardClass}>
              {plan.badge && <span className="absolute right-4 top-4 rounded-full bg-[#4a7c10] px-2 py-0.5 text-xs text-white">{plan.badge}</span>}
              <div>
                <h2 className={`text-xl font-semibold ${plan.badge ? "pr-24" : ""}`}>{plan.name}</h2>
                <p className="mt-2 whitespace-nowrap text-2xl font-bold text-[#4a7c10] dark:text-[#7ed59a]">{plan.price}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{plan.period}</p>
              </div>
              <ul className="my-5 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                {plan.features.map((feature) => <li key={feature}>• {feature}</li>)}
              </ul>
              {plan.note && <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">{plan.note}</p>}
              <button
                className={active ? "secondary-button mt-auto cursor-default" : "primary-button mt-auto"}
                disabled={active}
                onClick={() => startPayment(plan.id)}
              >
                {active ? "Текущий тариф" : payingPlan === plan.id ? "Готовим оплату..." : "Выбрать тариф"}
              </button>
            </article>
          );
        })}
      </div>

      <div className="panel text-sm text-slate-600 dark:text-slate-300">
        <p>Все тарифы включают проверку по официальным словарям РАН и реестру ФАС.</p>
        <p>Данные обновляются ежемесячно.</p>
        <p>Это автоматическая оценка риска, не юридическое заключение.</p>
      </div>
    </section>
  );
}
