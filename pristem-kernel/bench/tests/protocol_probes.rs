//! §11 — the three experiment benches remain the **protocol verification layer**.
//! Protocol changes prove out here (cheap, fast) before entering the kernel; the kernel
//! Rust tests then assert the same behaviours.
//!
//! - `hallu-replay`: replay output chains through compression and assert version
//!   numbers / ids / verdicts survive verbatim.
//! - `remind-probe`: assert the tiered answer-gate behaviour against a fixture matrix.
//! - `pid-probe`: assert the five-gate verdicts and status-line vocabulary.
//!
//! Plus a round-event sequence probe over the full kernel loop.

use std::collections::BTreeMap;
use std::sync::Arc;

use pristem_core::{Kernel, Mode, RecordingObserver, RoundEvent, RoundOutcome};
use pristem_defense::{
    AnswerGate, CallDecision, CallValidator, GatePolicy, SessionId, SignatureDb, TestSetPolicy,
    TokenTier, ToolCall,
};
use pristem_harness::compression::{
    CompressionRequest, Compressor, ExtractiveCompressor, SUMMARY_DECLARATION,
};
use pristem_harness::reminder::{Reminder, ReminderStore};
use pristem_provider::StubTransport;
use serde_json::{json, Value};

const HALLU: &str = include_str!("../fixtures/hallu_replay.jsonl");
const REMIND: &str = include_str!("../fixtures/remind_probe.jsonl");
const PID: &str = include_str!("../fixtures/pid_probe.jsonl");
const SIGDB: &str = include_str!("../../sigdb/signatures.json");

fn lines(src: &str) -> impl Iterator<Item = Value> + '_ {
    src.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("fixture line must be valid json"))
}

// ────────────────────────────── hallu-replay ───────────────────────────────────

