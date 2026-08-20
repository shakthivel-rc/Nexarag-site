#!/usr/bin/env node
/**
 * generate-flows.mjs — the seven retrieval-mode flowcharts.
 *
 *   node scripts/generate-flows.mjs            # write all seven into index.html
 *   node scripts/generate-flows.mjs --stdout   # print them, change nothing
 *   node scripts/generate-flows.mjs --check    # fail if index.html is out of date
 *
 * WHY THIS IS A GENERATOR AND NOT SEVEN HAND-WRITTEN SVGs
 *
 * A flowchart is arithmetic: every box position depends on the height of the box
 * above it, and every height depends on how many lines its label wraps to. Hand
 * placing ~40 coordinates per diagram across seven diagrams means 280 numbers that
 * are individually plausible and collectively inconsistent, and every copy edit
 * ("passages" → "passages in the base") silently breaks a layout somewhere else
 * in the file. Here the copy is the input and the geometry is derived, so the
 * diagrams are consistent by construction and an edit cannot leave a stale number
 * behind.
 *
 * THE DIAGRAMS ARE READ OFF THE SOURCE, NOT OFF RAG FOLKLORE
 *
 * Every box, number and formula below was taken from CorpusTrace-api/rag/service.py,
 * and for the seventh mode from CorpusTrace-api/rag/precision/.
 * The function each row describes is named in a comment beside it. Where the code
 * does something the literature would not predict — the entity boost SATURATES and
 * is capped at a fraction of the best lexical score; the "agent" plans with a
 * keyword test and no model; multi-modal counts a repeated word once where the
 * default mode counts it twice — the diagram says so, because those are exactly
 * the details a reader cannot get from the mode's name.
 *
 * THE LAYOUT MODEL
 *
 * A vertical spine of rows, with a right-hand gutter for the side exits a decision
 * takes. Vertical rather than the usual left-to-right pipeline for one measured
 * reason: the diagram renders inside a modal that is ~420px wide on a phone, and a
 * 900-unit-wide horizontal chart scaled into that puts 12px type at 5px. At 420
 * units wide it renders at ~1:1 on the narrowest screen the site supports and only
 * ever scales UP. Font sizes are therefore also larger than the architecture
 * diagram's, which sits in a full-bleed figure and can afford 12px.
 *
 * Row kinds: stage · formula · lanes · list · decision (+ gutter exit) · terminal ·
 * note · optional. Edges between consecutive rows are derived from the two rows'
 * anchor counts — one-to-one is a straight line, one-to-many fans through a bus,
 * many-to-one converges. Nothing positions an arrow by hand.
 *
 * WRAPPING IS ESTIMATED, DELIBERATELY
 *
 * SVG text cannot be measured without a browser, so line breaking uses a
 * per-font-class character-width factor. That is an approximation, and the
 * consequence of getting it wrong is a line that overflows its box — which is why
 * `--check` exists and why the rendered result is screenshotted rather than
 * trusted. Explicit `lines: []` bypasses wrapping wherever a break matters
 * (formulas, mostly), so the estimate only ever decides prose.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(ROOT, 'index.html');

/* ---------------------------------------------------------------- geometry */

const W = 420;          // canvas width in user units — see the note above
const SPINE_X = 10;
const SPINE_W = 268;
const GUT_X = 292;
const GUT_W = 118;
const FULL_X = 8;
const FULL_W = 404;
const ROW_GAP = 30;     // vertical space for one arrow between rows
const FAN_GAP = 44;     // ...and for several curves converging into one box
const PAD_X = 11;       // box inner padding, horizontal
const PAD_Y = 9;        // box inner padding, vertical
const BLOCK_GAP = 5;    // between a label block and its sub lines

const SPINE_CX = SPINE_X + SPINE_W / 2;

/* Font classes. `cw` is the average glyph advance as a fraction of the font size,
   and every value below was MEASURED in the browser against a representative line
   of this file's own copy — `probe.getBBox().width / (chars × size)` — not guessed.
   The guesses were wrong in both directions: mono by 1%, but the note font by 20%
   and the uppercase mono head by 6% the other way, and a `cw` that is too small
   silently overflows a box while one that is too large wastes a line.

   Each is rounded UP slightly from its measurement, because the sample is one line
   of prose and a different letter mix moves the average a little either way. That
   margin is the reason wrapping errs toward an early break. */
const F = {
  lab:  { size: 14.5, lh: 18,   cw: 0.52,  cls: 'f-lab' },
  lane: { size: 13,   lh: 16,   cw: 0.53,  cls: 'f-lane' },
  sub:  { size: 11.6, lh: 14.5, cw: 0.605, cls: 'f-sub' },
  mono: { size: 11.6, lh: 15.5, cw: 0.605, cls: 'f-mono' },
  head: { size: 10,   lh: 13,   cw: 0.70,  cls: 'f-head' },
  note: { size: 11.6, lh: 14.5, cw: 0.46,  cls: 'f-note' },
  val:  { size: 11.6, lh: 15.5, cw: 0.605, cls: 'f-val' },
};

/* ------------------------------------------------------------------ specs */

/* Each spec is read against a named function in CorpusTrace-api/rag/service.py. The
   trailing three rows of most modes are the same three rows on purpose: the
   sufficiency gate in `_plan_answer` runs after the mode has returned, so every
   mode really does end identically. Showing that seven times is the point — it is
   how a reader learns that refusing is not a Corrective-mode feature. */

