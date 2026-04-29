import { useEffect, useState } from "react";

const planLabels = {
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Агентство S",
  agency_m: "Агентство M"
};

export function Admin({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.email !== "admin@admin.ru") return;
    fetch("/api/admin/overview", { credentials: "include" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Не удалось загрузить админку");
        return payload;
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user]);

  if (user?.email !== "admin@admin.ru") {
    return (
      <section className="panel">
        <h1 className="section-title">Админка</h1>
        <p className="text-slate-600 dark:text-slate-300">Доступ только для администратора.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <p className="eyebrow">управление</p>
        <h1 className="section-title">Админка</h1>
      </div>
      {error && <div className="error-box">{error}</div>}
      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="panel">
              <p className="eyebrow">пользователи</p>
              <strong className="text-3xl">{data.users_count}</strong>
            </div>
            <div className="panel">
              <p className="eyebrow">записи квот</p>
              <strong className="text-3xl">{data.usage_records_count}</strong>
            </div>
            <div className="panel">
              <p className="eyebrow">тарифы</p>
              <div className="mt-2 grid gap-1 text-sm">
                {data.plans.map((item) => (
                  <span key={item.plan}>{planLabels[item.plan] || item.plan}: {item.count}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="panel">
            <p className="eyebrow">последние пользователи</p>
            <div className="mt-3 overflow-hidden rounded-md border border-slate-200 dark:border-[#38505c]">
              {data.recent_users.map((item) => (
                <div key={item.id} className="grid gap-2 border-b border-slate-200 px-3 py-2 text-sm last:border-b-0 dark:border-[#38505c] md:grid-cols-[1fr_140px_180px]">
                  <span className="font-medium">{item.email}</span>
                  <span>{planLabels[item.plan] || item.plan}</span>
                  <span className="text-slate-500 dark:text-slate-400">{new Date(item.created_at).toLocaleString("ru-RU")}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
