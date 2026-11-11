/**
 * Canonical shape of a SQL data step's structural extract.
 *
 * Produced by the walker (services/sql-extract/walker.ts) from the AST array
 * that @polyglot-sql/sdk returns. The walker is deterministic — same SQL
 * (with the same placeholder substitution) always produces the same extract
 * for a given (sdk_version, walker_version) pair.
 *
 * Per-env resolution (TableRef.envs) is applied as a separate step by the
 * resolver after the walker runs; the walker itself only produces TableRef.raw.
 *
 * See ../../ast_parser_issues.txt §"Final Implementation Plan" for the design
 * record.
 */
/** Bumped whenever the walker's output schema changes semantics. Stored
 *  alongside the extract so stale rows can be detected on read and lazily
 *  re-extracted (§6 of the plan). */
export const WALKER_VERSION = 1;
