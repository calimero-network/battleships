#!/bin/bash
set -e
cd "$(dirname $0)"
TARGET="${CARGO_TARGET_DIR:-../../target}"

rustup target add wasm32-unknown-unknown 2>/dev/null || true
cargo build --target wasm32-unknown-unknown --profile app-release

mkdir -p res
cp $TARGET/wasm32-unknown-unknown/app-release/battleships_lobby.wasm ./res/lobby.wasm

if command -v wasm-opt > /dev/null; then
  wasm-opt -Oz ./res/lobby.wasm -o ./res/lobby.wasm
fi

echo "Built: res/lobby.wasm"
