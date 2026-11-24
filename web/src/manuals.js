// "Available manuals": the library of finished 3D guides anyone can open, no account needed (#/manuals).
// One card per manual: a picture of the finished piece, the name and article number from the box, and the facts a
// builder plans with (steps, time, people, parts). Search and the type filter work on the list in the page.
import { apiJson } from './api.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// "BESTÅ" is found by "besta": compare without accents and case
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// furniture types, from words in the name; the first that matches wins
const KINDS = [
  ['chairs', 'Chairs', /chair|stool|seat|bench/],
  ['wardrobes', 'Wardrobes and cabinets', /wardrobe|cabinet|frame|cupboard/], // before drawers: "wardrobe … and 3 drawers"
  ['drawers', 'Chests of drawers', /drawer|dresser|chest/],
  ['shelves', 'Shelves and racks', /shelf|shelv|bookcase|rack/],
  ['tables', 'Tables and desks', /table|desk(?! fan)/],
  ['other', 'Other', /./],
];
const kindOf = m => KINDS.find(([, , re]) => re.test(fold(m.title)))[0];

let all = null, loading = null, kind = 'all', query = '';

const time = min => !min ? null : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
const ICON = {
  steps: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 18h5v-5h5V8h6"/></svg>',
  time: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  // the person pictogram printed on flat-pack boxes: one per person needed
  person: '<svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true"><circle cx="6" cy="3" r="2.6" fill="currentColor"/><path d="M1.5 15V9.5a4.5 4.5 0 0 1 9 0V15" fill="currentColor"/></svg>',
  arrow: '<svg class="arr" width="16" height="12" viewBox="0 0 20 14" aria-hidden="true"><path d="M0 7h16.5M11 1.5l6 5.5-6 5.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  box: '<svg width="56" height="56" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l18-8 18 8v19l-18 8-18-8z"/><path d="M6 15l18 8 18-8M24 23v19"/></svg>',
};

function cardHtml(m) {
  const people = m.people ? `<span class="mc-people" title="${m.people} ${m.people > 1 ? 'people' : 'person'}">${ICON.person.repeat(Math.min(m.people, 4))}<span class="sr">${m.people} ${m.people > 1 ? 'people' : 'person'}</span></span>` : '';
  const cover = m.cover
    ? `<img src="${esc(m.cover)}" alt="" width="960" height="720" loading="lazy" decoding="async">`
    : `<span class="mc-noimg">${ICON.box}</span>`;
  return `<li class="mcard">
    <div class="mc-cover">${cover}${m.example ? '<span class="tag">Example</span>' : ''}</div>
    <div class="mc-body">
      <div class="mc-head">
        <h2 class="mc-title"><a class="mc-link" href="#/guide/${encodeURIComponent(m.id)}">${esc(m.title)}</a></h2>
        ${m.article ? `<p class="mc-art"><span class="sr">Article number </span>${esc(m.article)}</p>` : ''}
      </div>
      <dl class="mc-facts">
        <div><dt class="sr">Steps</dt><dd>${ICON.steps}${m.steps} steps</dd></div>
        ${time(m.minutes) ? `<div><dt class="sr">Time</dt><dd>${ICON.time}${time(m.minutes)}</dd></div>` : ''}
        ${people ? `<div><dt class="sr">People</dt><dd>${people}</dd></div>` : ''}
      </dl>
      <p class="mc-parts">${m.boards} board${m.boards === 1 ? '' : 's'} · ${m.fittings} fitting${m.fittings === 1 ? '' : 's'}</p>
      <span class="mc-go" aria-hidden="true">Open 3D guide ${ICON.arrow}</span>
    </div>
  </li>`;
}

function render() {
  const q = fold(query.trim());
  const match = m => !q || fold(`${m.title} ${m.article || ''} ${m.product}`).includes(q);
  const searched = all.filter(match), shown = searched.filter(m => kind === 'all' || m.kind === kind);
  // the type buttons: only types that exist, each with how many match the search
  const counts = Object.fromEntries(KINDS.map(([k]) => [k, searched.filter(m => m.kind === k).length]));
  const chip = (k, label, n) => `<button type="button" class="man-chip" data-kind="${k}" aria-pressed="${kind === k}"${n || k === 'all' ? '' : ' disabled'}>${label}<span>${n}</span></button>`;
  $('man-chips').innerHTML = chip('all', 'All', searched.length)
    + KINDS.filter(([k]) => all.some(m => m.kind === k)).map(([k, label]) => chip(k, label, counts[k])).join('');
  $('man-grid').innerHTML = shown.map(cardHtml).join('');
  $('man-count').textContent = shown.length === all.length ? `${all.length} manuals` : `${shown.length} of ${all.length} manuals`;
  $('man-none').hidden = shown.length > 0;
  if (!shown.length) $('man-none-t').textContent = query.trim() ? `No manual matches “${query.trim()}”.` : 'No manual of this type yet.';
}

/** Shows the library; loads it the first time. */
export async function showManuals() {
  if (all) return render();
  $('man-grid').innerHTML = '';
  $('man-count').textContent = 'Loading manuals…';
  try {
    all = (await (loading ||= apiJson('/api/library'))).map(m => ({ ...m, kind: kindOf(m) }));
    render();
  } catch (e) {
    loading = null;
    $('man-count').textContent = '';
    $('man-grid').innerHTML = `<li class="man-err"><p class="status err">${esc(e.message || 'The manuals could not be loaded.')}</p><button class="btn small" type="button" id="man-retry">Try again</button></li>`;
  }
}

$('man-q').addEventListener('input', e => { query = e.target.value; if (all) render(); });
$('man-q').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.target.value = query = ''; if (all) render(); } });
$('man-chips').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (!b) return; kind = b.dataset.kind; render(); });
$('man-clear').addEventListener('click', () => { query = ''; kind = 'all'; $('man-q').value = ''; render(); $('man-q').focus(); });
$('man-grid').addEventListener('click', e => { if (e.target.closest('#man-retry')) showManuals(); });
