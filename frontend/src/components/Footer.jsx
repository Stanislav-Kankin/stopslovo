import { Link } from "react-router-dom";

const supportEmail = "stopslovo_supp@inbox.ru";

export function Footer() {
  return (
    <footer className="border-t border-[#e0e0da] px-4 py-6 text-sm text-[#7a7a70] dark:border-[#38505c] dark:text-[#c1d0cc]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p>© 2026 СтопСлово</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link className="font-semibold hover:text-[#4a7c10] dark:hover:text-[#7ed59a]" to="/terms">
            Условия использования
          </Link>
          <a
            className="font-semibold hover:text-[#4a7c10] dark:hover:text-[#7ed59a]"
            href={`mailto:${supportEmail}?subject=${encodeURIComponent("Вопрос по СтопСлово")}`}
          >
            Написать в поддержку
          </a>
        </div>
        <p className="max-w-2xl">
          Сервис предоставляет автоматическую оценку риска и не является юридической консультацией или официальным заключением.
        </p>
      </div>
    </footer>
  );
}
