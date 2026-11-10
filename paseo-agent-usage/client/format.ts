import { translateNow } from "./i18n";

/** Portable compact notation; some mobile Intl implementations ignore notation. */
export function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // Round before choosing a unit, so a carry across 1000 promotes K to M, etc.
  let scaled = Number(Math.abs(value).toPrecision(2));
  const units = ["", "K", "M", "B", "T"];
  let unit = 0;
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  const sign = value < 0 && scaled !== 0 ? "-" : "";
  return `${sign}${Number(scaled.toPrecision(2))}${units[unit]}`;
}

export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

export function shortProject(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return translateNow("project.unknown");
  return parts.slice(-2).join("/");
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

export function formatDurationMs(value: number): string {
  const ms = Math.max(0, value);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatCount(value: number): string {
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e3).toFixed(0)}k`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
