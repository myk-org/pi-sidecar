import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_PI_VERSION,
  assertPiVersionFloor,
  compareVersions,
  getInstalledPiVersion,
} from "../../src/pi-version.js";

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    assert.equal(compareVersions("0.81.1", "0.81.1"), 0);
  });

  it("returns negative when a < b (patch)", () => {
    assert.ok(compareVersions("0.81.0", "0.81.1") < 0);
  });

  it("returns positive when a > b (patch)", () => {
    assert.ok(compareVersions("0.81.2", "0.81.1") > 0);
  });

  it("returns negative when a < b (minor)", () => {
    assert.ok(compareVersions("0.80.9", "0.81.0") < 0);
  });

  it("returns positive when a > b (major)", () => {
    assert.ok(compareVersions("1.0.0", "0.81.1") > 0);
  });

  it("ignores prerelease/build suffixes on the leading x.y.z", () => {
    assert.ok(compareVersions("0.81.1-beta.1", "0.81.0") > 0);
  });

  it("treats unparsable versions as equal (does not throw)", () => {
    assert.equal(compareVersions("not-a-version", "0.81.1"), 0);
    assert.equal(compareVersions("0.81.1", "also-not-a-version"), 0);
  });
});

describe("getInstalledPiVersion", () => {
  it("resolves the installed @earendil-works/pi-coding-agent version", () => {
    const version = getInstalledPiVersion();
    assert.ok(version, "should resolve a version string");
    assert.match(version!, /^\d+\.\d+\.\d+/);
  });
});

describe("MIN_PI_VERSION", () => {
  it("is a valid x.y.z version string", () => {
    assert.match(MIN_PI_VERSION, /^\d+\.\d+\.\d+$/);
  });
});

describe("assertPiVersionFloor", () => {
  it("does not throw when the installed SDK meets the floor", () => {
    // The repo's own installed @earendil-works/pi-coding-agent is expected to
    // satisfy MIN_PI_VERSION — this is a real (non-mocked) check.
    const installed = getInstalledPiVersion();
    assert.ok(installed, "precondition: installed version must resolve");
    assert.ok(
      compareVersions(installed!, MIN_PI_VERSION) >= 0,
      `installed=${installed} should be >= MIN_PI_VERSION=${MIN_PI_VERSION}`,
    );
    assert.doesNotThrow(() => assertPiVersionFloor());
  });
});
