import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkNvidia, checkTdBinding, expectedMrConfigId, parseTdBody, replayRtmr3, verifyJwt, verifyModelAttestation } from "../src/verify.js";
import { fromHex, toHex } from "../src/crypto.js";

// A real attestation captured from NEAR AI Cloud (public data). The TD fields are parsed straight from its quote bytes.
const fx = JSON.parse(readFileSync(new URL("./fixtures/attestation.json", import.meta.url), "utf8"));
const td = parseTdBody(fromHex(fx.candidate.intel_quote));
const state = (cs: { id: string; state: string }[], id: string) => cs.find((c) => c.id === id)?.state;
const clone = () => JSON.parse(JSON.stringify(fx.candidate));

test("genuine report: binding, RTMR3 replay and compose hash all hold", async () => {
  const cs = await checkTdBinding(fx.candidate, fx.nonce, td);
  assert.deepEqual(cs.map((c) => c.state), ["ok", "ok", "ok"]);
});
test("a different nonce breaks the REPORT_DATA binding (replay)", async () => {
  const cs = await checkTdBinding(fx.candidate, "ab".repeat(32), td);
  assert.equal(state(cs, "report-data"), "failed");
});
test("a swapped model key breaks the REPORT_DATA binding", async () => {
  const c = clone(); c.signing_public_key = "11".repeat(32);
  assert.equal(state(await checkTdBinding(c, fx.nonce, td), "report-data"), "failed");
});
test("a tampered event payload is caught by its digest", async () => {
  const c = clone(); const e = c.event_log.find((x: any) => x.imr === 3 && x.event_payload);
  e.event_payload = e.event_payload.slice(0, -2) + (e.event_payload.endsWith("00") ? "01" : "00");
  assert.equal(state(await checkTdBinding(c, fx.nonce, td), "rtmr3"), "failed");
});
test("a dropped event changes the replayed RTMR3", async () => {
  const c = clone(); c.event_log = c.event_log.filter((x: any, i: number, a: any[]) => !(x.imr === 3 && i === a.findIndex((y) => y.imr === 3)));
  assert.equal(state(await checkTdBinding(c, fx.nonce, td), "rtmr3"), "failed");
});
test("a modified docker compose no longer matches MRCONFIGID", async () => {
  const c = clone(); c.info.tcb_info.app_compose += " ";
  assert.equal(state(await checkTdBinding(c, fx.nonce, td), "mr-config"), "failed");
});
test("replayRtmr3 starts from zeros and chains SHA-384 over each imr=3 event, ignoring other registers", async () => {
  assert.equal(toHex(await replayRtmr3([{ imr: 0, event_type: 1, event: "x", event_payload: "", digest: "" }])), "00".repeat(48));
  const one = await replayRtmr3([{ imr: 3, event_type: 1, event: "a", event_payload: "00", digest: "" }]);
  assert.notEqual(toHex(one), "00".repeat(48));
  assert.equal(one.length, 48);
});
test("expectedMrConfigId is 0x01, SHA-256, 15 zero bytes", async () => {
  const m = await expectedMrConfigId("compose");
  assert.equal(m.length, 48); assert.equal(m[0], 1); assert.ok(m.slice(33).every((b) => b === 0));
});

// ---- NVIDIA: a locally generated ES384 key stands in for NVIDIA's signing key ----
async function signer() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sign = async (claims: object, kid = "k1") => {
    const h = enc({ alg: "ES384", kid }), p = enc(claims);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-384" }, kp.privateKey, new TextEncoder().encode(`${h}.${p}`)));
    return `${h}.${p}.${Buffer.from(sig).toString("base64url")}`;
  };
  return { jwk, sign };
}
const nonce = "cd".repeat(32);
const nrasFetch = (jwk: object, token: string | null, status = 200) => (async (url: string) => {
  if (String(url).endsWith("jwks.json")) return new Response(JSON.stringify({ keys: [jwk] }));
  return new Response(JSON.stringify(token ? [["JWT", token], {}] : []), { status });
}) as unknown as typeof fetch;
const gpu = { nvidia_payload: JSON.stringify({ nonce, evidence_list: [] }) };

test("NVIDIA: a signed true verdict with our nonce passes", async () => {
  const { jwk, sign } = await signer();
  const r = await checkNvidia(gpu, nonce, nrasFetch(jwk, await sign({ "x-nvidia-overall-att-result": true, eat_nonce: nonce })));
  assert.equal(r.state, "ok");
});
test("NVIDIA: a false verdict fails", async () => {
  const { jwk, sign } = await signer();
  assert.equal((await checkNvidia(gpu, nonce, nrasFetch(jwk, await sign({ "x-nvidia-overall-att-result": false })))).state, "failed");
});
test("NVIDIA: a token signed by an unknown key fails", async () => {
  const a = await signer(), b = await signer();
  assert.equal((await checkNvidia(gpu, nonce, nrasFetch(a.jwk, await b.sign({ "x-nvidia-overall-att-result": true })))).state, "failed");
});
test("NVIDIA: a tampered token fails its signature", async () => {
  const { jwk, sign } = await signer();
  const t = (await sign({ "x-nvidia-overall-att-result": false })).split(".");
  t[1] = Buffer.from(JSON.stringify({ "x-nvidia-overall-att-result": true })).toString("base64url");
  await assert.rejects(verifyJwt(t.join("."), nrasFetch(jwk, null)));
});
test("NVIDIA: a different nonce in the evidence or the token fails", async () => {
  const { jwk, sign } = await signer();
  assert.equal((await checkNvidia({ nvidia_payload: JSON.stringify({ nonce: "ee".repeat(32) }) }, nonce, nrasFetch(jwk, await sign({ "x-nvidia-overall-att-result": true })))).state, "failed");
  assert.equal((await checkNvidia(gpu, nonce, nrasFetch(jwk, await sign({ "x-nvidia-overall-att-result": true, eat_nonce: "ee".repeat(32) })))).state, "failed");
});
test("NVIDIA: a service error fails, and a report with no GPU evidence is skipped", async () => {
  const { jwk } = await signer();
  assert.equal((await checkNvidia(gpu, nonce, nrasFetch(jwk, null, 500))).state, "failed");
  assert.equal((await checkNvidia({}, nonce, nrasFetch(jwk, null))).state, "skipped");
});
test("a report with no model attestations is not verified", async () => {
  const r = await verifyModelAttestation({ model_attestations: [] }, nonce);
  assert.equal(r.ok, false); assert.equal(r.publicKey, undefined);
});
