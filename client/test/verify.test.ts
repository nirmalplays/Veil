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
const nrasFetch = (jwk: object, token: string | null, status = 200, gpus: Record<string, string> = {}) => (async (url: string) => {
  if (String(url).endsWith("jwks.json")) return new Response(JSON.stringify({ keys: [jwk] }));
  return new Response(JSON.stringify(token ? [["JWT", token], gpus] : []), { status });
}) as unknown as typeof fetch;
const soon = () => Math.floor(Date.now() / 1000) + 3600;
/** Claims of a healthy GPU, shaped like NVIDIA's real tokens (checked against a live attestation of 8 H100s). */
const goodGpu = (over: object = {}) => ({ eat_nonce: nonce, exp: soon(), secboot: true, dbgstat: "disabled", measres: "success", hwmodel: "GH100 A01 GSP BROM", ueid: "1234",
  "x-nvidia-gpu-driver-rim-signature-verified": true, "x-nvidia-gpu-attestation-report-signature-verified": true, "x-nvidia-gpu-arch-check": true, "x-nvidia-attestation-warning": null, ...over });
const goodOverall = (names: string[], over: object = {}) => ({ "x-nvidia-overall-att-result": true, eat_nonce: nonce, exp: soon(), submods: Object.fromEntries(names.map((n) => [n, ["DIGEST", ["SHA-256", "00"]]])), ...over });
/** A complete NVIDIA answer: an overall token and one token per GPU. `mutate` changes one GPU's claims. */
async function fullAnswer(mutate: object = {}, opts: { names?: string[]; overall?: object; sign?: (c: object) => Promise<string> } = {}) {
  const { jwk, sign } = await signer(); const names = opts.names ?? ["GPU-0", "GPU-1"];
  const gpus: Record<string, string> = {}; for (const n of names) gpus[n] = await (opts.sign ?? sign)(n === names[0] ? goodGpu(mutate) : goodGpu());
  return nrasFetch(jwk, await sign(goodOverall(opts.names ?? ["GPU-0", "GPU-1"], opts.overall)), 200, gpus);
}
const gpu = { nvidia_payload: JSON.stringify({ nonce, evidence_list: [] }) };

