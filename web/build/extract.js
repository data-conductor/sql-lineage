/**
 * Extraction entry point — parser + walker, with no Node dependencies.
 *
 * Lifted from Data Conductor's api-main/src/services/sql-extract/index.ts.
 * Two deliberate differences from that original, both so this runs in a
 * browser:
 *
 *   1. The SDK version is a constant rather than a `require()` of the SDK's
 *      package.json. Bundlers cannot resolve that require, and the value is
 *      only ever used to mark an extract as produced against an unverified
 *      parser — it is metadata, not behaviour.
 *   2. `init()` takes an optional wasm URL, because a browser has to be told
 *      where the .wasm lives while Node resolves it from disk.
 *
 * Everything else — the placeholder substitution, the failure modes, the
 * best-effort contract — is unchanged, because the walker on the other side
 * of it is the same file that runs in production.
 */
import { parse as polyglotParse, init as polyglotInit, Dialect } from '@polyglot-sql/sdk';
import { walkAstArray } from './walker.js';
import { WALKER_VERSION } from './types.js';
/** SDK version this walker has been verified against. Kept in step with the
 *  dependency range in package.json by hand — it only marks confidence. */
export const VERIFIED_SDK_VERSION = '0.3.11';
const POLYGLOT_DIALECTS = {
    bigquery: Dialect.BigQuery,
    snowflake: Dialect.Snowflake,
    postgresql: Dialect.PostgreSQL,
    postgres: Dialect.PostgreSQL,
    mysql: Dialect.MySQL,
    mariadb: Dialect.MySQL,
    sqlserver: Dialect.TSQL,
    mssql: Dialect.TSQL,
    tsql: Dialect.TSQL,
    redshift: Dialect.Redshift,
    databricks: Dialect.Databricks,
    duckdb: Dialect.DuckDB,
    hive: Dialect.Hive,
    spark: Dialect.Spark,
    trino: Dialect.Trino,
    presto: Dialect.Presto,
    clickhouse: Dialect.ClickHouse,
    oracle: Dialect.Oracle,
    sqlite: Dialect.SQLite,
    generic: Dialect.Generic,
};
export const SUPPORTED_DIALECTS = Object.keys(POLYGLOT_DIALECTS);
/** Mustache placeholder: `{{NAME}}`. Rewritten to `__ph_NAME` before parsing
 *  so the lexer treats it as an ordinary identifier; the walker reverses it
 *  on output. Identical to the production substitution by design. */
const PLACEHOLDER_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
function substitutePlaceholders(sql) {
    return sql.replace(PLACEHOLDER_RE, (_m, name) => `__ph_${name}`);
}
function collectRawPlaceholders(rawSql) {
    const re = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
    const set = new Set();
    let m;
    while ((m = re.exec(rawSql)) !== null)
        set.add(`{{${m[1]}}}`);
    return Array.from(set).sort();
}
let initPromise = null;
/**
 * Load the parser's WASM module. Idempotent and memoised; a failure clears
 * the memo so the next caller can retry.
 *
 * @param wasmUrl Where the .wasm lives. Required in a browser, ignored in
 *                Node, where the SDK resolves it from the package.
 */
export function init(wasmUrl) {
    if (!initPromise) {
        initPromise = Promise.resolve(wasmUrl ? polyglotInit(wasmUrl) : polyglotInit())
            .then(() => undefined)
            .catch((err) => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}
/**
 * Extract structure from one SQL script.
 *
 * Never throws. A parser failure, a WASM failure or an unrecognised
 * construct all come back as data: `parse_error` for the first two,
 * `walker_warnings` for the third.
 */
export async function extractSql(rawSql, dialect) {
    const polyglotDialect = POLYGLOT_DIALECTS[(dialect || 'generic').toLowerCase()] || Dialect.Generic;
    try {
        await init();
    }
    catch (e) {
        return emptyResult(rawSql, `wasm_init_failed: ${e?.message ?? 'unknown'}`);
    }
    const prepared = substitutePlaceholders(rawSql);
    let result;
    try {
        result = polyglotParse(prepared, polyglotDialect);
    }
    catch (e) {
        return emptyResult(rawSql, `parser_threw: ${e?.message ?? 'unknown'}`);
    }
    if (result && typeof result === 'object' && result.success === false) {
        return emptyResult(rawSql, String(result.error || 'parse_failed'));
    }
    const asts = Array.isArray(result?.ast) ? result.ast : [result];
    const { extract } = walkAstArray(asts, rawSql);
    return {
        extract_json: extract,
        extract_sdk_version: VERIFIED_SDK_VERSION,
        walker_version: WALKER_VERSION,
    };
}
function emptyResult(rawSql, parseError) {
    return {
        extract_json: {
            operation_summary: 'OTHER',
            tables_read: [],
            external_writes: [],
            internal_writes: [],
            tables_written: [],
            raw_table_refs: collectRawPlaceholders(rawSql),
            statements: [],
            walker_warnings: [{ stmt_idx: -1, node_kind: 'parse', reason: parseError }],
        },
        extract_sdk_version: VERIFIED_SDK_VERSION,
        walker_version: WALKER_VERSION,
        parse_error: parseError,
    };
}
/**
 * Extract a whole set of files. This is the unit the tool actually works in —
 * a single file cannot show you a write conflict, which is the finding that
 * matters most.
 *
 * Files are processed in order and a failure in one never stops the rest:
 * a file that will not parse comes back with `parse_error` set and empty
 * structure, and the graph is built from whatever did parse.
 */
export async function extractFiles(files, dialect) {
    const out = [];
    for (const f of files) {
        const r = await extractSql(f.sql, dialect);
        out.push({ name: f.name, sql: f.sql, extract: r.extract_json, parse_error: r.parse_error });
    }
    return out;
}
