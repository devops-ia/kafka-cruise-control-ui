const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

// Bytes with binary units: 1073741824 -> "1 GiB".
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "-";
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const n = v >= 100 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${bytes < 0 ? "-" : ""}${n} ${UNITS[i]}`;
}

// Cruise Control reports disk in MB and network in KB/s.
export const formatMB = (mb: number): string => formatBytes(mb * 1024 * 1024);
export const formatRate = (kbPerSec: number): string => `${formatBytes(kbPerSec * 1024)}/s`;

export function formatPct(p: number): string {
  return Number.isFinite(p) ? `${Math.round(p * 10) / 10}%` : "-";
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
