#!/usr/bin/env bash
# Full check report for the pristem-kernel foundation scaffold.
# Run from anywhere:  bash scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/6 format check =="
cargo fmt --all -- --check

echo "== 2/6 workspace build =="
cargo build --workspace --all-targets

echo "== 3/6 workspace tests =="
cargo test --workspace

echo "== 4/6 bench compile =="
cargo bench --workspace --no-run

echo "== 5/6 clippy =="
cargo clippy --workspace --all-targets

echo "== 6/6 CLI end-to-end (stub provider, no API key) =="
cargo run -q -p pristem-cli -- --stub --once --no-ansi -m "run a full round"

echo "ALL CHECKS PASSED"
