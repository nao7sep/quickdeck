import { useEffect, useRef, useState } from "react";
import type { TextCounts } from "../types";
import { countText, latestOnly } from "../services/textCounts";
import { logWarn, serializeError } from "../services/logger";

// How long typing must pause before the text is counted. Each new input moves
// the count to this long after it, so a burst of typing is counted once, and a
// large pane is not copied to the counting worker on every keystroke.
export const COUNT_DELAY_MS = 200;

// The latest finished counts of a pane's text: null until the first arrives,
// "failed" when the newest count could not be made. The editor never waits.
export function useTextCounts(text: string, retryRevision = 0): TextCounts | null | "failed" {
  const [counts, setCounts] = useState<TextCounts | null | "failed">(null);
  const mounted = useRef(true);
  const submit = useRef<((text: string) => void) | null>(null);
  if (submit.current === null) {
    submit.current = latestOnly(countText, (result) => {
      if (!mounted.current) return;
      if (result instanceof Error) {
        logWarn("pane count failed", { error: serializeError(result) });
        setCounts("failed");
      } else {
        setCounts(result);
      }
    });
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => submit.current?.(text), COUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, retryRevision]);

  return counts;
}
