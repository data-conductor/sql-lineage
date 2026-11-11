import { analyseFiles } from '../dist/index.js';
const show = async (label, files, dialect='postgres') => {
  const r = await analyseFiles(files, dialect);
  console.log(`\n--- ${label}`);
  console.log('  stats:', JSON.stringify(r.graph.stats));
  for (const f of r.findings) console.log(`  [${f.severity}] ${f.title}`);
  console.log('  CTA:', r.cta.label);
};

await show('one broken file among good ones', [
  { name: 'good.sql', sql: 'CREATE TABLE a.t AS SELECT x FROM b.s;' },
  { name: 'broken.sql', sql: 'SELECT FROM WHERE ((( ;' },
]);
await show('empty input', []);
await show('single clean file', [
  { name: 'only.sql', sql: 'CREATE TABLE a.t AS SELECT x FROM b.s;' },
]);
await show('circular dependency', [
  { name: 'a.sql', sql: 'INSERT INTO s.x SELECT v FROM s.y;' },
  { name: 'b.sql', sql: 'INSERT INTO s.y SELECT v FROM s.x;' },
]);
await show('html-ish table name (escaping)', [
  { name: 'x.sql', sql: 'CREATE TABLE "<script>alert(1)</script>" AS SELECT a FROM b.c;' },
]);
