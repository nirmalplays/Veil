import { test } from "node:test";
import assert from "node:assert/strict";
import { consentState } from "../src/consent.js";

test("no consent record is none", () => {
  assert.equal(consentState(null, 1000), "none");
  assert.equal(consentState(undefined, 1000), "none");
});
test("a future expiry is active, a past or equal one is expired", () => {
  assert.equal(consentState({ expires_ms: 2000, paused: false }, 1000), "active");
  assert.equal(consentState({ expires_ms: 1000, paused: false }, 1000), "expired");
  assert.equal(consentState({ expires_ms: 500, paused: false }, 1000), "expired");
});
test("no expiry is pinned and stays pinned however late it is", () => {
  assert.equal(consentState({ expires_ms: null, paused: false }, 1000), "pinned");
  assert.equal(consentState({ paused: false }, Number.MAX_SAFE_INTEGER), "pinned");
});
test("paused is muted whether the consent is active, pinned or expired", () => {
  assert.equal(consentState({ expires_ms: 2000, paused: true }, 1000), "muted");
  assert.equal(consentState({ expires_ms: null, paused: true }, 1000), "muted");
  assert.equal(consentState({ expires_ms: 500, paused: true }, 1000), "muted");
});
