/** 时间与日期工具。D1 中所有时间均为 Unix 毫秒整数。 */

export function nowMs(): number {
  return Date.now();
}

export function toIso(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

export function fromIso(s: string): number {
  return new Date(s).getTime();
}

export function isExpired(expiresAtMs: number, at: number = Date.now()): boolean {
  return expiresAtMs <= at;
}

/** UTC 日期字符串,如 2026-08-01。用于日轮换 Salt 派生。 */
export function utcDateString(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function clampExpireSeconds(
  requested: number | undefined,
  defaultSeconds: number,
  maxSeconds: number,
): number {
  const v = requested == null ? defaultSeconds : Math.floor(requested);
  if (!Number.isFinite(v) || v <= 0) return defaultSeconds;
  return Math.min(v, maxSeconds);
}
