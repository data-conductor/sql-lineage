/**
 * What Runs First — page logic.
 *
 * Everything here is presentation. The analysis lives in the sql-lineage
 * package, which is the same code published to npm and consumed by the
 * product, so this file should stay thin enough to read in one sitting.
 */
import { analyseFiles, layout, SUPPORTED_DIALECTS } from './build/index.js';

const SAMPLE = [
  '01_load_events.sql', '02_sessionize.sql', '03_users_daily.sql',
  '04_mrr.sql', '05_exec_dashboard.sql', 'legacy_users_daily.sql',
];

const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $('dropzone'), fileinput: $('fileinput'), pick: $('pick'), replace: $('replace'),
  loaded: $('loaded'), filecount: $('filecount'), chips: $('chips'), dialect: $('dialect'),
  sampling: $('sampling'), usesample: $('usesample'), canvas: $('canvas'), graph: $('graph'),
  stats: $('stats'), status: $('status'), findingsblock: $('findingsblock'),
  findsub: $('findsub'), findings: $('findings'), bridge: $('bridge'),
  cta: $('cta'), download: $('download'), hover: $('hover'),
  ctahead: $('ctahead'), ctabody: $('ctabody'), ctaprimary: $('ctaprimary'),
};

let currentFiles = [];
let isSample = true;
let lastResult = null;

/* ── helpers ─────────────────────────────────────────────────────────── */

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Backtick spans become <code>. Everything is escaped first, so a table
 *  called `<script>` renders as text rather than running. */
