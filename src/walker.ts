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

import {
  ExtractJson,
  StatementExtract,
  TableRef,
  JoinExtract,
  JoinType,
  AggregationExtract,
  WindowFunctionExtract,
  CteExtract,
  WalkerWarning,
  SqlOperation,
  StatementClass,
  WALKER_VERSION,
} from './types.js';

/** Reverses the `__ph_NAME` substitution back to `{{NAME}}`. Applied to
 *  identifier strings before they leave the walker — extracts always
 *  surface the user's original mustache syntax. */
function unphIdent(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s.replace(/__ph_([A-Za-z_][A-Za-z0-9_]*)/g, '{{$1}}');
}

/** Collect distinct `{{NAME}}` placeholders from the raw SQL. Used for the
 *  variable-mutation-hook lookup index (§3 of the plan). */
export function collectRawPlaceholders(rawSql: string): string[] {
  const re = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawSql)) !== null) set.add(`{{${m[1]}}}`);
  return Array.from(set).sort();
}

/* ─────────────────────────── helpers ─────────────────────────── */

/** Build a TableRef from a polyglot `table` node's `{name, schema, catalog}`.
 *  Walker output has no envs yet — the resolver attaches those in a
 *  separate pass. */
function tableRefFromNamed(named: any): TableRef | null {
  if (!named || typeof named !== 'object') return null;
  const parts: string[] = [];
  const catalog = named.catalog?.name?.name ?? named.catalog?.name;
  const schema = named.schema?.name?.name ?? named.schema?.name;
  const name = named.name?.name?.name ?? named.name?.name ?? named.name;
  if (typeof catalog === 'string') parts.push(catalog);
  if (typeof schema === 'string') parts.push(schema);
  if (typeof name === 'string') parts.push(name);
  if (parts.length === 0) return null;
  const raw = parts.map(p => unphIdent(p)).join('.');
  return { raw, envs: {} };
}

/** Dedupe a TableRef array by `raw` (envs not yet populated at walker time). */
function dedupeRefs(refs: TableRef[]): TableRef[] {
  const seen = new Map<string, TableRef>();
  for (const r of refs) {
    if (!seen.has(r.raw)) seen.set(r.raw, r);
  }
  return Array.from(seen.values());
}

/** Walk an AST subtree and accumulate every TableRef encountered. Used as
 *  the catch-all for tables_read so we don't miss refs inside subqueries,
 *  set-ops, CTE bodies, etc. */
function collectTableRefs(node: any, into: TableRef[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectTableRefs(item, into);
    return;
  }
  // Polyglot table nodes — recognized by having `name.name` AND not being
  // a column ref (columns have `column` wrapper or sit under expressions).
  // We use a positive match on the wrapper structure: a `table` key whose
  // value has `name` + (schema or catalog or alias siblings) is a table ref.
  if (node.table && typeof node.table === 'object' && node.table.name) {
    const ref = tableRefFromNamed(node.table);
    if (ref) into.push(ref);
    // Continue walking — joins/laterals/subqueries can be siblings.
  }
  for (const k of Object.keys(node)) {
    // Skip column refs — they aren't table refs even though they have name.
    if (k === 'column') continue;
    collectTableRefs((node as any)[k], into);
  }
}

/** Polyglot statement root key → SqlOperation. Unknown keys become OTHER
 *  and a walker warning is emitted at the call site. */
function operationFromRootKey(rootKey: string): SqlOperation {
  const map: Record<string, SqlOperation> = {
    select: 'SELECT',
    insert: 'INSERT',
    update: 'UPDATE',
    delete: 'DELETE',
    merge: 'MERGE',
    create_table: 'CREATE_TABLE',
    create_view: 'CREATE_VIEW',
    alter_table: 'ALTER',
    alter: 'ALTER',
    drop_table: 'DROP',
    drop: 'DROP',
    truncate: 'TRUNCATE',
    truncate_table: 'TRUNCATE',
    call: 'CALL',
    declare: 'DECLARE',
    set_session_parameter: 'SET',
    set: 'SET',
    begin: 'BEGIN',
    commit: 'COMMIT',
    rollback: 'ROLLBACK',
    execute_immediate: 'EXECUTE_IMMEDIATE',
  };
  return map[rootKey] ?? 'OTHER';
}

