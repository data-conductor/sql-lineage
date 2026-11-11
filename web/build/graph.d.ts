/**
 * Cross-file graph model.
 *
 * The walker answers "what does THIS script touch". Everything interesting
 * about a folder of SQL is a question about the relationships BETWEEN
 * scripts — which is why this tool takes a file set and not a paste box.
 * A single file cannot show you that two scripts write the same table.
 *
 * Node identity is the table, not the file. Files appear on the edges,
 * because a file is how one table becomes another.
 */
import { FileExtract } from './extract.js';
export type NodeKind = 'source' | 'derived' | 'output' | 'internal' | 'isolated';
export interface GraphNode {
    /** Normalised key used for identity and lookup. */
    id: string;
    /** What the user actually wrote, preserving case and `{{placeholders}}`. */
    label: string;
    kind: NodeKind;
    /** Files that write this table. More than one is a finding. */
    writers: string[];
    /** Files that read this table. */
    readers: string[];
    /** True when the table is written and read only inside one file. */
    internalTo: string | null;
    /** Placeholder tokens appearing in this table's name. */
    placeholders: string[];
    /** Longest-path depth from a source. Drives the layout columns. */
    level: number;
    x: number;
    y: number;
}
export interface GraphEdge {
    from: string;
    to: string;
    /** The file whose SQL creates this dependency. */
    file: string;
    /** True when the target has more than one writer — the conflict edge. */
    contested: boolean;
}
export interface GraphModel {
    nodes: GraphNode[];
    edges: GraphEdge[];
    files: string[];
    stats: {
        files: number;
        statements: number;
        tables: number;
        parseFailures: number;
    };
}
/**
 * Normalise a table reference for identity.
 *
 * Deliberately conservative: lowercase, strip surrounding quote characters
 * from each dotted part, collapse whitespace. It does NOT try to resolve
 * schemas — `users` and `public.users` stay distinct, because guessing that
 * they are the same would silently merge two nodes and could turn a real
 * conflict into a clean graph. Over-reporting is recoverable; a finding we
 * hid is not.
 */
export declare function normalizeTable(raw: string): string;
export declare function buildGraph(files: FileExtract[]): GraphModel;
/** Does the graph contain a cycle? Reported as a finding rather than fixed. */
export declare function findCycles(model: GraphModel): string[][];
export interface LayoutOptions {
    nodeWidth?: number;
    nodeHeight?: number;
    columnGap?: number;
    rowGap?: number;
    padding?: number;
}
export interface LayoutResult {
    width: number;
    height: number;
    columns: number;
}
/**
 * Layered layout: one column per dependency level, barycentre ordering
 * within each column to keep edge crossings down.
 *
 * Not a general graph-drawing algorithm and not trying to be. Dependency
 * graphs read left-to-right as "what comes from what", and the levels the
 * walker gives us are already the right columns — the only real work is
 * choosing a vertical order that does not look like a plate of spaghetti.
 * Two barycentre passes gets most of the benefit; more passes stop helping
 * on graphs this size.
 */
export declare function layout(model: GraphModel, opts?: LayoutOptions): LayoutResult;
