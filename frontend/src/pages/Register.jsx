import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { humanizeApiError } from "../utils/errors";

export function Register({ onRegister }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
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
      setError(humanizeApiError(err));
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
        <div className="relative">
          <input className="input w-full pr-12" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Пароль" required />
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white"
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            title={showPassword ? "Скрыть пароль" : "Показать пароль"}
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        <div className="relative">
          <input className="input w-full pr-12" type={showRepeat ? "text" : "password"} value={repeat} onChange={(event) => setRepeat(event.target.value)} placeholder="Повторите пароль" required />
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white"
            type="button"
            onClick={() => setShowRepeat((value) => !value)}
            title={showRepeat ? "Скрыть пароль" : "Показать пароль"}
          >
            {showRepeat ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
        <button className="primary-button w-full" type="submit">Создать аккаунт</button>
        <div className="grid gap-2">
          <a className="secondary-button justify-center" href="/api/auth/yandex">Войти через Яндекс</a>
        </div>
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          Уже есть аккаунт? <Link className="font-semibold text-[#4a7c10] dark:text-[#7ed59a]" to="/login">Войти</Link>
        </p>
      </form>
    </section>
  );
}
