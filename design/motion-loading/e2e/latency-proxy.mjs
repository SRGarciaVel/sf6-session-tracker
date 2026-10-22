/**
 * Local TCP proxy that adds latency in front of the LOCAL Postgres, to reproduce a slow database
 * (e.g. a cold Supabase pooler) without touching application code. Dev/QA only.
 *
 *   node design/motion-loading/e2e/latency-proxy.mjs <listenPort> <targetPort> <delayMs>
 *
 * Every chunk the database sends back is delayed by <delayMs> (order preserved), so each query
 * round trip costs at least that much. Refuses anything but 127.0.0.1 targets.
 */
import net from "node:net";

const [listenPort, targetPort, delayMs] = process.argv.slice(2).map(Number);
if (!listenPort || !targetPort || Number.isNaN(delayMs)) {
  throw new Error("usage: latency-proxy.mjs <listenPort> <targetPort> <delayMs>");
}
net
  .createServer((client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    let chain = Promise.resolve();
    upstream.on("data", (chunk) => {
      chain = chain
        .then(() => new Promise((r) => setTimeout(r, delayMs)))
        .then(() => void client.write(chunk));
    });
    client.on("data", (chunk) => upstream.write(chunk));
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", close);
    upstream.on("close", close);
  })
  .listen(listenPort, "127.0.0.1", () =>
    console.log(`latency proxy 127.0.0.1:${listenPort} → :${targetPort} (+${delayMs} ms)`),
  );
