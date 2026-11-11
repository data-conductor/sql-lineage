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
/**
 * Identity of a table referenced by SQL. `raw` is what the user wrote
 * (potentially containing `{{var}}` placeholders); `envs` maps each env in
 * scope to the fully-resolved fully-qualified name when every placeholder
 * in `raw` has a value for that env. Envs with unresolved placeholders are
 * omitted (not partial-substituted) — see §3 of the plan.
 */
export interface TableRef {
    raw: string;
    envs: Record<string, string>;
}
/** Bumped whenever the walker's output schema changes semantics. Stored
 *  alongside the extract so stale rows can be detected on read and lazily
 *  re-extracted (§6 of the plan). */
export declare const WALKER_VERSION = 1;
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS' | 'LATERAL';
export interface JoinExtract {
    type: JoinType;
    left: TableRef;
    right: TableRef;
    /** Columns mentioned in the ON predicate, no operator info. For LATERAL
     *  joins where ON is implicit, empty. */
    on_cols: string[];
}
export interface AggregationExtract {
    /** Function name as written (uppercased). E.g. "MIN", "MAX", "COUNT_IF",
     *  "MIN_BY", "COUNT". */
    function: string;
    /** The raw expression text the function wraps. For `MIN_BY(A.UTM_MEDIUM,
     *  A.EVENT_TIME)` this is `A.UTM_MEDIUM, A.EVENT_TIME`. */
    expression: string;
    /** The output alias if one was given. */
    alias: string | null;
}
export interface WindowFunctionExtract {
    function: string;
    partition_by: string[];
    order_by: string[];
    frame: string | null;
}
export interface CteExtract {
    name: string;
    recursive: boolean;
    inputs: TableRef[];
    /** Output column aliases of the CTE's SELECT list. */
    outputs: string[];
}
export type SqlOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'CREATE_TABLE' | 'CREATE_VIEW' | 'ALTER' | 'DROP' | 'TRUNCATE' | 'CALL' | 'DECLARE' | 'SET' | 'BEGIN' | 'COMMIT' | 'ROLLBACK' | 'EXECUTE_IMMEDIATE' | 'OTHER';
export type StatementClass = 'DDL' | 'DML' | 'DCL' | 'TCL' | 'OTHER';
/** Walker output for a single SQL statement. The user's "data step" can
 *  contain N of these (one per `;`-terminated statement). */
export interface StatementExtract {
    /** Position in the script. 0-indexed. */
    idx: number;
    operation: SqlOperation;
    statement_class: StatementClass;
    /** For DDL/DML with a write target. NULL for pure SELECT. */
    target_table: TableRef | null;
    tables_read: TableRef[];
    tables_written: TableRef[];
    joins: JoinExtract[];
    aggregations: AggregationExtract[];
    group_by_columns: string[];
    window_functions: WindowFunctionExtract[];
    ctes: CteExtract[];
}
/** Walker warning for a SQL construct the walker didn't fully extract.
 *  Best-effort + flag pattern (§5 of the plan). */
export interface WalkerWarning {
    stmt_idx: number;
    /** Polyglot AST node kind that triggered the warning (e.g. "execute_immediate"). */
    node_kind: string;
    reason: string;
}
/**
 * The full extract for a data step. Top-level rollups summarize the whole
 * script for cheap graph queries; the `statements` array preserves
 * per-statement granularity for inspection.
 *
 * `internal_writes` vs `external_writes` classifies writes inside multi-statement
 * scripts: a TEMP table written by stmt 0 and read by stmt 2 is internal
 * (not visible to other data steps); anything else written is external.
 */
export interface ExtractJson {
    /** "multi-statement" when N > 1, else the single statement's operation. */
    operation_summary: 'multi-statement' | SqlOperation;
    tables_read: TableRef[];
    external_writes: TableRef[];
    internal_writes: TableRef[];
    /** Union of internal + external. Kept so JSONB queries that don't care
     *  about the internal/external distinction stay simple. */
    tables_written: TableRef[];
    /** Distinct `{{NAME}}` placeholder tokens that appear anywhere in the
     *  user_sql. Indexed via GIN so we can look up "which data steps reference
     *  variable X?" cheaply when a variable's value changes (§3 of the plan). */
    raw_table_refs: string[];
    statements: StatementExtract[];
    walker_warnings: WalkerWarning[];
    /** True iff the installed SDK version is outside the walker's verified
     *  range. Output still produced best-effort, but consumers should treat
     *  it as lower-confidence. */
    sdk_unverified?: boolean;
}
/** Shape of the columns we read/write on data_step_files alongside extract_json. */
export interface ExtractEnvelope {
    extract_json: ExtractJson;
    extract_sdk_version: string;
    walker_version: number;
    extract_warnings: WalkerWarning[];
}
