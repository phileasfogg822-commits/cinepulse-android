/**
 * Context-anchor fallback for CinePulse deep matching.
 *
 * THE PROBLEM
 * -----------
 * Deep matching anchors every narration segment to a literal source-SRT cue:
 * the cue's text must contain the segment's words, and each cue may be cited
 * only once (in either language). When a segment's only literal cue was
 * already accepted by an earlier segment, or no cue in the SRT says that
 * thing at all, the segment is unanchorable. The backend validator rejects
 * every submit shape for such a segment (for Shrek 2, null anchor, omission
 * and cue reuse were all rejected with HTTP 422), so the whole project parks
 * in `needs_review`. Six films hit this on 2026-11-10 (Shrek 2, Kung Fu
 * Panda, A Minecraft Movie, The Prestige, The School of Rock, The BFG).
 *
 * THE IDEA (Umar, 2026-11-11)
 * ----------------------------
 * When a segment fails to anchor, do NOT stop. Look at its CONTEXT — the
 * segments around it — and take the nearest FREE cue from that neighbourhood.
 * Start with a small area (a few segments each side). If no free cue is
 * left there, widen the area step by step, and if needed use any free cue
 * in the film. The scene does not have to match the words exactly: one
 * approximately-placed scene in ~300 does not hurt the film.
 *
 * RULES THE FALLBACK MUST NEVER BREAK
 * ------------------------------------
 * 1. The anchor is always a REAL cue from the source SRT. Nothing is
 *    invented: no fake timecode, no fake quote.
 * 2. A cue is never reused — not by another segment in the same language,
 *    and not by the other language either (the backend blocks cross-language
 *    cue reuse). Only cues no accepted decision cites are candidates.
 * 3. The decision is honestly labelled `anchorMethod: "context"`, so it can
 *    never be confused with a literal match in any report or audit.
 * 4. The evidence quote is the cited cue's exact text (multi-word, wrapped
 *    in quote characters), exactly as the validator already requires.
 * 5. The fallback runs ONLY when literal matching has already failed for a
 *    segment. Films that anchor normally are untouched.
 *
 * WHERE TO CALL IT (backend developer)
 * -------------------------------------
 * In the deep_match submit path, after the literal search for a segment
 * returns no anchor and BEFORE the task is marked `needs_review`:
 *
 *   const decision = findContextAnchor({
 *     segmentIndex, segmentCount, cues, accepted, anchorTimeBySegment,
 *   });
 *   if (decision) submit decision as usual (it is a normal decision object
 *   with one extra field, anchorMethod: "context");
 *   else mark the segment / task needs_review as before.
 *
 * VALIDATOR CHANGE REQUIRED
 * -------------------------
 * If the validator requires the evidence quote to appear in the narration
 * segment's text, that check MUST be skipped for context decisions — a
 * context quote comes from the cited cue, not from the narration. Gate it
 * with `isAcceptableContextDecision()` below: it verifies the cue exists,
 * is multi-word, the quote matches the cue text exactly, the anchor is a
 * single cue, and its span is within the normal limit. Everything else
 * about the decision is validated exactly as before.
 *
 * SAFETY CAP
 * ----------
 * A film that needs many context anchors is a signal, not a success. Track
 * how many context decisions a project uses and flag it for review when it
 * passes `contextAnchorBudgetExceeded()` (more than 3 segments across both languages). The cap keeps one imperfect scene in
 * ~300 acceptable and stops a systematic problem from passing silently.
 *
 * No dependencies. Pure functions only — no I/O, no network, no randomness
 * except a deterministic tie-break (lowest cue id), so the same input always
 * gives the same anchor.
 */

export interface SrcCue {
  /** 1-based cue number in the source SRT. */
  id: number;
  /** Cue start time in seconds. */
  start: number;
  /** Cue end time in seconds. */
  end: number;
  /** Exact subtitle text of the cue. */
  text: string;
}

export interface AcceptedAnchor {
  /** 0-based narration segment index (per language). */
  segmentIndex: number;
  /** Cue ids this segment already cites. */
  cueIds: number[];
}

export interface ContextDecision {
  segmentIndex: number;
  /** Always exactly one cue. */
  cueIds: number[];
  /** The cited cue's exact text, wrapped in quote characters. */
  evidenceQuote: string;
  /** Honest label: this anchor came from context, not a literal match. */
  anchorMethod: "context";
  /** Segment radius that produced the match (Infinity = whole film). */
  contextRadiusSegments: number;
  /** Interpolated film time for the blocked segment, in seconds. */
  expectedFilmTime: number;
}

/** Segment radii tried in order: small area first, then wider. */
export const DEFAULT_RADII: number[] = [5, 10, 20, 40];

/** Flag a project for review when it needs more context anchors than this. */
export const MAX_CONTEXT_ANCHORS_PER_PROJECT = 3;
// No percentage allowance: hard maximum of three per movie.

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isMultiWord(cue: SrcCue): boolean {
  return wordCount(cue.text) >= 2;
}

/** Wrap the cue text in quote characters, the way the validator expects. */
function quote(text: string): string {
  const t = text.trim();
  return t.includes('"') ? `'${t}'` : `"${t}"`;
}

