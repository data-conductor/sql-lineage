import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFiles, extractSql, normalizeTable } from '../dist/index.js';

/** The regression that mattered: every DML write op recorded its target as
 *  a READ and recorded no write, so a write conflict could never be seen.
 *  One case per statement type, because they each sit in a different place
 *  in the AST and only three of nine were right. */
test('write targets are recorded as writes, not reads', async () => {
  const cases = [
    ['INSERT INTO a.t (x) SELECT x FROM b.s;', 'a.t'],
    ['INSERT INTO a.t SELECT x FROM b.s;', 'a.t'],
    ['INSERT INTO a.t (x) VALUES (1);', 'a.t'],
    ['UPDATE a.t SET x = 1;', 'a.t'],
    ['DELETE FROM a.t WHERE x = 1;', 'a.t'],
    ['TRUNCATE TABLE a.t;', 'a.t'],
    ['CREATE TABLE a.t AS SELECT x FROM b.s;', 'a.t'],
    ['CREATE VIEW a.t AS SELECT x FROM b.s;', 'a.t'],
    ['MERGE INTO a.t USING b.s ON a.t.id=b.s.id WHEN MATCHED THEN UPDATE SET x=1;', 'a.t'],
  ];
  for (const [sql, target] of cases) {
    const { extract_json: e } = await extractSql(sql, 'postgres');
    assert.deepEqual(e.tables_written.map(t => t.raw), [target], sql);
    assert.ok(!e.tables_read.some(t => t.raw === target), `${sql} — target must not be a read`);
  }
});

test('two files writing one table is a ranked write-conflict finding', async () => {
  const r = await analyseFiles([
    { name: 'a.sql', sql: 'INSERT INTO s.t (x) SELECT x FROM s.src;' },
    { name: 'b.sql', sql: 'INSERT INTO s.t (y) SELECT y FROM s.other;' },
  ], 'postgres');
  const top = r.findings[0];
  assert.equal(top.kind, 'write-conflict');
  assert.match(top.title, /2 files write to/);
  assert.match(r.cta.label, /run order/);
});

test('edges come from statement scope, not a file-level cross product', async () => {
  // tmp is written by stmt 1 reading src, then read by stmt 2 writing out.
  // A file-level cross product invents src->out and loses tmp->out.
  const r = await analyseFiles([{
    name: 'm.sql',
    sql: `CREATE TEMP TABLE tmp AS SELECT a FROM s.src;
          INSERT INTO s.out (a) SELECT a FROM tmp;`,
  }], 'postgres');
  const pairs = r.graph.edges.map(e => `${e.from}->${e.to}`).sort();
  assert.deepEqual(pairs, ['s.src->tmp', 'tmp->s.out']);
});

test('a file that will not parse is reported and does not sink the rest', async () => {
  const r = await analyseFiles([
    { name: 'good.sql', sql: 'CREATE TABLE a.t AS SELECT x FROM b.s;' },
    { name: 'bad.sql', sql: 'SELECT FROM WHERE ((( ;' },
  ], 'postgres');
  assert.equal(r.graph.stats.parseFailures, 1);
  assert.ok(r.findings.some(f => f.kind === 'parse-failure'));
  assert.ok(r.graph.nodes.some(n => n.id === 'a.t'));
});

test('cycles are detected rather than hanging the layout', async () => {
  const r = await analyseFiles([
    { name: 'a.sql', sql: 'INSERT INTO s.x SELECT v FROM s.y;' },
    { name: 'b.sql', sql: 'INSERT INTO s.y SELECT v FROM s.x;' },
  ], 'postgres');
  assert.ok(r.findings.some(f => f.kind === 'cycle'));
});

test('normalizeTable keeps distinct schemas distinct', () => {
  assert.equal(normalizeTable('"Public"."Users"'), 'public.users');
  assert.notEqual(normalizeTable('users'), normalizeTable('public.users'));
});

test('an empty set does not throw', async () => {
  const r = await analyseFiles([], 'postgres');
  assert.equal(r.graph.nodes.length, 0);
  assert.equal(r.findings[0].kind, 'clean');
});
