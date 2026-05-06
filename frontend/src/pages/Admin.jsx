import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const planLabels = {
  free: "Бесплатный",
  freelancer: "Фрилансер",
  agency_s: "Команда",
  agency_m: "Агентство",
  one_time: "Разовая проверка"
};

export function Admin({ user }) {
  const [data, setData] = useState(null);
  const [allowlistText, setAllowlistText] = useState("");
  const [allowlistSaved, setAllowlistSaved] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantPlan, setGrantPlan] = useState("agency_m");
  const [grantDays, setGrantDays] = useState("");
  const [grantSaved, setGrantSaved] = useState("");
  const [usersData, setUsersData] = useState(null);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersPage, setUsersPage] = useState(1);
  const [error, setError] = useState("");

  const loadOverview = () => {
    fetch("/api/admin/overview", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Не удалось загрузить админку");
        return payload;
      })
      .then(setData)
      .catch((err) => setError(err.message));
  };

  const loadUsers = (page = usersPage, search = usersSearch) => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (search.trim()) params.set("search", search.trim());
    fetch(`/api/admin/users?${params.toString()}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Не удалось загрузить пользователей");
        return payload;
      })
      .then(setUsersData)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    if (!user?.is_admin) return;
    loadOverview();
    loadUsers(1, "");
    fetch("/api/admin/allowlist", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Не удалось загрузить белый список");
        return payload;
      })
      .then((payload) => setAllowlistText((payload.terms || []).join("\n")))
      .catch((err) => setError(err.message));
  }, [user]);

  useEffect(() => {
    if (!user?.is_admin) return;
    const timeout = window.setTimeout(() => {
      setUsersPage(1);
      loadUsers(1, usersSearch);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [usersSearch]);

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
        cache: "no-store",
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

  const grantPlanToUser = async () => {
    setError("");
    setGrantSaved("");
    try {
      const body = {
        email: grantEmail.trim(),
        plan: grantPlan,
        days: grantDays ? Number(grantDays) : null
      };
      const response = await fetch("/api/admin/users/plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Не удалось выдать тариф");
      const until = payload.plan_expires_at ? ` до ${new Date(payload.plan_expires_at).toLocaleString("ru-RU")}` : " без срока окончания";
      setGrantSaved(`${payload.email}: ${planLabels[payload.plan] || payload.plan}${until}`);
      setGrantEmail("");
      setGrantDays("");
      loadOverview();
      loadUsers(usersPage, usersSearch);
      setTimeout(() => setGrantSaved(""), 3000);
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
            <p className="eyebrow">доступы</p>
            <h2 className="section-title">Выдать тариф пользователю</h2>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              Пользователь должен сначала зарегистрироваться. Для безлимитного теста выбери «Агентство» и оставь срок пустым.
            </p>
            <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px_auto] lg:items-center">
              <input
                className="input"
                type="email"
                value={grantEmail}
                onChange={(event) => setGrantEmail(event.target.value)}
                placeholder="email коллеги"
              />
              <select className="input" value={grantPlan} onChange={(event) => setGrantPlan(event.target.value)}>
                <option value="agency_m">Агентство — безлимит</option>
                <option value="agency_s">Команда</option>
                <option value="freelancer">Фрилансер</option>
                <option value="free">Бесплатный</option>
                <option value="one_time">Разовая проверка</option>
              </select>
              <input
                className="input"
                type="number"
                min="1"
                max="3660"
                value={grantDays}
                onChange={(event) => setGrantDays(event.target.value)}
                placeholder="дней, пусто = бессрочно"
              />
              <button className="primary-button" disabled={!grantEmail.trim()} onClick={grantPlanToUser}>Выдать</button>
            </div>
            {grantSaved && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{grantSaved}</p>}
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">пользователи</p>
                <h2 className="section-title">Поиск и управление</h2>
              </div>
              <input
                className="input w-full max-w-sm"
                value={usersSearch}
                onChange={(event) => setUsersSearch(event.target.value)}
                placeholder="Поиск по email"
              />
            </div>
            <div className="mt-3 overflow-hidden rounded-md border border-slate-200 dark:border-[#38505c]">
              {(usersData?.items || data.recent_users).map((item) => (
                <div key={item.id} className="grid gap-2 border-b border-slate-200 px-3 py-2 text-sm last:border-b-0 dark:border-[#38505c] md:grid-cols-[1fr_140px_170px_190px]">
                  <span className="font-medium">{item.email}</span>
                  <span>{planLabels[item.plan] || item.plan}</span>
                  <span className="text-slate-500 dark:text-slate-400">{item.oauth_provider || "email"}</span>
                  <span className="text-slate-500 dark:text-slate-400">{new Date(item.created_at).toLocaleString("ru-RU")}</span>
                  {item.oauth_email_placeholder && <span className="md:col-span-4 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">OAuth не вернул настоящую почту, пользователю нужно указать email</span>}
                </div>
              ))}
            </div>
            {usersData && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
                <span>Показано {usersData.items.length} из {usersData.total}. Страница {usersData.page} из {usersData.pages}.</span>
                <div className="flex gap-2">
                  <button className="secondary-button" disabled={usersPage <= 1} onClick={() => { const next = Math.max(1, usersPage - 1); setUsersPage(next); loadUsers(next, usersSearch); }}>Назад</button>
                  <button className="secondary-button" disabled={usersData.page >= usersData.pages} onClick={() => { const next = usersPage + 1; setUsersPage(next); loadUsers(next, usersSearch); }}>Вперёд</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
