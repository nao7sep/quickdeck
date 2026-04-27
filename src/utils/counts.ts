import twitterText from "twitter-text";
import type { TextCounts } from "../types";

export function getTextCounts(text: string): TextCounts {
  const trimmed = text.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const chars = Array.from(text).length;
  const parsedTweet = twitterText.parseTweet(text);

  return {
    words,
    chars,
    xWeightedChars: parsedTweet.weightedLength,
    xLimit: 280,
    xValid: parsedTweet.valid,
  };
}
