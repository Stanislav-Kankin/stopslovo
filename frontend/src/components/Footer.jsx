import { Link } from "react-router-dom";

const supportEmail = "stopslovo_supp@inbox.ru";

export function Footer() {
  const copySupportEmail = async () => {
    try {
      await navigator.clipboard.writeText(supportEmail);
    } catch {
      window.prompt("Скопируйте email поддержки", supportEmail);
    }
  };

  return (
    <footer className="border-t border-[#e0e0da] px-4 py-6 text-sm text-[#7a7a70] dark:border-[#38505c] dark:text-[#c1d0cc]">
      <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-[auto_1fr] md:items-start">
        <div className="grid gap-2">
          <p>© 2026 СтопСлово</p>
          <Link className="font-semibold hover:text-[#4a7c10] dark:hover:text-[#7ed59a]" to="/terms">
            Условия использования
          </Link>
        </div>

        <div className="grid gap-3 md:justify-items-end">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[#62625a] dark:text-[#c1d0cc]">Поддержка:</span>
            <a
              className="font-semibold text-[#4a7c10] underline-offset-2 hover:underline dark:text-[#7ed59a]"
              href={`mailto:${supportEmail}?subject=${encodeURIComponent("Вопрос по СтопСлово")}`}
            >
              {supportEmail}
            </a>
            <button
              type="button"
              onClick={copySupportEmail}
              className="rounded-full border border-[#d6d8cf] bg-white px-3 py-1 text-xs font-semibold text-[#4a7c10] transition hover:border-[#4a7c10] dark:border-[#38505c] dark:bg-[#22313b] dark:text-[#7ed59a] dark:hover:border-[#7ed59a]"
            >
              Скопировать email
            </button>
            <a
              className="rounded-full border border-[#d6d8cf] bg-white px-3 py-1 text-xs font-semibold text-[#62625a] transition hover:border-[#4a7c10] hover:text-[#4a7c10] dark:border-[#38505c] dark:bg-[#22313b] dark:text-[#c1d0cc] dark:hover:border-[#7ed59a] dark:hover:text-[#7ed59a]"
              href={`mailto:${supportEmail}?subject=${encodeURIComponent("Вопрос по СтопСлово")}`}
            >
              Написать
            </a>
          </div>
          <p className="max-w-2xl md:text-right">
            Сервис предоставляет автоматическую оценку риска и не является юридической консультацией или официальным заключением.
          </p>
        </div>
      </div>
    </footer>
  );
}
