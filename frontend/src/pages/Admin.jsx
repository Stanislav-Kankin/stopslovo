import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const planLabels = {
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Агентство S",
  agency_m: "Агентство M",
  one_time: "Разовая проверка"
};

export function Admin({ user }) {
  const [data, setData] = useState(null);
  const [allowlistText, setAllowlistText] = useState("");
  const [allowlistSaved, setAllowlistSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.is_admin) return;
    fetch("/api/admin/overview", { credentials: "include" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Не удалось загрузить админку");
        return payload;
      })
      .then(setData)
      .catch((err) => setError(err.message));
    fetch("/api/admin/allowlist", { credentials: "include" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Не удалось загрузить белый список");
        return payload;
      })
      .then((payload) => setAllowlistText((payload.terms || []).join("\n")))
      .catch((err) => setError(err.message));
  }, [user]);

  const saveAllowlist = async () => {
    setError("");
    setAllowlistSaved("");
    try {
      const terms = allowlistText
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      const response = await fetch("/api/admin/allowlist", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Не удалось сохранить белый список");
      setAllowlistText((payload.terms || []).join("\n"));
      setAllowlistSaved(`Сохранено слов и фраз: ${(payload.terms || []).length}`);
      setTimeout(() => setAllowlistSaved(""), 1800);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!user?.is_admin) {
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
            <p className="eyebrow">словарь</p>
            <h2 className="section-title">Общий белый список</h2>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              Слова и фразы отсюда не будут попадать в замечания у всех пользователей. Можно добавлять аббревиатуры, бренды, названия систем и спорные русские термины.
            </p>
            <textarea
              className="input min-h-[160px] resize-y"
              value={allowlistText}
              onChange={(event) => setAllowlistText(event.target.value)}
              placeholder="Например:&#10;РСЯ&#10;масштабироваться&#10;Grand Line"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className="primary-button" onClick={saveAllowlist}>Сохранить белый список</button>
              <Link className="secondary-button" to="/admin/allowlist">Посмотреть белый список</Link>
              {allowlistSaved && <span className="text-sm text-emerald-700 dark:text-emerald-300">{allowlistSaved}</span>}
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
