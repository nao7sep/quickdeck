// Pure helpers for reading styles.css's theme token blocks and measuring
// contrast. The light tokens live in the top-level :root block; the dark tokens
// live in the :root block inside @media (prefers-color-scheme: dark).

export type Rgb = [number, number, number];

export function themeBlock(css: string, theme: "light" | "dark"): string {
  if (theme === "light") {
    const start = css.search(/^:root\s*\{/m);
    if (start < 0) throw new Error("top-level :root block missing");
    return css.slice(css.indexOf("{", start), css.indexOf("\n}", start));
  }
  const media = css.indexOf("@media (prefers-color-scheme: dark) {");
  if (media < 0) throw new Error("prefers-color-scheme: dark block missing");
  const start = css.indexOf("  :root {", media);
  if (start < 0) throw new Error(":root block missing inside the dark media query");
  return css.slice(css.indexOf("{", start), css.indexOf("\n  }", start));
}

export function tokenValue(block: string, token: string): string {
  const match = block.match(new RegExp(`${token.replaceAll("-", "\\-")}\\s*:\\s*([^;]+);`));
  if (!match) throw new Error(`${token} must be defined`);
  return match[1]!.trim();
}

export function parseHex(value: string): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) throw new Error(`${value} must be an opaque six-digit hex color`);
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
}

export function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

export function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
