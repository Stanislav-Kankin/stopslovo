import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

function normalizeTerm(value) {
  return value.trim().replace(/\s+/g, " ");
}

export function AllowlistAdmin({ user }) {
  const [terms, setTerms] = useState([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [newTerm, setNewTerm] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const filteredTerms = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return terms.map((term, index) => ({ term, index }));
    return terms
      .map((term, index) => ({ term, index }))
      .filter((item) => item.term.toLowerCase().includes(query));
  }, [terms, search]);

  useEffect(() => {
    if (!user?.is_admin) return;
    fetch("/api/admin/allowlist", { credentials: "include" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Не удалось загрузить белый список");
        return payload;
      })
      .then((payload) => {
        const loaded = payload.terms || [];
        setTerms(loaded);
        setDraft(loaded.join("\n"));
      })
      .catch((err) => setError(err.message));
  }, [user]);

  const updateTerms = (nextTerms) => {
    setTerms(nextTerms);
    setDraft(nextTerms.join("\n"));
    setStatus("");
  };

  const addTerm = () => {
    const term = normalizeTerm(newTerm);
    if (!term) return;
    const exists = terms.some((item) => item.toLowerCase().replace(/ё/g, "е") === term.toLowerCase().replace(/ё/g, "е"));
    if (exists) {
      setNewTerm("");
      return;
    }
    updateTerms([...terms, term]);
    setNewTerm("");
  };

  const editTerm = (index, value) => {
    const next = [...terms];
    next[index] = value;
    updateTerms(next);
  };

  const deleteTerm = (index) => {
    updateTerms(terms.filter((_, itemIndex) => itemIndex !== index));
  };

  const importFromTextarea = () => {
    const seen = new Set();
    const next = draft
      .split(/[\n,;]+/)
      .map(normalizeTerm)
      .filter(Boolean)
      .filter((term) => {
        const key = term.toLowerCase().replace(/ё/g, "е");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    updateTerms(next);
  };

  const save = async () => {
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/admin/allowlist", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Не удалось сохранить белый список");
      const saved = payload.terms || [];
      setTerms(saved);
      setDraft(saved.join("\n"));
      setStatus(`Сохранено: ${saved.length}`);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!user?.is_admin) {
    return (
      <section className="panel">
        <h1 className="section-title">Белый список</h1>
        <p className="text-slate-600 dark:text-slate-300">Доступ только для администратора.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">словарь</p>
          <h1 className="section-title">Белый список</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">Общие исключения для всех проверок.</p>
        </div>
        <Link className="secondary-button" to="/admin">Назад в админку</Link>
      </div>

      {error && <div className="error-box">{error}</div>}
      {status && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">{status}</div>}

      <div className="panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <input
            className="input"
            value={newTerm}
            onChange={(event) => setNewTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addTerm();
            }}
            placeholder="Добавить слово или фразу"
          />
          <button className="primary-button" onClick={addTerm}>
            <Plus className="h-4 w-4" /> Добавить
          </button>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
          <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по списку" />
          <button className="secondary-button" onClick={save}>
            <Save className="h-4 w-4" /> Сохранить
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">Записи</h2>
          <span className="text-sm text-slate-500 dark:text-slate-400">Показано {filteredTerms.length} из {terms.length}</span>
        </div>
        <div className="grid gap-2">
          {filteredTerms.length ? filteredTerms.map(({ term, index }) => (
            <div key={`${term}-${index}`} className="grid gap-2 rounded-md border border-slate-200 p-2 dark:border-[#38505c] md:grid-cols-[1fr_auto]">
              <input className="input" value={term} onChange={(event) => editTerm(index, event.target.value)} />
              <button className="secondary-button text-red-700 dark:text-red-200" onClick={() => deleteTerm(index)} title="Удалить">
                <Trash2 className="h-4 w-4" /> Удалить
              </button>
            </div>
          )) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Записей не найдено.</p>
          )}
        </div>
      </div>

      <div className="panel">
        <p className="eyebrow">массовое редактирование</p>
        <h2 className="section-title">Список текстом</h2>
        <textarea className="input min-h-[180px] resize-y" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="secondary-button" onClick={importFromTextarea}>Применить текст к списку</button>
          <button className="primary-button" onClick={save}>Сохранить</button>
        </div>
      </div>
    </section>
  );
}
