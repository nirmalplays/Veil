// The NEAR AI API key lives in memory only: never written to storage, lost on reload.
let key = "";
export const setNearKey = (k: string) => { key = k.trim(); };
export const getNearKey = () => key;
// Cheapest attested E2EE model on NEAR AI Cloud at the time of writing ($0.08 in / $0.50 out per million tokens).
export const NEAR_MODEL = "z-ai/glm-5.3-flash";
// The model the chat uses. Pick one from the models endpoint in the attestation panel; until then it is the cheapest TEE-hosted one.
let model = NEAR_MODEL;
export const setNearModel = (m: string) => { model = m.trim() || NEAR_MODEL; };
export const getNearModel = () => model;