const ticks = (s) =>
  escapeHtml(s).replace(/`([^`]+)`/g, (_m, inner) => `<code>${inner}</code>`);

const setStatus = (msg, isError = false) => {
  el.status.hidden = !msg;
  el.status.textContent = msg || '';
  el.status.classList.toggle('err', !!isError);
};

/* ── graph rendering ─────────────────────────────────────────────────── */

const NODE_STYLE = {
  source:   { fill: '#1b2335', stroke: '#3b486a', text: '#cfd8ec', dash: null },
  derived:  { fill: '#15264a', stroke: '#2f6df6', text: '#cddffd', dash: null },
  output:   { fill: '#0e2a20', stroke: '#0f7a52', text: '#9fe3c4', dash: null },
  internal: { fill: '#161b2b', stroke: '#39445f', text: '#9fb0d0', dash: '4 3' },
  isolated: { fill: '#161b2b', stroke: '#39445f', text: '#9fb0d0', dash: '4 3' },
  conflict: { fill: '#2a1a12', stroke: '#c2410c', text: '#ffc9a3', dash: null },
};

// Nodes carry three lines now: qualifier, table name, status. Real estates
// name tables `{{PREP_DB}}.{{PREP_AT_SITE_ACTIVITIES}}`, where every table
// shares the qualifier and head-truncation throws away the only part that
// differs. Splitting the qualifier off and eliding the MIDDLE keeps both ends.
const W = 228, H = 60;

// Monospace advance is 0.6em, so the character budget is just inner width
// over that. Written as a calculation rather than a magic number because the
// box width is the thing people change.
const PAD = 14;
const fitChars = (px) => Math.floor((W - PAD * 2) / (px * 0.6));
const NAME_CHARS = fitChars(12.5);   // 24
const SMALL_CHARS = fitChars(10.5);  // 29

/** Elide the middle, not the tail. `{{PREP_AT_SITE_ACTIVITIES}}` keeps both
 *  the prefix that tells you which system and the suffix that tells you which
 *  table; trimming the end leaves `{{PREP_AT_S…` and tells you neither. */
function fitMid(s, n) {
  s = String(s);
  if (s.length <= n) return s;
  const head = Math.ceil((n - 1) * 0.55);
  return s.slice(0, head) + '…' + s.slice(s.length - (n - 1 - head));
}

/** Everything before the last dot, kept with it: `a.b.` + `c`. */
function splitQualifier(label) {
  const i = String(label).lastIndexOf('.');
  return i > 0
    ? { qual: label.slice(0, i + 1), name: label.slice(i + 1) }
    : { qual: '', name: label };
}

// Below this scale the 12.5px labels stop being readable, so the canvas
// scrolls instead of shrinking further. Only bites on wide estates.
const MIN_SCALE = 0.55;
let lastDims = null;

function sizeSvg(dims) {
  const wrap = el.graph.parentElement;
  if (!wrap) return;
  // clientWidth INCLUDES the wrapper's padding, so using it directly made
  // every graph overflow by exactly the padding and show a scrollbar that
  // scrolled nothing.
  const cs = getComputedStyle(wrap);
  const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  el.graph.style.width = `${Math.max(avail, Math.round(dims.width * MIN_SCALE))}px`;
}

function renderGraph(model) {
  const dims = layout(model, { nodeWidth: W, nodeHeight: H });
  lastDims = dims;
  hideCard();
  const svg = el.graph;
  // viewBox + no width/height lets CSS scale the drawing down to fit the
  // column. A fixed pixel width overflowed the page on anything wider than
  // four levels, which put the conflict node — the whole point — off-screen.
  svg.setAttribute('viewBox', `0 0 ${dims.width} ${dims.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.aspectRatio = `${dims.width} / ${dims.height}`;
  sizeSvg(dims);

  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const showEdgeLabels = model.edges.length <= 16;
  const parts = [];
  // Edges that converge on one node share a midpoint, and their labels
  // printed on top of each other ("le@3cysesrsdadily"). Buckets by rounded
  // position; each collision nudges the next label up a line.
  const labelSlots = new Map();
  const slotFor = (x, y) => {
    const key = `${Math.round(x / 70)}:${Math.round(y / 14)}`;
    const used = labelSlots.get(key) || 0;
    labelSlots.set(key, used + 1);
    return y - used * 13;
  };

  parts.push(`<defs>
    <marker id="arr" markerWidth="9" markerHeight="7" refX="8.5" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#4a587a"/></marker>
    <marker id="arrbad" markerWidth="9" markerHeight="7" refX="8.5" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#c2410c"/></marker>
  </defs>`);

  for (const e of model.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + W, y1 = a.y + H / 2;
    const x2 = b.x,     y2 = b.y + H / 2;
    const mid = x1 + (x2 - x1) / 2;
    const d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
    const colour = e.contested ? '#c2410c' : '#4a587a';
    const marker = e.contested ? 'arrbad' : 'arr';
    parts.push(`<path d="${d}" stroke="${colour}" fill="none" stroke-width="${e.contested ? 2 : 1.5}"${
      e.contested ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#${marker})"/>`);
    if (showEdgeLabels) {
      const ly = slotFor(mid, (y1 + y2) / 2 - 7);
      parts.push(`<text class="fl" x="${mid}" y="${ly}" text-anchor="middle"${
        e.contested ? ' fill="#e07a3c"' : ''}>${escapeHtml(e.file.replace(/\.sql$/i, ''))}</text>`);
    }
  }

  nodeDetail.clear();
  for (const n of model.nodes) {
    const conflicted = n.writers.length > 1;
    const st = conflicted ? NODE_STYLE.conflict : (NODE_STYLE[n.kind] || NODE_STYLE.isolated);
    const sub = subtitleFor(n, conflicted);
    const { qual, name } = splitQualifier(n.label);
    const qy = n.y + 19;
    const ny = n.y + (qual ? 36 : 28);
    const sy = n.y + (qual ? 51 : 44);
    nodeDetail.set(n.id, detailCard(n, sub, conflicted));
    parts.push(`<g class="node" tabindex="0" role="button" data-node="${escapeHtml(n.id)}"
      aria-label="${escapeHtml(n.label)}, ${escapeHtml(sub)}">
      <title>${escapeHtml(n.label)}\n${escapeHtml(sub)}</title>
      <rect x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="8" fill="${st.fill}"
        stroke="${st.stroke}" stroke-width="${conflicted ? 1.6 : 1}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>
      ${qual ? `<text class="nq" x="${n.x + PAD}" y="${qy}">${escapeHtml(fitMid(qual, SMALL_CHARS))}</text>` : ''}
      <text class="nd" x="${n.x + PAD}" y="${ny}" fill="${st.text}">${escapeHtml(fitMid(name, NAME_CHARS))}</text>
      <text class="fl" x="${n.x + PAD}" y="${sy}"${conflicted ? ' fill="#e08b57"' : ''}>${escapeHtml(fitMid(sub, SMALL_CHARS))}</text>
    </g>`);
  }

  svg.innerHTML = parts.join('\n');
  el.canvas.hidden = false;
}

function subtitleFor(n, conflicted) {
  return conflicted
    ? `${n.writers.length} writers — conflict`
    : n.kind === 'internal' ? `internal to ${n.internalTo}`
    : n.kind === 'source'   ? 'read, never written here'
    : n.kind === 'output'   ? 'output · nothing reads it'
    : `derived · ${n.writers.length} writer`;
}

/* ── node detail on hover ────────────────────────────────────────────────
   The box can only ever hold an elided name, so the full one has to be
   reachable. Native <title> covers the no-JS and touch-and-hold case; this
   card adds the thing the box has no room for at all — which files write it
   and which read it. */

const nodeDetail = new Map();

function detailCard(n, sub, conflicted) {
  const rows = [
    ['Written by', n.writers.length ? n.writers.join(', ') : 'nothing in this set'],
    ['Read by', n.readers.length ? n.readers.join(', ') : 'nothing in this set'],
  ];
  if (n.placeholders.length) rows.push(['Variables', n.placeholders.join('  ')]);
  return `<p class="hcname">${escapeHtml(n.label)}</p>
    <p class="hckind${conflicted ? ' bad' : ''}">${escapeHtml(sub)}</p>
    <dl>${rows.map(([k, v]) =>
      `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
}

function showCard(g) {
  const html = nodeDetail.get(g.getAttribute('data-node'));
  if (!html) return;
  el.hover.innerHTML = html;
  el.hover.hidden = false;
  const wrap = el.graph.parentElement;
  const wr = wrap.getBoundingClientRect();
  const gr = g.getBoundingClientRect();
  const left = gr.left - wr.left + wrap.scrollLeft + gr.width / 2 - el.hover.offsetWidth / 2;
  let top = gr.bottom - wr.top + 8;
  if (top + el.hover.offsetHeight > wrap.clientHeight - 4) {
    top = gr.top - wr.top - el.hover.offsetHeight - 8;
  }
  el.hover.style.left = `${Math.round(Math.max(6,
    Math.min(left, wrap.scrollWidth - el.hover.offsetWidth - 6)))}px`;
  el.hover.style.top = `${Math.round(Math.max(4, top))}px`;
}

const hideCard = () => { el.hover.hidden = true; };
const nodeUnder = (e) => (e.target.closest ? e.target.closest('g[data-node]') : null);

/* ── findings ────────────────────────────────────────────────────────── */

const ICON = { warn: '⚠', info: 'ⓘ', ok: '✓' };

function renderFindings(result) {
  const { findings, graph, cta } = result;
  el.findsub.textContent =
    `${findings.length} ${findings.length === 1 ? 'thing' : 'things'} worth knowing, from ` +
    `${graph.stats.statements} statement${graph.stats.statements === 1 ? '' : 's'} across ` +
    `${graph.stats.files} file${graph.stats.files === 1 ? '' : 's'}.`;

  el.findings.innerHTML = findings.map((f) => `
    <div class="find ${f.severity}">
      <span class="ico">${ICON[f.severity] || 'ⓘ'}</span>
      <div><p class="ft">${ticks(f.title)}</p><p class="fb">${ticks(f.body)}</p></div>
    </div>`).join('');

  el.ctahead.textContent = cta.headline;
  el.ctabody.textContent = cta.body;
  el.ctaprimary.textContent = cta.primary.label;
  el.ctaprimary.href = cta.primary.href;
  el.cta.textContent = cta.secondary.label;
  el.cta.href = cta.secondary.href;
  // Mark the gap this particular finding lands on, so the four-up reads as a
  // response to their files rather than as a feature list that is always there.
  for (const g of document.querySelectorAll('.gap')) {
    g.classList.toggle('lit', g.dataset.gap === cta.gap);
  }
  el.findingsblock.hidden = false;
  el.bridge.hidden = false;
}

/* ── analysis run ────────────────────────────────────────────────────── */

async function run() {
  if (!currentFiles.length) return;
  setStatus('Parsing…');
  el.findingsblock.hidden = true;
  el.bridge.hidden = true;
  try {
    const result = await analyseFiles(currentFiles, el.dialect.value);
    lastResult = result;
    const s = result.graph.stats;
    el.stats.textContent =
      `${el.dialect.selectedOptions[0].textContent} · ${s.statements} statements · ${s.tables} tables`;
    renderGraph(result.graph);
    renderFindings(result);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus(`Could not analyse these files: ${err && err.message ? err.message : err}`, true);
  }
}

function setFiles(files, sample = false) {
  currentFiles = files;
  isSample = sample;
  el.loaded.hidden = false;
  el.dropzone.classList.add('compact');
  el.filecount.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
  el.chips.innerHTML = files
    .map((f) => `<span class="chip" title="${escapeHtml(f.name)}">${escapeHtml(fitMid(f.name, 28))}</span>`)
    .join('');
  el.sampling.hidden = !sample;
  run();
}

/* ── input ───────────────────────────────────────────────────────────── */

async function loadSample() {
  setStatus('Loading the worked example…');
  const files = await Promise.all(SAMPLE.map(async (name) => ({
    name, sql: await fetch(`./sample/${name}`).then((r) => r.text()),
  })));
  setFiles(files, true);
}

async function readDropped(fileList) {
  const wanted = Array.from(fileList).filter((f) => /\.(sql|txt|ddl)$/i.test(f.name));
  if (!wanted.length) {
    setStatus('No .sql files in that drop. Add .sql, .ddl or .txt files.', true);
    return;
  }
  const files = await Promise.all(wanted.map(async (f) => ({ name: f.name, sql: await f.text() })));
  files.sort((a, b) => a.name.localeCompare(b.name));
  setFiles(files, false);
}

el.pick.addEventListener('click', (e) => { e.stopPropagation(); el.fileinput.click(); });
el.dropzone.addEventListener('click', () => el.fileinput.click());
el.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileinput.click(); }
});
el.replace.addEventListener('click', () => el.fileinput.click());
el.usesample.addEventListener('click', loadSample);
el.fileinput.addEventListener('change', () => {
  if (el.fileinput.files.length) readDropped(el.fileinput.files);
  el.fileinput.value = '';
});