/** Operation → SQL standard class. */
function classifyOperation(op: SqlOperation): StatementClass {
  switch (op) {
    case 'SELECT':
    case 'INSERT':
    case 'UPDATE':
    case 'DELETE':
    case 'MERGE':
      return 'DML';
    case 'CREATE_TABLE':
    case 'CREATE_VIEW':
    case 'ALTER':
    case 'DROP':
    case 'TRUNCATE':
      return 'DDL';
    case 'BEGIN':
    case 'COMMIT':
    case 'ROLLBACK':
      return 'TCL';
    default:
      return 'OTHER';
  }
}

/** Extract the target_table for write operations. Polyglot puts this in
 *  a different place for almost every operation — this hides those
 *  differences. Returns null for ops without a write target (SELECT, CALL, …).
 *
 *  FIXED 2026-11-11. Every DML write op read `inner.this`, which these nodes
 *  do not have: polyglot puts the target under `inner.table` for INSERT,
 *  UPDATE, DELETE and TRUNCATE, under `inner.name` for ALTER, and in an ARRAY
 *  at `inner.names` for DROP. The result was that target_table came back null
 *  and the table fell through to the catch-all collector, so an
 *  `INSERT INTO t SELECT …` recorded `t` as a table it READ and recorded no
 *  write at all. Only CREATE TABLE AS, CREATE VIEW and MERGE were correct.
 *
 *  Each case keeps the old lookup as a fallback rather than replacing it, so
 *  a future SDK that moves back to `this` still resolves.
 */
function extractTargetTable(rootKey: string, inner: any): TableRef | null {
  switch (rootKey) {
    case 'create_table':
    case 'create_view':
      return tableRefFromNamed({ name: inner.name?.name, schema: inner.name?.schema, catalog: inner.name?.catalog });
    case 'insert':
    case 'update':
    case 'delete':
    case 'truncate':
    case 'truncate_table':
      // Target is `inner.table`; `inner.this` is kept as a fallback only.
      return tableRefFromNamed(inner.table ?? inner.this?.table ?? inner.this);
    case 'merge': {
      // MERGE INTO <target> T USING <src> S ON … — target under `this`,
      // usually wrapped in an alias. This one was always right.
      const t = inner.this?.alias?.this?.table ?? inner.this?.table ?? inner.this;
      return tableRefFromNamed(t);
    }
    case 'alter_table':
    case 'alter':
      return tableRefFromNamed(inner.name ?? inner.table ?? inner.this?.table ?? inner.this);
    case 'drop_table':
    case 'drop': {
      // `names` is an array — DROP TABLE a, b is one statement. We report
      // the first, which is what a single target_table field can hold.
      const first = Array.isArray(inner.names) && inner.names.length
        ? inner.names[0]
        : (inner.name ?? inner.table ?? inner.this?.table ?? inner.this);
      return tableRefFromNamed(first);
    }
    default:
      return null;
  }
}

/* ─────────────────────────── joins ─────────────────────────── */

/** Polyglot join-kind hints map to our JoinType. Best-effort. */
function joinTypeFrom(joinNode: any): JoinType {
  // Polyglot may carry kind/side in various fields depending on version.
  const kind = (joinNode?.kind ?? joinNode?.side ?? joinNode?.method ?? '')
    .toString()
    .toUpperCase();
  if (kind.includes('LEFT')) return 'LEFT';
  if (kind.includes('RIGHT')) return 'RIGHT';
  if (kind.includes('FULL') || kind.includes('OUTER')) return 'FULL';
  if (kind.includes('CROSS')) return 'CROSS';
  if (kind.includes('LATERAL') || joinNode?.lateral) return 'LATERAL';
  return 'INNER';
}

/** Pull column names out of an arbitrarily nested predicate tree. Recursive
 *  walk for any `column.name.name`. Used to populate JoinExtract.on_cols. */
