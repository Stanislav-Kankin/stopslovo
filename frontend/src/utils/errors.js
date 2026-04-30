export function humanizeApiError(error) {
  const payload = error?.payload;
  const detail = payload?.detail || payload;

  if (Array.isArray(detail)) {
    const first = detail[0];
    const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : "";
    if (first?.type === "string_too_short" && field === "password") {
      return "Пароль должен быть не короче 6 символов.";
    }
    if (first?.type === "string_too_long" && field === "password") {
      return "Пароль слишком длинный.";
    }
    if (field === "email" || first?.type?.includes("email")) {
      return "Проверьте адрес электронной почты.";
    }
    if (first?.msg) {
      return "Проверьте заполнение формы.";
    }
  }

  if (detail?.message) return detail.message;
  if (typeof detail === "string") return detail;
  if (error?.message && !error.message.startsWith("{")) return error.message;
  return "Что-то пошло не так. Проверьте данные и попробуйте ещё раз.";
}
