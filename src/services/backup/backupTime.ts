// Time helpers for the backup. Pure and UTC-only so they are deterministic under
// test — the caller passes the instant in as epoch milliseconds.

// Formats an instant as "yyyymmdd-hhmmss-fff-utc" in UTC — the machine-paced
// millisecond form (timestamp-conventions), since this stamp is assigned by the
// app itself rather than authored by a person. This is the run stamp and also
// the archive's stem (backup-<stamp>.zip), so it is filename-safe and sorts
// chronologically as a plain string.
export function backupTimestamp(nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}` +
    `-${pad(d.getUTCMilliseconds(), 3)}-utc`
  );
}

// Formats an mtime as ISO 8601 truncated to whole seconds ("2026-07-01T02:22:20Z").
// The index stores whole seconds so the 2-second mtime tolerance in the plan
// absorbs both FAT/exFAT's coarse granularity and this truncation.
export function toIsoSeconds(ms: number): string {
  const whole = Math.floor(ms / 1000) * 1000;
  return new Date(whole).toISOString().replace(/\.000Z$/, "Z");
}
