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

import { GraphModel, GraphNode, findCycles } from './graph.js';
import { FileExtract } from './extract.js';

export type FindingKind =
  | 'write-conflict'
  | 'cycle'
  | 'parse-failure'
  | 'unresolved-placeholder'
  | 'external-dependency'
  | 'internal-safe'
  | 'clean';

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

export interface CtaLink {
  label: string;
  href: string;
}

/** Which of the four gaps in the bridge block this finding lands on. */
export type GapKey = 'run-order' | 'variables' | 'history' | 'tests';

export interface CallToAction {
  /** What the product does about THIS finding, in one line. */
  headline: string;
  /** Two sentences naming the mechanism, not the benefit. */
  body: string;
  /** The product action. */
  primary: CtaLink;
  /** The documentation page answering the same gap. */
  secondary: CtaLink;
  gap: GapKey;
  /** Why this CTA and not another — shown to nobody, kept for the record. */
  because: FindingKind;
}

/**
 * CTA mapping. Each finding leads somewhere the product genuinely answers
 * that exact gap. A button that does not answer the thing just fired is
 * worse than no button, because it proves the preceding paragraph was bait.
 *
 * Two tiers on purpose. The PRIMARY is the product, because a link to a
 * documentation page is not an offer — it is a reading assignment, and the
 * person looking at a write conflict in their own files is past wanting one.
 * The SECONDARY is that documentation page, kept because the claim above the
 * buttons has to be checkable by someone who does not want to sign up.
 */
const PLATFORM = 'https://platform.data-conductor.com/auth/signup';

const RUN_ORDER: CallToAction = {
  headline: 'In Data Conductor these files are steps, and the order is declared.',
  body:
    'You choose the order once, in the pipeline, and it is the same order in QA and in PROD — ' +
    'not something reconstructed from cron lines later. The graph stops being a picture of ' +
    'what you have and becomes the thing you edit.',
  primary: { label: 'Build this as a pipeline — 14 days free →', href: PLATFORM },
  secondary: { label: 'How run order works', href: 'https://data-conductor.com/docs/pipelines/' },
  gap: 'run-order',
  because: 'write-conflict',
};

const CTA_BY_KIND: Record<FindingKind, CallToAction> = {
  'write-conflict': RUN_ORDER,
  cycle: { ...RUN_ORDER, because: 'cycle' },
  'parse-failure': { ...RUN_ORDER, because: 'parse-failure' },
  'unresolved-placeholder': {
    headline: 'In Data Conductor every {{variable}} has a row per environment.',
    body:
      'QA and PROD are both required, and a save will not complete while a placeholder has no ' +
      'value in either. Substitution happens server-side at run time, so what an environment ' +
      'shows is what actually ran.',
    primary: { label: 'Give these variables a value — 14 days free →', href: PLATFORM },
    secondary: {
      label: 'How variables resolve per environment',
      href: 'https://data-conductor.com/docs/data-builder/#pipeline-variables',
    },
    gap: 'variables',
    because: 'unresolved-placeholder',
  },
  'external-dependency': {
    headline: 'In Data Conductor a step can refuse to run on input that is already wrong.',
    body:
      'Tests are injected and run in QA and in PROD before a pipeline is promoted. An upstream ' +
      'job that failed quietly then shows up as a failed assertion, rather than as a number ' +
      'nobody thought to question.',
    primary: { label: 'Put a test in front of these reads — 14 days free →', href: PLATFORM },
    secondary: {
      label: 'How pipeline testing works',
      href: 'https://data-conductor.com/docs/testing-data-pipelines/',
    },
    gap: 'tests',
    because: 'external-dependency',
  },
  'internal-safe': {
    headline: 'In Data Conductor this stays true as the folder grows.',
    body:
      'Deployments are versioned and diffed, so the day a second file starts writing one of ' +
      'these tables it appears in the diff rather than in a number that moved. That is the ' +
      'point at which a set of scripts normally stops being manageable.',
    primary: { label: 'Keep it this way — 14 days free →', href: PLATFORM },
    secondary: {
      label: 'How deployments are versioned',
      href: 'https://data-conductor.com/docs/deployment-manager/',
    },
    gap: 'history',
    because: 'internal-safe',
  },
  clean: {
    headline: 'In Data Conductor this stays true as the folder grows.',
    body:
      'A clean set is clean until the fourth or fifth file arrives. Deployments are versioned ' +
      'and diffed, so the day a second writer appears you see it in the diff rather than in a ' +
      'number that moved.',
    primary: { label: 'Start a pipeline — 14 days free →', href: PLATFORM },
    secondary: {
      label: 'How deployments are versioned',
      href: 'https://data-conductor.com/docs/deployment-manager/',
    },
    gap: 'history',
    because: 'clean',
  },
};

