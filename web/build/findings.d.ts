/**
 * Findings — the reason this is a tool and not a diagram.
 *
 * A dependency graph is interesting for about ten seconds. What makes
 * someone act is being told something specific about their own files that
 * they did not know, in a sentence that names the consequence rather than
 * the construct. Every rule here states what will go wrong, not what is
 * structurally present.
 *
 * Findings are RANKED and the most severe owns the single call to action.
 * One button, not four — four reads as an advertisement.
 */
import { GraphModel } from './graph.js';
import { FileExtract } from './extract.js';
export type FindingKind = 'write-conflict' | 'cycle' | 'parse-failure' | 'unresolved-placeholder' | 'external-dependency' | 'internal-safe' | 'clean';
export type Severity = 'warn' | 'info' | 'ok';
export interface Finding {
    kind: FindingKind;
    severity: Severity;
    /** Sort key. Higher wins the call to action. */
    rank: number;
    /** One line, with `code` spans marked by backticks. */
    title: string;
    /** Two or three sentences naming the consequence. */
    body: string;
    /** Tables or files this finding points at, for highlighting in the graph. */
    refs: string[];
}
export interface CallToAction {
    label: string;
    href: string;
    /** Why this CTA and not another — shown to nobody, kept for the record. */
    because: FindingKind;
}
export declare function analyse(model: GraphModel, files: FileExtract[]): Finding[];
/** The single call to action, chosen by the most severe finding. */
export declare function chooseCta(findings: Finding[]): CallToAction;
