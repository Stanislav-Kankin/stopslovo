const plans = [
  {
    id: "freelancer",
    name: "Фрилансер",
    price: "1 990 ₽/мес",
    features: ["До 3 клиентов", "10 000 слов в месяц", "5 000 строк файлов в месяц", "Экспорт XLSX / CSV"]
  },
  {
    id: "agency_s",
    name: "Агентство S",
    price: "5 990 ₽/мес",
    features: ["До 20 клиентов", "120 000 слов в месяц", "50 000 строк файлов в месяц", "Экспорт XLSX / CSV"]
  },
  {
    id: "agency_m",
    name: "Агентство M",
    price: "12 990 ₽/мес",
    features: ["Без лимита слов", "Без лимита строк файлов", "Полный отчёт", "Экспорт XLSX / CSV"]
  },
  {
    id: "one_time",
    name: "Разовая проверка",
    price: "490 ₽/файл",
    features: ["Один файл", "Без подписки", "Подходит для первой проверки", "Отчёт XLSX / CSV"]
  }
];

const planLabels = {
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Агентство S",
  agency_m: "Агентство M"
};

export function Pricing({ user }) {
  return (
    <section className="space-y-5">
      <div>
        <p className="eyebrow">тарифы</p>
        <h1 className="section-title">Выберите формат проверки</h1>
        <p className="text-slate-600 dark:text-slate-300">
          Сейчас оплата показана как заглушка. Подключение ЮKassa будет отдельным шагом.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const active = user?.plan === plan.id;
          return (
            <article key={plan.id} className={`panel flex min-h-[280px] flex-col ${active ? "ring-2 ring-[#4a7c10] dark:ring-[#7ed59a]" : ""}`}>
              <div>
                <h2 className="text-xl font-semibold">{plan.name}</h2>
                <p className="mt-2 text-2xl font-bold text-[#4a7c10] dark:text-[#7ed59a]">{plan.price}</p>
              </div>
              <ul className="my-5 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                {plan.features.map((feature) => <li key={feature}>• {feature}</li>)}
              </ul>
              <button className={active ? "secondary-button mt-auto" : "primary-button mt-auto"} onClick={() => alert("Оплата будет подключена позже")}>
                {active ? "Текущий тариф" : "Выбрать тариф"}
              </button>
            </article>
          );
        })}
      </div>
      {user && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Сейчас у вас тариф: {planLabels[user.plan] || user.plan}.
        </p>
      )}
    </section>
  );
}