const SHARED_TAIL = [
  // rag/service.py :: _blend_semantic — inert unless a document was embedded.
  { t: 'optional', label: 'If the document was embedded: fused with the cosine ranking by reciprocal rank' },
  // rag/service.py :: _has_sufficient_evidence
  {
    t: 'decision',
    label: 'Do the top 3 passages cover 35% of your words?',
    exit: {
      label: 'no',
      box: {
        label: 'Refuse',
        subs: ['and name which of your', 'words matched nothing'],
        tone: 'stop',
      },
    },
  },
  { t: 'terminal', tone: 'good', label: 'Answer, from those passages, with citations' },
];

/* High Precision does NOT run `_blend_semantic`: it has already fused the dense side with
   normalised, weighted scores of its own, and a second reciprocal-rank pass over the same
   list would throw that ranking away. So it takes the tail from the gate down — which every
   mode really does share, because the gate lives in `_plan_answer`, after the mode returns. */
const GATE_TAIL = SHARED_TAIL.slice(1);

const MODES = [
  {
    id: 'contextual-hybrid',
    title: 'Contextual Hybrid — how a passage is scored',
    desc:
      'Your question is split into terms. Every passage in the knowledge base is scored on term overlap ' +
      'against its own text plus a six-line context header naming its base, file, title, modality and position. ' +
      'The score is the sum of term-frequency products divided by passage length, plus query coverage times three, ' +
      'plus two if the whole question appears verbatim and half a point if a matched term is in the document title. ' +
      'Passages scoring zero are dropped, the rest sorted, and the top five kept. If the document carries ' +
      'embeddings the ranking is fused with a cosine ranking. Finally the evidence is gated: unless the top three ' +
      'passages cover 35% of the question, the answer is refused and the unmatched words are named.',
    rows: [
      { t: 'stage', kind: 'accent', label: 'Your question', subs: ['split into terms · repeats counted'] },
      // rag/service.py :: _contextual_hybrid — every chunk of the resource, in Python.
      {
        t: 'stage',
        label: 'Every passage in the base',
        subs: ['scored against its text plus a', '6-line header: base, file, title,', 'modality, position'],
      },
      // rag/service.py :: _score_chunk
      {
        t: 'formula',
        head: 'SCORE',
        lines: [
          'Σ(passage tf × query tf) ÷ length',
          '+ coverage × 3.0',
          '+ 2.0  question appears verbatim',
          '+ 0.5  matched term is in the title',
        ],
        subs: ['no shared term at all → 0, dropped'],
      },
      { t: 'stage', label: 'Sort, keep the top 5' },
      ...SHARED_TAIL,
      { t: 'note', text: 'The default mode, and the one every other mode is built out of.' },
    ],
  },

  {
    id: 'rag-fusion',
    title: 'RAG-Fusion — four phrasings, merged by rank',
    desc:
      'Up to four phrasings of your question are built by rule, with no language model involved: the question as ' +
      'typed, its distinct words, those words reversed, and the first three of them. The last two exist only if the ' +
      'question has more than two distinct words. Each phrasing runs a full Contextual Hybrid search eight passages ' +
      'deep. Every passage then scores one over sixty plus its rank, from each phrasing that found it, and the ' +
      'totals decide the top five — so agreement across phrasings beats a single strong hit. The same evidence gate ' +
      'as every other mode follows.',
    rows: [
      { t: 'stage', kind: 'accent', label: 'Your question' },
      // rag/service.py :: _query_variants
      {
        t: 'list',
        head: 'FOUR PHRASINGS, BUILT BY RULE',
        items: [
          { name: 'as you typed it' },
          { name: 'its distinct words' },
          { name: 'those words, reversed' },
          { name: 'the first three of them' },
        ],
        subs: [
          'The last two exist only if the question has more than two distinct words.',
          'Each phrasing runs its own Contextual Hybrid search, 8 passages deep.',
        ],
      },
      // rag/service.py :: _rag_fusion — reciprocal rank fusion, RRF_K = 60.
      {
        t: 'formula',
        head: 'MERGE BY RANK, NOT BY SCORE',
        converge: 4,
        lines: ['each passage scores', '1 / (60 + its rank)', 'from every phrasing that found it'],
      },
      {
        t: 'stage',
        label: 'Sort by the totals, keep 5',
        subs: ['a passage several phrasings agree', 'on beats one a single phrasing loved'],
      },
      ...SHARED_TAIL,
      { t: 'note', text: 'No model rewrites anything. The four phrasings are string operations.' },
    ],
  },

  {
    id: 'graph-rag',
    title: 'GraphRAG — a capped re-rank on shared names',
    desc:
      'Two things run. A normal Contextual Hybrid search returns eight passages, and separately your words are ' +
      'matched against the recurring names extracted from your documents at indexing time. Each matched name lends ' +
      'affinity to the passages that mention it. That affinity becomes a boost that saturates rather than ' +
      'accumulating, and is capped at 35% of the best lexical score this question produced — so it can reorder the ' +
      'ranking but never replace it. A passage with no lexical score at all can enter on boost alone. No graph is ' +
      'traversed.',
    rows: [
      { t: 'stage', kind: 'accent', label: 'Your question' },
      {
        t: 'lanes',
        items: [
          // rag/service.py :: _contextual_hybrid(limit=8)
          { label: 'Lexical search', subs: ['Contextual Hybrid,', 'top 8'] },
          // rag/service.py :: _graph_rag — RagGraphEntity names, matched by token.
          { label: 'Named things', subs: ['names pulled out at', 'indexing time, matched', 'by your words'] },
        ],
      },
      // rag/service.py :: GRAPH_BOOST_MAX_FRACTION = 0.35, GRAPH_BOOST_SATURATION = 3.0
      {
        t: 'formula',
        head: 'A BOOST THAT CANNOT TAKE OVER',
        lines: [
          'ceiling = 35% of the best',
          '          lexical score',
          'w = Σ 1.0 + min(weight,5) × 0.1',
          'boost = ceiling × w / (w + 3.0)',
        ],
        subs: [
          'w is affinity: how many matched names a',
          'passage carries. It saturates — 38 names',
          'is not 38 times the evidence of one.',
        ],
      },
      {
        t: 'stage',
        label: 'Lexical score + boost',
        subs: ['a passage with no lexical score', 'at all can enter on boost alone'],
      },
      { t: 'stage', label: 'Sort, keep the top 5' },
      ...SHARED_TAIL,
      { t: 'note', text: 'No graph is walked. The name is historical; this is a re-rank on shared names.' },
    ],
  },

  {
    id: 'corrective',
    title: 'Corrective — grade first, retry differently, then decline',
    desc:
      'A Contextual Hybrid search runs and its result is graded: do the top three passages cover at least 35% of ' +
      'your words, and did anything score above zero. If so the answer is written. If not, the question is re-run ' +
      'as a RAG-Fusion search — a different route rather than the same one again — and graded a second time. If ' +
      'that also fails, the mode declines and names which of your words appear nowhere in the documents, so a typo ' +
      'is distinguishable from a topic the documents do not cover.',
    rows: [
      { t: 'stage', kind: 'accent', label: 'Your question' },
      // rag/service.py :: _corrective_rag — primary pass.
      { t: 'stage', label: 'Contextual Hybrid, top 5' },
      // rag/service.py :: _has_sufficient_evidence
      {
        t: 'decision',
        label: 'Enough evidence?',
        subs: ['top 3 cover 35% of your words', 'and the best score is above 0'],
        exit: { label: 'yes', box: { label: 'Answer', subs: ['with citations'], tone: 'good' } },
      },
      // rag/service.py :: _corrective_rag — the fallback branch.
      {
        t: 'stage',
        label: 'Re-run as RAG-Fusion',
        subs: ['four phrasings, merged by rank —', 'a different route, not a retry'],
      },
      { t: 'decision', label: 'Enough now?', exit: { label: 'yes', box: { label: 'Answer', subs: ['with citations'], tone: 'good' } } },
      {
        t: 'terminal',
        tone: 'stop',
        label: 'Decline — and name which of your words matched nothing',
        subs: ['a typo and an uncovered topic look identical without it'],
      },
      { t: 'note', text: 'Every mode refuses on thin evidence. This is the one that tries a second route first.' },
    ],
  },

  {
    id: 'multi-modal',
    title: 'Multi-Modal — the same scoring, weighted by content type',
    desc:
      'Your words are checked against three fixed vocabularies that name a kind of content: table words, image ' +
      'words and media words. A passage recorded as a kind you asked for is weighted 1.8 times; ordinary PDF or ' +
      'text is weighted 1.1; anything else is unweighted. Everything after that is the same term-overlap scoring ' +
      'the default mode uses. Nothing is excluded — the ordering changes, not the pool — so a question naming no ' +
      'content type behaves almost exactly like the default.',
    rows: [
      {
        t: 'stage',
        kind: 'accent',
        label: 'Your question',
        subs: ['a repeated word counts once here,', 'unlike in the default mode'],
      },
      // rag/service.py :: TABLE_TERMS / IMAGE_TERMS / AUDIO_TERMS
      {
        t: 'list',
        head: 'WORDS THAT NAME A CONTENT TYPE',
        items: [
          { name: 'table', sub: 'row · column · csv · data · dataset · spreadsheet · total · average · count' },
          { name: 'image', sub: 'photo · picture · screenshot · diagram · chart · figure' },
          { name: 'media', sub: 'audio · voice · recording · transcript · timestamp · video' },
        ],
      },
      // rag/service.py :: _multimodal_rag — modality_boost.
      {
        t: 'formula',
        head: 'WEIGHT PER PASSAGE',
        lines: ['1.8 ×  it is a kind you asked for', '1.1 ×  ordinary PDF or text', '1.0 ×  anything else'],
      },
      {
        t: 'stage',
        label: 'The default scoring, × weight',
        subs: ['nothing is excluded — the ordering', 'changes, not the pool'],
      },
      { t: 'stage', label: 'Sort, keep the top 5' },
      ...SHARED_TAIL,
      { t: 'note', text: 'Name no content type and this is the default mode with a 1.1× on prose.' },
    ],
  },

  {
    id: 'agentic-rag',
    title: 'Agentic RAG — five tools, weighted by keyword',
    desc:
      'Five retrieval tools are given fixed weights, adjusted by two keyword tests: words like compare, between or ' +
      'related raise GraphRAG, and words naming a content type raise Multi-Modal. No language model plans any of ' +
      'it. Every tool runs; each tool’s scores are divided by its own best score, multiplied by the tool’s weight ' +
      'and given a rank bonus, which is what makes tools on different scales comparable at all. Results are then ' +
      'spread across source documents. If the merged evidence is thin, the remaining phrasings are searched at 0.8 ' +
      'weight and the merge is redone. The evidence is graded strong, moderate or weak and reported with the answer, ' +
      'which carries up to seven citations.',
    rows: [
      { t: 'stage', kind: 'accent', label: 'Your question', subs: ['tested for two keyword signals'] },
      // rag/service.py :: _agentic_tool_plan — fixed weights, keyword-adjusted.
      {
        t: 'list',
        head: 'FIVE TOOLS, FIXED WEIGHTS',
        items: [
          { name: 'RAG-Fusion', value: '1.25' },
          { name: 'Corrective', value: '1.15' },
          { name: 'Contextual Hybrid', value: '1.00' },
          { name: 'GraphRAG', value: '1.35 / 0.85' },
          { name: 'Multi-Modal', value: '1.35 / 0.75' },
        ],
        subs: [
          'GraphRAG rises on compare, between,',
          'related, across, impact, depends;',
          'Multi-Modal on a content-type word.',
          'No language model plans any of this.',
        ],
      },
      // rag/service.py :: _merge_agentic_tool_results
      {
        t: 'formula',
        head: 'MERGE',
        converge: 5,
        anchor: 'merge',
        lines: ['each tool’s scores ÷ its own best', '× the tool’s weight', '+ 1 / (rank + 4)'],
        subs: ['tools score on different scales;', 'this is what makes them comparable'],
      },
      // rag/service.py :: _source_diverse_results
      {
        t: 'stage',
        label: 'Spread across documents',
        subs: ['−0.15 per passage already taken', 'from the same source'],
      },
      // rag/service.py :: _agentic_rag — the repair pass, then _grade_evidence.
      {
        t: 'decision',
        label: 'Enough evidence?',
        exit: {
          label: 'no',
          loopTo: 'merge',
          box: { label: 'Repair pass', subs: ['the other phrasings,', 'at 0.8 weight'] },
        },
      },
      {
        t: 'stage',
        label: 'Grade the evidence',
        subs: ['strong: 65% coverage · moderate: 35%', '· otherwise weak — said in the answer'],
      },
      { t: 'terminal', tone: 'good', label: 'Answer, with up to 7 citations' },
      { t: 'note', text: 'Nothing here is an agent. Five tools, two keyword tests, one weighted merge.' },
    ],
  },

  {
    id: 'high-precision',
    title: 'High Precision — ten stages, and no language model in any of them',
    desc:
      'The one mode that does not reuse the default scoring. Your question is folded to a canonical form, ' +
      'spell-checked against the words your own documents actually contain, and widened by dictionary — ' +
      'abbreviations, synonyms, entity aliases and word forms — with every added word weighted lower than the ' +
      'ones you typed and capped so it can surface a passage but never outrank a literal match. Filters read out ' +
      'of the question are applied only when enough passages survive them. Okapi BM25 and, where a document was ' +
      'embedded, cosine similarity then run over the whole base; their normalised scores are combined with your ' +
      'own words and any metadata agreement into a pool of a hundred. A cross-encoder re-scores each of those as a ' +
      'pair with the question — coverage, how tightly the words sit together, whether their order survived, an ' +
      'exact substring, a heading match, and where in the passage the match falls — and keeps twenty. ' +
      'Near-duplicates are dropped at 90% term overlap, ten are chosen for relevance against redundancy, and each ' +
      'one is handed its surrounding passages as context. The same evidence gate every other mode ends on follows. ' +
      'Nothing here builds a prompt or asks a model anything.',
    rows: [
      // rag/precision/normalize.py :: normalize_query + correct_spelling
      {
        t: 'stage',
        kind: 'accent',
        label: 'Your question, folded to one form',
        subs: [
          'unicode, punctuation, case and possessives flattened — then spelling checked',
          'against your own documents, never a general dictionary: your files are the',
          'only authority on what your vocabulary is.',
        ],
      },
      // rag/precision/expansion.py :: expand_query
      {
        t: 'list',
        head: 'WIDENED BY DICTIONARY, NEVER BY A MODEL',
        items: [
          { name: 'abbreviations', sub: 'auth · config · docs · k8s · env · repo' },
          { name: 'synonyms and domain terms', sub: 'from a built-in list plus any file you point it at' },
          { name: 'entity aliases', sub: 'the recurring names pulled out of your own documents' },
          { name: 'word forms and hyphenation', sub: 'plurals, -ing, -ed · runbook ⇄ run-book ⇄ run book' },
        ],
        subs: [
          'An added word carries 0.45 of a typed one, and everything they contribute',
          'together is capped at 35% of your best literal match — so a synonym can',
          'surface a passage, and can never outrank the words you actually used.',
        ],
      },
      // rag/precision/metadata.py :: infer_filters + apply_filters
      {
        t: 'stage',
        label: 'Filters read out of the question',
        subs: [
          'a version, a document type or a category. One that would empty the pool is',
          'recorded and dropped — a guess read out of a question must not remove the answer.',
        ],
      },
      // rag/precision/bm25.py + the dense side, both over every passage in the base.
      {
        t: 'lanes',
        items: [
          {
            label: 'Okapi BM25',
            subs: ['k1 1.2, b 0.75 — a repeated term', 'saturates instead of accumulating'],
          },
          {
            label: 'Cosine, where embedded',
            subs: ['one embedding model only; vectors', 'from two never meet in one score'],
          },
        ],
      },
      // rag/precision/pipeline.py :: retrieve — the weighted, normalised fuse.
      {
        t: 'formula',
        head: 'COMBINE, THEN KEEP 100',
        converge: 2,
        lines: [
          'score = 1.0 × cosine (normalised)',
          '      + 1.0 × BM25   (normalised)',
          '      + 0.5 × your words, in full',
          '      + 0.35 × metadata agreement',
          '      × (1 − any penalty)',
        ],
        subs: ['both are normalised first: a cosine and a BM25 score', 'are different scales and do not add up as they are'],
      },
      // rag/precision/rerank.py :: lexical_cross_encode
      {
        t: 'formula',
        head: 'CROSS-ENCODER — SCORES THE PAIR',
        lines: [
          'IDF coverage         0.34',
          'word proximity       0.22',
          'preserved word order 0.16',
          'exact substring      0.14',
          'heading match        0.08',
          'position in passage  0.06',
        ],
        subs: [
          'Scored per (question, passage) pair, so none of it can be precomputed.',
          'Reads only the words you typed. Keeps the top 20.',
        ],
      },
      // rag/precision/diversity.py :: deduplicate
      {
        t: 'stage',
        label: 'Drop near-duplicates',
        subs: ['90% shared terms. The chunker overlaps by design, so a base', 'genuinely holds passages that say the same thing twice'],
      },
      // rag/precision/diversity.py :: maximal_marginal_relevance
      {
        t: 'formula',
        head: 'RELEVANCE AGAINST REDUNDANCY',
        lines: ['pick by 0.7 × relevance', '      − 0.3 × similarity to', '            what is already picked'],
        subs: ['ten survive — the top ten by score alone would be', 'the same passage restated ten ways'],
      },
      // rag/precision/parents.py :: recover_parent
      {
        t: 'stage',
        label: 'Hand each one its neighbours',
        subs: ['its neighbours in the same file, up to 2400 characters. Nothing is', 're-chunked — the window is assembled at question time'],
      },
      ...GATE_TAIL,
      { t: 'note', text: 'No prompt is built and no model is asked anything. The reranker is arithmetic over six features.' },
    ],
  },
];

