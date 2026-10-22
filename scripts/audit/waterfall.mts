/**
 * Request waterfall depth (LOCAL ONLY). Run against the production build behind
 * pg-wire-probe.mjs started WITH a per-round-trip delay (e.g. 40 ms):
 *   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/waterfall.mts <delayMs>
 * wall time ≈ fixed cost + sequential DB levels × delay, so (wall − wall@0) / delay estimates the
 * number of SEQUENTIAL round trips on the critical path; the probe gives the total.
 */
import { readFileSync, writeFileSync } from "node:fs";

const APP = "http://localhost:3171";
const PROBE = "http://127.0.0.1:5442";
const delay = Number(process.argv[2] ?? "0");
const s = JSON.parse(readFileSync(process.env.AUDIT_STATE ?? "", "utf8")) as {
  accounts: Array<{ cookie: string }>;
  sessions: Record<string, string>;
  overlay: { id: string; token: string };
};
const A = s.accounts[0]!.cookie;
const B = s.accounts[1]!.cookie;
const pages: Array<[string, string, string | undefined]> = [
  ["dashboard Fight Session", "/dashboard", A],
  ["dashboard classic", "/dashboard", B],
  ["analytics", "/dashboard/analytics", A],
  ["recap 30", `/dashboard/sessions/${s.sessions[30]}`, A],
  ["overlay builder", `/dashboard/overlays/${s.overlay.id}`, A],
  ["overlay page (public)", `/overlay/${s.overlay.token}`, undefined],
  ["onboarding", "/onboarding", A],
];
const out: Record<string, unknown> = {};
for (const [name, path, cookie] of pages) {
  const times: number[] = [];
  let rt = 0;
  for (let i = 0; i < 5; i++) {
    await fetch(`${PROBE}/reset`);
    const t0 = performance.now();
    const r = await fetch(`${APP}${path}`, { headers: cookie ? { cookie } : {} });
    await r.arrayBuffer();
    times.push(performance.now() - t0);
    await new Promise((res) => setTimeout(res, 300));
    rt = ((await (await fetch(`${PROBE}/stats`)).json()) as { roundTrips: number }).roundTrips;
  }
  const med = [...times].sort((a, b) => a - b)[2]!;
  out[name] = { medianMs: Math.round(med), roundTrips: rt };
  console.log(name, Math.round(med), "ms", rt, "rt");
}
writeFileSync(
  `docs/audit/2026-10-22-evidence/waterfall-${delay}ms.json`,
  JSON.stringify({ delay, pages: out }, null, 2),
);
