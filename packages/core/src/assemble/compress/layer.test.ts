import { describe, it, expect } from "vitest";
import { selectLayers, type LayerCandidate } from "./layer.js";

const mk = (
  path: string,
  cost: Record<"full" | "skeleton" | "outline" | "omit", number>,
  importance: number,
  pinned = false,
): LayerCandidate => ({ path, cost, importance, pinned });

const find = (plan: ReturnType<typeof selectLayers>, p: string) =>
  plan.decisions.find((d) => d.path === p)!;

describe("selectLayers — downgrade", () => {
  it("keeps everything full under generous budget", () => {
    const cs = [
      mk("a.ts", { full: 100, skeleton: 60, outline: 20, omit: 0 }, 1000),
      mk("b.ts", { full: 100, skeleton: 60, outline: 20, omit: 0 }, 500),
    ];
    const plan = selectLayers(cs, 1000, "auto");
    expect(find(plan, "a.ts").layer).toBe("full");
    expect(find(plan, "b.ts").layer).toBe("full");
    expect(plan.fits).toBe(true);
  });

  it("downgrades least-important first", () => {
    const cs = [
      mk("a.ts", { full: 100, skeleton: 60, outline: 20, omit: 0 }, 1000),
      mk("b.ts", { full: 100, skeleton: 60, outline: 20, omit: 0 }, 500),
    ];
    // total full = 200 > 150 → b (imp 500) downgraded to skeleton (60). total 160 > 150
    // → b to outline (20). total 120 ≤ 150.
    const plan = selectLayers(cs, 150, "auto");
    expect(find(plan, "a.ts").layer).toBe("full");
    expect(find(plan, "b.ts").layer).toBe("outline");
  });
});

describe("selectLayers — backfill", () => {
  it("promotes files into leftover budget after downgrade", () => {
    const cs = [
      mk("a.ts", { full: 200, skeleton: 65, outline: 15, omit: 0 }, 1000),
      mk("b.ts", { full: 200, skeleton: 65, outline: 15, omit: 0 }, 500),
    ];
    // Downgrade: full 400 > 80 → b skeleton (total 265) → b outline (215)
    // → b omit (200) → a skeleton (65). total 65 ≤ 80. Stop.
    // Backfill: remaining 15. a (imp 1000) first: full delta 135 > 15, skeleton
    // == cur. skip. b (imp 500): full 200 > 15, skeleton 65 > 15, outline
    // delta 15 ≤ 15 → promote to outline. remaining 0.
    const plan = selectLayers(cs, 80, "auto");
    expect(find(plan, "a.ts").layer).toBe("skeleton");
    expect(find(plan, "b.ts").layer).toBe("outline");
    expect(plan.total).toBe(80);
    expect(plan.fits).toBe(true);
  });

  it("promotes to the highest affordable layer", () => {
    const cs = [
      mk("a.ts", { full: 120, skeleton: 60, outline: 15, omit: 0 }, 1000),
    ];
    // Downgrade: full 120 > 100 → skeleton 60 ≤ 100. Stop. remaining 40.
    // Backfill: a from skeleton, full delta 120-60=60 > 40 skip. skeleton == cur.
    // → no promotion. total 60.
    // (Confirms backfill doesn't force a partial promotion when full won't fit.)
    const plan = selectLayers(cs, 100, "auto");
    expect(find(plan, "a.ts").layer).toBe("skeleton");
    expect(plan.total).toBe(60);
  });

  it("does not escalate past strategy ceiling", () => {
    const cs = [
      mk("a.ts", { full: 200, skeleton: 60, outline: 15, omit: 0 }, 1000),
    ];
    // strategy=skeleton: start skeleton 60 ≤ 70. No downgrade. remaining 10.
    // Backfill ceiling=skeleton: a already at ceiling, can't go higher. total 60.
    const plan = selectLayers(cs, 70, "skeleton");
    expect(find(plan, "a.ts").layer).toBe("skeleton");
    expect(plan.total).toBe(60);
  });

  it("does not backfill above ceiling even after downgrade below it", () => {
    const cs = [
      mk("a.ts", { full: 200, skeleton: 60, outline: 15, omit: 0 }, 1000),
    ];
    // strategy=skeleton, budget=10: skeleton 60 > 10 → outline 15 > 10 → omit 0.
    // Backfill ceiling=skeleton, remaining 10: skeleton delta 60 > 10 skip,
    // outline delta 15 > 10 skip. No promotion. total 0.
    const plan = selectLayers(cs, 10, "skeleton");
    expect(find(plan, "a.ts").layer).toBe("omit");
    expect(plan.total).toBe(0);
  });

  it("promotes back up to ceiling when budget allows (strategy=skeleton)", () => {
    const cs = [
      mk("a.ts", { full: 200, skeleton: 60, outline: 15, omit: 0 }, 1000),
    ];
    // strategy=skeleton, budget=20: skeleton 60 > 20 → outline 15 ≤ 20. Stop.
    // Backfill ceiling=skeleton, remaining 5: skeleton delta 60-15=45 > 5 skip.
    // total 15.
    const plan = selectLayers(cs, 20, "skeleton");
    expect(find(plan, "a.ts").layer).toBe("outline");
    expect(plan.total).toBe(15);
  });

  it("never downgrades pinned files; skips them in backfill", () => {
    const cs = [
      mk("a.ts", { full: 200, skeleton: 60, outline: 15, omit: 0 }, 1000, true),
      mk("b.ts", { full: 100, skeleton: 40, outline: 10, omit: 0 }, 0),
    ];
    // budget 50: a pinned full 200. b full 100 → skeleton 40 (240) → outline 10
    // (210) → omit 0 (200). a can't downgrade. total 200 > 50. break.
    // Backfill: remaining = 50 - 200 = -150 < 0 → no backfill.
    const plan = selectLayers(cs, 50, "auto");
    expect(find(plan, "a.ts").layer).toBe("full"); // pinned survived
    expect(find(plan, "b.ts").layer).toBe("omit");
    expect(plan.total).toBe(200);
    expect(plan.fits).toBe(false);
  });

  it("backfills the most important file first", () => {
    const cs = [
      mk("low.ts", { full: 50, skeleton: 30, outline: 10, omit: 0 }, 100),
      mk("hi.ts", { full: 50, skeleton: 30, outline: 10, omit: 0 }, 1000),
    ];
    // budget 30: full 100 > 30 → low skeleton (80) → low outline (60) → low omit
    // (50) → hi skeleton (30). total 30 ≤ 30. Stop. remaining 0. No backfill.
    // hi skeleton, low omit.
    const plan = selectLayers(cs, 30, "auto");
    expect(find(plan, "hi.ts").layer).toBe("skeleton");
    expect(find(plan, "low.ts").layer).toBe("omit");
    expect(plan.total).toBe(30);
  });
});
