#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const REPLACEMENTS = [
  {
    files: 'packages/adapters/src',
    rules: [
      [/from '\.\.\/config\//g, "from '@foundry/core/config/"],
    ],
  },
  {
    files: 'packages/doctor/src',
    rules: [
      [/from '\.\.\/\.\.\/types\//g, "from '@foundry/core/types/"],
      [/from '\.\.\/types\//g, "from '@foundry/core/types/"],
      [/from '\.\.\/schema\//g, "from '@foundry/core/schema/"],
      [/from '\.\.\/config\//g, "from '@foundry/core/config/"],
      [/from '\.\.\/adapters\//g, "from '@foundry/adapters/"],
    ],
  },
  {
    files: 'packages/planner/src',
    rules: [
      [/from '\.\.\/doctor\//g, "from '@foundry/doctor/"],
      [/from '\.\.\/adapters\//g, "from '@foundry/adapters/"],
      [/from '\.\.\/config\//g, "from '@foundry/core/config/"],
      [/from '\.\.\/types\//g, "from '@foundry/core/types/"],
      [/from '\.\.\/state\//g, "from '@foundry/core/state/"],
    ],
  },
  {
    files: 'packages/cli/src',
    rules: [
      [/from '\.\.\/types\//g, "from '@foundry/core/types/"],
      [/from '\.\.\/schema\//g, "from '@foundry/core/schema/"],
      [/from '\.\.\/config\//g, "from '@foundry/core/config/"],
      [/from '\.\.\/state\//g, "from '@foundry/core/state/"],
      [/from '\.\.\/doctor\//g, "from '@foundry/doctor/"],
      [/from '\.\.\/plan\//g, "from '@foundry/planner/plan/"],
      [/from '\.\.\/publish\//g, "from '@foundry/planner/publish/"],
      [/from '\.\.\/adapters\//g, "from '@foundry/adapters/"],
    ],
  },
  {
    files: 'tests',
    rules: [
      [/from '\.\.\/src\/types\//g, "from '@foundry/core/types/"],
      [/from '\.\.\/src\/schema\//g, "from '@foundry/core/schema/"],
      [/from '\.\.\/src\/config\//g, "from '@foundry/core/config/"],
      [/from '\.\.\/src\/state\//g, "from '@foundry/core/state/"],
      [/from '\.\.\/src\/doctor\//g, "from '@foundry/doctor/"],
      [/from '\.\.\/src\/plan\//g, "from '@foundry/planner/plan/"],
      [/from '\.\.\/src\/publish\//g, "from '@foundry/planner/publish/"],
      [/from '\.\.\/src\/adapters\//g, "from '@foundry/adapters/"],
      [/from '\.\.\/src\/state\.ts'/g, "from '@foundry/core/state.js'"],
      [/from '\.\.\/src\/state\/run-writer\.ts'/g, "from '@foundry/core/state/run-writer.js'"],
    ],
  },
  {
    files: 'scripts',
    rules: [
      [/from '\.\.\/src\/plan\//g, "from '@foundry/planner/plan/"],
      [/from '\.\.\/src\/state\//g, "from '@foundry/core/state/"],
      [/from '\.\.\/src\/doctor\//g, "from '@foundry/doctor/"],
      [/from '\.\.\/src\/adapters\//g, "from '@foundry/adapters/"],
    ],
  },
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

for (const { files, rules } of REPLACEMENTS) {
  for (const file of walk(path.join(ROOT, files))) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const [pattern, replacement] of rules) {
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(file, content);
  }
}

console.log('Import paths updated');
