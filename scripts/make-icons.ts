/* App icons for each accent (src/state/appearance.ts ACCENTS): public/icons/icon-<accent>.svg, then PNGs at 180 / 192 / 512
   (full-bleed, the Home Screen rounds them) and public/manifest-<accent>.webmanifest. Plum is also the default icon.svg and
   icon-*.png. macOS only (qlmanage + sips). Run: node scripts/make-icons.ts */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// gradient top-left → bottom-right, the spark's colour, and the manifest's theme colour
const ICONS: Record<string, { from: string; to: string; spark: string; theme: string }> = {
  plum: { from: "#C04478", to: "#6E1C3D", spark: "#fff", theme: "#9C2F5A" },
  blue: { from: "#3B80E0", to: "#163F85", spark: "#fff", theme: "#1F5FBF" },
  teal: { from: "#1C9C91", to: "#0A4A45", spark: "#fff", theme: "#0F766E" },
  green: { from: "#45A045", to: "#1B4D1B", spark: "#fff", theme: "#2F7A2F" },
  amber: { from: "#D9841A", to: "#6E3B00", spark: "#fff", theme: "#9A5200" },
  indigo: { from: "#6C60E2", to: "#2C2480", spark: "#fff", theme: "#4B3FB8" },
  // Bear-style: graphite with a red spark
  graphite: { from: "#3A3B41", to: "#1C1D20", spark: "#F0605E", theme: "#C8393B" },
};

const svg = (c: (typeof ICONS)[string], rounded: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c.from}"/>
      <stop offset="1" stop-color="${c.to}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64"${rounded ? ' rx="14"' : ""} fill="url(#g)"/>
  <!-- an open book, with a spark above it -->
  <path d="M10 22c7-2.6 14-2.2 22 2v25c-8-4.2-15-4.6-22-2Z" fill="#fff" opacity=".9"/>
  <path d="M54 22c-7-2.6-14-2.2-22 2v25c8-4.2 15-4.6 22-2Z" fill="#fff" opacity=".62"/>
  <path d="M32 7.5l1.9 5.1 5.1 1.9-5.1 1.9L32 21.5l-1.9-5.1-5.1-1.9 5.1-1.9Z" fill="${c.spark}"/>
</svg>
`;

const base = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as Record<string, unknown>;
const tmp = mkdtempSync(join(tmpdir(), "icons-"));

for (const [id, c] of Object.entries(ICONS)) {
  writeFileSync(`public/icons/icon-${id}.svg`, svg(c, true));
  const full = join(tmp, `${id}.svg`);
  writeFileSync(full, svg(c, false));
  execFileSync("qlmanage", ["-t", "-s", "512", "-o", tmp, full], { stdio: "ignore" });
  const png512 = `public/icons/icon-${id}-512.png`;
  renameSync(join(tmp, `${id}.svg.png`), png512);
  for (const s of [180, 192]) execFileSync("sips", ["-z", String(s), String(s), png512, "--out", `public/icons/icon-${id}-${s}.png`], { stdio: "ignore" });
  const icons = [192, 512].map((s) => ({ src: `icons/icon-${id}-${s}.png`, sizes: `${s}x${s}`, type: "image/png", purpose: "any" }));
  icons.push({ ...icons[1], purpose: "maskable" });
  writeFileSync(`public/manifest-${id}.webmanifest`, JSON.stringify({ ...base, id: "./", theme_color: c.theme, icons }, null, 2) + "\n");
}
console.log("icons written for", Object.keys(ICONS).join(", "));
