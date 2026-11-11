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
import { ExtractJson } from './types.js';
/** SDK version this walker has been verified against. Kept in step with the
 *  dependency range in package.json by hand — it only marks confidence. */
export declare const VERIFIED_SDK_VERSION = "0.3.11";
export declare const SUPPORTED_DIALECTS: string[];
/**
 * Load the parser's WASM module. Idempotent and memoised; a failure clears
 * the memo so the next caller can retry.
 *
 * @param wasmUrl Where the .wasm lives. Required in a browser, ignored in
 *                Node, where the SDK resolves it from the package.
 */
export declare function init(wasmUrl?: string): Promise<void>;
export interface ExtractResult {
    extract_json: ExtractJson;
    extract_sdk_version: string;
    walker_version: number;
    /** Set when parsing failed. extract_json is then a minimal placeholder
     *  that still carries raw_table_refs, so a caller can show the error
     *  without losing which variables the file mentions. */
    parse_error?: string;
}
/**
 * Extract structure from one SQL script.
 *
 * Never throws. A parser failure, a WASM failure or an unrecognised
 * construct all come back as data: `parse_error` for the first two,
 * `walker_warnings` for the third.
 */
export declare function extractSql(rawSql: string, dialect: string): Promise<ExtractResult>;
/** One input file and what came out of it. */
export interface FileExtract {
    name: string;
    sql: string;
    extract: ExtractJson;
    parse_error?: string;
}
export interface SqlFileInput {
    name: string;
    sql: string;
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
export declare function extractFiles(files: SqlFileInput[], dialect: string): Promise<FileExtract[]>;
