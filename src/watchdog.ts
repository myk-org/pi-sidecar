const CHECK_INTERVAL = 10_000; // 10 seconds
const MAX_FAILURES = 3; // 30 seconds of failures before shutdown

export function startWatchdog(healthUrl: string, onDead: () => void): () => void {
  let consecutiveFailures = 0;
  let stopped = false;
  let dead = false;
  let currentController: AbortController | undefined;
  let currentTimeout: ReturnType<typeof setTimeout> | undefined;

  const intervalId = setInterval(async () => {
    if (stopped) return;

    try {
      currentController = new AbortController();
      currentTimeout = setTimeout(() => currentController?.abort(), 5000);
      const resp = await fetch(healthUrl, { signal: currentController.signal });
      if (stopped) return;
      if (resp.ok) {
        consecutiveFailures = 0;
      } else {
        console.debug("[watchdog] Health check returned status:", resp.status);
        consecutiveFailures++;
      }
    } catch (err) {
      if (stopped) return;
      console.debug("[watchdog] Health check failed:", err);
      consecutiveFailures++;
    } finally {
      if (currentTimeout) clearTimeout(currentTimeout);
      currentTimeout = undefined;
      currentController = undefined;
    }

    if (consecutiveFailures >= MAX_FAILURES && !dead) {
      dead = true;
      onDead();
    }
  }, CHECK_INTERVAL);

  return () => {
    stopped = true;
    clearInterval(intervalId);
    if (currentTimeout) clearTimeout(currentTimeout);
    currentController?.abort();
    currentTimeout = undefined;
    currentController = undefined;
  };
}
