#!/bin/bash
set -e

cd "$(dirname $0)"

TARGET="${CARGO_TARGET_DIR:-target}"

APP_VERSION=$(grep '^version' Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')

./build.sh 2>&1 | grep -v "wasm-validator error" || true

mkdir -p res/bundle-temp

cp res/battleships.wasm res/bundle-temp/app.wasm

if [ -f res/abi.json ]; then
    cp res/abi.json res/bundle-temp/abi.json
fi

WASM_SIZE=$(stat -f%z res/battleships.wasm 2>/dev/null || stat -c%s res/battleships.wasm 2>/dev/null || echo 0)
ABI_SIZE=$(stat -f%z res/abi.json 2>/dev/null || stat -c%s res/abi.json 2>/dev/null || echo 0)

cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "com.calimero.battleships",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "Battleships",
    "description": "Battleships on Calimero — group-aware lobby and match architecture.",
    "author": "Calimero"
  },
  "wasm": {
    "path": "app.wasm",
    "size": ${WASM_SIZE},
    "hash": null
  },
  "abi": {
    "path": "abi.json",
    "size": ${ABI_SIZE},
    "hash": null
  },
  "migrations": [],
  "links": {
    "frontend": "http://localhost:5173/"
  }
}
EOF

cargo run --manifest-path ../../core/Cargo.toml -p mero-sign --quiet -- \
    sign res/bundle-temp/manifest.json \
    --key ../../core/scripts/test-signing-key/test-key.json

cd res/bundle-temp
tar -czf ../battleships-${APP_VERSION}.mpk manifest.json app.wasm abi.json 2>/dev/null || \
tar -czf ../battleships-${APP_VERSION}.mpk manifest.json app.wasm 2>/dev/null

echo "Bundle created: res/battleships-${APP_VERSION}.mpk"
