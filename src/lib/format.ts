export function pct(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function cents(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}¢`;
}

export function pp(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return "—";
  const v = p * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}pp`;
}

export function compact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs >= 100) return n.toFixed(0);
  return n.toFixed(n >= 10 ? 0 : 1);
}

export function relativeClose(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const ms = t - now;
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const ago = ms < 0;
  const suffix = ago ? " ago" : "";
  if (mins < 90) return `${mins}m${suffix}`;
  if (hours < 48) return `${hours}h${suffix}`;
  if (days < 21) return `${days}d${suffix}`;
  if (days < 400) return `${Math.round(days / 30.4)}mo${suffix}`;
  return `${Math.round(days / 365)}y${suffix}`;
}

export function formatClose(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(t);
}

export function signedCents(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const v = p * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}¢`;
}

export function usd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
