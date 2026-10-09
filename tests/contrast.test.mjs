import { expect, it } from "vitest";
import { readFileSync } from "node:fs";

function luminance(hex) {
  const values = hex
    .replace("#", "")
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
const ratio = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
it("keeps the functional text palette at AA contrast across its dark surfaces", () => {
  const css = readFileSync("src/index.css", "utf8");
  const color = (name) => css.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))[1];
  for (const foreground of [
    "text",
    "muted",
    "amber",
    "green",
    "blue",
    "orange",
  ])
    for (const background of ["bg", "surface", "raised"])
      expect(
        ratio(color(foreground), color(background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
  expect(ratio("#142027", color("amber"))).toBeGreaterThanOrEqual(4.5);
  expect(ratio("#647d8c", color("bg"))).toBeGreaterThanOrEqual(3);
});
it("ships reduced-motion and forced-colors styles", () => {
  const css = readFileSync("src/index.css", "utf8");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain("forced-colors: active");
  expect(css).toContain("outline: 3px solid Highlight");
});
