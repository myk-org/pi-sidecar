import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Intended override pins — single source of truth for declaration and lockfile checks. */
const EXPECTED_OVERRIDES: Record<string, string> = {
  "adm-zip": "0.6.0",
  "brace-expansion": ">=5.0.7 <6",
  protobufjs: ">=7.6.5 <8",
};

interface PackageJson {
  overrides?: Record<string, string>;
}

interface LockPackage {
  version?: string;
  name?: string;
}

interface PackageLock {
  packages?: Record<string, LockPackage>;
}

interface ExactConstraint {
  kind: "exact";
  version: string;
}

interface RangeConstraint {
  kind: "range";
  minInclusive: string;
  maxExclusiveMajor: number;
}

type VersionConstraint = ExactConstraint | RangeConstraint;

function loadPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;
}

function loadPackageLock(): PackageLock {
  return JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as PackageLock;
}

/** Collect resolved versions for a package name from package-lock packages map. */
function collectResolvedVersions(lock: PackageLock, packageName: string): string[] {
  const versions: string[] = [];
  for (const [key, pkg] of Object.entries(lock.packages ?? {})) {
    const isDirect = key === `node_modules/${packageName}`;
    const isNested = key.endsWith(`/node_modules/${packageName}`);
    if (isDirect || isNested) {
      assert.ok(pkg.version, `missing version for ${key}`);
      versions.push(pkg.version!);
    }
  }
  return versions;
}

function parseSemver(version: string): { major: number; minor: number; patch: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  assert.ok(match, `invalid semver: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

function isInRange(version: string, minInclusive: string, maxExclusiveMajor: number): boolean {
  return compareSemver(version, minInclusive) >= 0 && parseSemver(version).major < maxExclusiveMajor;
}

/** Parse an override string: exact pin (`0.6.0`) or range (`>=5.0.7 <6`). */
function parseConstraint(spec: string): VersionConstraint {
  const rangeMatch = /^>=(\d+\.\d+\.\d+)\s+<(\d+)$/.exec(spec);
  if (rangeMatch) {
    return {
      kind: "range",
      minInclusive: rangeMatch[1]!,
      maxExclusiveMajor: Number(rangeMatch[2]),
    };
  }
  assert.ok(/^\d+\.\d+\.\d+$/.test(spec), `unsupported override constraint: ${spec}`);
  return { kind: "exact", version: spec };
}

function assertVersionMatchesConstraint(
  packageName: string,
  version: string,
  constraint: VersionConstraint,
): void {
  if (constraint.kind === "exact") {
    assert.equal(
      version,
      constraint.version,
      `${packageName} must be pinned to ${constraint.version}, got ${version}`,
    );
    return;
  }
  assert.ok(
    isInRange(version, constraint.minInclusive, constraint.maxExclusiveMajor),
    `${packageName} must be >=${constraint.minInclusive} <${constraint.maxExclusiveMajor}, got ${version}`,
  );
}

describe("dependency overrides", () => {
  it("declares expected override pins in package.json", () => {
    const pkg = loadPackageJson();
    assert.ok(pkg.overrides, "package.json must declare overrides");
    for (const [name, expected] of Object.entries(EXPECTED_OVERRIDES)) {
      assert.equal(
        pkg.overrides![name],
        expected,
        `package.json overrides.${name} must be ${expected}`,
      );
    }
  });

  for (const [packageName, spec] of Object.entries(EXPECTED_OVERRIDES)) {
    const constraint = parseConstraint(spec);
    const label =
      constraint.kind === "exact"
        ? `exactly ${constraint.version}`
        : `>=${constraint.minInclusive} and <${constraint.maxExclusiveMajor}`;

    it(`resolves ${packageName} to ${label} in the lockfile`, () => {
      const versions = collectResolvedVersions(loadPackageLock(), packageName);
      assert.ok(versions.length > 0, `expected at least one ${packageName} entry in lockfile`);
      for (const version of versions) {
        assertVersionMatchesConstraint(packageName, version, constraint);
      }
    });
  }
});