function uniqueStrings(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function list(xs: string[]): string {
  if (xs.length === 1) return `\`${xs[0]}\``;
  if (xs.length === 2) return `\`${xs[0]}\` and \`${xs[1]}\``;
  return xs.slice(0, -1).map(x => `\`${x}\``).join(', ') + ` and \`${xs[xs.length - 1]}\``;
}

export function analyse(model: GraphModel, files: FileExtract[]): Finding[] {
  const found: Finding[] = [];

  // ── 1. Two or more files write the same table ────────────────────────────
  // The headline finding, and the one that cannot be seen from inside any
  // single file. Ranked top because it is silent: both scripts succeed.
  for (const n of model.nodes) {
    if (n.writers.length < 2) continue;
    found.push({
      kind: 'write-conflict',
      severity: 'warn',
      rank: 100,
      title: `${n.writers.length} files write to \`${n.label}\``,
      body:
        `${list(n.writers)} all write this table. Nothing in these files declares which runs ` +
        `first, so whichever your scheduler happens to run last is the one that wins. Both ` +
        `scripts succeed either way, which is why this kind of thing survives for months.`,
      refs: [n.id, ...n.writers],
    });
  }

  // ── 2. Dependency cycle ──────────────────────────────────────────────────
  const cycles = findCycles(model);
  const seenCycle = new Set<string>();
  for (const c of cycles) {
    const key = [...c].sort().join('>');
    if (seenCycle.has(key)) continue;
    seenCycle.add(key);
    found.push({
      kind: 'cycle',
      severity: 'warn',
      rank: 90,
      title: `Circular dependency: ${c.map(x => `\`${x}\``).join(' → ')}`,
      body:
        `These tables depend on each other in a loop, so there is no order in which all of ` +
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
      body:
        `${list(failed.map(f => f.name))} did not parse in this dialect, so nothing from ` +
        `${failed.length > 1 ? 'them' : 'it'} is in the graph above. Try another dialect — ` +
        `and if it still fails, the graph below is incomplete rather than clean.`,
      refs: failed.map(f => f.name),
    });
  }

  // ── 4. Placeholders with no value in scope ───────────────────────────────
  const phFiles = new Map<string, string[]>();
  for (const f of files) {
    for (const ph of f.extract.raw_table_refs) {
      if (!phFiles.has(ph)) phFiles.set(ph, []);
      phFiles.get(ph)!.push(f.name);
    }
  }
  // Aggregated once past a handful. A templated estate — every table written
  // `{{PREP_DB}}.{{PREP_AT_SCHEMA}}.X` — has a dozen distinct tokens, and one
  // finding per token buries the write conflict under a list of things the
  // reader already knows. Same failure as rule 5, same fix: say it once.
  const phEntries = Array.from(phFiles.entries()).sort();
  if (phEntries.length > 3) {
    const tokens = phEntries.map(([ph]) => ph);
    const shown = tokens.slice(0, 8);
    const names = uniqueStrings(phEntries.flatMap(([, ns]) => ns)).sort();
    found.push({
      kind: 'unresolved-placeholder',
      severity: 'warn',
      rank: 70,
      title: `${tokens.length} variables have no value in this folder`,
      body:
        `${list(shown)}${tokens.length > shown.length ? ` and ${tokens.length - shown.length} more` : ''} ` +
        `appear across ${list(names)}. Each is substituted by something at run time, by nothing ` +
        `in this folder, and not necessarily by the same thing in each file. The graph above ` +
        `treats every spelling as a distinct table — so if two of these resolve to the same ` +
        `name at run time, a write conflict can be hiding behind two of these boxes.`,
      refs: names,
    });
  } else {
    for (const [ph, names] of phEntries) {
      found.push({
        kind: 'unresolved-placeholder',
        severity: 'warn',
        rank: names.length > 1 ? 70 : 65,
        title: `\`${ph}\` appears in ${names.length} file${names.length > 1 ? 's' : ''} with no value in scope`,
        body:
          `Found in ${list(names)}. Each one is substituted by something at runtime — but not by ` +
          `anything in this folder, and not necessarily by the same thing. ` +
          `${names.length > 1 ? 'Nothing here guarantees these files agree on its value.' : ''}`.trim(),
        refs: names,
      });
    }
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
      title:
        names.length === 1
          ? `\`${names[0]}\` is read but never written here`
          : `${names.length} tables are read but never written here`,
      body:
        `${list(names)} ${names.length === 1 ? 'is' : 'are'} populated by something outside ` +
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
      body:
        `Written and read only inside \`${n.internalTo}\`. Nothing else in this folder can see ` +
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
      body:
        `No write conflicts, no cycles, no unresolved variables and no external reads across ` +
        `${model.stats.files} files. That is an unusually clean set, and the interesting ` +
        `question becomes how it stays that way as files get added.`,
      refs: [],
    });
  }

  return found;
}

/** The single call to action, chosen by the most severe finding. */
export function chooseCta(findings: Finding[]): CallToAction {
  const top = findings[0];
  return CTA_BY_KIND[top ? top.kind : 'clean'];
}
