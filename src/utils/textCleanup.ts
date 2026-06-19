// Per-app text-cleanup helper realizing the fleet text-cleanup conventions.
//
// Two of the three canonical patterns are used here: single-line (scalar values
// like the pane title) and multiline (snapshot bodies). The truncation pattern
// is intentionally omitted — quickdeck renders full snapshot bodies and never
// previews a clipped one. These algorithms are copied verbatim from the
// convention's verified reference; do not rewrite them locally. Cleanup is a
// commit/display-time operation — never run on a keystroke while the user types.

// Single-line cleanup for scalar values (titles, labels). Always trims the ends;
// the two decisions are interior. Default (flatten on, minify off) collapses any
// whitespace run containing a line break into one ASCII space — so a pasted
// multi-line value becomes one line — while leaving pure horizontal spacing
// typed within a line intact. This normalizes; it does not validate, so it must
// not be used on identity fields.
export function singleLine(
  text: string,
  opts: { flattenLineBreaks?: boolean; minify?: boolean } = {},
): string {
  const { flattenLineBreaks = true, minify = false } = opts;
  if (minify) return text.replace(/\s+/g, " ").trim();
  if (flattenLineBreaks) return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return text.trim();
}

// Multiline cleanup for bodies where line structure matters (snapshot content).
// Defaults: trim each line's trailing whitespace, drop blank lines before the
// first and after the last visible line, and preserve interior blank runs (a
// deliberate section break). Splitting on \r\n|\r|\n and rejoining with \n
// normalizes newlines as a side effect. Indentation is always preserved.
export function multiline(
  text: string,
  opts: { trimLineEnds?: boolean; dropEdgeBlankLines?: boolean; collapseBlankLines?: boolean } = {},
): string {
  const { trimLineEnds = true, dropEdgeBlankLines = true, collapseBlankLines = false } = opts;
  const isBlank = (l: string) => l.trim() === "";
  let lines = text.split(/\r\n|\r|\n/);
  if (trimLineEnds) lines = lines.map((l) => l.replace(/\s+$/, ""));

  let start = 0;
  let end = lines.length;
  if (dropEdgeBlankLines) {
    while (start < end && isBlank(lines[start])) start++;
    while (end > start && isBlank(lines[end - 1])) end--;
  }

  const out: string[] = [];
  let prevBlank = false;
  for (const line of lines.slice(start, end)) {
    const blank = isBlank(line);
    if (collapseBlankLines && blank && prevBlank) continue;
    out.push(line);
    prevBlank = blank;
  }
  return out.join("\n");
}
