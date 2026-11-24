// Side-by-side check of a guide against its manual: for every step, the manual page on the left and the app's 3D view
// on the right, with the step text underneath. The automatic check only tests that a guide agrees with itself; this is
// for looking at whether it agrees with the paper.
// Run (with `npm run dev` running):  npm run xcheck -- <guide id> [first step] [last step]
// Writes server/data/xcheck/<id>/stepNN.jpg. The guide needs its manual stored (scans keep it since 7 Nov 2026).
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser } from '../server/render.js';
import { adminSession } from './session.mjs';

const [id, from = '1', to] = process.argv.slice(2);
if (!id) { console.log('Usage: npm run xcheck -- <guide id> [first step] [last step]'); process.exit(1); }
const base = process.env.XCHECK_URL || `https://localhost:${process.env.WEB_PORT || 5173}`;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'xcheck', id);
const exe = findBrowser();
if (!exe) { console.log('No Chrome found. Set RENDER_BROWSER or run: npx playwright-core install chromium'); process.exit(1); }

const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
await ctx.addCookies([{ ...adminSession(), url: base, secure: true, httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('page error:', e.message));
await page.goto(`${base}/#/guide/${encodeURIComponent(id)}`);
await page.waitForFunction(() => window.builditViewer?.objs?.length > 0, null, { timeout: 60000 });
const N = await page.evaluate(() => window.builditViewer.N);
await mkdir(out, { recursive: true });

for (let s = Math.max(1, +from); s <= Math.min(N, +(to || N)); s++) {
  // through the app's own step buttons, so the labels on the 3D view match the step
  await page.evaluate(s => { document.querySelector(`#progress [data-i="${s}"]`).click(); window.builditViewer.goCam(true); }, s);
  await page.waitForTimeout(700);
  const shot = (await page.locator('#stage').screenshot()).toString('base64');
  // compose in the page: it can draw the manual page with the app's own code (web/src/manual.js)
  const jpg = await page.evaluate(async ({ s, shot }) => {
    const v = window.builditViewer, g = v.guide, st = g.steps[s - 1];
    const { manualPage, pageNumber } = await import('/src/manual.js');
    const img = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
    const n = pageNumber(st.page), murl = n ? await manualPage(g, n) : null;
    const man = murl ? await img(murl) : null, model = await img('data:image/png;base64,' + shot);
    const mh = 900, mw = man ? Math.round(man.width * mh / man.height) : 640, vw = Math.round(model.width * 680 / model.height);
    const c = document.createElement('canvas'); c.width = mw + vw + 30; c.height = mh + 150;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    if (man) x.drawImage(man, 10, 10, mw, mh); else { x.fillStyle = '#888'; x.font = '20px sans-serif'; x.fillText(n ? `Manual page ${n} not stored` : 'No manual page given', 30, 60); }
    x.drawImage(model, mw + 20, 10, vw, 680);
    x.fillStyle = '#111'; x.font = 'bold 20px sans-serif'; x.fillText(`Step ${s}/${g.steps.length} · manual page ${st.page ?? '?'} · ${st.title}`, 10, mh + 40);
    x.font = '16px sans-serif';
    const words = (st.text || '').split(' '), lines = ['']; for (const w of words) { const t = `${lines.at(-1)} ${w}`.trim(); if (x.measureText(t).width > c.width - 20) lines.push(w); else lines[lines.length - 1] = t; }
    lines.slice(0, 3).forEach((l, i) => x.fillText(l, 10, mh + 68 + i * 22));
    x.fillStyle = '#555'; x.fillText('Take: ' + st.need.map(([p, q]) => `${q}× ${p}`).join(', '), 10, mh + 68 + Math.min(3, lines.length) * 22);
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
  }, { s, shot });
  await writeFile(path.join(out, `step${String(s).padStart(2, '0')}.jpg`), Buffer.from(jpg, 'base64'));
  process.stdout.write(`\rstep ${s}/${N}`);
}
await browser.close();
console.log(`\nWrote ${out}`);
