/**
 * Query plans on a synthetic, multi-tenant dataset (LOCAL ONLY; refuses any non-loopback DB).
 *
 *   pnpm exec tsx scripts/audit/explain.mts
 *
 * Creates (then deletes) fictitious `@test.local` accounts:
 *   - target: 1 player, 400 sessions, 20 000 matches over ~1 year, 20 rated characters;
 *   - noise:  100 players × 2 000 matches (other tenants sharing the tables).
 * Runs EXPLAIN (ANALYZE, BUFFERS) on the statements the app actually sends (captured with
 * scripts/audit/pg-wire-probe.mjs) and writes docs/audit/2026-10-22-evidence/explain.json. Writes inside a
 * transaction are rolled back.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

process.loadEnvFile(".env");
const url = process.env.DATABASE_URL ?? "";
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)) {
  throw new Error("REFUSING: non-local database");
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const users: string[] = [];

async function makePlayer(tag: string) {
  const userId = randomUUID();
  users.push(userId);
  await sql`insert into auth_user (id, name, email) values (${userId}, ${tag}, ${`${userId}@test.local`})`;
  const [p] = await sql<{ id: string }[]>`
    insert into sf6_player (user_id, cfn_user_id, display_name)
    values (${userId}, ${`9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`}, ${tag})
    returning id`;
  return { userId, playerId: p!.id };
}

/** n sessions × perSession matches, newest last; returns the 10 newest session ids. */
async function fill(playerId: string, sessions: number, perSession: number) {
  await sql`
    insert into game_session (player_id, status, started_at, ended_at, filter, rating_model)
    select ${playerId}, 'ended', now() - (g || ' hours')::interval * 20,
           now() - (g || ' hours')::interval * 20 + interval '2 hours',
           '{"modes":["ranked"]}'::jsonb, 'per_character'
      from generate_series(1, ${sessions}) g`;
  await sql`
    insert into match (player_id, session_id, external_match_id, played_at, mode, result,
                       player_character, character_key, opponent_name, opponent_character,
                       opponent_character_key, opponent_rank)
    select ${playerId}, s.id, md5(s.id::text || k), s.started_at + (k || ' minutes')::interval,
           case when k % 5 = 0 then 'casual' else 'ranked' end,
           case when k % 3 = 0 then 'loss' else 'win' end,
           'Ryu', case when k % 4 = 0 then 'jamie' else 'ryu' end, 'Rival', 'Ken', 'ken', 'Master'
      from game_session s, generate_series(1, ${perSession}) k
     where s.player_id = ${playerId}`;
  await sql`
    insert into player_character_rating (player_id, character_key, character_name, rating_system,
                                         master_rate, observed_at)
    select ${playerId}, 'c' || g, 'C' || g, 'mr', 1500 + g, now() from generate_series(1, 20) g`;
  return (
    await sql<{ id: string }[]>`select id from game_session where player_id = ${playerId}
      order by started_at desc limit 10`
  ).map((r) => r.id);
}

async function explain(label: string, text: string, params: unknown[] = []) {
  const rows = await sql.unsafe(`explain (analyze, buffers, format json) ${text}`, params as never);
  const plan = (rows[0] as unknown as { "QUERY PLAN": Array<Record<string, unknown>> })[
    "QUERY PLAN"
  ][0]!;
  const top = plan.Plan as Record<string, unknown>;
  const nodes: string[] = [];
  const walk = (n: Record<string, unknown>, d = 0) => {
    nodes.push(
      `${"  ".repeat(d)}${n["Node Type"]}${n["Index Name"] ? ` (${n["Index Name"]})` : ""}${n["Relation Name"] ? ` on ${n["Relation Name"]}` : ""} rows=${n["Actual Rows"]} loops=${n["Actual Loops"]}`,
    );
    for (const c of (n.Plans as Record<string, unknown>[] | undefined) ?? []) walk(c, d + 1);
  };
  walk(top);
  return {
    label,
    executionMs: plan["Execution Time"],
    planningMs: plan["Planning Time"],
    sharedHit: top["Shared Hit Blocks"],
    sharedRead: top["Shared Read Blocks"],
    rows: top["Actual Rows"],
    plan: nodes,
  };
}

