/**
 * Tests for context-anchor-fallback.ts.
 *
 * Each test rebuilds one of the real 2026-11-10 failure shapes with small
 * synthetic SRT data and checks the fallback behaves the way the backend
 * needs it to. Run:  node context-anchor-fallback.test.ts
 */
import assert from "node:assert/strict";
import {
  findContextAnchor,
  isAcceptableContextDecision,
  contextAnchorBudgetExceeded,
} from "./context-anchor-fallback.ts";
import type { SrcCue } from "./context-anchor-fallback.ts";

function makeCues(
  fromId: number,
  toId: number,
  startAt: number,
  step: number,
  overrides: Record<number, string> = {},
): SrcCue[] {
  const cues: SrcCue[] = [];
  for (let id = fromId; id <= toId; id++) {
    const start = startAt + (id - fromId) * step;
    cues.push({
      id,
      start,
      end: start + 1.8,
      text: overrides[id] ?? `Subtitle line number ${id} with some words here`,
    });
  }
  return cues;
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// --- Test 1: Shrek 2 shape -----------------------------------------------
// Segment 81's only literal cue 489 was already accepted by segment 80
// (batch 16, cues 487-491). Neighbours 80 and 82 are anchored. The
// fallback must pick a FREE cue near the expected time, never cue 489.
check("Shrek 2: blocked seg 81 gets a free nearby cue, never cue 489", () => {
  const cues = makeCues(480, 500, 1900, 2, {
    489: "I know it would mean the world to Fiona.",
  });
  const t = (id: number): number => cues.find((c) => c.id === id)!.start;
  const d = findContextAnchor({
    segmentIndex: 81,
    segmentCount: 94,
    cues,
    accepted: [
      { segmentIndex: 79, cueIds: [485] },
      { segmentIndex: 80, cueIds: [487, 488, 489, 490, 491] },
      { segmentIndex: 82, cueIds: [495] },
    ],
    anchorTimeBySegment: new Map([
      [79, t(485)],
      [80, t(489)],
      [82, t(495)],
    ]),
  });
  assert.ok(d, "expected a decision");
  // Expected time is the midpoint of cues 489 (1918) and 495 (1930) = 1924,
  // which is exactly cue 492's start — the nearest free cue.
  assert.equal(d!.cueIds[0], 492);
  assert.equal(d!.anchorMethod, "context");
  assert.equal(d!.contextRadiusSegments, 5);
  assert.ok(isAcceptableContextDecision(d!, cues));
});

// --- Test 2: Prestige 115 shape (no literal cue at all) -----------------
// Segment 115 ("The promise is on.") has no matching cue anywhere.
// The fallback must still find the nearest free cue from its context.
check("Prestige 115: no-cue segment still gets a context anchor", () => {
  const cues = makeCues(1100, 1120, 3000, 2);
  const t = (id: number): number => cues.find((c) => c.id === id)!.start;
  const d = findContextAnchor({
    segmentIndex: 115,
    segmentCount: 161,
    cues,
    accepted: [
      { segmentIndex: 114, cueIds: [1100] },
      { segmentIndex: 116, cueIds: [1110] },
    ],
    anchorTimeBySegment: new Map([
      [114, t(1100)],
      [116, t(1110)],
    ]),
  });
  assert.ok(d, "expected a decision");
  assert.equal(d!.cueIds[0], 1105); // midpoint of 3000 and 3020
  assert.ok(isAcceptableContextDecision(d!, cues));
});

// --- Test 3: never reuse, even when the nearest cue is taken ------------
// The cue closest to the expected time is already used; the fallback must
// skip it and take the next nearest FREE cue.
check("nearest cue is used -> skips to next nearest free cue", () => {
  const cues = makeCues(1, 10, 90, 2);
  const d = findContextAnchor({
    segmentIndex: 5,
    segmentCount: 20,
    cues,
    accepted: [
      { segmentIndex: 4, cueIds: [5] }, // cue 5 sits at t=98
      { segmentIndex: 6, cueIds: [7] }, // cue 7 sits at t=104
    ],
    anchorTimeBySegment: new Map([
      [4, 98],
      [6, 104],
    ]),
  });
  assert.ok(d, "expected a decision");
  // Expected time is 101; the nearest cue (6, t=100) is free, while the
  // cues either side of it (5 and 7) are already used.
  assert.equal(d!.cueIds[0], 6);
  assert.ok(![5, 7].includes(d!.cueIds[0]));
});

// --- Test 4: expansion ----------------------------------------------------
// Radius 5 has no free cue left; radius 10 does. The fallback must widen
// the area and report the radius that worked.
check("radius 5 empty -> expands to radius 10", () => {
  const cues = makeCues(1, 40, 0, 2);
  // Every cue is already used except cue 34 (t=66).
  const allBut34 = cues.filter((c) => c.id !== 34).map((c) => c.id);
  const d = findContextAnchor({
    segmentIndex: 15,
    segmentCount: 30,
    cues,
    accepted: [
      { segmentIndex: 10, cueIds: [21] }, // t=40
      { segmentIndex: 20, cueIds: [31] }, // t=60
      { segmentIndex: 25, cueIds: [35] }, // t=68
      { segmentIndex: 0, cueIds: allBut34 },
    ],
    anchorTimeBySegment: new Map([
      [10, 40],
      [20, 60],
      [25, 68],
    ]),
  });
  assert.ok(d, "expected a decision");
  assert.equal(d!.cueIds[0], 34);
  assert.equal(d!.contextRadiusSegments, 10);
});

// --- Test 5: validator hook ----------------------------------------------
check("validator hook accepts good context decisions, rejects bad ones", () => {
  const cues = makeCues(1, 5, 10, 2);
  const good = findContextAnchor({
    segmentIndex: 2,
    segmentCount: 10,
    cues,
    accepted: [
      { segmentIndex: 1, cueIds: [1] },
      { segmentIndex: 3, cueIds: [5] },
    ],
    anchorTimeBySegment: new Map([
      [1, 10],
      [3, 18],
    ]),
  });
  assert.ok(good && isAcceptableContextDecision(good, cues));
  // Fabricated cue id.
  assert.equal(
    isAcceptableContextDecision({ ...good!, cueIds: [999] }, cues),
    false,
  );
  // Quote that does not match the cited cue's text.
  assert.equal(
    isAcceptableContextDecision(
      { ...good!, evidenceQuote: '"words that are not in the cue"' },
      cues,
    ),
    false,
  );
  // Not labelled as a context decision.
  assert.equal(
    isAcceptableContextDecision(
      { ...good!, anchorMethod: "literal" as never },
      cues,
    ),
    false,
  );
});

// --- Test 6: deterministic -------------------------------------------------
check("same input twice -> same anchor", () => {
  const cues = makeCues(480, 500, 1900, 2);
  const args = {
    segmentIndex: 81,
    segmentCount: 94,
    cues,
    accepted: [{ segmentIndex: 80, cueIds: [489] }],
    anchorTimeBySegment: new Map([
      [80, 1918],
      [82, 1930],
    ]),
  };
  assert.deepEqual(findContextAnchor(args), findContextAnchor(args));
});

// --- Test 7: nothing free anywhere -> null --------------------------------
check("no free cue anywhere -> null (stays needs_review)", () => {
  const cues = makeCues(1, 5, 10, 2);
  const d = findContextAnchor({
    segmentIndex: 2,
    segmentCount: 10,
    cues,
    accepted: [{ segmentIndex: 0, cueIds: [1, 2, 3, 4, 5] }],
    anchorTimeBySegment: new Map([[1, 12]]),
  });
  assert.equal(d, null);
});

// --- Test 8: safety cap ----------------------------------------------------
check("budget: at most three context anchors per movie", () => {
  assert.equal(contextAnchorBudgetExceeded(2, 300), false);
  assert.equal(contextAnchorBudgetExceeded(3, 300), false);
  assert.equal(contextAnchorBudgetExceeded(4, 300), true);
  assert.equal(contextAnchorBudgetExceeded(16, 300), true);
});

console.log(`\n${passed} tests passed.`);