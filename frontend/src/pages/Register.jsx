import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function Register({ onRegister }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (password !== repeat) {
      setError("Пароли не совпадают");
      return;
    }
    try {
      await onRegister(email, password);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="mx-auto max-w-md">
      <form className="panel space-y-4" onSubmit={submit}>
        <div>
          <p className="eyebrow">аккаунт</p>
          <h1 className="section-title">Создать аккаунт</h1>
        </div>
        <input className="input w-full" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Почта" required />
        <input className="input w-full" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Пароль" required />
        <input className="input w-full" type="password" value={repeat} onChange={(event) => setRepeat(event.target.value)} placeholder="Повторите пароль" required />
        {error && <div className="error-box">{error}</div>}
        <button className="primary-button w-full" type="submit">Создать аккаунт</button>
        <div className="grid gap-2">
          <a className="secondary-button justify-center" href="/api/auth/yandex">Войти через Яндекс</a>
          <a className="secondary-button justify-center" href="/api/auth/vk">Войти через ВКонтакте</a>
        </div>
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          Уже есть аккаунт? <Link className="font-semibold text-[#4a7c10] dark:text-[#7ed59a]" to="/login">Войти</Link>
        </p>
      </form>
    </section>
  );
}
