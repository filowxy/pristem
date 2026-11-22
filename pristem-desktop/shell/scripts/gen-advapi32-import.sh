#!/usr/bin/env bash
# gnullvm's self-contained sysroot ships libkernel32.a / libuser32.a / libws2_32.a
# but NOT libadvapi32.a, which windows-sys (registry features, pulled in by tao)
# links against. Generate that one import library from the system DLL's export
# table using the LLVM tools already shipped with the Rust toolchain.
#
# No Visual Studio / Windows SDK / MinGW install required.
set -euo pipefail

SYSROOT="$(rustc --print sysroot)"
BIN="$SYSROOT/lib/rustlib/x86_64-pc-windows-gnullvm/bin"
OUT="$(cd "$(dirname "$0")/.." && pwd)/native-lib"
mkdir -p "$OUT"

{
  echo "LIBRARY ADVAPI32.dll"
  echo "EXPORTS"
  "$BIN/llvm-objdump.exe" -p "C:/Windows/System32/advapi32.dll" |
    awk '
      /^Export Table:/ { inexp = 1; next }
      inexp && /^[A-Za-z]/ { inexp = 0 }
      inexp && /^ *[0-9]+/ {
        if (NF >= 3 && $3 ~ /^[A-Za-z_]/) print "  " $3
      }
    '
} > "$OUT/advapi32.def"

# Use `-` style flags: Git Bash would MSYS-convert `/dll` into a filesystem path.
(
  cd "$OUT"
  "$BIN/rust-lld.exe" -flavor link \
    -dll -noentry -machine:x64 \
    -def:advapi32.def \
    -out:advapi32_stub.dll \
    -implib:libadvapi32.a
)

echo "generated $OUT/libadvapi32.a ($(wc -l < "$OUT/advapi32.def") exports)"