const t0 = Date.now();
try {
  const target = await makePlayer("audit-target");
  const latest = await fill(target.playerId, 400, 50);
  for (let i = 0; i < 100; i++) {
    const n = await makePlayer(`audit-noise-${i}`);
    await fill(n.playerId, 40, 50);
  }
  await sql`analyze match`;
  await sql`analyze game_session`;
  const counts = (await sql<{ n: string }[]>`select count(*)::text n from match`)[0]!.n;
  console.log(`dataset ready in ${Date.now() - t0} ms; match rows: ${counts}`);

  const P = target.playerId;
  const since = new Date(Date.now() - 90 * 86_400_000);
  const results = [];
  results.push(
    await explain(
      "dashboard history: full rows of the 10 latest sessions' matches",
      `select * from match where session_id = any($1::uuid[])`,
      [latest],
    ),
  );
  results.push(
    await explain(
      "dashboard: 10 latest sessions",
      `select * from game_session where player_id = $1 order by started_at desc limit 10`,
      [P],
    ),
  );
  results.push(
    await explain(
      "recap / LIVE recent: one session's matches",
      `select id, external_match_id, played_at, mode, result, character_key, player_character, opponent_character, opponent_name from match where session_id = $1 and player_id = $2`,
      [latest[0], P],
    ),
  );
  results.push(
    await explain(
      "companion state: known replay ids",
      `select external_match_id from match where player_id = $1 order by played_at desc limit 100`,
      [P],
    ),
  );
  results.push(
    await explain(
      "analytics 90 d ranked",
      `select external_match_id, played_at, result, mode, character_key, player_character, session_id, opponent_character_key, opponent_character from match where player_id = $1 and played_at >= $2 and mode = $3 order by played_at desc, external_match_id desc`,
      [P, since, "ranked"],
    ),
  );
  results.push(
    await explain(
      "analytics all-time (every match of the player)",
      `select external_match_id, played_at, result, mode, character_key, player_character, session_id, opponent_character_key, opponent_character from match where player_id = $1 order by played_at desc, external_match_id desc`,
      [P],
    ),
  );
  results.push(
    await explain(
      "analytics: latest character name per key (full scan of the player's matches)",
      `select character_key, (array_agg(player_character order by played_at desc))[1] from match where player_id = $1 group by character_key`,
      [P],
    ),
  );
  results.push(
    await explain(
      "overlay presence count",
      `select count(*) from overlay_connection oc join overlay o on o.id = oc.overlay_id where o.player_id = $1 and oc.last_seen_at > now() - interval '45 seconds'`,
      [P],
    ),
  );
  results.push(
    await explain(
      "worker claim (due players with an active session)",
      `select c.id from sf6_player c where c.next_poll_at is not null and c.next_poll_at <= now() and (c.lease_expires_at is null or c.lease_expires_at < now()) and exists (select 1 from game_session s where s.player_id = c.id and s.status = 'active') order by c.next_poll_at limit 10`,
      [],
    ),
  );
  // Ingestion of 100 matches (50 duplicates) — rolled back.
  await sql
    .begin(async (tx) => {
      const rows = Array.from({ length: 100 }, (_, i) => ({
        player_id: P,
        session_id: latest[0]!,
        external_match_id: i < 50 ? `new-${randomUUID()}` : `dup-${i}`,
        played_at: new Date(),
        mode: "ranked",
        result: "win",
        player_character: "Ryu",
        character_key: "ryu",
      }));
      await tx`insert into match ${tx(rows.slice(50))} on conflict do nothing`;
      const plan = await tx.unsafe(
        `explain (analyze, buffers, format json) insert into match (player_id, session_id, external_match_id, played_at, mode, result, player_character, character_key)
       select player_id, session_id, external_match_id, played_at, mode, result, player_character, character_key
         from json_populate_recordset(null::match, $1::text::json) on conflict (player_id, external_match_id) do nothing`,
        [JSON.stringify(rows)] as never,
      );
      const p = (plan[0] as unknown as { "QUERY PLAN": Array<Record<string, unknown>> })[
        "QUERY PLAN"
      ][0]!;
      results.push({
        label: "ingest: one multi-row insert of 100 (50 duplicates), ON CONFLICT DO NOTHING",
        executionMs: p["Execution Time"],
        planningMs: p["Planning Time"],
        rows: (p.Plan as Record<string, unknown>)["Actual Rows"],
      });
      throw new Error("rollback");
    })
    .catch((e: Error) => {
      if (e.message !== "rollback") throw e;
    });

  writeFileSync(
    "docs/audit/2026-10-22-evidence/explain.json",
    JSON.stringify(
      { ranAt: new Date().toISOString(), matchRows: Number(counts), results },
      null,
      2,
    ),
  );
  for (const r of results) console.log(`${r.label}: ${r.executionMs} ms`);
} finally {
  await sql`delete from auth_user where id in ${sql(users)} and email like '%@test.local'`;
  console.log(`cleaned ${users.length} synthetic accounts`);
}
await sql.end();
