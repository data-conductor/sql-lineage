/**
 * AST walker — deterministic structural extraction from @polyglot-sql/sdk.
 *
 * The plan calls this MID-scope: tables, joins, aggregations, group_by,
 * window_functions, CTEs. Per-column lineage is NOT in scope. Best-effort +
 * flag is the contract: any AST construct the walker doesn't recognize
 * produces a WalkerWarning rather than failing the extract.
 *
 * Polyglot AST shape primer (gathered from probing the SDK):
 *   - Each statement is a single-key object: { create_table: {...} },
 *     { select: {...} }, { merge: {...} }, { insert: {...} }, etc.
 *   - Table refs look like { name: { name, quoted }, schema?, catalog? }
 *     (sometimes wrapped in alias.this.table)
 *   - Aggregates: either { aggregate_function: { name, args } } or
 *     specific keys per function (count.star, min.this, ...) — we handle
 *     both.
 *   - Window functions: { window_function: { this, over: { partition_by,
 *     order_by, ... } } }
 *   - CTEs live at select.with.ctes[].{alias, this}
 *
 * Placeholder reversal: input SQL has `{{NAME}}` rewritten to `__ph_NAME`
 * so it parses. Walker reverses that on output — TableRef.raw and other
 * user-visible strings restore the original mustache form.
 */
import { ExtractJson } from './types.js';
/** Collect distinct `{{NAME}}` placeholders from the raw SQL. Used for the
 *  variable-mutation-hook lookup index (§3 of the plan). */
export declare function collectRawPlaceholders(rawSql: string): string[];
/** Walk an array of polyglot statement ASTs → ExtractJson (envs unresolved).
 *  Pure function over the parser output. Pair with the resolver to attach
 *  per-env table names. */
export declare function walkAstArray(asts: any[], rawSql: string): {
    extract: ExtractJson;
    walker_version: number;
};