function collectOnCols(node: any, into: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectOnCols(item, into);
    return;
  }
  if (node.column?.name?.name) into.add(unphIdent(node.column.name.name) || '');
  for (const k of Object.keys(node)) collectOnCols((node as any)[k], into);
}

function extractJoinsFromSelect(selectNode: any): JoinExtract[] {
  const raw = selectNode?.joins;
  if (!Array.isArray(raw)) return [];
  const joins: JoinExtract[] = [];
  // The "left" of each join is the cumulative left-hand-side. For walker
  // purposes we approximate "left" as the FROM's first table — a richer
  // representation can land in Phase 2 when per-statement lineage matters.
  const leftRef = (() => {
    const fromExpr = selectNode?.from?.expressions?.[0];
    return tableRefFromNamed(fromExpr?.table ?? fromExpr?.alias?.this?.table);
  })();

  for (const j of raw) {
    const rightTbl = j?.this?.table ?? j?.this?.alias?.this?.table ?? j?.this;
    const right = tableRefFromNamed(rightTbl);
    if (!right) continue;
    const colSet = new Set<string>();
    collectOnCols(j?.on, colSet);
    joins.push({
      type: joinTypeFrom(j),
      left: leftRef ?? { raw: '', envs: {} },
      right,
      on_cols: Array.from(colSet),
    });
  }
  return joins;
}

/* ─────────────────────────── aggregations ─────────────────────────── */

const AGG_FN_KEYS = new Set([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'min_by',
  'max_by',
  'count_if',
  'array_agg',
  'string_agg',
  'listagg',
  'group_concat',
]);

function aliasOf(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  const a = node.alias?.alias?.name ?? node.alias?.name;
  return typeof a === 'string' ? unphIdent(a) : null;
}

/** Find every aggregation in an AST subtree. Looks for both the generic
 *  `{aggregate_function: {name, args}}` shape and per-function keys
 *  (count, sum, min, etc.). */
function collectAggregations(node: any, into: AggregationExtract[], parentAlias: string | null = null): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectAggregations(item, into, parentAlias);
    return;
  }
  const alias = aliasOf(node) ?? parentAlias;

  if (node.aggregate_function) {
    const af = node.aggregate_function;
    into.push({
      function: (af.name || '').toUpperCase(),
      expression: stringifyArgs(af.args),
      alias,
    });
  }
  for (const k of Object.keys(node)) {
    if (AGG_FN_KEYS.has(k) && node[k] && typeof node[k] === 'object') {
      const agg = node[k];
      const fn = (agg.original_name || k).toUpperCase();
      let expr: string;
      if (agg.star === true) {
        expr = '*';
      } else if (agg.this) {
        expr = stringifyArgs([agg.this]);
      } else if (agg.args) {
        expr = stringifyArgs(agg.args);
      } else {
        expr = '';
      }
      into.push({ function: fn, expression: expr, alias });
    }
    // Recurse into substructures. The `alias` wrapper passes its alias down
    // so a column-level aggregate inherits its enclosing AS name.
    collectAggregations((node as any)[k], into, alias);
  }
}

/** Best-effort stringification of a polyglot args list. We don't reconstruct
 *  full SQL — just enough for human readability and downstream queries. */
function stringifyArgs(args: any): string {
  if (!args) return '';
  if (Array.isArray(args)) {
    return args.map(stringifyOne).filter(Boolean).join(', ');
  }
  return stringifyOne(args);
}

function stringifyOne(node: any): string {
  if (!node || typeof node !== 'object') return '';
  if (node.column?.name?.name) {
    const t = node.column.table?.name;
    const n = unphIdent(node.column.name.name) ?? node.column.name.name;
    return t ? `${t}.${n}` : n;
  }
  if (node.literal !== undefined) return JSON.stringify(node.literal);
  // Catch-all: dump the first scalar inside
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === 'string') return v;
  }
  return '<expr>';
}

/* ─────────────────────────── group_by ─────────────────────────── */

