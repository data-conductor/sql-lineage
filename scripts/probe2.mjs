import { extractSql } from '../dist/index.js';
const cases = {
  'INSERT cols + SELECT': 'INSERT INTO a.t (x,y) SELECT x,y FROM b.s;',
  'INSERT bare SELECT'  : 'INSERT INTO a.t SELECT x,y FROM b.s;',
  'INSERT VALUES'       : "INSERT INTO a.t (x) VALUES (1);",
  'CREATE TABLE AS'     : 'CREATE TABLE a.t AS SELECT x FROM b.s;',
  'UPDATE'              : 'UPDATE a.t SET x = 1 WHERE y IN (SELECT y FROM b.s);',
  'DELETE'              : 'DELETE FROM a.t WHERE y IN (SELECT y FROM b.s);',
  'MERGE'               : 'MERGE INTO a.t USING b.s ON a.t.id=b.s.id WHEN MATCHED THEN UPDATE SET x=b.s.x;',
  'TRUNCATE'            : 'TRUNCATE TABLE a.t;',
  'CREATE VIEW'         : 'CREATE VIEW a.v AS SELECT x FROM b.s;',
};
for (const [label, sql] of Object.entries(cases)) {
  const e = (await extractSql(sql, 'postgres')).extract_json;
  const s = e.statements[0];
  console.log(label.padEnd(22),
    '| op:', String(s?.operation).padEnd(13),
    '| target:', String(s?.target_table?.raw ?? '—').padEnd(6),
    '| written:', JSON.stringify(e.tables_written.map(t=>t.raw)).padEnd(10),
    '| read:', JSON.stringify(e.tables_read.map(t=>t.raw)));
}
