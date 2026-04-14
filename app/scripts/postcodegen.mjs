// Post-process @calimero/abi-codegen output. Two issues handled:
//
// 1. Unit-only enum variants are emitted as a tagged-object union
//    (`type FooPayload = { name: 'X' } | ...; const Foo = { X: () => ({name:'X'}), ... }`)
//    even though the Rust serde-default wire format is a plain JSON string.
//    Earlier codegen versions produced string unions, which is what consumers
//    (e.g. `m.status === 'Active'`) actually depend on. We rewrite each
//    detected pair to `export type Foo = 'X' | 'Y' | ...;` and drop the
//    factory const, restoring the previous behaviour and matching the runtime.
//
// 2. Unused helper functions (`convertCalimeroBytesForWasm`,
//    `convertWasmResultToCalimeroBytes`) sometimes appear in clients whose
//    methods don't call them; the codegen no longer prepends an
//    `eslint-disable` directive, so `pnpm lint --max-warnings 0` fails. We
//    re-add the directive only for files where at least one helper is
//    genuinely module-level-unused.

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

/**
 * Rewrite every `export type FooPayload = | { name: 'X' } …` block followed
 * by `export const Foo = { … } as const;` into a single string-union type
 * `export type Foo = 'X' | 'Y' | …;` — but only when every variant is unit
 * (no payload fields beyond `name`). Variants with fields are left alone so
 * data-bearing enums keep their tagged-object representation.
 */
function rewriteUnitVariants(text) {
  const payloadRe =
    /export type (\w+)Payload =\s*((?:\s*\|\s*\{[^}]*\})+)\s*\n\s*export const \1 = \{[\s\S]*?\} as const;\s*/g;
  return text.replace(payloadRe, (match, baseName, variantsBlock) => {
    const variantRe = /\{\s*name:\s*'([^']+)'\s*\}/g;
    const allUnit = [...variantsBlock.matchAll(/\{[^}]*\}/g)].every((m) =>
      /^\{\s*name:\s*'[^']+'\s*\}$/.test(m[0].trim()),
    );
    if (!allUnit) return match;
    const names = [...variantsBlock.matchAll(variantRe)].map((m) => `'${m[1]}'`);
    return `export type ${baseName} =\n  | ${names.join('\n  | ')};\n\n`;
  });
}

for (const file of FILES) {
  let text = fs.readFileSync(file, 'utf8');
  const rewritten = rewriteUnitVariants(text);
  if (rewritten !== text) {
    fs.writeFileSync(file, rewritten);
    text = rewritten;
  }
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
