/**
 * The colour tokens keep text readable (plan §7: ≥ 4.5:1). axe cannot measure
 * text over a gradient, so the page washes are checked here, from globals.css
 * itself.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
}

const light = block(":root");
const darkBySystem = block(':root:not([data-theme="light"])');
const darkBySwitch = block(':root[data-theme="dark"]');

type Rgba = [number, number, number, number];
function color(v: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(v);
  if (rgb) return rgb.slice(1).map(Number) as Rgba;
  throw new Error(`not a colour: ${v}`);
}
const over = (top: Rgba, bottom: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1) as Rgba;
const luminance = (c: Rgba) =>
  [0.2126, 0.7152, 0.0722].reduce((sum, w, i) => {
    const s = c[i] / 255;
    return sum + w * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  }, 0);
const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = ["text", "text-muted", "accent", "gain", "loss", "warn"];

describe("theme tokens", () => {
  it("dark mode is the same whether the system or the switch picks it", () => {
    expect(darkBySystem).toEqual(darkBySwitch);
  });

  for (const [name, tokens] of [["light", light], ["dark", darkBySwitch]] as const) {
    it(`${name}: text stays ≥ 4.5:1 on the page and the cards, also where a wash is strongest`, () => {
      const page = color(tokens.page);
      const grounds = [page, color(tokens.card), color(tokens.subtle), ...["wash-1", "wash-2", "wash-3"].map((w) => over(color(tokens[w]), page))];
      for (const t of TEXT) {
        for (const g of grounds) expect(contrast(color(tokens[t]), g), `${t} on ${g.map(Math.round)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: a control's border is ≥ 3:1 on the page and the cards`, () => {
      for (const g of ["page", "card", "subtle"]) expect(contrast(color(tokens.control), color(tokens[g])), g).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: a primary button's label is ≥ 4.5:1 on its accent`, () => {
      expect(contrast(color(tokens["accent-contrast"]), color(tokens.accent))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("light: paper-coloured cards on the page as it was (the owner's choice, 2026-09-30)", () => {
    expect([light.card, light.page]).toEqual(["#fff9ee", "#eef1ef"]);
  });
});

describe("primary buttons", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));

  it("are one colour again (the owner's choice, 2026-09-30): no gradient fill is left, and nothing asks for one", () => {
    expect(css).not.toMatch(/linear-gradient/);
    // A class naming a utility that no longer exists would leave a button without a background.
    const users = files(path.join(process.cwd(), "src")).filter((f) => /\.tsx?$/.test(f) && !f.endsWith("theme.test.ts") && readFileSync(f, "utf8").includes("accent-fill"));
    expect(users.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});
