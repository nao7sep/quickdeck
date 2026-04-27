declare module "twitter-text" {
  export type ParsedTweet = {
    weightedLength: number;
    permillage: number;
    valid: boolean;
    displayRangeStart: number;
    displayRangeEnd: number;
    validRangeStart: number;
    validRangeEnd: number;
  };

  const twitterText: {
    parseTweet(text: string): ParsedTweet;
  };

  export default twitterText;
}
