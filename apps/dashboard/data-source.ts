import {
  dashboardEventSchema,
  parseDashboardRun,
  type DashboardEvent,
  type DashboardRun,
} from "@framelia/contracts";
import { onBeforeUnmount, onMounted, ref } from "vue";

import { dashboardHost, reportBase } from "./lib/dashboard-host";

const STATIC_RUN_FILE = "data/selected-run.json";
const EVENTSOURCE_CLOSED = 2;

/** Resolves a static-report data path against the directory index.html was loaded from. */
export function staticDataUrl(relativePath: string, base: string | undefined = reportBase) {
  return base ? new URL(relativePath, base).href : `./${relativePath}`;
}

/**
 * The one place a DashboardRun enters this app. Parsing here rather than casting means a
 * server on a different projection version surfaces as a readable error (a format-version
 * hint, or `path: message` lines) instead of a property access on `undefined` deep in a
 * component.
 */
async function fetchRun(url: string): Promise<DashboardRun> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  const payload: unknown = await response.json();
  const parsed = parseDashboardRun(payload);
  if (!parsed.success) throw new Error(`${url}: run payload rejected\n${parsed.error}`);
  // Validated for shape, then handed back as the richer interface: the schema deliberately
  // leaves each contract's optional evidence detail loose (see dashboard/wire.ts).
  return payload as DashboardRun;
}

/**
 * What a live event means for the run on screen. The server serves exactly one run, so
 * an event (including the `sync` frame sent on every (re)connect) naming a different run
 * means the served run changed -- e.g. a re-run on the same port -- and the page must
 * reload it right away rather than ignore it.
 */
export function runEventAction(
  currentRunId: string | undefined,
  event: DashboardEvent,
): "reload" | "refresh" {
  return event.runId === currentRunId ? "refresh" : "reload";
}

export type LiveConnectionState = "connecting" | "open" | "reconnecting";

/** 1s, 2s, 4s, … capped at 30s. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

export interface RunEventsOptions {
  onEvent: (event: DashboardEvent) => void;
  onStateChange?: (state: LiveConnectionState) => void;
  url?: string;
  EventSourceCtor?: typeof EventSource;
  delay?: (attempt: number) => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Keeps one `/events` stream open for as long as the page is. The browser retries a
 * dropped connection by itself; when it gives up (`readyState === CLOSED`, e.g. the
 * server was down when it retried) this reconnects with backoff, so a finished-then-re-run
 * Reporter on the same port is picked up again. Every state change is reported, so the
 * header can stop claiming "Live" while the stream is down.
 */
export function connectRunEvents(options: RunEventsOptions): { close: () => void } {
  const Ctor = options.EventSourceCtor ?? EventSource;
  const delay = options.delay ?? reconnectDelayMs;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let source: EventSource | undefined;
  let timer: unknown;
  let attempt = 0;
  let closed = false;

  const setState = (state: LiveConnectionState) => options.onStateChange?.(state);

  function open(): void {
    const events = new Ctor(options.url ?? "/events");
    source = events;
    events.addEventListener("open", () => {
      attempt = 0;
      setState("open");
    });
    events.addEventListener("run", (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse((event as MessageEvent<string>).data);
      } catch {
        return;
      }
      const parsed = dashboardEventSchema.safeParse(payload);
      if (parsed.success) options.onEvent(parsed.data);
    });
    events.addEventListener("error", () => {
      if (closed || source !== events) return;
      setState("reconnecting");
      if (events.readyState !== EVENTSOURCE_CLOSED) return;
      events.close();
      timer = setTimer(open, delay(attempt));
      attempt += 1;
    });
  }

  setState("connecting");
  open();
  return {
    close: () => {
      closed = true;
      if (timer !== undefined) clearTimer(timer);
      source?.close();
    },
  };
}

/**
 * Coalesces bursts of refresh requests (one live event per finished test) into one fetch
 * after `delayMs` of quiet; a request arriving while a fetch is in flight schedules
 * exactly one follow-up instead of piling up.
 */
