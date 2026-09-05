import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(ms?: number | null) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function relativeTime(input: string | Date | null | undefined) {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - date.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [60_000, "m"],
    [3_600_000, "h"],
    [86_400_000, "d"],
    [604_800_000, "w"],
  ];
  if (abs < 45_000) return future ? "in a moment" : "just now";
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, label] = units[i];
    if (abs >= size) {
      const value = Math.round(abs / size);
      return future ? `in ${value}${label}` : `${value}${label} ago`;
    }
  }
  return date.toLocaleDateString();
}

export function formatDate(input: string | Date | null | undefined) {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(input: string | Date | null | undefined) {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function clockTime(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function titleCase(input: string) {
  return input
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncate(input: string, length = 120) {
  return input.length > length ? `${input.slice(0, length).trimEnd()}…` : input;
}

export function percent(value: number) {
  return `${Math.round(value)}%`;
}
