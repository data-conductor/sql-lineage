/**
 * Print the raw polyglot AST for a statement.
 *
 *   node scripts/ast-probe.mjs "INSERT INTO a.t SELECT x FROM b.s" postgres
 *
 * This is how the walker's node-shape assumptions get checked. It is also
 * how the INSERT/UPDATE/DELETE/TRUNCATE write-target bug was found: the code
 * looked for the target under `inner.this`, and this script showed it sitting
 * at `inner.table`. If you are reporting a wrong graph, the output of this is
 * the most useful thing you can paste.
 */
import { parse, init, Dialect } from '@polyglot-sql/sdk';

const sql = process.argv[2];
const dialectName = (process.argv[3] || 'postgresql').toLowerCase();
if (!sql) {
  console.error('usage: node scripts/ast-probe.mjs "<SQL>" [dialect]');
  process.exit(1);
}
const DIALECTS = {
  postgres: Dialect.PostgreSQL, postgresql: Dialect.PostgreSQL, mysql: Dialect.MySQL,
  tsql: Dialect.TSQL, sqlserver: Dialect.TSQL, snowflake: Dialect.Snowflake,
  bigquery: Dialect.BigQuery, duckdb: Dialect.DuckDB, generic: Dialect.Generic,
};
await init();
const r = parse(sql, DIALECTS[dialectName] ?? Dialect.Generic);
const stmts = Array.isArray(r?.ast) ? r.ast : [r];
for (const [i, ast] of stmts.entries()) {
  const key = Object.keys(ast)[0];
  console.log(`\n── statement ${i} · root key: ${key}`);
  console.log('   top-level keys:', Object.keys(ast[key] || {}).join(', '));
  console.log(JSON.stringify(ast[key], null, 1));
}
