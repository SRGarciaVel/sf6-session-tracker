/** Server-Sent Events response helper for route handlers. */

export interface SseContext {
  send(event: string, data: unknown): void;
  close(): void;
}

type Cleanup = () => void | Promise<void>;

export const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  // Disable proxy buffering (nginx & friends) so events flush immediately.
  "X-Accel-Buffering": "no",
};

/**
 * Create a streaming SSE response. `setup` runs once the stream is open and returns a cleanup
 * function, called exactly once when the client disconnects or the server closes the stream.
 */
export function sseResponse(
  signal: AbortSignal,
  setup: (ctx: SseContext) => Promise<Cleanup>,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: Cleanup | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const finish = async () => {
    if (closed) return;
    closed = true;
    try {
      await cleanup?.();
    } catch {
      // cleanup errors must not crash the server
    }
    try {
      controllerRef?.close();
    } catch {
      // already closed
    }
  };

  const ctx: SseContext = {
    send(event, data) {
      if (closed || !controllerRef) return;
      try {
        controllerRef.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        void finish();
      }
    },
    close() {
      void finish();
    },
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      // Ask EventSource to reconnect after 3s if the connection drops.
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      signal.addEventListener("abort", () => void finish(), { once: true });
      try {
        const fn = await setup(ctx);
        if (closed) await fn();
        else cleanup = fn;
      } catch {
        ctx.send("error", { message: "stream setup failed" });
        await finish();
      }
      if (signal.aborted) await finish();
    },
    cancel() {
      void finish();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
