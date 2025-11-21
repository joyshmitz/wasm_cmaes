#!/usr/bin/env bash
set -euo pipefail

# Build both wasm bundles: sequential (pkg/) and parallel+SIMD (pkg-par/).
# You can override TOOLCHAIN, WASM_PACK, or RUSTFLAGS_PAR via environment.

ROOT="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)"
cd "$ROOT"

: "${TOOLCHAIN:=nightly}"
: "${WASM_PACK:=wasm-pack}"
: "${RUSTFLAGS_PAR:=-C target-feature=+simd128}"

echo ":: cleaning pkg outputs"
rm -rf pkg pkg-par

echo ":: building parallel bundle (to pkg/, then copying to pkg-par/)" \
     "(TOOLCHAIN=$TOOLCHAIN, RUSTFLAGS=$RUSTFLAGS_PAR)"
RUSTUP_TOOLCHAIN="$TOOLCHAIN" \
RUSTFLAGS="$RUSTFLAGS_PAR" \
"$WASM_PACK" build --target bundler --features parallel
mv pkg pkg-par
perl -0777 -pe 's/"name":\s*"cmaes_wasm"/"name": "cmaes_wasm-par"/' \
    -i pkg-par/package.json

echo ":: building sequential bundle -> pkg/" \
     "(TOOLCHAIN=$TOOLCHAIN)"
RUSTUP_TOOLCHAIN="$TOOLCHAIN" \
"$WASM_PACK" build --target bundler

echo ":: done"
