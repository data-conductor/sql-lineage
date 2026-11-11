/**
 * sql-lineage — read a set of .sql files and work out what depends on what.
 *
 * No database connection, no dbt project, no server. The parser is
 * @polyglot-sql/sdk compiled to WASM; everything above it is deterministic
 * AST walking, which is why the same files always produce the same graph.
 *
 * The walker here is the same file that runs inside Data Conductor, which
 * is the point of publishing it rather than a reimplementation of it.
 */
export * from './types.js';
export * from './extract.js';
export * from './graph.js';
export * from './findings.js';
export { walkAstArray, collectRawPlaceholders } from './walker.js';
export { inferKindFromExtract, kindMismatchWarnings, lintIdempotence, } from './kind-analyzer.js';
export type { ExecutionKind, InferredKind } from './kind-analyzer.js';
import { SqlFileInput, init } from './extract.js';
import { GraphModel } from './graph.js';
import { Finding, CallToAction } from './findings.js';
import type { FileExtract } from './extract.js';
export interface AnalysisResult {
    files: FileExtract[];
    graph: GraphModel;
    findings: Finding[];
    cta: CallToAction;
}
/**
 * The one call the tool makes: files in, graph and findings out.
 *
 * Never throws on bad SQL — a file that will not parse is reported as a
 * finding and excluded from the graph, so a single malformed file cannot
 * take the whole answer down with it.
 */
export declare function analyseFiles(files: SqlFileInput[], dialect?: string): Promise<AnalysisResult>;
export { init };
