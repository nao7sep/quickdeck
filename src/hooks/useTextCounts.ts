import { useEffect, useState } from "react";
import type { TextCounts } from "../types";
import { getTextCounts } from "../utils/counts";

// How long typing must pause before the text is counted. Each new input moves
// the count to this long after it, so a burst of typing is counted once and
// a large pane is not recounted on every keystroke.
export const COUNT_DELAY_MS = 200;

// The latest counts of a pane's text, null until the first is made. Counting
// runs on the page once typing pauses; a worker would need a measurement on
// real panes showing typing lag (Performance machinery for unmeasured scale).
export function useTextCounts(text: string): TextCounts | null {
  const [counts, setCounts] = useState<TextCounts | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setCounts(getTextCounts(text)), COUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return counts;
}
