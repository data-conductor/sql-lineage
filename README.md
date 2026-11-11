# sql-lineage

Read a folder of `.sql` files and work out what depends on what.

No database connection. No dbt project. No server. It parses the SQL you
already have — the files in repos, in cron jobs, in that one folder — and
tells you things you can't see from inside any single file:

- **two files writing the same table**, with nothing declaring which runs first
- **`{{variables}}` with no value in scope**, and which files disagree about them
- **tables read but never written here**, which is where your real boundary is
- **tables internal to one file**, which are the ones safe to rename

**[Try it in your browser →](https://data-conductor.com/tools/what-runs-first/)**
Nothing is uploaded; the parser runs locally as WebAssembly.

---

## Why this exists

Most lineage tools are platforms. You deploy them, point them at a warehouse,
and maintain them. That is a reasonable trade once you have a data team, and a
bad one when you have four SQL files and a cron job.

This is the small version: a parser and a graph, usable from a web page in
thirty seconds or from Node in three lines.

It is also the parser that runs inside [Data Conductor](https://data-conductor.com),
not a reimplementation of it. Things you do once should be free and shouldn't
need an account; things you do repeatedly, that you don't want to maintain a
server for, are what we sell.

## Install

```bash
npm install sql-lineage
```

## Use

```js
import { analyseFiles } from 'sql-lineage';

const { graph, findings, cta } = await analyseFiles([
  { name: '03_users_daily.sql',     sql: '...' },
  { name: 'legacy_users_daily.sql', sql: '...' },
], 'postgres');

for (const f of findings) console.log(`[${f.severity}] ${f.title}`);
// [warn] 2 files write to `analytics.users_daily`
```

`analyseFiles` never throws on bad SQL. A file that will not parse comes back
as a finding and is excluded from the graph, so one malformed file cannot take
the whole answer down with it.

### Lower-level

```js
import { extractSql, buildGraph, analyse, layout } from 'sql-lineage';

const { extract_json } = await extractSql(sql, 'postgres');   // one script
const graph = buildGraph(fileExtracts);                        // the model
const findings = analyse(graph, fileExtracts);                 // the rules
layout(graph);                                                 // x/y for drawing
```

### In a browser

The parser is WebAssembly. Serve `polyglot_sql_wasm_bg.wasm` next to the SDK's
`index.js` and it resolves itself; see `scripts/build-web.mjs` for the whole
of what the hosted page does. It is about 17 MB raw and about 2.1 MB brotli —
serve it compressed.

## Dialects

postgres · mysql · tsql · snowflake · bigquery · duckdb · redshift ·
databricks · clickhouse · oracle · sqlite · spark · trino · presto · hive ·
mariadb · generic

## What it does not do

- **Per-column lineage.** Table-level only. The walker records that a table
  was read, not which column came from where.
- **Resolve schemas.** `users` and `public.users` stay separate nodes.
  Guessing they are the same could merge two tables and turn a real write
  conflict into a clean graph — over-reporting is recoverable, a finding we
  hid is not.
- **Connect to anything.** If you want live-database introspection, this is
  the wrong tool; give it a schema dump instead
  (`pg_dump -s`, `mysqldump --no-data`, SSMS *Generate Scripts*).

## Development

```bash
npm install
npm run build        # compile the package
npm run dev          # build, stage the web assets, serve the page locally
npm test
```

## Contributing

Issues and pull requests are welcome, particularly:

- SQL that produces a wrong graph — paste the statement, that is the whole
  bug report
- AST shapes from dialects we do not see much of
- findings rules that caught something real in your own estate

## Licence

MIT.