/* ----------------------------------------------------------------- helpers */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Break `text` to fit `width` user units in font `f`. Long words are not split —
 *  an overflowing token is more findable than a hyphen invented by a script. */
function wrap(text, width, f) {
  const max = Math.max(6, Math.floor(width / (f.size * f.cw)));
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + word : word;
    if (next.length <= max || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** A text block: n lines in one font, measured before it is placed. */
function block(lines, f) {
  return { f, lines, h: lines.length * f.lh };
}

/** Prose block. `subs` in a spec are written as an array for readability, but the
 *  breaks in them are NOT meaning — they are a guess at a width the author cannot
 *  see, and the same array is reused in boxes 268 and 118 units wide. So they are
 *  joined and re-wrapped to whatever box they actually landed in. The verbatim
 *  path is `lines`, which is where a formula's breaks live and where they matter.
 *  Hand-authored breaks in a 118-unit gutter box overflowed it by 38 units, which
 *  is what this rule exists to make impossible rather than to notice later. */
function prose(subs, width, f) {
  return block(wrap(subs.join(' '), width, f), f);
}

/** A verbatim line that does not fit is a spec bug, not a layout to nudge: the
 *  breaks were chosen by hand precisely so nothing would re-flow them. */
function assertFits(lines, width, f, where) {
  const max = Math.floor(width / (f.size * f.cw));
  for (const line of lines) {
    if (line.length > max) {
      throw new Error(`${where}: "${line}" is ${line.length} chars, ${max} fit — shorten it or split the line`);
    }
  }
}

function blocksHeight(blocks) {
  if (!blocks.length) return 0;
  return blocks.reduce((sum, b) => sum + b.h, 0) + (blocks.length - 1) * BLOCK_GAP;
}

/** Emit one block's <text> elements, top-aligned at `y`, and return the new y.
 *  The baseline sits at 0.78 of the line height — SVG has no reliable
 *  dominant-baseline across engines, so every baseline here is arithmetic. */
function emitBlock(out, b, x, y, extraCls = '') {
  let cursor = y;
  for (const line of b.lines) {
    const cls = (b.f.cls + ' ' + extraCls).trim();
    out.push(`<text class="${cls}" x="${r(x)}" y="${r(cursor + b.f.lh * 0.78)}">${esc(line)}</text>`);
    cursor += b.f.lh;
  }
  return y + b.h;
}

const r = (n) => (Math.round(n * 100) / 100).toString();

/* ------------------------------------------------------------------ layout */

/** Measure a row: its height, and where edges may attach to it.
 *  Anchors are x positions on the row's top and bottom edges. */
function measure(row) {
  if (row.t === 'note') {
    const lines = wrap(row.text, FULL_W - 8, F.note);
    return { h: lines.length * F.note.lh + 6, lines, anchors: [], noEdge: true };
  }

  if (row.t === 'optional') {
    const lines = wrap(row.label, SPINE_W - PAD_X * 2, F.sub);
    return { h: lines.length * F.sub.lh + PAD_Y * 2 - 2, lines, anchors: [SPINE_CX], x: SPINE_X, w: SPINE_W };
  }

  if (row.t === 'lanes') {
    const n = row.items.length;
    const gap = 10;
    const w = (FULL_W - gap * (n - 1)) / n;
    let h = 0;
    const laid = row.items.map((item, i) => {
      const blocks = [block(wrap(item.label, w - PAD_X * 2, F.lane), F.lane)];
      if (item.subs) blocks.push(prose(item.subs, w - PAD_X * 2, F.sub));
      const bh = blocksHeight(blocks) + PAD_Y * 2;
      h = Math.max(h, bh);
      return { x: FULL_X + i * (w + gap), w, blocks };
    });
    return { h, laid, anchors: laid.map((l) => l.x + l.w / 2) };
  }

  if (row.t === 'list') {
    const inner = SPINE_W - PAD_X * 2;
    const blocks = [];
    if (row.head) blocks.push(block(wrap(row.head, inner, F.head), F.head));
    const items = row.items.map((item) => {
      const hasVal = typeof item.value === 'string';
      const nameW = hasVal ? inner * 0.62 : inner;
      const nameLines = wrap(item.name, nameW, F.lane);
      const subLines = item.sub ? wrap(item.sub, inner - 6, F.sub) : [];
      return {
        nameLines,
        subLines,
        value: item.value,
        h: nameLines.length * F.lane.lh + subLines.length * F.sub.lh + (subLines.length ? 2 : 0),
      };
    });
    const rowsH = items.reduce((s, i) => s + i.h, 0) + (items.length - 1) * 6;
    const subs = row.subs ? prose(row.subs, inner - 6, F.sub) : null;
    const h =
      PAD_Y * 2 + blocksHeight(blocks) + (blocks.length ? BLOCK_GAP : 0) + rowsH + (subs ? BLOCK_GAP + 4 + subs.h : 0);
    return { h, blocks, items, subs, anchors: [SPINE_CX], x: SPINE_X, w: SPINE_W, spread: row.converge };
  }

  if (row.t === 'decision') {
    const inner = SPINE_W - PAD_X * 2 - 22; // the hexagon's chamfer eats horizontal room
    const blocks = [block(wrap(row.label, inner, F.lab), F.lab)];
    if (row.subs) blocks.push(prose(row.subs, inner, F.sub));
    const h = blocksHeight(blocks) + PAD_Y * 2 + 8;
    const exit = row.exit ? measureGutter(row.exit.box) : null;
    return { h, blocks, exit, anchors: [SPINE_CX], x: SPINE_X, w: SPINE_W };
  }

  // stage · formula · terminal
  const inner = SPINE_W - PAD_X * 2;
  const blocks = [];
  if (row.head) blocks.push(block(wrap(row.head, inner, F.head), F.head));
  if (row.label) blocks.push(block(wrap(row.label, inner, F.lab), F.lab));
  if (row.lines) {
    assertFits(row.lines, inner, F.mono, row.head || row.label || 'formula');
    blocks.push(block(row.lines, F.mono));
  }
  if (row.subs) blocks.push(prose(row.subs, inner, F.sub));
  return {
    h: blocksHeight(blocks) + PAD_Y * 2,
    blocks,
    anchors: [SPINE_CX],
    x: SPINE_X,
    w: SPINE_W,
    converge: row.converge,
  };
}

function measureGutter(box) {
  const inner = GUT_W - PAD_X * 2;
  const blocks = [block(wrap(box.label, inner, F.lane), F.lane)];
  if (box.subs) blocks.push(prose(box.subs, inner, F.sub));
  return { h: blocksHeight(blocks) + PAD_Y * 2, blocks, tone: box.tone };
}

/* ------------------------------------------------------------------ render */

function shape(kind, x, y, w, h, tone) {
  const cls = ['f-box'];
  if (kind === 'accent') cls.push('f-box--accent');
  if (kind === 'formula') cls.push('f-box--formula');
  if (kind === 'optional') cls.push('f-box--dash');
  if (tone === 'good') cls.push('f-box--good');
  if (tone === 'stop') cls.push('f-box--stop');

  if (kind === 'terminal') {
    return `<rect class="${cls.join(' ')}" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${r(Math.min(16, h / 2))}"/>`;
  }
  if (kind === 'decision') {
    // A hexagon, not a diamond. A diamond wastes both top corners on whitespace and
    // forces the label into a 40%-width column; a chamfered box reads as a decision
    // and still fits a sentence.
    const c = 16;
    const pts = [
      [x + c, y],
      [x + w - c, y],
      [x + w, y + h / 2],
      [x + w - c, y + h],
      [x + c, y + h],
      [x, y + h / 2],
    ];
    return `<polygon class="${cls.join(' ')}" points="${pts.map((p) => r(p[0]) + ',' + r(p[1])).join(' ')}"/>`;
  }
  return `<rect class="${cls.join(' ')}" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="9"/>`;
}

function arrow(id) {
  return `url(#fa-${id})`;
}

/** One diagram. Returns the SVG source. */
function render(mode) {
  const rows = mode.rows.map((row) => ({ row, m: measure(row) }));

  // Vertical pass. A note sits tight under its row; everything else gets an arrow gap.
  let y = 8;
  for (let i = 0; i < rows.length; i++) {
    const { row, m } = rows[i];
    m.y = y;
    y += m.h;
    const next = rows[i + 1];
    if (next) y += next.m.noEdge || m.noEdge ? 10 : next.row.converge ? FAN_GAP : ROW_GAP;
  }
  const height = y + 8;

  const out = [];
  const edges = [];
  const anchorsById = {};

  /* Every box is emitted inside its own <g> TOGETHER WITH its own labels, and that
     is structural, not cosmetic. A `<rect>` with no text in its group is an
     informational graphic and owes 3:1 against the page under SC 1.4.11; a rect
     that has text on it is a SURFACE, and a surface behind text that already meets
     1.4.3 has no minimum of its own. Flat output made the first true and the
     second unreadable — the contrast audit reported five failures per theme for
     box fills that are, correctly read, exempt, and the only honest way to fix
     that is to make the markup say what the boxes are. It also means the
     separator inside the list box is grouped with the labels it separates.

     A note is deliberately NOT wrapped: it is a caption on the diagram, not a node
     in it, and giving it a node's markup would be the same lie in reverse. */
  const node = (emit) => {
    const at = out.length;
    emit();
    out.splice(at, 0, '<g class="f-node">');
    out.push('</g>');
  };

  for (let i = 0; i < rows.length; i++) {
    const { row, m } = rows[i];
    if (row.anchor) anchorsById[row.anchor] = m;

    if (row.t === 'note') {
      let cursor = m.y + 2;
      for (const line of m.lines) {
        out.push(`<text class="f-note" x="${r(FULL_X + 4)}" y="${r(cursor + F.note.lh * 0.78)}">${esc(line)}</text>`);
        cursor += F.note.lh;
      }
      continue;
    }

    if (row.t === 'optional') {
      node(() => {
        out.push(shape('optional', SPINE_X, m.y, SPINE_W, m.h));
        let cursor = m.y + PAD_Y - 1;
        for (const line of m.lines) {
          out.push(`<text class="f-sub" x="${r(SPINE_X + PAD_X)}" y="${r(cursor + F.sub.lh * 0.78)}">${esc(line)}</text>`);
          cursor += F.sub.lh;
        }
      });
      continue;
    }

    if (row.t === 'lanes') {
      for (const lane of m.laid) {
        node(() => {
          out.push(shape('plain', lane.x, m.y, lane.w, m.h));
          let cursor = m.y + PAD_Y;
          for (const b of lane.blocks) cursor = emitBlock(out, b, lane.x + PAD_X, cursor) + BLOCK_GAP;
        });
      }
      continue;
    }

    if (row.t === 'list') {
      node(() => {
      out.push(shape('plain', SPINE_X, m.y, SPINE_W, m.h));
      let cursor = m.y + PAD_Y;
      for (const b of m.blocks) cursor = emitBlock(out, b, SPINE_X + PAD_X, cursor) + BLOCK_GAP;
      for (let k = 0; k < m.items.length; k++) {
        const item = m.items[k];
        let inner = cursor;
        for (const line of item.nameLines) {
          out.push(`<text class="f-lane" x="${r(SPINE_X + PAD_X)}" y="${r(inner + F.lane.lh * 0.78)}">${esc(line)}</text>`);
          inner += F.lane.lh;
        }
        if (typeof item.value === 'string') {
          out.push(
            `<text class="f-val" text-anchor="end" x="${r(SPINE_X + SPINE_W - PAD_X)}" y="${r(cursor + F.lane.lh * 0.78)}">${esc(item.value)}</text>`,
          );
        }
        if (item.subLines.length) inner += 2;
        for (const line of item.subLines) {
          out.push(`<text class="f-sub" x="${r(SPINE_X + PAD_X + 6)}" y="${r(inner + F.sub.lh * 0.78)}">${esc(line)}</text>`);
          inner += F.sub.lh;
        }
        cursor += item.h + 6;
      }
      if (m.subs) {
        out.push(
          `<line class="f-rule" x1="${r(SPINE_X + PAD_X)}" y1="${r(cursor - 2)}" x2="${r(SPINE_X + SPINE_W - PAD_X)}" y2="${r(cursor - 2)}"/>`,
        );
        emitBlock(out, m.subs, SPINE_X + PAD_X, cursor + 4);
      }
      });
      continue;
    }

    if (row.t === 'decision') {
      node(() => {
        out.push(shape('decision', SPINE_X, m.y, SPINE_W, m.h));
        let cursor = m.y + PAD_Y + 4;
        for (const b of m.blocks) cursor = emitBlock(out, b, SPINE_X + PAD_X + 11, cursor) + BLOCK_GAP;
      });

      if (m.exit) {
        const ey = m.y + m.h / 2 - m.exit.h / 2;
        node(() => {
          out.push(shape('terminal', GUT_X, ey, GUT_W, m.exit.h, m.exit.tone));
          let ec = ey + PAD_Y;
          for (const b of m.exit.blocks) ec = emitBlock(out, b, GUT_X + PAD_X, ec) + BLOCK_GAP;
        });
        edges.push(
          `<path class="f-edge" d="M${r(SPINE_X + SPINE_W)} ${r(m.y + m.h / 2)}H${r(GUT_X - 5)}" marker-end="${arrow(mode.id)}"/>`,
        );
        /* End-anchored just before the box, not start-anchored just after the
           hexagon. The gap between the two is 14 units and "yes" is 19, so a
           left-aligned tag ran onto the outcome box's border and read as a
           mistake. Anchored the other way it overlaps the hexagon's sloping edge
           instead, where the knockout halo makes it read as a label sitting on a
           line — the same treatment the architecture diagram's edge captions use. */
        out.push(
          `<text class="f-tag" text-anchor="end" x="${r(GUT_X - 4)}" y="${r(m.y + m.h / 2 - 5)}">${esc(row.exit.label)}</text>`,
        );

        // The loop back. Routed around the right edge because the gutter box it
        // leaves from is already the rightmost thing on the canvas; dashed, and
        // unlabelled by design — the label lives in the box it comes out of, so
        // there is no caption to place over a line.
        if (row.exit.loopTo) {
          const target = anchorsById[row.exit.loopTo];
          if (!target) throw new Error(`${mode.id}: loopTo "${row.exit.loopTo}" names no row with that anchor`);
          const lane = GUT_X + GUT_W + 5;
          edges.push(
            `<path class="f-edge f-edge--dash" d="M${r(GUT_X + GUT_W)} ${r(ey + m.exit.h / 2)}H${r(lane)}V${r(target.y + target.h / 2)}H${r(SPINE_X + SPINE_W + 5)}" marker-end="${arrow(mode.id)}"/>`,
          );
        }
      }
      continue;
    }

    // stage · formula · terminal
    const kind = row.t === 'formula' ? 'formula' : row.t === 'terminal' ? 'terminal' : row.kind || 'plain';
    node(() => {
      out.push(shape(kind, SPINE_X, m.y, SPINE_W, m.h, row.tone));
      let cursor = m.y + PAD_Y;
      for (const b of m.blocks) cursor = emitBlock(out, b, SPINE_X + PAD_X, cursor) + BLOCK_GAP;
    });
  }

  /* Edges between consecutive rows, derived from anchor counts. */
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.m.noEdge || b.m.noEdge) continue;

    const top = a.m.y + a.m.h;
    const bottom = b.m.y;
    const mid = (top + bottom) / 2;

    // Converging fan: several lanes of one box's content collapsing into the next.
    // Drawn as curves with a single arrowhead, because n arrowheads landing on one
    // point is a blob rather than a merge.
    if (b.row.converge) {
      const n = b.row.converge;
      const from = a.m.x != null ? a.m.x : FULL_X;
      const fw = a.m.w != null ? a.m.w : FULL_W;
      for (let k = 0; k < n; k++) {
        const sx = from + (fw * (k + 0.5)) / n;
        edges.push(
          `<path class="f-edge" d="M${r(sx)} ${r(top)}C${r(sx)} ${r(mid)} ${r(SPINE_CX)} ${r(mid)} ${r(SPINE_CX)} ${r(bottom - 6)}"/>`,
        );
      }
      edges.push(
        `<path class="f-edge" d="M${r(SPINE_CX)} ${r(bottom - 8)}V${r(bottom - 1)}" marker-end="${arrow(mode.id)}"/>`,
      );
      continue;
    }

    const A = a.m.anchors;
    const B = b.m.anchors;

    if (A.length === 1 && B.length === 1) {
      edges.push(`<path class="f-edge" d="M${r(A[0])} ${r(top)}V${r(bottom - 1)}" marker-end="${arrow(mode.id)}"/>`);
      continue;
    }

    // Fan out or fan in through a horizontal bus at the midpoint.
    const busY = mid;
    if (A.length === 1) {
      edges.push(`<path class="f-edge" d="M${r(A[0])} ${r(top)}V${r(busY)}"/>`);
      edges.push(`<path class="f-edge" d="M${r(Math.min(...B))} ${r(busY)}H${r(Math.max(...B))}"/>`);
      for (const x of B) {
        edges.push(`<path class="f-edge" d="M${r(x)} ${r(busY)}V${r(bottom - 1)}" marker-end="${arrow(mode.id)}"/>`);
      }
    } else {
      for (const x of A) edges.push(`<path class="f-edge" d="M${r(x)} ${r(top)}V${r(busY)}"/>`);
      edges.push(`<path class="f-edge" d="M${r(Math.min(...A))} ${r(busY)}H${r(Math.max(...A))}"/>`);
      edges.push(`<path class="f-edge" d="M${r(B[0])} ${r(busY)}V${r(bottom - 1)}" marker-end="${arrow(mode.id)}"/>`);
    }
  }

  const tid = `flow-${mode.id}-t`;
  const did = `flow-${mode.id}-d`;
  return [
    `<svg class="flow" viewBox="0 0 ${W} ${r(height)}" role="img" aria-labelledby="${tid} ${did}">`,
    `<title id="${tid}">${esc(mode.title)}</title>`,
    `<desc id="${did}">${esc(mode.desc)}</desc>`,
    `<defs><marker id="fa-${mode.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.4" markerHeight="5.4" orient="auto-start-reverse"><path class="f-arrow" d="M0 0 10 5 0 10z"/></marker></defs>`,
    // Edges first so a box always paints over a line, never the other way round.
    ...edges,
    ...out,
    '</svg>',
  ].join('\n');
}

