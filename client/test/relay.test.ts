import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkMeasurements, parseTdBody, relayBindingOk, type TdFields } from "../src/verify.js";
import { fromHex, toHex } from "../src/crypto.js";

// The measurements come from a real NEAR AI attestation (public data). A relay reports the same kind of event log and compose.
const fx = JSON.parse(readFileSync(new URL("./fixtures/attestation.json", import.meta.url), "utf8"));
const td = parseTdBody(fromHex(fx.candidate.intel_quote));
const state = (cs: { id: string; state: string }[], id: string) => cs.find((c) => c.id === id)?.state;
const who = { key: "", noun: "relay", idPrefix: "relay-", labelPrefix: "Relay: " };
const nonce = "cd".repeat(32);
const withData = (nonceHex: string): TdFields => ({ ...td, reportData: fromHex(nonceHex + "00".repeat(32)) });

test("relay binding: REPORT_DATA must be our nonce followed by zero padding", () => {
  assert.equal(relayBindingOk(withData(nonce), nonce), true);
});
test("relay binding: a different nonce, or no padding, is rejected", () => {
  assert.equal(relayBindingOk(withData("ab".repeat(32)), nonce), false);
  const unpadded: TdFields = { ...td, reportData: fromHex(nonce + "ff".repeat(32)) };
  assert.equal(relayBindingOk(unpadded, nonce), false);
});
test("relay measurements: a genuine event log and compose match the quote", async () => {
  const cs = await checkMeasurements({ info: fx.candidate.info, event_log: fx.candidate.event_log }, td, who);
  assert.deepEqual(cs.map((c) => c.state), ["ok", "ok"]);
  assert.ok(cs.every((c) => c.id.startsWith("relay-")));
});
test("relay measurements: a modified compose is caught", async () => {
  const info = JSON.parse(JSON.stringify(fx.candidate.info));
  info.tcb_info.app_compose += " ";
  assert.equal(state(await checkMeasurements({ info, event_log: fx.candidate.event_log }, td, who), "relay-mr-config"), "failed");
});
test("relay measurements: a tampered event payload is caught", async () => {
  const log = JSON.parse(JSON.stringify(fx.candidate.event_log));
  const e = log.find((x: any) => x.imr === 3 && x.event_payload);
  e.event_payload = e.event_payload.slice(0, -2) + (e.event_payload.endsWith("00") ? "01" : "00");
  assert.equal(state(await checkMeasurements({ info: fx.candidate.info, event_log: log }, td, who), "relay-rtmr3"), "failed");
});
test("hex round trip sanity for the padded REPORT_DATA", () => {
  assert.equal(toHex(fromHex(nonce + "00".repeat(32))).length, 128);
});
