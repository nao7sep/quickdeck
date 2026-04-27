// Snapshots only need the meaningful body of the buffer, so we strip leading
// and trailing lines that are empty or contain only whitespace before storing
// or deduping. Interior blank lines are preserved because they carry meaning
// in the user's text. Returns an empty string when nothing remains.
export function trimSnapshotContent(content: string): string {
  if (content.length === 0) {
    return "";
  }

  const lines = content.split(/\r\n|\r|\n/);

  let start = 0;
  while (start < lines.length && lines[start].trim().length === 0) {
    start += 1;
  }

  let end = lines.length;
  while (end > start && lines[end - 1].trim().length === 0) {
    end -= 1;
  }

  if (start >= end) {
    return "";
  }

  return lines.slice(start, end).join("\n");
}
