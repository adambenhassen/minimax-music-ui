import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const eslintPath = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
const validFixture = fileURLToPath(new URL('./lint-fixtures/valid-hook.tsx', import.meta.url));
const invalidFixture = fileURLToPath(new URL('./lint-fixtures/invalid-hook.tsx', import.meta.url));

function lint(fixture) {
  const result = spawnSync(process.execPath, [eslintPath, fixture], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const validResult = lint(validFixture);
assert.equal(validResult.status, 0, `Valid Hook fixture failed linting:\n${validResult.output}`);

const invalidResult = lint(invalidFixture);
assert.equal(invalidResult.status, 1, `Invalid Hook fixture did not fail linting:\n${invalidResult.output}`);
assert.match(invalidResult.output, /react-hooks\/rules-of-hooks/);

console.log('Lint fixtures passed: valid Hook accepted; conditional Hook rejected by react-hooks/rules-of-hooks.');
