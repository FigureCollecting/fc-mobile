// Draws the app icons (public/icons/icon-{180,192,512}.png) and the static
// splash's inline art (index.html, between the brand:splash-art markers) from
// the vector figure src/assets/brand/final-E.svg, never from a PNG. The sizes
// and colours are in deploy/brandArt.ts (ICON_FIGURE_SCALE is the one knob).
// Chromium (Playwright's, already a dev dependency) rasterises the SVG.
// Re-run after changing the art or a constant: npm run brand
//   --scale=<n>   figure scale for this run (default ICON_FIGURE_SCALE)
//   --out=<dir>   write the icons there, leaving public/ and index.html alone
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import {
  ICON_BG,
  ICON_FG,
  ICON_FIGURE_CENTER,
  ICON_SIZES,
  ICON_FIGURE_SCALE,
  figureLayout,
  iconFigureFraction,
  parseFigureArt,
  roundPathData,
  splashArtMarkup,
} from '../deploy/brandArt.ts';
import { decodePng, encodeRgbPng } from '../deploy/png.ts';

const ROOT = path.join(import.meta.dirname, '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const scale = arg('scale') === undefined ? ICON_FIGURE_SCALE : Number(arg('scale'));
const outDir = arg('out');

const art = parseFigureArt(readFileSync(path.join(ROOT, 'src/assets/brand/final-E.svg'), 'utf8'));
const pathTag = (d) => `<path d="${d}" transform="translate(${art.tx},${art.ty})"/>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });

  // The figure's box in the SVG's own canvas, as the browser measures it.
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"><g id="art">${pathTag(art.d)}</g></svg>`);
  const bbox = await page.evaluate(() => {
    const b = document.getElementById('art').getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });

  const dir = outDir === undefined ? path.join(ROOT, 'public/icons') : path.resolve(outDir);
  mkdirSync(dir, { recursive: true });
  for (const size of ICON_SIZES) {
    const { scale: s, tx, ty } = figureLayout(bbox, size, iconFigureFraction(scale), ICON_FIGURE_CENTER);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:${ICON_BG}"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" style="display:block">` +
        `<rect width="${size}" height="${size}" fill="${ICON_BG}"/><g transform="translate(${tx},${ty}) scale(${s})" fill="${ICON_FG}">${pathTag(art.d)}</g></svg></body>`,
    );
    const shot = decodePng(await page.screenshot({ type: 'png' }));
    const rgb = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgb.set(shot.pixel(x, y), (y * size + x) * 3);
    writeFileSync(path.join(dir, `icon-${size}.png`), encodeRgbPng(size, size, rgb));
    console.log(`icon-${size}.png  figure ${Math.round(bbox.height * s)} px of ${size}  (scale ${scale})`);
  }

  if (outDir === undefined) {
    const htmlPath = path.join(ROOT, 'index.html');
    const html = readFileSync(htmlPath, 'utf8');
    const markers = /(<!-- brand:splash-art -->\n)(\s*)[\s\S]*?(\n\s*<!-- \/brand:splash-art -->)/;
    if (!markers.test(html)) throw new Error('index.html has no brand:splash-art markers');
    const markup = splashArtMarkup(art, bbox);
    writeFileSync(htmlPath, html.replace(markers, (_, open, indent, close) => `${open}${indent}${markup}${close}`));
    console.log(`index.html  splash art ${roundPathData(art.d).length} path chars`);
  }
} finally {
  await browser.close();
}
