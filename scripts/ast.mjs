import { parse, init, Dialect } from '@polyglot-sql/sdk';
await init();
for (const sql of ['INSERT INTO a.t (x) SELECT x FROM b.s;', 'UPDATE a.t SET x=1;', 'TRUNCATE TABLE a.t;']) {
  const r = parse(sql, Dialect.PostgreSQL);
  const ast = Array.isArray(r?.ast) ? r.ast[0] : r;
  const key = Object.keys(ast)[0];
  console.log('='.repeat(70));
  console.log(sql, '\n root key:', key);
  console.log(JSON.stringify(ast[key], null, 1).split('\n').slice(0, 40).join('\n'));
}