/* -------------------------------------------------------------------- main */

const args = process.argv.slice(2);
const svgs = new Map(MODES.map((m) => [m.id, render(m)]));

if (args.includes('--stdout')) {
  for (const [id, svg] of svgs) console.log(`\n===== ${id} =====\n${svg}`);
  process.exit(0);
}

let html = readFileSync(HTML, 'utf8');
let written = 0;
const missing = [];

for (const [id, svg] of svgs) {
  const start = `<!-- FLOW:${id}:START -->`;
  const end = `<!-- FLOW:${id}:END -->`;
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    missing.push(id);
    continue;
  }
  const replacement = `${start}\n${svg}\n            ${end}`;
  const next = html.slice(0, from) + replacement + html.slice(to + end.length);
  if (next !== html) written++;
  html = next;
}

if (missing.length) {
  console.error(`index.html has no FLOW markers for: ${missing.join(', ')}`);
  process.exit(1);
}

if (args.includes('--check')) {
  const current = readFileSync(HTML, 'utf8');
  if (current === html) {
    console.log('index.html flowcharts are up to date.');
    process.exit(0);
  }
  console.error('index.html flowcharts are STALE — run: node scripts/generate-flows.mjs');
  process.exit(1);
}

writeFileSync(HTML, html);
const dims = MODES.map((m) => {
  const vb = svgs.get(m.id).match(/viewBox="0 0 (\d+) ([\d.]+)"/);
  return `  ${m.id.padEnd(19)} ${vb[1]} × ${vb[2]}`;
}).join('\n');
console.log(`wrote ${written} of ${svgs.size} flowcharts into index.html\n${dims}`);
