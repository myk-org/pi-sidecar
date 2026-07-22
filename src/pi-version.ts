import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { logger } from "./logger.js";
import { resolveExtensionPathDetailed } from "./resolve-extension-path.js";

/** Minimum @earendil-works/pi-coding-agent version the sidecar supports (createProvider() APIs, cli-provider #v3.16.0). */
export const MIN_PI_VERSION = "0.81.1";

/** Not a real override — resolveExtensionPathDetailed() requires an env var name; this one is never set. */
const UNUSED_ENV_VAR = "__SIDECAR_PI_VERSION_PACKAGE_JSON_INTERNAL__";

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compares two semver-ish "x.y.z" strings. Returns <0, 0, or >0. Unparsable input compares as equal (0). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Resolves the installed @earendil-works/pi-coding-agent version from its
 * package.json, or null if unresolvable.
 *
 * Uses resolveExtensionPathDetailed()'s search-path fallback rather than a
 * plain `require.resolve('pkg/package.json')`: the SDK is an ESM-only package
 * with a strict `exports` map, which makes the plain form throw
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` (see AGENTS.md §9 / resolve-extension-path.ts).
 */
export function getInstalledPiVersion(): string | null {
  try {
    const result = resolveExtensionPathDetailed(UNUSED_ENV_VAR, "@earendil-works/pi-coding-agent", "package.json");
    if (!result.path) {
      logger.debug(`[sidecar] PI_VERSION_RESOLVE_FAILED: package=@earendil-works/pi-coding-agent, reason=${result.error || "unknown"}`);
      return null;
    }
    const pkg = JSON.parse(readFileSync(result.path, "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch (err) {
    logger.debug(`[sidecar] PI_VERSION_RESOLVE_FAILED: package=@earendil-works/pi-coding-agent`, err);
    return null;
  }
}

/**
 * Best-effort check of the `pi` binary on PATH, used only as an advisory
 * warning — the subagent extension spawns this binary as a subprocess
 * (see AGENTS.md §8), so a stale global `pi` can break subagent calls even
 * when the sidecar's own SDK dependency is up to date.
 */
function getPathPiVersion(): string | null {
  try {
    const result = spawnSync("pi", ["--version"], { encoding: "utf8", timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      const m = /(\d+\.\d+\.\d+)/.exec(result.stdout);
      return m ? m[1] : null;
    }
  } catch (err) {
    logger.debug(`[sidecar] PI_PATH_VERSION_CHECK_FAILED:`, err);
  }
  return null;
}

/**
 * Enforces the minimum installed @earendil-works/pi-coding-agent version.
 * Throws (does not just log) when the resolved SDK version is below MIN_PI_VERSION
 * or cannot be resolved at all — callers should call this early during startup
 * so a stale SDK install fails fast instead of surfacing confusing runtime errors
 * (e.g. createProvider()-based ACPX/CLI providers silently failing to register).
 */
export function assertPiVersionFloor(): void {
  const installed = getInstalledPiVersion();
  if (!installed) {
    logger.error(`[sidecar] PI_VERSION_CHECK_FAILED: reason=could_not_resolve_installed_version, required>=${MIN_PI_VERSION}`);
    throw new Error(`Could not resolve installed @earendil-works/pi-coding-agent version; requires >=${MIN_PI_VERSION}`);
  }
  // Fail closed: compareVersions treats unparsable inputs as equal (0), which
  // would incorrectly pass the floor check — reject unparsable versions here.
  if (!parseVersion(installed)) {
    logger.error(`[sidecar] PI_VERSION_CHECK_FAILED: reason=unparsable_installed_version, installed=${installed}, required>=${MIN_PI_VERSION}`);
    throw new Error(
      `Could not parse installed @earendil-works/pi-coding-agent version '${installed}'; requires >=${MIN_PI_VERSION}`,
    );
  }
  if (compareVersions(installed, MIN_PI_VERSION) < 0) {
    logger.error(`[sidecar] PI_VERSION_CHECK_FAILED: installed=${installed}, required>=${MIN_PI_VERSION}`);
    throw new Error(`@earendil-works/pi-coding-agent ${installed} is below the required floor ${MIN_PI_VERSION}. Upgrade the dependency.`);
  }
  logger.info(`[sidecar] PI_VERSION_CHECK_OK: installed=${installed}, required>=${MIN_PI_VERSION}`);

  const pathVersion = getPathPiVersion();
  if (pathVersion && compareVersions(pathVersion, MIN_PI_VERSION) < 0) {
    logger.warn(`[sidecar] PI_PATH_VERSION_BELOW_FLOOR: pathVersion=${pathVersion}, required>=${MIN_PI_VERSION}, reason=subagent_subprocess_may_fail`);
  }
}