function extractGroupByFromSelect(selectNode: any): string[] {
  const gb = selectNode?.group_by;
  if (!gb) return [];
  const arr = gb.expressions ?? gb.this ?? gb;
  if (!Array.isArray(arr)) return [];
  const cols = arr.map(stringifyOne).filter(Boolean);
  return cols;
}

/* ─────────────────────────── window functions ─────────────────────────── */

function collectWindowFunctions(node: any, into: WindowFunctionExtract[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectWindowFunctions(item, into);
    return;
  }
  if (node.window_function) {
    const wf = node.window_function;
    const fnNode = wf.this ?? {};
    const fnName = Object.keys(fnNode)[0]?.toUpperCase() ?? 'UNKNOWN';
    const over = wf.over ?? {};
    const partition = (over.partition_by ?? []).map(stringifyOne).filter(Boolean);
    const order = (over.order_by ?? []).map((o: any) => stringifyOne(o.this ?? o)).filter(Boolean);
    into.push({
      function: fnName,
      partition_by: partition,
      order_by: order,
      frame: over.frame_clause ? '<frame>' : null,
    });
  }
  for (const k of Object.keys(node)) collectWindowFunctions((node as any)[k], into);
}

/* ─────────────────────────── CTEs ─────────────────────────── */

function extractCtesFromSelect(selectNode: any): CteExtract[] {
  const ctes = selectNode?.with?.ctes;
  if (!Array.isArray(ctes)) return [];
  return ctes.map((c: any) => {
    const name = unphIdent(c.alias?.name ?? c.alias?.this?.name) ?? '';
    const recursive = !!(c.recursive ?? selectNode?.with?.recursive);
    const innerRefs: TableRef[] = [];
    collectTableRefs(c.this, innerRefs);
    const exprs = c.this?.select?.expressions ?? [];
    const outputs = exprs
      .map((e: any) => aliasOf(e) ?? e.column?.name?.name ?? null)
      .filter((s: any) => typeof s === 'string')
      .map((s: any) => unphIdent(s) ?? s);
    return { name, recursive, inputs: dedupeRefs(innerRefs), outputs };
  });
}

/* ─────────────────────────── statement walker ─────────────────────────── */

/** Walk a single statement AST → StatementExtract. The recursive helpers
 *  above do most of the work; this function is the dispatcher. */
function walkStatement(stmt: any, idx: number, warnings: WalkerWarning[]): StatementExtract {
  const rootKey = Object.keys(stmt)[0];
  const inner = stmt[rootKey];
  const operation = operationFromRootKey(rootKey);
  if (operation === 'OTHER') {
    warnings.push({
      stmt_idx: idx,
      node_kind: rootKey,
      reason: `Unrecognized statement root key; structural fields will be empty`,
    });
  }

  const target_table = extractTargetTable(rootKey, inner);

  // Read-side: walk the statement minus the target into all_refs, then dedupe.
  // For SELECT, scan select.from + select.joins + select.with.ctes inputs.
  // For CTAS, scan as_select. For MERGE, scan using + on. Generic catch-all
  // is collectTableRefs which deep-walks anything we haven't enumerated.
  const allRefs: TableRef[] = [];
  collectTableRefs(inner, allRefs);
  const readRefs = dedupeRefs(
    allRefs.filter(r => !target_table || r.raw !== target_table.raw)
  );

  // Determine which sub-tree to pull joins/aggs/group_by/windows/ctes from.
  // CTAS wraps a select under as_select; MERGE's read source is `using`;
  // INSERT...SELECT has the select under inner.select or inner.this.select.
  const selectLike: any =
    rootKey === 'select'
      ? inner
      : rootKey === 'create_table'
        ? inner.as_select?.select ?? inner.as_select
        : rootKey === 'insert'
          ? inner.select ?? inner.this?.select ?? inner
          : rootKey === 'merge'
            ? inner.using?.alias?.this?.subquery ?? inner.using
            : inner.select ?? inner;

  const joins = extractJoinsFromSelect(selectLike);
  const aggregations: AggregationExtract[] = [];
  collectAggregations(selectLike, aggregations);
  const group_by_columns = extractGroupByFromSelect(selectLike);
  const window_functions: WindowFunctionExtract[] = [];
  collectWindowFunctions(selectLike, window_functions);
  const ctes = extractCtesFromSelect(selectLike);

  // Flag known-not-supported procedural constructs
  if (rootKey === 'execute_immediate') {
    warnings.push({
      stmt_idx: idx,
      node_kind: 'execute_immediate',
      reason: 'Dynamic SQL — contents not statically analyzable',
    });
  }
  if (rootKey === 'declare' || rootKey === 'set') {
    warnings.push({
      stmt_idx: idx,
      node_kind: rootKey,
      reason: 'Procedural statement — not modeled in MVP walker',
    });
  }
  if (selectLike?.with?.recursive) {
    warnings.push({
      stmt_idx: idx,
      node_kind: 'recursive_cte',
      reason: 'Recursive CTE — extracted shallowly in MVP walker',
    });
  }

  return {
    idx,
    operation,
    statement_class: classifyOperation(operation),
    target_table,
    tables_read: readRefs,
    tables_written: target_table ? [target_table] : [],
    joins,
    aggregations,
    group_by_columns,
    window_functions,
    ctes,
  };
}

