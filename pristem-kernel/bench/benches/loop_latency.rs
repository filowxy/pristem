//! §11 bench: round-loop latency. Target — defense adds < 5% round overhead.
//! `full_round_with_defense` vs `defense_scan_only` vs a pure formatting `baseline` makes
//! the defence share of a round directly visible in the criterion report.

use std::sync::Arc;

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use pristem_core::{Kernel, Mode, NoopObserver};
use pristem_defense::InterceptPosition;
use pristem_provider::StubTransport;

const REPLY: &str = r#"{"choices":[{"message":{"content":"<answer>ok</answer>"}}]}"#;
const CLEAN: &str =
    "Please read src/main.rs and summarise the agent loop; version 0.3.0, verdict: allow.";

fn loop_latency(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let transport = Arc::new(StubTransport::new(Vec::<String>::new()));
    let manager = Kernel::with_config(Kernel::test_config(), transport.clone()).unwrap();
    let session = rt.block_on(manager.open(Mode::Goal)).unwrap();
    let defense = manager.shared.defense.clone();

    let mut group = c.benchmark_group("loop_latency");
    group.bench_function("full_round_with_defense", |b| {
        b.iter(|| {
            transport.push(REPLY);
            rt.block_on(manager.submit(session, black_box("hello"), &NoopObserver))
                .unwrap();
        })
    });
    group.bench_function("defense_scan_only", |b| {
        b.iter(|| {
            black_box(defense.scan_inbound(black_box(CLEAN), InterceptPosition::Inbound));
        })
    });
    let call = pristem_defense::ToolCall::new("read").arg("path", "src/lib.rs");
    group.bench_function("defense_three_checkpoints", |b| {
        b.iter(|| {
            black_box(defense.scan_inbound(black_box(CLEAN), InterceptPosition::Inbound));
            black_box(defense.validate_calls(black_box(std::slice::from_ref(&call))));
            black_box(defense.scan_outbound(black_box("ok")));
        })
    });
    group.bench_function("baseline_format", |b| {
        b.iter(|| black_box(format!("hello {}", black_box(0.3))))
    });
    group.finish();
}

criterion_group!(benches, loop_latency);
criterion_main!(benches);
