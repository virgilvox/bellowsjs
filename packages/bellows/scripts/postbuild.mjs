/*
 * Writes dist/worklet.js (the raw kernel bundle) for hosts whose CSP blocks
 * blob: script sources; createKernelNode accepts its URL as an override.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const gen = readFileSync(join(pkg, 'src/kernel/worklet-code.gen.ts'), 'utf8');
const match = gen.match(/workletCode: string = (".*");/s);
if (!match) throw new Error('could not extract worklet code from worklet-code.gen.ts');
writeFileSync(join(pkg, 'dist/worklet.js'), JSON.parse(match[1]));
console.log('dist/worklet.js written');
