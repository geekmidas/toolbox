#!/usr/bin/env node

/**
 * Transforms Vitest benchmark JSON output to github-action-benchmark format.
 *
 * Usage: node scripts/transform-benchmarks.js <input.json> <output.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [inputFile, outputFile] = process.argv.slice(2);

if (!inputFile || !outputFile) {
  process.exit(1);
}

const data = JSON.parse(readFileSync(inputFile, 'utf8'));
const results = [];

for (const file of data.files || []) {
  for (const group of file.groups || []) {
    for (const bench of group.benchmarks || []) {
      results.push({
        name: `${group.fullName} > ${bench.name}`,
        unit: 'ops/sec',
        value: Math.round(bench.hz),
        range: `±${bench.rme.toFixed(2)}%`,
      });
    }
  }
}

writeFileSync(outputFile, JSON.stringify(results, null, 2));
process.stdout.write(
  `Transformed ${results.length} benchmarks to ${outputFile}\n`,
);
