/**
 * Audit tooling (local only): a TCP proxy in front of the LOCAL Postgres that counts what the
 * app sends, without touching application code.
 *
 *   node scripts/audit/pg-wire-probe.mjs <listenPort> <targetPort> <controlPort> [delayMs]
 *
 * - Point the app's DATABASE_URL at 127.0.0.1:<listenPort> (same credentials, same database).
 * - GET http://127.0.0.1:<controlPort>/reset  → zero the counters
 * - GET http://127.0.0.1:<controlPort>/stats  → { roundTrips, statements: { sql: count }, simple }
 *
 * Counts frontend messages of the PostgreSQL wire protocol (v3): every Sync ('S') or simple
 * Query ('Q') is one client round trip; every Parse ('P') records its SQL text (literal
 * parameters are never part of it). Bind values are not read or stored. Optionally adds a
 * round-trip delay (a reply is released no earlier than `delayMs` after the app's latest request
 * on that connection). Only connects to 127.0.0.1.
 */
import http from "node:http";
import net from "node:net";

const [listenPort, targetPort, controlPort, delayArg] = process.argv.slice(2).map(Number);
if (!listenPort || !targetPort || !controlPort) {
  throw new Error("usage: pg-wire-probe.mjs <listenPort> <targetPort> <controlPort> [delayMs]");
}
const delayMs = Number.isFinite(delayArg) ? delayArg : 0;

let stats = { roundTrips: 0, simple: 0, statements: {} };
const reset = () => (stats = { roundTrips: 0, simple: 0, statements: {} });

/** Incremental parser of the client→server stream (startup packet first, then typed messages). */
function clientParser() {
  let buf = Buffer.alloc(0);
  let started = false;
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (!started) {
        if (buf.length < 8) return;
        const len = buf.readInt32BE(0);
        if (buf.length < len) return;
        const code = buf.readInt32BE(4);
        buf = buf.subarray(len);
        // SSLRequest / GSSENCRequest are followed by another untyped startup packet.
        if (code !== 80877103 && code !== 80877104) started = true;
        continue;
      }
      if (buf.length < 5) return;
      const type = String.fromCharCode(buf[0]);
      const len = buf.readInt32BE(1);
      if (buf.length < 1 + len) return;
      const body = buf.subarray(5, 1 + len);
      if (type === "P") {
        // Parse: statement name (cstring), query (cstring), …
        const nameEnd = body.indexOf(0);
        const qEnd = body.indexOf(0, nameEnd + 1);
        const sql = body
          .subarray(nameEnd + 1, qEnd)
          .toString("utf8")
          .replace(/\s+/g, " ")
          .trim();
        stats.statements[sql] = (stats.statements[sql] ?? 0) + 1;
      } else if (type === "S") {
        stats.roundTrips++;
      } else if (type === "Q") {
        stats.roundTrips++;
        stats.simple++;
        const sql = body.subarray(0, body.indexOf(0)).toString("utf8").replace(/\s+/g, " ").trim();
        stats.statements[`[simple] ${sql}`] = (stats.statements[`[simple] ${sql}`] ?? 0) + 1;
      }
      buf = buf.subarray(1 + len);
    }
  };
}

net
  .createServer((client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    const parse = clientParser();
    // RTT model: a reply cannot reach the app before (last request sent + delay). Chunks of one
    // reply share that release time, so a large result is not penalised per TCP chunk.
    let chain = Promise.resolve();
    let releaseAt = 0;
    client.on("data", (chunk) => {
      parse(chunk);
      releaseAt = Date.now() + delayMs;
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      if (!delayMs) return void client.write(chunk);
      const at = releaseAt;
      chain = chain
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, at - Date.now()))))
        .then(() => void client.write(chunk));
    });
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    for (const s of [client, upstream]) {
      s.on("error", close);
      s.on("close", close);
    }
  })
  .listen(listenPort, "127.0.0.1");

http
  .createServer((req, res) => {
    if (req.url === "/reset") reset();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(stats));
  })
  .listen(controlPort, "127.0.0.1", () =>
    console.log(
      `pg-wire-probe :${listenPort} → :${targetPort} control :${controlPort} delay ${delayMs}ms`,
    ),
  );
