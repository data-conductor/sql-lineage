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
export function normalizeTable(raw) {
    return String(raw || '')
        .trim()
        .replace(/\s+/g, ' ')
        .split('.')
        .map(p => p.replace(/^["'`\[]+|["'`\]]+$/g, '').toLowerCase())
        .join('.');
}
const PLACEHOLDER_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
function placeholdersIn(s) {
    const out = new Set();
    let m;
    const re = new RegExp(PLACEHOLDER_RE.source, 'g');
    while ((m = re.exec(s)) !== null)
        out.add(`{{${m[1]}}}`);
    return Array.from(out);
}
function uniq(xs) {
    return Array.from(new Set(xs));
}
export function buildGraph(files) {
    const nodes = new Map();
    const edges = [];
    let statements = 0;
    let parseFailures = 0;
    const touch = (ref) => {
        const raw = typeof ref === 'string' ? ref : ref.raw;
        const id = normalizeTable(raw);
        let n = nodes.get(id);
        if (!n) {
            n = {
                id,
                label: String(raw).trim(),
                kind: 'isolated',
                writers: [],
                readers: [],
                internalTo: null,
                placeholders: placeholdersIn(String(raw)),
                level: 0,
                x: 0,
                y: 0,
            };
            nodes.set(id, n);
        }
        return n;
    };
    for (const f of files) {
        if (f.parse_error)
            parseFailures++;
        const ex = f.extract;
        statements += ex.statements.length;
        const internal = new Set(ex.internal_writes.map(t => normalizeTable(t.raw)));
        // Edges are derived PER STATEMENT, not from the file's rolled-up reads
        // and writes. A file-level cross-product is wrong in both directions on
        // any multi-statement script: in 04_mrr.sql it invented an edge from
        // raw.subscriptions to tmp_invoice_stage (different statements) and lost
        // the real one from tmp_invoice_stage to analytics.mrr_daily (because a
        // table internal to the file is excluded from the file-level read
        // rollup, by design). Statement scope is the truth the walker records.
        for (const st of ex.statements) {
            for (const t of st.tables_read) {
                const n = touch(t);
                if (!n.readers.includes(f.name))
                    n.readers.push(f.name);
            }
            for (const t of st.tables_written) {
                const n = touch(t);
                if (!n.writers.includes(f.name))
                    n.writers.push(f.name);
                if (internal.has(normalizeTable(t.raw)) && n.internalTo === null) {
                    n.internalTo = f.name;
                }
            }
            const reads = uniq(st.tables_read.map(t => normalizeTable(t.raw)));
            const writes = uniq(st.tables_written.map(t => normalizeTable(t.raw)));
            for (const r of reads) {
                for (const w of writes) {
                    // A statement that reads and writes the same table (INSERT INTO t
                    // SELECT FROM t, or an UPDATE with a self-referencing subquery) is
                    // not a dependency, it is an in-place edit. Dropping it keeps the
                    // graph acyclic for the common case.
                    if (r === w)
                        continue;
                    edges.push({ from: r, to: w, file: f.name, contested: false });
                }
            }
        }
        // A file whose statements array is empty (parse failure) still has
        // rolled-up refs worth showing as nodes, so the graph reflects that the
        // file exists rather than silently dropping it.
        if (!ex.statements.length) {
            for (const t of ex.tables_read) {
                const n = touch(t);
                if (!n.readers.includes(f.name))
                    n.readers.push(f.name);
            }
            for (const t of ex.tables_written) {
                const n = touch(t);
                if (!n.writers.includes(f.name))
                    n.writers.push(f.name);
            }
        }
    }
    // Classify. A table internal to one file stops being internal the moment
    // another file touches it — that is the whole point of checking across
    // files rather than within one.
    for (const n of nodes.values()) {
        const others = uniq([...n.writers, ...n.readers]);
        if (n.internalTo && others.length > 1)
            n.internalTo = null;
        if (n.internalTo)
            n.kind = 'internal';
        else if (n.writers.length === 0 && n.readers.length > 0)
            n.kind = 'source';
        else if (n.writers.length > 0 && n.readers.length === 0)
            n.kind = 'output';
        else if (n.writers.length > 0 && n.readers.length > 0)
            n.kind = 'derived';
        else
            n.kind = 'isolated';
    }
    for (const e of edges) {
        const target = nodes.get(e.to);
        if (target && target.writers.length > 1)
            e.contested = true;
    }
    const model = {
        nodes: Array.from(nodes.values()),
        edges: dedupeEdges(edges),
        files: files.map(f => f.name),
        stats: {
            files: files.length,
            statements,
            tables: nodes.size,
            parseFailures,
        },
    };
    assignLevels(model);
    return model;
}
function dedupeEdges(edges) {
    const seen = new Set();
    const out = [];
    for (const e of edges) {
        const k = `${e.from}\u0000${e.to}\u0000${e.file}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push(e);
    }
    return out;
}
/**
 * Longest-path layering, cycle-safe.
 *
 * A dependency cycle across files is rare but entirely possible (A writes X
 * reading Y, B writes Y reading X) and it must not hang the page, so the
 * relaxation is capped at node-count passes. Anything still unsettled keeps
 * the level it reached, which draws a slightly wrong graph rather than no
 * graph at all.
 */
function assignLevels(model) {
    const byId = new Map(model.nodes.map(n => [n.id, n]));
    for (const n of model.nodes)
        n.level = 0;
    const outgoing = new Map();
    for (const e of model.edges) {
        if (!outgoing.has(e.from))
            outgoing.set(e.from, []);
        outgoing.get(e.from).push(e);
    }
    const maxPasses = Math.max(1, model.nodes.length);
    for (let pass = 0; pass < maxPasses; pass++) {
        let moved = false;
        for (const e of model.edges) {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b)
                continue;
            if (b.level < a.level + 1) {
                b.level = a.level + 1;
                moved = true;
            }
        }
        if (!moved)
            break;
    }
}
/** Does the graph contain a cycle? Reported as a finding rather than fixed. */
export function findCycles(model) {
    const adj = new Map();
    for (const e of model.edges) {
        if (!adj.has(e.from))
            adj.set(e.from, []);
        adj.get(e.from).push(e.to);
    }
    const WHITE = 0, GREY = 1, BLACK = 2;
    const colour = new Map();
    for (const n of model.nodes)
        colour.set(n.id, WHITE);
    const cycles = [];
    const stack = [];
    const visit = (id) => {
        colour.set(id, GREY);
        stack.push(id);
        for (const next of adj.get(id) || []) {
            const c = colour.get(next);
            if (c === GREY) {
                const i = stack.indexOf(next);
                if (i >= 0)
                    cycles.push(stack.slice(i).concat(next));
            }
            else if (c === WHITE) {
                visit(next);
            }
        }
        stack.pop();
        colour.set(id, BLACK);
    };
    for (const n of model.nodes)
        if (colour.get(n.id) === WHITE)
            visit(n.id);
    return cycles;
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
export function layout(model, opts = {}) {
    const nodeWidth = opts.nodeWidth ?? 196;
    const nodeHeight = opts.nodeHeight ?? 46;
    const columnGap = opts.columnGap ?? 116;
    const rowGap = opts.rowGap ?? 26;
    const padding = opts.padding ?? 28;
    const levels = new Map();
    for (const n of model.nodes) {
        if (!levels.has(n.level))
            levels.set(n.level, []);
        levels.get(n.level).push(n);
    }
    const levelKeys = Array.from(levels.keys()).sort((a, b) => a - b);
    // Stable starting order so the same files always draw the same picture.
    for (const k of levelKeys) {
        levels.get(k).sort((a, b) => a.label.localeCompare(b.label));
    }
    const indexIn = (arr, id) => arr.findIndex(n => n.id === id);
    const incoming = new Map();
    const outgoing = new Map();
    for (const e of model.edges) {
        if (!incoming.has(e.to))
            incoming.set(e.to, []);
        incoming.get(e.to).push(e.from);
        if (!outgoing.has(e.from))
            outgoing.set(e.from, []);
        outgoing.get(e.from).push(e.to);
    }
    for (let pass = 0; pass < 2; pass++) {
        // Forward: order each column by the mean position of its inputs.
        for (let i = 1; i < levelKeys.length; i++) {
            const prev = levels.get(levelKeys[i - 1]);
            const cur = levels.get(levelKeys[i]);
            const score = new Map();
            cur.forEach((n, idx) => {
                const ins = (incoming.get(n.id) || []).map(id => indexIn(prev, id)).filter(x => x >= 0);
                score.set(n.id, ins.length ? ins.reduce((a, b) => a + b, 0) / ins.length : idx);
            });
            cur.sort((a, b) => (score.get(a.id) - score.get(b.id)) || a.label.localeCompare(b.label));
        }
        // Backward: same, using outputs.
        for (let i = levelKeys.length - 2; i >= 0; i--) {
            const next = levels.get(levelKeys[i + 1]);
            const cur = levels.get(levelKeys[i]);
            const score = new Map();
            cur.forEach((n, idx) => {
                const outs = (outgoing.get(n.id) || []).map(id => indexIn(next, id)).filter(x => x >= 0);
                score.set(n.id, outs.length ? outs.reduce((a, b) => a + b, 0) / outs.length : idx);
            });
            cur.sort((a, b) => (score.get(a.id) - score.get(b.id)) || a.label.localeCompare(b.label));
        }
    }
    const tallest = Math.max(...levelKeys.map(k => levels.get(k).length), 1);
    const contentHeight = tallest * nodeHeight + (tallest - 1) * rowGap;
    levelKeys.forEach((k, col) => {
        const column = levels.get(k);
        const h = column.length * nodeHeight + (column.length - 1) * rowGap;
        // Centre short columns against the tallest one.
        const top = padding + (contentHeight - h) / 2;
        column.forEach((n, row) => {
            n.x = padding + col * (nodeWidth + columnGap);
            n.y = top + row * (nodeHeight + rowGap);
        });
    });
    return {
        width: padding * 2 + levelKeys.length * nodeWidth + (levelKeys.length - 1) * columnGap,
        height: padding * 2 + contentHeight,
        columns: levelKeys.length,
    };
}
