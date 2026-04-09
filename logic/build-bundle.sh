#!/bin/bash
set -e
cd "$(dirname $0)"

APP_VERSION="0.3.0"

# Build both services
echo "Building lobby service..."
(cd crates/lobby && bash build.sh)
echo "Building game service..."
(cd crates/game && bash build.sh)

# Gather artifacts
mkdir -p res/bundle-temp
cp crates/lobby/res/lobby.wasm res/bundle-temp/
cp crates/game/res/game.wasm res/bundle-temp/
cp crates/lobby/res/abi.json res/bundle-temp/lobby-abi.json 2>/dev/null || true
cp crates/game/res/abi.json res/bundle-temp/game-abi.json 2>/dev/null || true

LOBBY_SIZE=$(stat -f%z crates/lobby/res/lobby.wasm 2>/dev/null || stat -c%s crates/lobby/res/lobby.wasm)
GAME_SIZE=$(stat -f%z crates/game/res/game.wasm 2>/dev/null || stat -c%s crates/game/res/game.wasm)
LOBBY_ABI_SIZE=$(stat -f%z crates/lobby/res/abi.json 2>/dev/null || stat -c%s crates/lobby/res/abi.json 2>/dev/null || echo 0)
GAME_ABI_SIZE=$(stat -f%z crates/game/res/abi.json 2>/dev/null || stat -c%s crates/game/res/abi.json 2>/dev/null || echo 0)

cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "com.calimero.battleships",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "Battleships",
    "description": "Battleships on Calimero — lobby + game multi-service bundle."
  },
  "services": [
    {
      "name": "lobby",
      "wasm": { "path": "lobby.wasm", "size": ${LOBBY_SIZE}, "hash": null },
      "abi": { "path": "lobby-abi.json", "size": ${LOBBY_ABI_SIZE}, "hash": null }
    },
    {
      "name": "game",
      "wasm": { "path": "game.wasm", "size": ${GAME_SIZE}, "hash": null },
      "abi": { "path": "game-abi.json", "size": ${GAME_ABI_SIZE}, "hash": null }
    }
  ],
  "migrations": [],
  "links": {
    "frontend": "http://localhost:5173/"
  }
}
EOF

# Sign manifest
cargo run --manifest-path ../../core/Cargo.toml -p mero-sign --quiet -- \
    sign res/bundle-temp/manifest.json \
    --key ../../core/scripts/test-signing-key/test-key.json

# Package .mpk
cd res/bundle-temp
tar -czf ../battleships-${APP_VERSION}.mpk \
    manifest.json lobby.wasm game.wasm lobby-abi.json game-abi.json 2>/dev/null || \
tar -czf ../battleships-${APP_VERSION}.mpk \
    manifest.json lobby.wasm game.wasm

echo "Bundle created: res/battleships-${APP_VERSION}.mpk"