/** Median gap between consecutive cue starts — used only to step past an edge. */
function medianGap(cues: SrcCue[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < cues.length; i++) {
    const g = cues[i].start - cues[i - 1].start;
    if (g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return 2;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Find a context anchor for one blocked segment.
 *
 * @param segmentIndex   0-based index of the blocked segment in its language.
 * @param segmentCount   Total narration segments in that language.
 * @param cues           Full source SRT, sorted by start time.
 * @param accepted       Every accepted anchor so far, in BOTH languages
 *                       (cross-language cue reuse is blocked, so both lists
 *                       must be passed).
 * @param anchorTimeBySegment  segmentIndex -> representative film time
 *                       (start of its first cited cue) for every segment
 *                       that already has an anchor.
 * @param radii          Segment radii to try, smallest first.
 * @returns A context decision, or null when no free cue exists anywhere
 *          (then the segment genuinely stays needs_review).
 */
export function findContextAnchor(opts: {
  segmentIndex: number;
  segmentCount: number;
  cues: SrcCue[];
  accepted: AcceptedAnchor[];
  anchorTimeBySegment: Map<number, number>;
  radii?: number[];
}): ContextDecision | null {
  const { segmentIndex, segmentCount, cues, accepted, anchorTimeBySegment } = opts;
  const radii = opts.radii ?? DEFAULT_RADII;
  if (cues.length === 0) return null;
  if (segmentIndex < 0 || segmentIndex >= segmentCount) return null;

  // Cues already cited anywhere are off limits, in both languages.
  const used = new Set<number>();
  for (const a of accepted) for (const id of a.cueIds) used.add(id);

  // Only multi-word cues can carry an evidence quote.
  const free = cues.filter((c) => !used.has(c.id) && isMultiWord(c));
  if (free.length === 0) return null;

  // Where in the film should this segment sit? Take the midpoint between
  // its nearest anchored neighbours. At an edge, step one median cue-gap
  // past the single neighbour we have.
  const anchored = [...anchorTimeBySegment.entries()].sort((a, b) => a[0] - b[0]);
  let prevT: number | null = null;
  let nextT: number | null = null;
  for (const [idx, t] of anchored) {
    if (idx < segmentIndex) prevT = t;
    if (idx > segmentIndex && nextT === null) nextT = t;
  }
  if (prevT === null && nextT === null) return null;
  const gap = medianGap(cues);
  const expected =
    prevT !== null && nextT !== null
      ? (prevT + nextT) / 2
      : prevT !== null
        ? prevT + gap
        : (nextT as number) - gap;

  // Nearest free cue to the expected time inside a film-time window.
  // Iterating in cue order with a strict "closer wins" keeps ties
  // deterministic (lowest cue id wins).
  function pickInWindow(lo: number, hi: number): SrcCue | null {
    let best: SrcCue | null = null;
    let bestD = Infinity;
    for (const c of free) {
      if (c.start < lo || c.start > hi) continue;
      const d = Math.abs(c.start - expected);
      if (d < bestD - 1e-9) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  // Try each radius: the film-time window is bounded by the nearest
  // anchored segments at or beyond the segment window's edges.
  for (const r of radii) {
    const loIdx = segmentIndex - r;
    const hiIdx = segmentIndex + r;
    let lo = cues[0].start;
    let hi = cues[cues.length - 1].end;
    for (const [idx, t] of anchored) {
      if (idx <= loIdx) lo = t;
    }
    for (const [idx, t] of anchored) {
      if (idx >= hiIdx) {
        hi = t;
        break;
      }
    }
    const pick = pickInWindow(lo, hi);
    if (pick) {
      return {
        segmentIndex,
        cueIds: [pick.id],
        evidenceQuote: quote(pick.text),
        anchorMethod: "context",
        contextRadiusSegments: r,
        expectedFilmTime: expected,
      };
    }
  }

  // Last resort: any free cue in the whole film, nearest to the expected
  // time. (With ~1,000+ cues per SRT and ~100–200 cited, this almost
  // always succeeds; if it does not, the segment stays needs_review.)
  const pick = pickInWindow(-Infinity, Infinity);
  if (!pick) return null;
  return {
    segmentIndex,
    cueIds: [pick.id],
    evidenceQuote: quote(pick.text),
    anchorMethod: "context",
    contextRadiusSegments: Infinity,
    expectedFilmTime: expected,
  };
}

/**
 * Validator hook: accept a context decision only when it is a real,
 * checkable anchor. Call this INSTEAD OF the literal-quote check for
 * decisions with anchorMethod === "context" — the quote comes from the
 * cited cue, not from the narration, so requiring it in the narration
 * would reject every context decision.
 */
export function isAcceptableContextDecision(
  decision: ContextDecision,
  cues: SrcCue[],
): boolean {
  if (decision.anchorMethod !== "context") return false;
  if (decision.cueIds.length !== 1) return false;
  const cue = cues.find((c) => c.id === decision.cueIds[0]);
  if (!cue) return false;
  if (!isMultiWord(cue)) return false;
  const q = decision.evidenceQuote;
  const quoted =
    q.length >= 2 &&
    ((q.startsWith('"') && q.endsWith('"')) ||
      (q.startsWith("'") && q.endsWith("'")));
  if (!quoted || q.slice(1, -1) !== cue.text.trim()) return false;
  // Single-cue anchor span must stay within the normal ~25s limit.
  if (!(cue.end > cue.start) || cue.end - cue.start > 25) return false;
  return true;
}

/**
 * True when a project has used too many context anchors and should be
 * flagged for review instead of passing silently.
 */
export function contextAnchorBudgetExceeded(
  usedCount: number,
  totalSegments: number,
): boolean {
  if (usedCount > MAX_CONTEXT_ANCHORS_PER_PROJECT) return true;
  return false; // The caller must count both languages together.
}