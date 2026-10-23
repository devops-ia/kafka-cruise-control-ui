import css from "./styles.css?raw";

/** Custom properties declared in the first rule whose selector starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("styles.css", () => {
  it("keeps radii at 4px or less (50% is the only round shape allowed)", () => {
    const bad = [...css.matchAll(/border(?:-[a-z]+){0,2}-radius:\s*([^;]+);/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter((v) => v !== "50%" && !/^[0-4](px)?$/.test(v) && !v.startsWith("var("));
    expect(bad).toEqual([]);
    expect(Number.parseFloat(tokens(":root")["--radius"])).toBeLessThanOrEqual(4);
  });

  it("opens the cluster picker as a base-select list", () => {
    expect(css).toMatch(/#cluster,\s*#cluster::picker\(select\)\s*\{[^}]*appearance:\s*base-select;/);
  });

  it("uses system fonts only", () => {
    expect(css).not.toMatch(/@font-face|@import|url\(/);
  });

  // [foreground, background, minimum ratio]: 4.5 for text, 3 for borders of controls and focus rings.
  const PAIRS: [string, string, number][] = [
    ["--ink", "--bg", 4.5], ["--ink", "--surface", 4.5], ["--muted", "--bg", 4.5], ["--muted", "--surface", 4.5], ["--muted", "--sunken", 4.5],
    ["--accent", "--surface", 4.5], ["--accent", "--sunken", 4.5], ["--on-accent", "--accent", 4.5], ["--on-danger", "--danger", 4.5],
    ["--ok", "--ok-bg", 4.5], ["--ok", "--surface", 4.5], ["--bad", "--surface", 4.5], ["--warn", "--warn-bg", 4.5], ["--bad", "--bad-bg", 4.5],
    ["--rail-text", "--rail", 4.5], ["--rail-label", "--rail", 4.5], ["--rail-active-text", "--rail-active", 4.5], ["--rail-focus", "--rail", 3],
    ["--control-border", "--surface", 3], ["--accent", "--bg", 3],
  ];
  const themes: [string, Record<string, string>][] = [
    ["light", tokens(":root")],
    ["dark", tokens(':root[data-theme="dark"]')],
  ];
  it.each(themes)("meets WCAG AA in the %s theme", (_name, t) => {
    const low = PAIRS.filter(([f, b, min]) => ratio(t[f], t[b]) < min).map(([f, b, min]) => `${f} on ${b} is ${ratio(t[f], t[b]).toFixed(2)}, needs ${min}`);
    expect(low).toEqual([]);
  });

  it("system dark theme repeats the dark tokens", () => {
    const media = tokens(':root:not([data-theme="light"])');
    const dark = tokens(':root[data-theme="dark"]');
    for (const [k, v] of Object.entries(media)) expect(dark[k], k).toBe(v);
  });
});
