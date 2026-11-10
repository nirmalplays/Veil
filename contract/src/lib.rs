//! Veil registry.
//!
//! Stores only hashes and pointers. Session plaintext never touches the chain,
//! and TEE attestations are verified off-chain (the contract keeps their hash
//! so anyone can re-fetch and re-verify the report).

use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Models,
    Sessions,
    Consents,
    Evals,
    Rounds,
    Policies,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Model {
    pub owner: AccountId,
    pub meta_hash: String,
    /// X25519 public key (64 hex) that session keys are wrapped to when a user grants consent.
    pub enc_pubkey: String,
    pub tags: Vec<String>,
    pub registered_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Session {
    pub owner: AccountId,
    /// Pointer to the client-side-encrypted blob (e.g. a storage id). Opaque to the contract.
    pub blob_id: String,
    pub committed_ms: u64,
    /// Set by `forget_session`. A forgotten session can never be granted, read or scored again.
    pub forgotten: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Consent {
    /// `None` means pinned: the consent never expires until revoked or the session is forgotten.
    pub expires_ms: Option<u64>,
    /// Muted. The grant and its expiry are kept, but nothing may use the session until resumed.
    pub paused: bool,
    /// Session key wrapped to the model owner's `enc_pubkey` (opaque hex). Deleted on revoke.
    pub wrapped_key: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Eval {
    pub score: u8,
    pub attestation_hash: String,
    pub recorded_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Round {
    pub merkle_root: String,
    pub attestation_hash: String,
    pub leaf_count: u32,
    pub recorded_ms: u64,
}

/// One published version of a site's policy (master prompt + guardrails). Only its hash is stored.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Policy {
    pub version: u32,
    /// sha256 (64 hex) of the exact policy text the site runs.
    pub policy_hash: String,
    /// Optional pointer to where the text is published, so users can read it.
    pub uri: String,
    pub recorded_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PolicySet {
    pub owner: AccountId,
    pub versions: Vec<Policy>,
}

/// Opened on demand rather than held in contract state, so adding it does not change the stored layout
/// and an already-deployed contract can be upgraded in place. Writes flush when the handle drops.
fn policies() -> LookupMap<String, PolicySet> {
    LookupMap::new(Key::Policies)
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    models: IterableMap<String, Model>,
    sessions: LookupMap<String, Session>,
    /// key = "{session_hash}|{model_id}"
    consents: IterableMap<String, Consent>,
    evals: LookupMap<String, Eval>,
    rounds: LookupMap<String, Vec<Round>>,
}

fn ck(session_hash: &str, model_id: &str) -> String {
    format!("{session_hash}|{model_id}")
}

#[near]
impl Registry {
    #[init]
    pub fn new() -> Self {
        Self {
            models: IterableMap::new(Key::Models),
            sessions: LookupMap::new(Key::Sessions),
            consents: IterableMap::new(Key::Consents),
            evals: LookupMap::new(Key::Evals),
            rounds: LookupMap::new(Key::Rounds),
        }
    }

    pub fn register_model(
        &mut self,
        model_id: String,
        meta_hash: String,
        enc_pubkey: String,
        tags: Vec<String>,
    ) {
        require!(!model_id.is_empty() && model_id.len() <= 64, "bad model_id");
        require!(tags.len() <= 16, "too many tags");
        require!(is_hex(&enc_pubkey, 64), "enc_pubkey must be 64 hex chars");
        require!(!self.models.contains_key(&model_id), "model exists");
        self.models.insert(
            model_id,
            Model {
                owner: env::predecessor_account_id(),
                meta_hash,
                enc_pubkey,
                tags,
                registered_ms: now_ms(),
            },
        );
    }

    /// Caller commits the hash of their (already encrypted) session.
    pub fn commit_session(&mut self, session_hash: String, blob_id: String) {
        require!(session_hash.len() == 64, "session_hash must be 64 hex chars");
        require!(!self.sessions.contains_key(&session_hash), "already committed");
        self.sessions.insert(
            session_hash,
            Session {
                owner: env::predecessor_account_id(),
                blob_id,
                committed_ms: now_ms(),
                forgotten: false,
            },
        );
    }

    /// `expires_ms = None` grants a pinned consent (no expiry); `Some(t)` must be in the future.
    pub fn grant_consent(
        &mut self,
        session_hash: String,
        model_id: String,
        expires_ms: Option<u64>,
        wrapped_key: String,
    ) {
        self.assert_session_owner(&session_hash);
        self.assert_not_forgotten(&session_hash);
        require!(self.models.contains_key(&model_id), "unknown model");
        if let Some(t) = expires_ms {
            require!(t > now_ms(), "expiry must be in the future");
        }
        require!(
            !wrapped_key.is_empty() && wrapped_key.len() <= 512 && is_hex(&wrapped_key, wrapped_key.len()),
            "bad wrapped_key"
        );
        self.consents.insert(ck(&session_hash, &model_id), Consent { expires_ms, paused: false, wrapped_key });
    }

    /// Pin: keep the existing consent with no expiry.
    pub fn pin_consent(&mut self, session_hash: String, model_id: String) {
        self.update_consent(&session_hash, &model_id, |c| c.expires_ms = None);
    }

    /// Mute: stop all use of the session without losing the grant or its expiry.
    pub fn pause_consent(&mut self, session_hash: String, model_id: String) {
        self.update_consent(&session_hash, &model_id, |c| c.paused = true);
    }

    /// Unmute: restore a muted consent. The expiry is untouched, so an expired one stays expired.
    pub fn resume_consent(&mut self, session_hash: String, model_id: String) {
        self.update_consent(&session_hash, &model_id, |c| c.paused = false);
    }

    /// Removes the grant entirely (and the wrapped key with it). Allowed after `forget_session` as cleanup.
    pub fn revoke_consent(&mut self, session_hash: String, model_id: String) {
        self.assert_session_owner(&session_hash);
        self.consents.remove(&ck(&session_hash, &model_id));
    }

    /// Forget: the session can never be granted, read, scored or included again, and a log event tells
    /// the client to delete the encrypted blob. Past evals and rounds are never altered: a round that
    /// already used the session stays on-chain, and a model owner who already decrypted it keeps what
    /// they read. Forgetting stops future use; it cannot undo the past.
    pub fn forget_session(&mut self, session_hash: String) {
        self.assert_session_owner(&session_hash);
        let mut s = self.sessions.get(&session_hash).cloned().unwrap_or_else(|| env::panic_str("unknown session"));
        require!(!s.forgotten, "session forgotten");
        s.forgotten = true;
        let (owner, blob_id) = (s.owner.clone(), s.blob_id.clone());
        self.sessions.insert(session_hash.clone(), s);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "veil", "version": "1.0.0", "event": "session_forgotten",
                "data": [{ "session_hash": session_hash, "blob_id": blob_id, "owner": owner }]
            })
        ));
    }

    /// Publishes a new policy version for `site_id`. The first caller owns the site; only the owner can add versions.
    /// Old versions stay readable, so a receipt can be checked against the policy in force when it was made.
    pub fn publish_policy(&mut self, site_id: String, policy_hash: String, uri: String) -> u32 {
        require!(!site_id.is_empty() && site_id.len() <= 64, "bad site_id");
        require!(is_hex(&policy_hash, 64), "policy_hash must be 64 hex chars");
        require!(uri.len() <= 256, "uri too long");
        let who = env::predecessor_account_id();
        let mut map = policies();
        let mut set = map.get(&site_id).cloned().unwrap_or(PolicySet { owner: who.clone(), versions: vec![] });
        require!(set.owner == who, "not site owner");
        let version = set.versions.len() as u32 + 1;
        set.versions.push(Policy { version, policy_hash: policy_hash.to_lowercase(), uri, recorded_ms: now_ms() });
        map.insert(site_id.clone(), set);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "veil", "version": "1.0.0", "event": "policy_published",
                "data": [{ "site_id": site_id, "policy_version": version, "policy_hash": policy_hash.to_lowercase(), "owner": who }]
            })
        ));
        version
    }

    /// Latest policy for the site.
    pub fn get_policy(&self, site_id: String) -> Option<Policy> {
        policies().get(&site_id).and_then(|s| s.versions.last().cloned())
    }
    pub fn policy_owner(&self, site_id: String) -> Option<AccountId> {
        policies().get(&site_id).map(|s| s.owner.clone())
    }
    pub fn policy_history(&self, site_id: String) -> Vec<Policy> {
        policies().get(&site_id).map(|s| s.versions.clone()).unwrap_or_default()
    }
    /// The policy that was in force at `at_ms` (latest version published at or before that time).
    pub fn policy_at(&self, site_id: String, at_ms: u64) -> Option<Policy> {
        policies().get(&site_id).and_then(|s| s.versions.iter().rev().find(|p| p.recorded_ms <= at_ms).cloned())
    }

    /// Model owner records an in-enclave relevance score for a consented session.
    pub fn record_eval(
        &mut self,
        session_hash: String,
        model_id: String,
        score: u8,
        attestation_hash: String,
    ) {
        self.assert_model_owner(&model_id);
        require!(score <= 100, "score 0-100");
        require!(self.has_consent(session_hash.clone(), model_id.clone()), "no live consent");
        self.evals.insert(
            ck(&session_hash, &model_id),
            Eval { score, attestation_hash, recorded_ms: now_ms() },
        );
    }

    /// Model owner anchors the Merkle root of the session hashes scored or used as context in a round. Nothing is trained, so a round is a record of use, not of learning.
    pub fn record_round(
        &mut self,
        model_id: String,
        merkle_root: String,
        attestation_hash: String,
        leaf_count: u32,
    ) {
        self.assert_model_owner(&model_id);
        require!(merkle_root.len() == 64, "merkle_root must be 64 hex chars");
        let mut v = self.rounds.get(&model_id).cloned().unwrap_or_default();
        v.push(Round { merkle_root, attestation_hash, leaf_count, recorded_ms: now_ms() });
        self.rounds.insert(model_id, v);
    }

    // ---- views ----

    pub fn has_consent(&self, session_hash: String, model_id: String) -> bool {
        if self.is_forgotten(&session_hash) {
            return false;
        }
        self.consents
            .get(&ck(&session_hash, &model_id))
            .map(|c| consent_live(c, now_ms()))
            .unwrap_or(false)
    }

    /// The consent record (incl. wrapped key) only while it is live; None once expired or revoked.
    pub fn get_consent(&self, session_hash: String, model_id: String) -> Option<Consent> {
        if !self.has_consent(session_hash.clone(), model_id.clone()) {
            return None;
        }
        self.consents.get(&ck(&session_hash, &model_id)).cloned()
    }

    /// The raw consent record whatever its state (live, muted, expired), so a UI can show and change it.
    /// Unlike `get_consent`, this does not filter by liveness. Everything stored on-chain is public;
    /// the wrapped key is useless without the model owner's private key.
    pub fn consent_info(&self, session_hash: String, model_id: String) -> Option<Consent> {
        self.consents.get(&ck(&session_hash, &model_id)).cloned()
    }

    pub fn get_model(&self, model_id: String) -> Option<Model> {
        self.models.get(&model_id).cloned()
    }

    pub fn get_session(&self, session_hash: String) -> Option<Session> {
        self.sessions.get(&session_hash).cloned()
    }

    pub fn get_eval(&self, session_hash: String, model_id: String) -> Option<Eval> {
        self.evals.get(&ck(&session_hash, &model_id)).cloned()
    }

    pub fn get_rounds(&self, model_id: String) -> Vec<Round> {
        self.rounds.get(&model_id).cloned().unwrap_or_default()
    }

    /// Session hashes with a live consent for `model_id`. Paginated.
    pub fn consented_sessions(&self, model_id: String, from: u32, limit: u32) -> Vec<String> {
        let suffix = format!("|{model_id}");
        let now = now_ms();
        self.consents
            .iter()
            .filter(|(k, c)| k.ends_with(&suffix) && consent_live(c, now))
            .map(|(k, _)| k.trim_end_matches(&suffix).to_string())
            .filter(|h| !self.is_forgotten(h))
            .skip(from as usize)
            .take(limit.min(100) as usize)
            .collect()
    }

    // ---- internals ----

    fn assert_session_owner(&self, session_hash: &str) {
        let s = self.sessions.get(session_hash).unwrap_or_else(|| env::panic_str("unknown session"));
        require!(s.owner == env::predecessor_account_id(), "not session owner");
    }

    fn is_forgotten(&self, session_hash: &str) -> bool {
        self.sessions.get(session_hash).map(|s| s.forgotten).unwrap_or(false)
    }

    fn assert_not_forgotten(&self, session_hash: &str) {
        require!(!self.is_forgotten(session_hash), "session forgotten");
    }

    fn update_consent(&mut self, session_hash: &str, model_id: &str, f: impl FnOnce(&mut Consent)) {
        self.assert_session_owner(session_hash);
        self.assert_not_forgotten(session_hash);
        let key = ck(session_hash, model_id);
        let mut c = self.consents.get(&key).cloned().unwrap_or_else(|| env::panic_str("no consent"));
        f(&mut c);
        self.consents.insert(key, c);
    }

    fn assert_model_owner(&self, model_id: &str) {
        let m = self.models.get(model_id).unwrap_or_else(|| env::panic_str("unknown model"));
        require!(m.owner == env::predecessor_account_id(), "not model owner");
    }
}

fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Live = not muted and (pinned or not yet expired). Forgotten sessions are checked separately.
fn consent_live(c: &Consent, now: u64) -> bool {
    !c.paused && c.expires_ms.map_or(true, |t| t > now)
}

fn now_ms() -> u64 {
    env::block_timestamp() / 1_000_000
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const PK: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const WK: &str = "deadbeef";
    const H: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn ctx(who: &str, ms: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who.parse().unwrap())
            .block_timestamp(ms * 1_000_000)
            .build());
    }

    fn setup() -> Registry {
        ctx("owner.testnet", 1_000);
        let mut r = Registry::new();
        r.register_model("m1".into(), "mh".into(), PK.into(), vec!["code".into()]);
        ctx("alice.testnet", 1_000);
        r.commit_session(H.into(), "blob1".into());
        r
    }

    #[test]
    fn consent_lifecycle() {
        let mut r = setup();
        assert!(!r.has_consent(H.into(), "m1".into()));
        r.grant_consent(H.into(), "m1".into(), Some(5_000), WK.into());
        assert!(r.has_consent(H.into(), "m1".into()));
        assert_eq!(r.consented_sessions("m1".into(), 0, 10), vec![H.to_string()]);
        ctx("alice.testnet", 6_000); // after expiry
        assert!(!r.has_consent(H.into(), "m1".into()));
        assert!(r.consented_sessions("m1".into(), 0, 10).is_empty());
        ctx("alice.testnet", 2_000);
        r.revoke_consent(H.into(), "m1".into());
        assert!(!r.has_consent(H.into(), "m1".into()));
    }

    #[test]
    #[should_panic(expected = "not session owner")]
    fn only_owner_grants() {
        let mut r = setup();
        ctx("mallory.testnet", 1_500);
        r.grant_consent(H.into(), "m1".into(), Some(5_000), WK.into());
    }

    #[test]
    #[should_panic(expected = "no live consent")]
    fn eval_requires_consent() {
        let mut r = setup();
        ctx("owner.testnet", 1_500);
        r.record_eval(H.into(), "m1".into(), 80, "ah".into());
    }

    #[test]
    #[should_panic(expected = "not model owner")]
    fn only_model_owner_evals() {
        let mut r = setup();
        r.grant_consent(H.into(), "m1".into(), Some(5_000), WK.into());
        ctx("mallory.testnet", 1_500);
        r.record_eval(H.into(), "m1".into(), 80, "ah".into());
    }

    #[test]
    fn eval_and_round() {
        let mut r = setup();
        r.grant_consent(H.into(), "m1".into(), Some(5_000), WK.into());
        ctx("owner.testnet", 1_500);
        r.record_eval(H.into(), "m1".into(), 80, "ah".into());
        assert_eq!(r.get_eval(H.into(), "m1".into()).unwrap().score, 80);
        r.record_round("m1".into(), H.into(), "ah".into(), 1);
        assert_eq!(r.get_rounds("m1".into()).len(), 1);
    }

    #[test]
    fn wrapped_key_visible_only_while_live() {
        let mut r = setup();
        r.grant_consent(H.into(), "m1".into(), Some(5_000), WK.into());
        assert_eq!(r.get_consent(H.into(), "m1".into()).unwrap().wrapped_key, WK);
        ctx("alice.testnet", 6_000);
        assert!(r.get_consent(H.into(), "m1".into()).is_none());
        ctx("alice.testnet", 2_000);
        r.revoke_consent(H.into(), "m1".into());
        assert!(r.get_consent(H.into(), "m1".into()).is_none());
    }

    #[test]
    #[should_panic(expected = "bad wrapped_key")]
    fn rejects_bad_wrapped_key() {
        let mut r = setup();
        r.grant_consent(H.into(), "m1".into(), Some(5_000), "not-hex!".into());
    }

    #[test]
    #[should_panic(expected = "enc_pubkey must be 64 hex chars")]
    fn rejects_bad_enc_pubkey() {
        ctx("owner.testnet", 1_000);
        let mut r = Registry::new();
        r.register_model("m2".into(), "mh".into(), "short".into(), vec![]);
    }

    fn granted() -> Registry {
        let mut r = setup();
        r.grant_consent(H.into(), "m1".into(), Some(5_000), WK.into());
        r
    }

    #[test]
    fn pin_never_expires() {
        let mut r = granted();
        r.pin_consent(H.into(), "m1".into());
        ctx("alice.testnet", 9_000_000_000_000); // far past the old expiry
        assert!(r.has_consent(H.into(), "m1".into()));
        assert_eq!(r.consented_sessions("m1".into(), 0, 10), vec![H.to_string()]);
        assert!(r.get_consent(H.into(), "m1".into()).unwrap().expires_ms.is_none());
    }

    #[test]
    fn grant_with_no_expiry_is_pinned() {
        let mut r = setup();
        r.grant_consent(H.into(), "m1".into(), None, WK.into());
        ctx("alice.testnet", 9_000_000_000_000);
        assert!(r.has_consent(H.into(), "m1".into()));
    }

    #[test]
    #[should_panic(expected = "expiry must be in the future")]
    fn grant_expiry_must_be_future() {
        let mut r = setup();
        r.grant_consent(H.into(), "m1".into(), Some(500), WK.into());
    }

    #[test]
    #[should_panic(expected = "no consent")]
    fn pin_requires_existing_consent() {
        let mut r = setup();
        r.pin_consent(H.into(), "m1".into());
    }

    #[test]
    fn pause_blocks_consent_and_listing() {
        let mut r = granted();
        r.pause_consent(H.into(), "m1".into());
        assert!(!r.has_consent(H.into(), "m1".into()));
        assert!(r.get_consent(H.into(), "m1".into()).is_none());
        assert!(r.consented_sessions("m1".into(), 0, 10).is_empty());
    }

    #[test]
    #[should_panic(expected = "no live consent")]
    fn pause_blocks_record_eval() {
        let mut r = granted();
        r.pause_consent(H.into(), "m1".into());
        ctx("owner.testnet", 1_500);
        r.record_eval(H.into(), "m1".into(), 80, "ah".into());
    }

    #[test]
    fn resume_restores_consent_and_eval() {
        let mut r = granted();
        r.pause_consent(H.into(), "m1".into());
        r.resume_consent(H.into(), "m1".into());
        assert!(r.has_consent(H.into(), "m1".into()));
        ctx("owner.testnet", 1_500);
        r.record_eval(H.into(), "m1".into(), 80, "ah".into());
        assert_eq!(r.get_eval(H.into(), "m1".into()).unwrap().score, 80);
    }

    #[test]
    fn pause_keeps_expiry_and_resume_does_not_extend_it() {
        let mut r = granted();
        r.pause_consent(H.into(), "m1".into());
        assert_eq!(r.consents.get(&ck(H, "m1")).unwrap().expires_ms, Some(5_000));
        ctx("alice.testnet", 6_000); // expires while muted
        r.resume_consent(H.into(), "m1".into());
        assert_eq!(r.consents.get(&ck(H, "m1")).unwrap().expires_ms, Some(5_000));
        assert!(!r.has_consent(H.into(), "m1".into()));
    }

    #[test]
    #[should_panic(expected = "not session owner")]
    fn only_owner_pins() {
        let mut r = granted();
        ctx("mallory.testnet", 1_500);
        r.pin_consent(H.into(), "m1".into());
    }

    #[test]
    #[should_panic(expected = "not session owner")]
    fn only_owner_pauses() {
        let mut r = granted();
        ctx("mallory.testnet", 1_500);
        r.pause_consent(H.into(), "m1".into());
    }

    #[test]
    #[should_panic(expected = "not session owner")]
    fn only_owner_resumes() {
        let mut r = granted();
        r.pause_consent(H.into(), "m1".into());
        ctx("mallory.testnet", 1_500);
        r.resume_consent(H.into(), "m1".into());
    }

    #[test]
    #[should_panic(expected = "not session owner")]
    fn only_owner_forgets() {
        let mut r = granted();
        ctx("mallory.testnet", 1_500);
        r.forget_session(H.into());
    }

    #[test]
    fn consent_info_shows_muted_and_expired_records() {
        let mut r = granted();
        r.pause_consent(H.into(), "m1".into());
        let c = r.consent_info(H.into(), "m1".into()).unwrap();
        assert!(c.paused && c.expires_ms == Some(5_000));
        assert!(r.get_consent(H.into(), "m1".into()).is_none());
        assert!(r.consent_info(H.into(), "other".into()).is_none());
    }

    #[test]
    fn forget_blocks_everything_and_delists() {
        let mut r = granted();
        r.pin_consent(H.into(), "m1".into());
        r.forget_session(H.into());
        assert!(!r.has_consent(H.into(), "m1".into()));
        assert!(r.get_consent(H.into(), "m1".into()).is_none());
        assert!(r.consented_sessions("m1".into(), 0, 10).is_empty());
        assert!(r.get_session(H.into()).unwrap().forgotten);
        let logs = near_sdk::test_utils::get_logs();
        assert!(logs.iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains("session_forgotten") && l.contains("blob1")));
        r.revoke_consent(H.into(), "m1".into()); // cleanup of the grant is still allowed
        assert!(r.consents.get(&ck(H, "m1")).is_none());
    }

    #[test]
    #[should_panic(expected = "no live consent")]
    fn forget_blocks_record_eval() {
        let mut r = granted();
        r.forget_session(H.into());
        ctx("owner.testnet", 1_500);
        r.record_eval(H.into(), "m1".into(), 80, "ah".into());
    }

    #[test]
    #[should_panic(expected = "session forgotten")]
    fn grant_after_forget_panics() {
        let mut r = setup();
        r.forget_session(H.into());
        r.grant_consent(H.into(), "m1".into(), Some(5_000), WK.into());
    }

    #[test]
    #[should_panic(expected = "session forgotten")]
    fn pin_pause_resume_after_forget_panic() {
        let mut r = granted();
        r.forget_session(H.into());
        r.pause_consent(H.into(), "m1".into());
    }

    #[test]
    #[should_panic(expected = "session forgotten")]
    fn forget_twice_panics() {
        let mut r = setup();
        r.forget_session(H.into());
        r.forget_session(H.into());
    }

    #[test]
    fn forget_leaves_past_evals_and_rounds_untouched() {
        let mut r = granted();
        ctx("owner.testnet", 1_500);
        r.record_eval(H.into(), "m1".into(), 80, "ah".into());
        r.record_round("m1".into(), H.into(), "ah".into(), 1);
        ctx("alice.testnet", 1_600);
        r.forget_session(H.into());
        assert_eq!(r.get_eval(H.into(), "m1".into()).unwrap().score, 80);
        assert_eq!(r.get_rounds("m1".into()).len(), 1);
    }

    #[test]
    #[should_panic(expected = "already committed")]
    fn no_double_commit() {
        let mut r = setup();
        r.commit_session(H.into(), "blob2".into());
    }

    #[test]
    #[should_panic(expected = "score 0-100")]
    fn score_bounded() {
        let mut r = setup();
        r.grant_consent(H.into(), "m1".into(), Some(5_000), WK.into());
        ctx("owner.testnet", 1_500);
        r.record_eval(H.into(), "m1".into(), 101, "ah".into());
    }

    const P1: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const P2: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    #[test]
    fn policy_versions_and_time_lookup() {
        ctx("firm.testnet", 1_000);
        let mut r = Registry::new();
        assert_eq!(r.publish_policy("smith-law".into(), P1.into(), "https://x/p1".into()), 1);
        ctx("firm.testnet", 5_000);
        assert_eq!(r.publish_policy("smith-law".into(), P2.into(), String::new()), 2);
        assert_eq!(r.get_policy("smith-law".into()).unwrap().policy_hash, P2);
        assert_eq!(r.policy_history("smith-law".into()).len(), 2);
        assert_eq!(r.policy_at("smith-law".into(), 4_999).unwrap().policy_hash, P1);
        assert_eq!(r.policy_at("smith-law".into(), 5_000).unwrap().policy_hash, P2);
        assert!(r.policy_at("smith-law".into(), 999).is_none());
        assert!(r.get_policy("other".into()).is_none());
        assert_eq!(r.policy_owner("smith-law".into()).unwrap().as_str(), "firm.testnet");
        let logs = near_sdk::test_utils::get_logs();
        assert!(logs.iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains("policy_published")));
    }

    #[test]
    #[should_panic(expected = "not site owner")]
    fn only_site_owner_updates_policy() {
        ctx("firm.testnet", 1_000);
        let mut r = Registry::new();
        r.publish_policy("smith-law".into(), P1.into(), String::new());
        ctx("mallory.testnet", 2_000);
        r.publish_policy("smith-law".into(), P2.into(), String::new());
    }

    #[test]
    #[should_panic(expected = "policy_hash must be 64 hex chars")]
    fn policy_hash_must_be_hex() {
        ctx("firm.testnet", 1_000);
        let mut r = Registry::new();
        r.publish_policy("smith-law".into(), "nothex".into(), String::new());
    }
}