/* ─────────────────────────── rollup ─────────────────────────── */

/**
 * Roll the per-statement extracts into the top-level fields.
 *   - tables_read: union, deduped
 *   - tables_written: union of statement.tables_written
 *   - internal_writes: tables written by an earlier statement that are read
 *     by a later statement within the same script
 *   - external_writes: tables_written - internal_writes
 *
 * "Internal" classification: a table is internal iff it was written by
 * one of this script's statements AND read by another. Anything else
 * written is external.
 */
function rollUp(statements: StatementExtract[]): {
  tables_read: TableRef[];
  external_writes: TableRef[];
  internal_writes: TableRef[];
  tables_written: TableRef[];
  operation_summary: ExtractJson['operation_summary'];
} {
  const allReads: TableRef[] = [];
  const allWrites: TableRef[] = [];
  for (const s of statements) {
    allReads.push(...s.tables_read);
    allWrites.push(...s.tables_written);
  }
  const dedupedReads = dedupeRefs(allReads);
  const dedupedWrites = dedupeRefs(allWrites);

  const readsSet = new Set(dedupedReads.map(r => r.raw));
  const internal_writes = dedupedWrites.filter(w => readsSet.has(w.raw));
  const internalSet = new Set(internal_writes.map(w => w.raw));
  const external_writes = dedupedWrites.filter(w => !internalSet.has(w.raw));

  // tables_read at the rollup excludes anything that's an internal write.
  // Those tables aren't real upstream dependencies — they're produced
  // inside this same step.
  const tables_read = dedupedReads.filter(r => !internalSet.has(r.raw));

  const operation_summary: ExtractJson['operation_summary'] =
    statements.length === 1 ? statements[0].operation : 'multi-statement';

  return {
    tables_read,
    external_writes,
    internal_writes,
    tables_written: dedupedWrites,
    operation_summary,
  };
}

/* ─────────────────────────── public API ─────────────────────────── */

/** Walk an array of polyglot statement ASTs → ExtractJson (envs unresolved).
 *  Pure function over the parser output. Pair with the resolver to attach
 *  per-env table names. */
export function walkAstArray(
  asts: any[],
  rawSql: string
): { extract: ExtractJson; walker_version: number } {
  const warnings: WalkerWarning[] = [];
  const statements = asts.map((s, idx) => walkStatement(s, idx, warnings));
  const rolled = rollUp(statements);
  const extract: ExtractJson = {
    operation_summary: rolled.operation_summary,
    tables_read: rolled.tables_read,
    external_writes: rolled.external_writes,
    internal_writes: rolled.internal_writes,
    tables_written: rolled.tables_written,
    raw_table_refs: collectRawPlaceholders(rawSql),
    statements,
    walker_warnings: warnings,
  };
  return { extract, walker_version: WALKER_VERSION };
}
