import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

test('diagnostic module contains no constructor invocation', () => {
  const source = fs.readFileSync(new URL('../../src/services/autorunDiag.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('autorunDiag.ts', source, ts.ScriptTarget.Latest, true);
  const constructors = [];
  function visit(node) {
    if (ts.isNewExpression(node)) constructors.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(constructors, [], 'diagnostics must not allocate native objects');
});
