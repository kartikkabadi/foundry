import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function findForbiddenImports(sourceDir: string, forbiddenPattern: RegExp): string[] {
  const violations: string[] = [];
  for (const file of collectSourceFiles(sourceDir)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('import ') && !trimmed.includes('from ')) {
        continue;
      }
      if (forbiddenPattern.test(trimmed)) {
        violations.push(`${path.relative(ROOT, file)}: ${trimmed}`);
      }
    }
  }
  return violations;
}

describe('package boundaries (V2-10)', () => {
  it('packages layout exists with workspace members', () => {
    for (const pkg of ['cli', 'core', 'doctor', 'adapters', 'planner']) {
      const pkgJson = path.join(ROOT, 'packages', pkg, 'package.json');
      assert.ok(fs.existsSync(pkgJson), `missing packages/${pkg}/package.json`);
    }

    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      workspaces?: string[];
    };
    assert.ok(Array.isArray(rootPkg.workspaces));
    assert.ok(rootPkg.workspaces?.includes('packages/*'));
  });

  it('planner must not import cli', () => {
    const plannerSrc = path.join(ROOT, 'packages', 'planner', 'src');
    const violations = findForbiddenImports(plannerSrc, /@foundry\/cli|packages\/cli|\.\.\/cli|\.\.\/\.\.\/cli/);
    assert.deepStrictEqual(violations, []);
  });

  it('core must not import planner or cli', () => {
    const coreSrc = path.join(ROOT, 'packages', 'core', 'src');
    const violations = findForbiddenImports(
      coreSrc,
      /@foundry\/(cli|planner)|packages\/(cli|planner)/,
    );
    assert.deepStrictEqual(violations, []);
  });

  it('adapters must not import planner', () => {
    const adaptersSrc = path.join(ROOT, 'packages', 'adapters', 'src');
    const violations = findForbiddenImports(
      adaptersSrc,
      /@foundry\/planner|packages\/planner|\.\.\/planner|\.\.\/\.\.\/planner/,
    );
    assert.deepStrictEqual(violations, []);
  });

  it('doctor must not import planner', () => {
    const doctorSrc = path.join(ROOT, 'packages', 'doctor', 'src');
    const violations = findForbiddenImports(
      doctorSrc,
      /@foundry\/planner|packages\/planner|\.\.\/planner|\.\.\/\.\.\/planner/,
    );
    assert.deepStrictEqual(violations, []);
  });

  it('core must not import adapters', () => {
    const coreSrc = path.join(ROOT, 'packages', 'core', 'src');
    const violations = findForbiddenImports(
      coreSrc,
      /@foundry\/adapters|packages\/adapters|\.\.\/adapters|\.\.\/\.\.\/adapters/,
    );
    assert.deepStrictEqual(violations, []);
  });

  it('bin entry resolves to cli package build output', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      bin?: Record<string, string>;
    };
    assert.strictEqual(rootPkg.bin?.foundry, './packages/cli/bin/foundry.js');
    assert.ok(fs.existsSync(path.join(ROOT, 'packages/cli/src/cli.ts')));
  });
});
