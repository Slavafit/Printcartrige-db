#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareBrotherSupplyImport } from './brother-supply-import.js';

const outputFlag = process.argv.indexOf('--output-dir');
const outputDirectory = resolve(outputFlag >= 0 ? process.argv[outputFlag + 1] : 'data/official/brother');
const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(path), 'utf8').replace(/^\uFEFF/, ''));
const prepared = prepareBrotherSupplyImport(
  readJson('data/brother-compatibility.json') as Parameters<typeof prepareBrotherSupplyImport>[0],
  readJson('data/brother-audit.json') as Parameters<typeof prepareBrotherSupplyImport>[1],
);
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, 'brother-supplies.json'), `${JSON.stringify(prepared.parsed.rows, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, 'brother-supplies-report.json'), `${JSON.stringify({ ...prepared.summary, errors: prepared.parsed.errors, review: prepared.parsed.warnings }, null, 2)}\n`);
console.log(JSON.stringify({ outputDirectory, ...prepared.summary, errors: prepared.parsed.errors.length, review: prepared.parsed.warnings.length }, null, 2));
if (prepared.parsed.errors.length) process.exitCode = 1;
