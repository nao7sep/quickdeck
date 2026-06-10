// `created_at_utc` is a canonical ISO 8601 UTC instant. Convert it to a
// deterministic local-time string ("YYYY-MM-DD HH:mm") so the displayed format
// stays the same across machine locales (no toLocaleString localization).
export function formatSnapshotTimestamp(rawUtc: string): string {
  const date = new Date(rawUtc);
  if (Number.isNaN(date.getTime())) {
    return rawUtc;
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
