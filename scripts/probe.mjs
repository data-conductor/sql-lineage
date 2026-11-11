import { readFileSync } from 'node:fs';
import { extractSql } from '../dist/index.js';
const sql = readFileSync(new URL('../web/sample/03_users_daily.sql', import.meta.url), 'utf8');
const r = await extractSql(sql, 'postgres');
const e = r.extract_json;
console.log('operation_summary:', e.operation_summary);
console.log('tables_read     :', e.tables_read.map(t=>t.raw));
console.log('tables_written  :', e.tables_written.map(t=>t.raw));
console.log('external_writes :', e.external_writes.map(t=>t.raw));
console.log('internal_writes :', e.internal_writes.map(t=>t.raw));
console.log('warnings        :', JSON.stringify(e.walker_warnings));
console.log('\nstatements:');
for (const s of e.statements) {
  console.log(' ', s.idx, s.operation, s.statement_class,
    '| target:', s.target_table?.raw ?? null,
    '| read:', s.tables_read.map(t=>t.raw),
    '| written:', s.tables_written.map(t=>t.raw));
}