export function coalesce(task: () => Promise<void>, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let pending = false;

  async function run(): Promise<void> {
    timer = undefined;
    if (running) {
      pending = true;
      return;
    }
    running = task().finally(() => {
      running = undefined;
      if (pending) {
        pending = false;
        schedule();
      }
    });
    await running;
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void run(), delayMs);
  }

  return {
    schedule,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = false;
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useRunArtifact() {
  const run = ref<DashboardRun>();
  const loading = ref(true);
  /** Blocking: nothing could be loaded at all. */
  const error = ref<string>();
  /** Non-blocking: the last good run stays on screen while this is shown. */
  const refreshError = ref<string>();
  const staticMode = ref(dashboardHost === "static");
  const liveMode = ref(false);
  const mockMode = ref(false);
  const connection = ref<LiveConnectionState>();
  let events: { close: () => void } | undefined;
  // Bumped on every refresh() call so a slower, earlier-started fetch can detect
  // it's been superseded and drop its result instead of overwriting a newer one.
  let refreshToken = 0;

  function adopt(result: DashboardRun): void {
    run.value = result;
    error.value = undefined;
    refreshError.value = undefined;
  }

  async function refresh() {
    const token = ++refreshToken;
    try {
      const result = await fetchRun(staticMode.value ? staticDataUrl(STATIC_RUN_FILE) : "/api/run");
      if (token === refreshToken) adopt(result);
    } catch (liveError) {
      if (!staticMode.value && !run.value) {
        // A served page whose API is missing may still be a report directory served by
        // some other static server: try its data file before giving up.
        try {
          const result = await fetchRun(staticDataUrl(STATIC_RUN_FILE));
          if (token !== refreshToken) return;
          staticMode.value = true;
          adopt(result);
          events?.close();
          return;
        } catch {
          // Report the live error below.
        }
      }
      if (token !== refreshToken) return;
      if (run.value) refreshError.value = message(liveError);
      else error.value = message(liveError);
    } finally {
      if (token === refreshToken) loading.value = false;
    }
  }

  const scheduled = coalesce(refresh, 150);

  function onRunEvent(event: DashboardEvent): void {
    if (runEventAction(run.value?.runId, event) === "reload") {
      scheduled.cancel();
      void refresh();
    } else scheduled.schedule();
  }

  /**
   * Builds an artifact URL, appending the evidence digest as `?v=` when known: artifact
   * names are reused across retries and re-runs, so the digest is what tells the browser
   * a same-named image is new content.
   */
  function artifactUrl(relativePath: string | undefined, hash?: string): string {
    if (!relativePath) return "";
    const segments = relativePath.split("/");
    const isSafe = segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
    if (!isSafe) return "";
    const encoded = segments.map(encodeURIComponent).join("/");
    const url = staticMode.value ? staticDataUrl(`data/${encoded}`) : `/artifacts/${encoded}`;
    return hash ? `${url}?v=${encodeURIComponent(hash)}` : url;
  }

  onMounted(async () => {
    await refresh();
    if (staticMode.value) return;
    try {
      const response = await fetch("/api/meta", { cache: "no-store" });
      const meta = response.ok
        ? ((await response.json()) as { live: boolean; mock?: boolean })
        : undefined;
      liveMode.value = meta?.live ?? false;
      mockMode.value = meta?.mock ?? false;
    } catch {
      liveMode.value = false;
    }
    if (!liveMode.value) return;
    events = connectRunEvents({
      onEvent: onRunEvent,
      onStateChange: (state) => (connection.value = state),
    });
  });

  onBeforeUnmount(() => {
    scheduled.cancel();
    events?.close();
  });

  return {
    run,
    loading,
    error,
    refreshError,
    staticMode,
    liveMode,
    mockMode,
    connection,
    refresh,
    artifactUrl,
  };
}
