// Runs the test set of manuals through the real scan pipeline and makes the side-by-side pictures for each.
// A change to the prompt or pipeline is kept only if the scores over ALL manuals go up and none gets clearly worse.
//
// Run (with `npm run dev` running):  npm run eval            (the dev set)
//                                    npm run eval -- --all   (dev set + held-out manuals; run these only now and then)
//                                    npm run eval -- shoe-rack office-chair   (only these)
// Manuals: eval/manuals/<name>.pdf (kept out of git). Results: eval/runs/<time>/summary.json + summary.md,
// side-by-side pictures in server/data/xcheck/<guide id>/. Scores are given by looking at those (eval/RUBRIC.md).
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { findBrowser } from '../server/render.js';
import { adminSession } from './session.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = process.env.EVAL_API || `http://localhost:${process.env.PORT || 8787}`;
const args = process.argv.slice(2), all = args.includes('--all'), only = args.filter(a => !a.startsWith('--'));

const names = (await readdir(path.join(root, 'eval', 'manuals'))).filter(f => /\.pdf$/i.test(f)).map(f => f.replace(/\.pdf$/i, '')).sort()
  .filter(n => (only.length ? only.includes(n) : all || !n.endsWith('-heldout')));
if (!names.length) { console.log('No manuals found in eval/manuals.'); process.exit(1); }
const health = await fetch(`${api}/api/health`).then(r => r.json()).catch(() => null);
if (!health?.ai) { console.log(`The server at ${api} is not running or has no AI key. Start npm run dev first.`); process.exit(1); }

const session = adminSession(), auth = { cookie: `${session.name}=${session.value}`, 'x-buildit': '1' };
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const out = path.join(root, 'eval', 'runs', stamp);
await mkdir(out, { recursive: true });
console.log(`Eval ${stamp}: ${names.length} manuals with ${health.model}`);

// POST the pages like the browser does. Plain http: fetch gives up after 5 minutes, a big manual takes longer.
async function analyze(fd) {
  const req = new Request(`${api}/api/analyze`, { method: 'POST', body: fd });
  const body = Buffer.from(await req.arrayBuffer());
  const text = await new Promise((done, fail) => {
    const r = http.request(`${api}/api/analyze`, { method: 'POST', headers: { ...auth, 'content-type': req.headers.get('content-type'), 'content-length': body.length } }, res => {
      let t = ''; res.setEncoding('utf8'); res.on('data', c => (t += c)); res.on('end', () => done(t));
    });
    r.setTimeout(0); r.on('error', fail); r.end(body);
  });
  let guide = null, error = null, code = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'done') guide = msg.guide;
    if (msg.type === 'error') { error = msg.error; code = msg.code; }
    if (!msg.type && msg.error) error = msg.error;
  }
  return { guide, error, code };
}
// a PDF the AI will not open: render its pages to pictures with pdf.js in the dev server's page, as the app does
async function pdfPages(file) {
  const browser = await chromium.launch({ executablePath: findBrowser(), args: ['--ignore-certificate-errors'] });
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await page.goto(`${process.env.XCHECK_URL || `https://localhost:${process.env.WEB_PORT || 5173}`}/render.html`);
  const jpgs = await page.evaluate(async ([data, root]) => {
    const lib = `/@fs${root}/node_modules/pdfjs-dist/build/`, pdfjs = await import(lib + 'pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = lib + 'pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(data), c => c.charCodeAt(0)) }).promise, out = [];
    for (let i = 1; i <= Math.min(60, doc.numPages); i++) {
      const pg = await doc.getPage(i), b = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 1600 / Math.max(b.width, b.height) });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: x, viewport: vp }).promise;
      out.push(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }
    return out;
  }, [(await readFile(file)).toString('base64'), root]);
  await browser.close();
  return jpgs.map(b => Buffer.from(b, 'base64'));
}

const results = [];
for (const name of names) {
  const t0 = Date.now(), file = path.join(root, 'eval', 'manuals', `${name}.pdf`);
  process.stdout.write(`- ${name}: scanning…`);
  const fd = new FormData();
  fd.append('pages', new Blob([await readFile(file)], { type: 'application/pdf' }), `${name}.pdf`);
  let { guide, error, code } = await analyze(fd).catch(e => ({ error: e.message }));
  if (code === 'pdf_rejected') {
    process.stdout.write(' PDF rejected, sending its pages as pictures…');
    const fd2 = new FormData();
    (await pdfPages(file)).forEach((b, i) => fd2.append('pages', new Blob([b], { type: 'image/jpeg' }), `page-${i + 1}.jpg`));
    fd2.append('from_pdf', '1');
    ({ guide, error } = await analyze(fd2).catch(e => ({ error: e.message })));
  }
  const r = { name, seconds: Math.round((Date.now() - t0) / 1000), error };
  if (guide) Object.assign(r, {
    id: guide.id, steps: guide.steps.length, panels: guide.panels.length, hardware: guide.hardware.length, groups: (guide.groups || []).length,
    errors: guide.check.error, warnings: guide.check.warn, usd: guide.cost?.usd, model: guide.model,
  });
  results.push(r);
  console.log(guide ? ` ${r.steps} steps, ${r.errors} errors / ${r.warnings} warnings, $${r.usd}, ${r.seconds} s` : ` FAILED: ${error}`);
  await writeFile(path.join(out, 'summary.json'), JSON.stringify({ stamp, model: health.model, results }, null, 1));
}

// side-by-side pictures (manual page | 3D view) for every guide
for (const r of results.filter(r => r.id)) {
  process.stdout.write(`- ${r.name}: pictures…`);
  await new Promise(done => spawn(process.execPath, [path.join(root, 'scripts', 'xcheck.mjs'), r.id], { stdio: 'ignore', env: process.env }).on('exit', done));
  r.xcheck = `server/data/xcheck/${r.id}/`;
  console.log(' done');
}

const total = results.reduce((s, r) => s + (r.usd || 0), 0);
const md = [`# Eval ${stamp} (${health.model})`, '', '| manual | guide | steps | boards | fittings | groups | errors | warnings | cost | time | pictures |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map(r => r.id ? `| ${r.name} | ${r.id} | ${r.steps} | ${r.panels} | ${r.hardware} | ${r.groups} | ${r.errors} | ${r.warnings} | $${r.usd} | ${r.seconds} s | ${r.xcheck} |` : `| ${r.name} | failed: ${r.error} |`),
  '', `Total cost: $${total.toFixed(2)}`, '', 'Scores: see scores.md in this folder (filled in by looking at the pictures, eval/RUBRIC.md).', ''].join('\n');
await writeFile(path.join(out, 'summary.json'), JSON.stringify({ stamp, model: health.model, results, usd: total }, null, 1));
await writeFile(path.join(out, 'summary.md'), md);
console.log(`\nTotal $${total.toFixed(2)}. Results in eval/runs/${stamp}/`);
