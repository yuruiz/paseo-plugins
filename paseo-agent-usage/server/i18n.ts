/**
 * Minimal server-side message localization.
 *
 * The server cannot inspect the client's system locale, so `language: "auto"`
 * keeps Chinese unless the client reports its detected locale through a
 * prefs call (`usage.prefs.get` with `locale`).
 */
export type ServerLocale = "zh" | "en";

let current: ServerLocale = "zh";

export function setServerLocale(locale: ServerLocale): void {
  current = locale === "en" ? "en" : "zh";
}

/** Picks the zh or en variant for one user-facing server message. */
export function st(zh: string, en: string): string {
  return current === "en" ? en : zh;
}
