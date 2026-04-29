import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="border-t border-[#e0e0da] px-4 py-6 text-sm text-[#7a7a70] dark:border-[#38505c] dark:text-[#c1d0cc]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p>© 2026 СтопСлово</p>
        <Link className="font-semibold hover:text-[#4a7c10] dark:hover:text-[#7ed59a]" to="/terms">
          Условия использования
        </Link>
        <p className="max-w-2xl">
          Сервис предоставляет автоматическую оценку риска и не является юридической консультацией или официальным заключением.
        </p>
      </div>
    </footer>
  );
}
