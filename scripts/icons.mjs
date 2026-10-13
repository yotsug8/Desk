// Значки приложения: рисуем icons/icon.svg в PNG нужных размеров через Chromium
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
// без скруглений и с полями: для Android (maskable) и iOS, они сами режут форму
const square = svg
  .replace(/<rect width="512" height="512" rx="\d+" fill="([^"]+)"\/>/, '<rect width="512" height="512" fill="$1"/><g transform="translate(256 256) scale(.78) translate(-256 -256)">')
  .replace('</svg>', '</g></svg>');

const out = [
  [svg, 192, 'icon-192.png'], [svg, 512, 'icon-512.png'],
  [square, 512, 'maskable-512.png'], [square, 180, 'apple-touch.png'],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, size, name] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
  await page.screenshot({ path: new URL(`../icons/${name}`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
