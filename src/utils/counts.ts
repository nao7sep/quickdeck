import type { TextCounts } from "../types";

export function getTextCounts(text: string): TextCounts {
  const trimmed = text.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const chars = Array.from(text).length;

  return {
    words,
    chars,
    xWeightedChars: chars,
    xLimit: 280,
  };
}