#[test]
fn hallu_replay_preserves_versions_ids_and_verdicts_verbatim() {
    let compressor = ExtractiveCompressor::default();
    let mut cases = 0;
    for fixture in lines(HALLU) {
        let id = fixture["id"].as_str().unwrap();
        let messages: Vec<String> = fixture["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let must: Vec<String> = fixture["must_preserve"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let summary = compressor
            .compress(&CompressionRequest {
                messages,
                budget_tokens: 8000,
            })
            .unwrap_or_else(|e| panic!("{id}: compression failed: {e}"));
        assert!(summary.declared, "{id}: summary must self-declare");
        assert!(
            summary.text.contains(SUMMARY_DECLARATION),
            "{id}: declaration marker missing"
        );
        assert!(
            summary.text.contains("Dropped:"),
            "{id}: must state what was dropped"
        );
        for token in &must {
            assert!(
                summary.text.contains(token.as_str()),
                "{id}: verbatim token `{token}` was hallucinated away"
            );
        }
        cases += 1;
    }
    assert_eq!(cases, 3);
}

#[test]
fn hallu_replay_detects_a_summary_that_drops_a_verdict() {
    let compressor = ExtractiveCompressor::default();
    let messages: Vec<String> = lines(HALLU).next().unwrap()["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let good = compressor
        .compress(&CompressionRequest {
            messages,
            budget_tokens: 8000,
        })
        .unwrap();
    let forged = summary_like_without("verdict: deny", &good.text);
    assert!(compressor
        .validate(
            &pristem_harness::compression::Summary {
                text: forged,
                declared: true,
                dropped: good.dropped.clone(),
                preserved: good.preserved.clone(),
                estimated_tokens: 10,
            },
            &["verdict: deny".into()],
        )
        .is_err());
}

fn summary_like_without(needle: &str, text: &str) -> String {
    text.replace(needle, "<removed>")
}

// ────────────────────────────── remind-probe ───────────────────────────────────

#[test]
fn remind_probe_tier_matrix() {
    let mut cases = 0;
    for fixture in lines(REMIND) {
        let id = fixture["id"].as_str().unwrap();
        let tier: TokenTier =
            serde_json::from_value(json!(fixture["tier"].as_str().unwrap())).unwrap();
        let reminders: Vec<String> = fixture["reminders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let store = ReminderStore::default();
        for (i, r) in reminders.iter().enumerate() {
            store.set_global(Reminder {
                id: format!("{id}-{i}"),
                lines: vec![r.clone()],
                source: "remind-probe".into(),
                created_at: 0,
            });
        }
        let answer = fixture["answer"].as_str().unwrap();
        let expected = fixture["expect_reject"].as_bool().unwrap();
        let verdict =
            AnswerGate::new(GatePolicy::default()).check(answer, SessionId(1), tier, &store);
        assert_eq!(
            verdict.must_not_answer(),
            expected,
            "{id}: tier={tier:?} answer={answer:?} gave {verdict:?}"
        );
        cases += 1;
    }
    assert_eq!(cases, 6);
}

// ─────────────────────────────── pid-probe ─────────────────────────────────────

#[test]
fn pid_probe_five_gates_and_status_vocabulary() {
    let db = SignatureDb::from_json(SIGDB).unwrap();
    let validator = CallValidator::new("D:/ws", TestSetPolicy::default()).with_signature_db(db);
    let mut cases = 0;
    for fixture in lines(PID) {
        let id = fixture["id"].as_str().unwrap();
        let tool = fixture["tool"].as_str().unwrap();
        let mut args = BTreeMap::new();
        for (k, v) in fixture["args"].as_object().unwrap() {
            args.insert(k.clone(), v.as_str().unwrap().to_string());
        }
        let call = ToolCall {
            tool: tool.into(),
            args,
            raw: format!("<call tool=\"{tool}\"/>"),
        };
        let verdict = validator.validate(&call);
        if let Some(expected_tool) = fixture["expect_effective"].as_str() {
            assert!(
                matches!(verdict.decision, CallDecision::Reroute { .. }),
                "{id}: expected reroute"
            );
            assert_eq!(verdict.effective_tool, expected_tool, "{id}");
        } else {
            let expected = fixture["expect_code"].as_str().unwrap();
            if expected == "allow" {
                assert_eq!(verdict.decision, CallDecision::Allow, "{id}");
            } else {
                match &verdict.decision {
                    CallDecision::Reject { code, .. } => assert_eq!(*code, expected, "{id}"),
                    other => panic!("{id}: expected reject `{expected}`, got {other:?}"),
                }
            }
        }
        cases += 1;
    }
    assert_eq!(cases, 8);
}

// ──────────────────────── full round protocol probe ────────────────────────────

#[tokio::test]
async fn round_event_sequence_is_protocol_stable() {
    let transport = Arc::new(StubTransport::new(vec![
        r#"{"choices":[{"message":{"content":"checking files\n<call tool=\"search\" query=\"pristem\"/>"}}]}"#,
        r#"{"choices":[{"message":{"content":"<answer>done</answer>"}}]}"#,
    ]));
    let kernel = Kernel::with_config(Kernel::test_config(), transport).unwrap();
    let id = kernel.open(Mode::Coding).await.unwrap();
    let observer = RecordingObserver::default();
    let outcome = kernel.submit(id, "go", &observer).await.unwrap();
    assert_eq!(outcome, RoundOutcome::Answer("done".into()));
    let events = observer.snapshot();
    let position = |pred: fn(&RoundEvent) -> bool| events.iter().position(pred);
    let speech = position(|e| matches!(e, RoundEvent::Speech(_))).expect("speech event");
    let call = position(|e| matches!(e, RoundEvent::Call { .. })).expect("call event");
    let result = position(|e| matches!(e, RoundEvent::Result { .. })).expect("result event");
    let answer = position(|e| matches!(e, RoundEvent::Answer(_))).expect("answer event");
    assert!(
        speech < call && call < result && result < answer,
        "event order: {events:#?}"
    );
    kernel.close(id).unwrap();
}

#[test]
fn defense_scan_of_clean_protocol_text_is_a_no_op() {
    let db = SignatureDb::from_json(SIGDB).unwrap();
    let policy = pristem_defense::InterceptionPolicy::default();
    let scanner =
        pristem_defense::InboundScanner::new(db, policy, pristem_defense::Quarantine::default());
    let clean = "<call tool=\"read\" path=\"src/lib.rs\"/>\nstatus: ok\nversion 0.3.0";
    let out = scanner.scan(clean, pristem_defense::InterceptPosition::ToolResult);
    assert!(!out.intercepted);
    assert_eq!(out.text, clean);
}
