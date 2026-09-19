// `created_at_utc` is a canonical ISO 8601 UTC instant. It is shown in local
// time, formatted for the interface language and the computer's region by the
// caller's formatter; an unparseable value is shown as stored.
export function formatSnapshotTimestamp(rawUtc: string, format: (date: Date) => string): string {
  const date = new Date(rawUtc);
  if (Number.isNaN(date.getTime())) {
    return rawUtc;
  }

  return format(date);
}
