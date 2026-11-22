//! §11 bench: read-registry check cost and staging-store FTS cost.

use std::path::Path;
use std::sync::Arc;

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use pristem_deepsleep::{PortableStagingStore, StagingQueue, StagingStore};
use pristem_defense::{FileStamp, SessionId};
use pristem_harness::registry::ReadRegistry;

fn registry_check(c: &mut Criterion) {
    let registry = ReadRegistry::new(false);
    let session = SessionId(1);
    let path = Path::new("src/lib.rs");
    let stamp = FileStamp::of(b"stable content");
    registry.record(session, path, stamp);

    let store = Arc::new(PortableStagingStore::in_memory());
    let queue = StagingQueue::new(store.clone());
    for i in 0..64 {
        queue
            .archive(&format!("archive entry {i}: agent loop defence overhead"))
            .unwrap();
    }

    let mut group = c.benchmark_group("registry_check");
    group.bench_function("on_read_intent_held", |b| {
        b.iter(|| black_box(registry.on_read_intent(session, path, stamp)))
    });
    group.bench_function("on_read_intent_other_session", |b| {
        b.iter(|| black_box(registry.on_read_intent(SessionId(2), path, stamp)))
    });
    group.bench_function("mark_changed_no_change", |b| {
        b.iter(|| black_box(registry.mark_changed(session, path, stamp)))
    });
    group.bench_function("fts_search_two_terms", |b| {
        b.iter(|| black_box(store.search(black_box("agent loop")).unwrap()))
    });
    group.finish();
}

criterion_group!(benches, registry_check);
criterion_main!(benches);