test("NVIDIA: a signed true verdict, with healthy per-GPU tokens and our nonce, passes", async () => {
  const r = await checkNvidia(gpu, nonce, await fullAnswer());
  assert.equal(r.state, "ok", r.detail);
  assert.match(r.detail, /2 GPUs/);
});
test("NVIDIA: the overall verdict alone is not enough, each GPU is checked", async () => {
  const { jwk, sign } = await signer();
  const noGpus = await checkNvidia(gpu, nonce, nrasFetch(jwk, await sign(goodOverall(["GPU-0"]))));
  assert.equal(noGpus.state, "failed"); assert.match(noGpus.detail, /no per-GPU tokens/);
  const cases: [string, object, RegExp][] = [
    ["secure boot off", { secboot: false }, /secure boot/], ["debug enabled", { dbgstat: "enabled" }, /debug/], ["measurements failed", { measres: "fail" }, /measurements/],
    ["a verification flag false", { "x-nvidia-gpu-driver-rim-signature-verified": false }, /rim-signature-verified is false/], ["a warning", { "x-nvidia-attestation-warning": "stale RIM" }, /warning/],
    ["a stale nonce on one GPU", { eat_nonce: "ee".repeat(32) }, /different nonce/], ["an expired token", { exp: 1000 }, /expired/], ["a missing identity", { ueid: undefined }, /identity/],
  ];
  for (const [name, mutate, re] of cases) { const r = await checkNvidia(gpu, nonce, await fullAnswer(mutate)); assert.equal(r.state, "failed", name); assert.match(r.detail, re, name); }
});
test("NVIDIA: the GPUs in the overall token must be the GPUs returned, and an expired overall token fails", async () => {
  assert.equal((await checkNvidia(gpu, nonce, await fullAnswer({}, { overall: { submods: { "GPU-0": ["DIGEST", []], "GPU-9": ["DIGEST", []] } } }))).state, "failed");
  const r = await checkNvidia(gpu, nonce, await fullAnswer({}, { overall: { exp: 1000 } })); assert.equal(r.state, "failed"); assert.match(r.detail, /expired/);
});
test("NVIDIA: a per-GPU token signed by an unknown key fails", async () => {
  const other = await signer(); const r = await checkNvidia(gpu, nonce, await fullAnswer({}, { names: ["GPU-0"], sign: (c) => other.sign(c) }));
  assert.equal(r.state, "failed");
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

// A real gateway attestation captured from NEAR AI Cloud. The docs make it the first thing to verify.
const gx = JSON.parse(readFileSync(new URL("./fixtures/gateway.json", import.meta.url), "utf8"));
const gtd = parseTdBody(fromHex(gx.candidate.intel_quote));
const GW = (c: any) => ({ key: c.signing_address, noun: "gateway", idPrefix: "gw-", labelPrefix: "Gateway: " });
const gclone = () => JSON.parse(JSON.stringify(gx.candidate));

test("genuine gateway attestation: binding, RTMR3 replay and compose hash all hold", async () => {
  const cs = await checkTdBinding(gx.candidate, gx.nonce, gtd, GW(gx.candidate));
  assert.deepEqual(cs.map((c) => c.state), ["ok", "ok", "ok"]);
  assert.deepEqual(cs.map((c) => c.id), ["gw-report-data", "gw-rtmr3", "gw-mr-config"]);
  assert.ok(cs.every((c) => c.label.startsWith("Gateway: ")));
});
test("gateway: a replayed nonce, a swapped signing address, an edited event or compose are all caught", async () => {
  assert.equal(state(await checkTdBinding(gx.candidate, "ab".repeat(32), gtd, GW(gx.candidate)), "gw-report-data"), "failed");
  const swapped = gclone(); swapped.signing_address = "11".repeat(32);
  assert.equal(state(await checkTdBinding(swapped, gx.nonce, gtd, GW(swapped)), "gw-report-data"), "failed");
  const ev = gclone(); const asString = typeof ev.event_log === "string";   // the gateway serves its event log as a JSON string
  const log = asString ? JSON.parse(ev.event_log) : ev.event_log; const e = log.find((x: any) => x.imr === 3 && x.event_payload);
  e.event_payload = e.event_payload.slice(0, -2) + (e.event_payload.endsWith("00") ? "01" : "00"); ev.event_log = asString ? JSON.stringify(log) : log;
  assert.equal(state(await checkTdBinding(ev, gx.nonce, gtd, GW(ev)), "gw-rtmr3"), "failed");
  const cp = gclone(); cp.info.tcb_info.app_compose += " ";
  assert.equal(state(await checkTdBinding(cp, gx.nonce, gtd, GW(cp)), "gw-mr-config"), "failed");
});
test("a model key is not accepted as the gateway key (the two identities are separate)", async () => {
  const cs = await checkTdBinding(gx.candidate, gx.nonce, gtd, { ...GW(gx.candidate), key: fx.candidate.signing_public_key });
  assert.equal(state(cs, "gw-report-data"), "failed");
});
test("a report with no gateway attestation is reported as skipped, not as verified", async () => {
  const { verifyGatewayAttestation } = await import("../src/verify.js");
  const cs = await verifyGatewayAttestation(undefined, gx.nonce);
  assert.equal(cs[0].state, "skipped");
  const bad = await verifyGatewayAttestation({ ...gclone(), request_nonce: "00".repeat(32) }, gx.nonce);
  assert.equal(state(bad, "gw-nonce"), "failed");
});

test("the images an enclave attests to are listed from its compose manifest", async () => {
  const { attestedImages } = await import("../src/verify.js");
  const model = attestedImages(JSON.parse(JSON.stringify(fx.candidate)).info.tcb_info.app_compose ?? "");
  assert.ok(model.some((i) => i.image === "nearaidev/compose-manager" && /^[0-9a-f]{64}$/.test(i.digest)));
  assert.ok(model.every((i) => !i.image.startsWith("-")), "list markers are not part of the name");
  const tcb = typeof gx.candidate.info.tcb_info === "string" ? JSON.parse(gx.candidate.info.tcb_info) : gx.candidate.info.tcb_info;
  assert.ok(attestedImages(tcb.app_compose).some((i) => i.image === "nearaidev/cloud-api"));
  assert.deepEqual(attestedImages(""), []);
});
test("an address that differs only in letter case is the same address", async () => {
  const { verifyReceipt } = await import("../src/receipt.js");
  const base = JSON.parse(readFileSync(new URL("./fixtures/receipt.json", import.meta.url), "utf8"));
  base.signature.signing_address = base.signature.signing_address.toUpperCase();
  const v = await verifyReceipt(base);
  assert.equal(v.checks.find((c) => /attested enclave key/.test(c.label))?.ok, true, "the attested key and the signer are compared case-insensitively");
  assert.equal(v.checks.find((c) => /signature is valid/.test(c.label))?.ok, true, "hex decoding does not care about case either");
});
