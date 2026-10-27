"use client";

/**
 * PROTOTYPE — the OBS Browser Source side: reads the dock's image from IndexedDB and shows it
 * through its OWN object URL (revoked on change / unmount). It re-reads when the dock announces
 * a change (BroadcastChannel), when the page becomes visible again, and on load. Transparent and
 * silent unless `?debug=1`: an empty or failed state draws nothing over the stream.
 */
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  LocalPortraitError,
  loadLocalPortrait,
  onLocalPortraitChange,
  type LocalPortraitRecord,
} from "@/lib/local-portrait/store";
import "./local-portrait-source.css";

type State = "loading" | "image" | "empty" | "error";

export function LocalPortraitSource({
  debug,
  labels,
  factory,
}: {
  debug: boolean;
  labels: Record<"empty" | "loading" | "error", string>;
  /** Tests inject an IndexedDB implementation; the page uses the browser's. */
  factory?: IDBFactory;
}) {
  const [record, setRecord] = useState<LocalPortraitRecord | null>(null);
  const [state, setState] = useState<State>("loading");
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () =>
      loadLocalPortrait({ factory }).then(
        (saved) => {
          if (!alive) return;
          setRecord(saved);
          setState(saved ? "image" : "empty");
          setErrorCode(null);
        },
        (error: unknown) => {
          if (!alive) return;
          setRecord(null);
          setState("error");
          setErrorCode(error instanceof LocalPortraitError ? error.code : "failed");
        },
      );
    void read();
    const stop = onLocalPortraitChange(() => void read());
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [factory]);

  const url = useMemo(() => (record ? URL.createObjectURL(record.blob) : null), [record]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  return (
    <div className="lp-source" data-state={state} data-error={errorCode ?? undefined}>
      {url && record ? (
        <Image
          unoptimized
          className="lp-image"
          src={url}
          alt=""
          width={record.width}
          height={record.height}
        />
      ) : debug ? (
        <span className="lp-debug">{labels[state === "image" ? "loading" : state]}</span>
      ) : null}
    </div>
  );
}
