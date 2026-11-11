/**
 * AST-based checks for the migrations feature (kb/retired/migrations-feature.md).
 *
 * Two independent analyses, both driven by the walker's per-statement
 * StatementExtract output — cheap because the AST is already parsed.
 *
 *   1. inferKindFromExtract() — what "kind" does the SQL actually look
 *      like? DDL-only → migration; DML/SELECT-only → query; mixed →
 *      neither. Used to raise a kind-mismatch warning when the user has
 *      flagged a step as one kind but its contents suggest the other.
 *
 *   2. lintIdempotence() — for migration steps, scan for DDL that would
 *      fail on a second QA run (CREATE TABLE X vs CREATE TABLE IF NOT
 *      EXISTS X, etc.). Returns warnings that flow into extract_warnings
 *      so the Summary tab surfaces them alongside walker warnings.
 *
 * Both are best-effort. The walker doesn't currently preserve raw statement
 * text so idempotence detection works from operation + target_table + the
 * raw SQL — a lexical scan is used for the "IF NOT EXISTS" check.
 */
import { ExtractJson, WalkerWarning } from './types.js';
export type ExecutionKind = 'query' | 'migration';
export type InferredKind = 'query' | 'migration' | 'mixed' | 'empty';
/**
 * Best-effort classification of the AST's overall shape.
 *   - "migration"  — every statement is DDL (CREATE_TABLE, ALTER, DROP,
 *                    TRUNCATE, CREATE_VIEW) or TCL (BEGIN/COMMIT wrapping
 *                    DDL, though we don't inspect inside blocks).
 *   - "query"      — every statement is DML (SELECT/INSERT/UPDATE/DELETE/
 *                    MERGE) or a CALL (procedural).
 *   - "mixed"      — the script contains both. This is often legitimate
 *                    (e.g., CREATE TABLE + INSERT bootstrap) so we report
 *                    but don't hard-block.
 *   - "empty"      — no statements extracted (parse failure or empty SQL);
 *                    caller should skip the mismatch check.
 */
export declare function inferKindFromExtract(extract: ExtractJson | null | undefined): InferredKind;
/**
 * Produce a kind-mismatch warning if the user's declared execution_kind
 * disagrees with what the AST looks like. Returns [] when it agrees or
 * when the extract is empty (nothing to classify).
 */
export declare function kindMismatchWarnings(extract: ExtractJson | null | undefined, declaredKind: ExecutionKind): WalkerWarning[];
/**
 * Lint DDL for idempotence. Migration steps must be safe to re-run in
 * QA/test envs (see kb/retired/migrations-feature.md — QA re-runs require the
 * user to write IF NOT EXISTS themselves).
 *
 * Detection is lexical, per statement: the walker doesn't preserve raw
 * text of the specific DDL clauses, so we scan the SQL string for the
 * operation keyword + presence/absence of the guard. Best-effort.
 *
 * Statements checked:
 *   - CREATE TABLE  → needs "IF NOT EXISTS"
 *   - CREATE VIEW   → needs "IF NOT EXISTS" or "OR REPLACE"
 *   - DROP TABLE    → needs "IF EXISTS"
 *   - TRUNCATE      → always idempotent, no warning
 *   - ALTER TABLE ADD COLUMN → needs "IF NOT EXISTS" (Snowflake/Postgres
 *                              support it; MySQL as of 8.0.29+)
 *
 * We do NOT try to lint TCL, EXECUTE_IMMEDIATE, or generic ALTER
 * variants — too many edge cases and the warning-fatigue cost would be
 * high. Users of those constructs are responsible for their own
 * idempotence.
 */
export declare function lintIdempotence(extract: ExtractJson | null | undefined, rawSql: string): WalkerWarning[];
