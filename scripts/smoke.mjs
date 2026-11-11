import { readFileSync, readdirSync } from 'node:fs';
import { analyseFiles } from '../dist/index.js';

const dir = new URL('../web/sample/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  .map(name => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') }));

const r = await analyseFiles(files, 'postgres');

console.log('STATS', JSON.stringify(r.graph.stats));
console.log('\nPARSE ERRORS:', r.files.filter(f => f.parse_error).map(f => `${f.name}: ${f.parse_error}`).join('\n  ') || 'none');

console.log('\nNODES');
for (const n of [...r.graph.nodes].sort((a,b) => a.level - b.level || a.id.localeCompare(b.id))) {
  console.log(`  L${n.level} ${n.kind.padEnd(9)} ${n.label.padEnd(26)} w=[${n.writers}] r=[${n.readers}]`);
}

console.log('\nEDGES');
for (const e of r.graph.edges) console.log(`  ${e.from} -> ${e.to}  (${e.file})${e.contested ? '  **CONTESTED**' : ''}`);

console.log('\nFINDINGS');
for (const f of r.findings) {
  console.log(`  [${f.rank}] ${f.severity.toUpperCase()} ${f.kind}`);
  console.log(`      ${f.title}`);
}
console.log('\nCTA:', r.cta.label, '->', r.cta.href);
