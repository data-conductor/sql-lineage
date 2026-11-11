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
export function inferKindFromExtract(extract: ExtractJson | null | undefined): InferredKind {
  if (!extract || !Array.isArray(extract.statements) || extract.statements.length === 0) {
    return 'empty';
  }
  let ddlCount = 0;
  let dmlCount = 0;
  for (const s of extract.statements) {
    if (s.statement_class === 'DDL') ddlCount++;
    else if (s.statement_class === 'DML') dmlCount++;
    // TCL / OTHER (BEGIN/COMMIT/CALL/EXECUTE_IMMEDIATE) are ignored for
    // classification — they don't push in either direction.
  }
  if (ddlCount > 0 && dmlCount === 0) return 'migration';
  if (dmlCount > 0 && ddlCount === 0) return 'query';
  if (ddlCount > 0 && dmlCount > 0) return 'mixed';
  // Neither DDL nor DML found (all TCL/OTHER). Treat as unclassifiable.
  return 'empty';
}

/**
 * Produce a kind-mismatch warning if the user's declared execution_kind
 * disagrees with what the AST looks like. Returns [] when it agrees or
 * when the extract is empty (nothing to classify).
 */
export function kindMismatchWarnings(
  extract: ExtractJson | null | undefined,
  declaredKind: ExecutionKind
): WalkerWarning[] {
  const inferred = inferKindFromExtract(extract);
  if (inferred === 'empty') return [];
  if (inferred === declaredKind) return [];
  if (inferred === 'mixed') {
    return [
      {
        stmt_idx: -1,
        node_kind: 'kind_mismatch',
        reason:
          declaredKind === 'migration'
            ? 'Migration step contains both DDL and non-DDL statements — split DML into a separate data step.'
            : 'Query step contains DDL — consider flagging as migration so it runs with tracking in PROD.',
      },
    ];
  }
  return [
    {
      stmt_idx: -1,
      node_kind: 'kind_mismatch',
      reason:
        declaredKind === 'migration'
          ? `This step is marked as migration but its SQL looks like a ${inferred} (no DDL detected).`
          : `This step is marked as query but its SQL looks like a ${inferred} (only DDL detected).`,
    },
  ];
}

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
export function lintIdempotence(
  extract: ExtractJson | null | undefined,
  rawSql: string
): WalkerWarning[] {
  if (!extract || !Array.isArray(extract.statements)) return [];
  const warnings: WalkerWarning[] = [];
  // We use a single case-insensitive test against the whole SQL for each
  // guard; that's coarse (won't catch the guard being in a different
  // statement than the operation) but false positives are the cost of
  // safety here. Users can silence by adding the guard globally.
  const sqlUpper = rawSql.toUpperCase();
  const hasIfNotExists = /\bIF\s+NOT\s+EXISTS\b/.test(sqlUpper);
  const hasIfExists = /\bIF\s+EXISTS\b/.test(sqlUpper);
  const hasOrReplace = /\bOR\s+REPLACE\b/.test(sqlUpper);

  for (const s of extract.statements) {
    switch (s.operation) {
      case 'CREATE_TABLE':
        if (!hasIfNotExists) {
          warnings.push({
            stmt_idx: s.idx,
            node_kind: 'idempotence',
            reason:
              'CREATE TABLE without IF NOT EXISTS will fail on re-run in QA. Add IF NOT EXISTS to make QA re-runs safe.',
          });
        }
        break;
      case 'CREATE_VIEW':
        if (!hasIfNotExists && !hasOrReplace) {
          warnings.push({
            stmt_idx: s.idx,
            node_kind: 'idempotence',
            reason:
              'CREATE VIEW without IF NOT EXISTS or OR REPLACE will fail on re-run. Add one to make QA re-runs safe.',
          });
        }
        break;
      case 'DROP':
        if (!hasIfExists) {
          warnings.push({
            stmt_idx: s.idx,
            node_kind: 'idempotence',
            reason:
              'DROP without IF EXISTS will fail on re-run in QA if the object was already dropped. Add IF EXISTS.',
          });
        }
        break;
      case 'ALTER':
        // Only warn on ADD COLUMN without a guard — the most common failure.
        // Other ALTERs (RENAME, DROP COLUMN, ADD CONSTRAINT) are harder to
        // reliably lint without full DDL parsing; skip until we have it.
        if (/\bADD\s+COLUMN\b/.test(sqlUpper) && !hasIfNotExists) {
          warnings.push({
            stmt_idx: s.idx,
            node_kind: 'idempotence',
            reason:
              'ALTER TABLE ADD COLUMN without IF NOT EXISTS will fail on re-run. Add IF NOT EXISTS (Snowflake/Postgres supported).',
          });
        }
        break;
      // TRUNCATE is naturally idempotent (result is the same empty
      // table each time); no warning needed.
    }
  }
  return warnings;
}
