/**
 * Intentional pagination of the review report (Phase 6.4B). Priorities are capped at 3, so each
 * count has a designed layout instead of free flowing text (blocks are also `wrap={false}`, so a
 * priority is never split across pages):
 *
 *   1 signal   1 cover + snapshot · 2 priority 01 · 3 worksheet + notes + methodology
 *   2 signals  1 cover + snapshot · 2 priorities 01–02 · 3 worksheet + notes + methodology
 *   3 signals  1 cover + snapshot · 2 priorities 01–02 · 3 priority 03 + worksheet
 *              4 notes + methodology
 */
export type ReportBlock =
  | { kind: "cover" }
  | { kind: "priority"; index: number }
  | { kind: "worksheet" }
  | { kind: "notes"; lines: number }
  | { kind: "methodology" };

export function planReportPages(priorityCount: number): ReportBlock[][] {
  const p = (index: number): ReportBlock => ({ kind: "priority", index });
  const cover: ReportBlock[] = [{ kind: "cover" }];
  if (priorityCount <= 0) return [cover];
  if (priorityCount === 1) {
    return [
      cover,
      [p(0)],
      [{ kind: "worksheet" }, { kind: "notes", lines: 6 }, { kind: "methodology" }],
    ];
  }
  if (priorityCount === 2) {
    return [
      cover,
      [p(0), p(1)],
      [{ kind: "worksheet" }, { kind: "notes", lines: 5 }, { kind: "methodology" }],
    ];
  }
  return [
    cover,
    [p(0), p(1)],
    [p(2), { kind: "worksheet" }],
    [{ kind: "notes", lines: 12 }, { kind: "methodology" }],
  ];
}
