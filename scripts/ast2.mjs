import { parse, init, Dialect } from '@polyglot-sql/sdk';
await init();
const show = (o) => o ? Object.keys(o).slice(0,8).join(', ') : String(o);
for (const sql of ['DELETE FROM a.t WHERE x=1;','TRUNCATE TABLE a.t;','MERGE INTO a.t USING b.s ON a.t.id=b.s.id WHEN MATCHED THEN UPDATE SET x=1;','DROP TABLE a.t;','ALTER TABLE a.t ADD COLUMN z INT;']) {
  const r = parse(sql, Dialect.PostgreSQL);
  const ast = Array.isArray(r?.ast) ? r.ast[0] : r;
  const key = Object.keys(ast)[0];
  const inner = ast[key];
  console.log(key.padEnd(16), '| top keys:', show(inner));
  console.log(' '.repeat(16), '| inner.table?', !!inner?.table, ' inner.this?', !!inner?.this,
    ' name@table:', inner?.table?.name?.name ?? '-', ' schema@table:', inner?.table?.schema?.name ?? '-');
}
