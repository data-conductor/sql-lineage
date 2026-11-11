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
import { findCycles } from './graph.js';
/**
 * CTA mapping. Each finding leads somewhere the product genuinely answers
 * that exact gap. A button that does not answer the thing just fired is
 * worse than no button, because it proves the preceding paragraph was bait.
 */
const CTA_BY_KIND = {
    'write-conflict': {
        label: 'See how Data Conductor handles run order →',
        href: 'https://data-conductor.com/docs/pipelines/',
        because: 'write-conflict',
    },
    cycle: {
        label: 'See how Data Conductor handles run order →',
        href: 'https://data-conductor.com/docs/pipelines/',
        because: 'cycle',
    },
    'unresolved-placeholder': {
        label: 'See how Data Conductor resolves variables per environment →',
        href: 'https://data-conductor.com/docs/data-builder/#pipeline-variables',
        because: 'unresolved-placeholder',
    },
    'external-dependency': {
        label: 'See how Data Conductor tests a pipeline before it runs →',
        href: 'https://data-conductor.com/docs/testing-data-pipelines/',
        because: 'external-dependency',
    },
    'parse-failure': {
        label: 'See how Data Conductor handles run order →',
        href: 'https://data-conductor.com/docs/pipelines/',
        because: 'parse-failure',
    },
    'internal-safe': {
        label: 'See how Data Conductor keeps it this way →',
        href: 'https://data-conductor.com/docs/deployment-manager/',
        because: 'internal-safe',
    },
    clean: {
        label: 'See how Data Conductor keeps it this way →',
        href: 'https://data-conductor.com/docs/deployment-manager/',
        because: 'clean',
    },
};
function uniqueStrings(xs) {
    return Array.from(new Set(xs));
}
function list(xs) {
    if (xs.length === 1)
        return `\`${xs[0]}\``;
    if (xs.length === 2)
        return `\`${xs[0]}\` and \`${xs[1]}\``;
    return xs.slice(0, -1).map(x => `\`${x}\``).join(', ') + ` and \`${xs[xs.length - 1]}\``;
}
export function analyse(model, files) {
    const found = [];
    // ── 1. Two or more files write the same table ────────────────────────────
    // The headline finding, and the one that cannot be seen from inside any
    // single file. Ranked top because it is silent: both scripts succeed.
    for (const n of model.nodes) {
        if (n.writers.length < 2)
            continue;
        found.push({
            kind: 'write-conflict',
            severity: 'warn',
            rank: 100,
            title: `${n.writers.length} files write to \`${n.label}\``,
            body: `${list(n.writers)} all write this table. Nothing in these files declares which runs ` +
                `first, so whichever your scheduler happens to run last is the one that wins. Both ` +
                `scripts succeed either way, which is why this kind of thing survives for months.`,
            refs: [n.id, ...n.writers],
        });
    }
    // ── 2. Dependency cycle ──────────────────────────────────────────────────
    const cycles = findCycles(model);
    const seenCycle = new Set();
    for (const c of cycles) {
        const key = [...c].sort().join('>');
        if (seenCycle.has(key))
            continue;
        seenCycle.add(key);
        found.push({
            kind: 'cycle',
            severity: 'warn',
            rank: 90,
            title: `Circular dependency: ${c.map(x => `\`${x}\``).join(' → ')}`,
            body: `These tables depend on each other in a loop, so there is no order in which all of ` +
                `them are built from fresh inputs. One of them is always reading yesterday's data, ` +
                `and which one depends on where the cycle happens to be entered.`,
            refs: c,
        });
    }
    // ── 3. Files that did not parse ──────────────────────────────────────────
    // Reported honestly and prominently. A graph drawn from four of six files
    // that does not say so is a graph that lies.
    const failed = files.filter(f => f.parse_error);
    if (failed.length) {
        found.push({
            kind: 'parse-failure',
            severity: 'warn',
            rank: 85,
            title: `${failed.length} file${failed.length > 1 ? 's' : ''} could not be parsed`,
            body: `${list(failed.map(f => f.name))} did not parse in this dialect, so nothing from ` +
                `${failed.length > 1 ? 'them' : 'it'} is in the graph above. Try another dialect — ` +
                `and if it still fails, the graph below is incomplete rather than clean.`,
            refs: failed.map(f => f.name),
        });
    }
    // ── 4. Placeholders with no value in scope ───────────────────────────────
    const phFiles = new Map();
    for (const f of files) {
        for (const ph of f.extract.raw_table_refs) {
            if (!phFiles.has(ph))
                phFiles.set(ph, []);
            phFiles.get(ph).push(f.name);
        }
    }
    for (const [ph, names] of Array.from(phFiles.entries()).sort()) {
        found.push({
            kind: 'unresolved-placeholder',
            severity: 'warn',
            rank: names.length > 1 ? 70 : 65,
            title: `\`${ph}\` appears in ${names.length} file${names.length > 1 ? 's' : ''} with no value in scope`,
            body: `Found in ${list(names)}. Each one is substituted by something at runtime — but not by ` +
                `anything in this folder, and not necessarily by the same thing. ` +
                `${names.length > 1 ? 'Nothing here guarantees these files agree on its value.' : ''}`.trim(),
            refs: names,
        });
    }
    // ── 5. Read but never written here ───────────────────────────────────────
    // Aggregated into ONE finding on purpose. Every raw input satisfies this
    // condition, so emitting one per table turns the most useful part of the
    // page into a list of things the reader already knows. The finding is the
    // BOUNDARY of what these files control, stated once.
    const sources = model.nodes.filter(n => n.kind === 'source');
    if (sources.length) {
        const names = sources.map(n => n.label).sort();
        const readers = uniqueStrings(sources.flatMap(n => n.readers));
        found.push({
            kind: 'external-dependency',
            severity: 'info',
            rank: 60,
            title: names.length === 1
                ? `\`${names[0]}\` is read but never written here`
                : `${names.length} tables are read but never written here`,
            body: `${list(names)} ${names.length === 1 ? 'is' : 'are'} populated by something outside ` +
                `this folder, and read by ${list(readers)}. If one of those upstream jobs fails, these ` +
                `scripts still run clean against stale data and report a number nobody will question.`,
            refs: [...sources.map(n => n.id), ...readers],
        });
    }
    // ── 6. Internal and safe — the one positive finding ──────────────────────
    // Worth stating because it is the only thing here that tells someone a
    // change is SAFE, and a tool that only ever warns gets ignored.
    for (const n of model.nodes.filter(x => x.kind === 'internal')) {
        found.push({
            kind: 'internal-safe',
            severity: 'ok',
            rank: 10,
            title: `\`${n.label}\` is internal and safe`,
            body: `Written and read only inside \`${n.internalTo}\`. Nothing else in this folder can see ` +
                `it, so it can be renamed or restructured without touching anything above.`,
            refs: [n.id],
        });
    }
    found.sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title));
    if (!found.length) {
        found.push({
            kind: 'clean',
            severity: 'ok',
            rank: 0,
            title: 'Nothing to flag — every table has one writer and a clear path',
            body: `No write conflicts, no cycles, no unresolved variables and no external reads across ` +
                `${model.stats.files} files. That is an unusually clean set, and the interesting ` +
                `question becomes how it stays that way as files get added.`,
            refs: [],
        });
    }
    return found;
}
/** The single call to action, chosen by the most severe finding. */
export function chooseCta(findings) {
    const top = findings[0];
    return CTA_BY_KIND[top ? top.kind : 'clean'];
}