for (const type of ['dragenter', 'dragover']) {
  el.dropzone.addEventListener(type, (e) => { e.preventDefault(); el.dropzone.classList.add('over'); });
}
for (const type of ['dragleave', 'drop']) {
  el.dropzone.addEventListener(type, (e) => { e.preventDefault(); el.dropzone.classList.remove('over'); });
}
el.dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) readDropped(e.dataTransfer.files);
});
// Dropping anywhere on the page works; the browser's default is to navigate
// away to the file, which would lose everything on screen.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

el.dialect.addEventListener('change', run);

for (const type of ['mouseover', 'click', 'focusin']) {
  el.graph.addEventListener(type, (e) => {
    const g = nodeUnder(e);
    if (g) showCard(g);
    else if (type === 'click') hideCard();
  });
}
el.graph.addEventListener('mouseleave', hideCard);
el.graph.addEventListener('focusout', hideCard);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCard(); });
window.addEventListener('resize', () => { if (lastDims) sizeSvg(lastDims); });

el.download.addEventListener('click', () => {
  if (!lastResult) return;
  const payload = {
    generated_by: 'sql-lineage — https://github.com/data-conductor/sql-lineage',
    generated_at: new Date().toISOString(),
    dialect: el.dialect.value,
    stats: lastResult.graph.stats,
    nodes: lastResult.graph.nodes.map(({ id, label, kind, writers, readers, internalTo, level }) =>
      ({ id, label, kind, writers, readers, internal_to: internalTo, level })),
    edges: lastResult.graph.edges,
    findings: lastResult.findings.map(({ kind, severity, title, body, refs }) =>
      ({ kind, severity, title, body, refs })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sql-lineage.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* ── boot ────────────────────────────────────────────────────────────── */

const DIALECT_LABELS = {
  postgres: 'Postgres', postgresql: 'Postgres', mysql: 'MySQL', bigquery: 'BigQuery',
  snowflake: 'Snowflake', tsql: 'SQL Server', sqlserver: 'SQL Server', mssql: 'SQL Server',
  redshift: 'Redshift', databricks: 'Databricks', duckdb: 'DuckDB', hive: 'Hive',
  spark: 'Spark', trino: 'Trino', presto: 'Presto', clickhouse: 'ClickHouse',
  oracle: 'Oracle', sqlite: 'SQLite', generic: 'Generic SQL', mariadb: 'MariaDB',
};
const PREFERRED = ['postgres', 'mysql', 'tsql', 'snowflake', 'bigquery', 'duckdb',
  'redshift', 'databricks', 'clickhouse', 'oracle', 'sqlite', 'spark', 'trino', 'generic'];

el.dialect.innerHTML = PREFERRED
  .filter((d) => SUPPORTED_DIALECTS.includes(d))
  .map((d) => `<option value="${d}"${d === 'postgres' ? ' selected' : ''}>${DIALECT_LABELS[d] || d}</option>`)
  .join('');

loadSample().catch((e) => setStatus(`Could not load the example: ${e.message}`, true));
