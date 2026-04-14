// Post-process @calimero/abi-codegen output: codegen v1.0.1 sometimes emits
// helper functions (convertCalimeroBytesForWasm / convertWasmResultToCalimeroBytes)
// in clients whose methods don't actually call them. Lint then fails on the
// unused locals. Re-add an `eslint-disable` directive only for files that
// contain at least one of these helpers, so we don't emit a stray
// "unused eslint-disable" error on cleaner clients.

import fs from 'node:fs';

const FILES = [
  'src/api/lobby/LobbyClient.ts',
  'src/api/game/GameClient.ts',
];
const DISABLE = '/* eslint-disable @typescript-eslint/no-unused-vars */';
const UNUSED_HELPERS = [
  'convertCalimeroBytesForWasm',
  'convertWasmResultToCalimeroBytes',
];

for (const file of FILES) {
  const text = fs.readFileSync(file, 'utf8');
  // Heuristic: a helper is unused at the module level when it's defined but
  // never called from outside its own body. We detect this by stripping the
  // function definition (and its body) and checking whether any call site
  // remains. The codegen indents top-level function bodies but not method
  // bodies, so a "module-level" caller will appear with no leading whitespace
  // before its containing `public async`/`public` block.
  const hasUnusedHelper = UNUSED_HELPERS.some((name) => {
    const definitionPattern = new RegExp(`function ${name}\\b`);
    if (!definitionPattern.test(text)) return false;
    // Find the definition's opening brace and walk to the matching close.
    const defStart = text.search(definitionPattern);
    let braceDepth = 0;
    let cursor = text.indexOf('{', defStart);
    let bodyEnd = cursor;
    for (let i = cursor; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') braceDepth++;
      else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          bodyEnd = i + 1;
          break;
        }
      }
    }
    const outsideBody = text.slice(0, defStart) + text.slice(bodyEnd);
    return !new RegExp(`${name}\\s*\\(`).test(outsideBody);
  });
  if (!hasUnusedHelper) continue;
  if (text.includes(DISABLE)) continue;
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => l.includes('@generated'));
  const insertAt = headerIdx >= 0 ? headerIdx + 1 : 0;
  lines.splice(insertAt, 0, DISABLE);
  fs.writeFileSync(file, lines.join('\n'));
}
