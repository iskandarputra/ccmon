#!/usr/bin/env node
/**
 * @file inspect-data.cjs
 * @brief Dev utility — quick structural peek at raw transcript lines.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The shebang has to be the FIRST line to mean anything; it used to sit below
 * this comment, where it was just a stray `#` the parser choked on.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(os.homedir(), '.claude', 'projects');

// Find the most recently modified .jsonl transcript.
let newest = null;
for (const dir of fs.readdirSync(root)) {
  const dirPath = path.join(root, dir);
  let st;
  try {
    st = fs.statSync(dirPath);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  for (const f of fs.readdirSync(dirPath)) {
    if (!f.endsWith('.jsonl')) continue;
    const fp = path.join(dirPath, f);
    const s = fs.statSync(fp);
    if (!newest || s.mtimeMs > newest.m) newest = { fp, m: s.mtimeMs };
  }
}

console.log('=== newest transcript:', newest.fp);
const lines = fs.readFileSync(newest.fp, 'utf8').trim().split('\n');
console.log('lines:', lines.length);

const types = {};
let sample = null;
for (const l of lines) {
  let j;
  try {
    j = JSON.parse(l);
  } catch {
    types.MALFORMED = (types.MALFORMED || 0) + 1;
    continue;
  }
  types[j.type] = (types[j.type] || 0) + 1;
  if (j.type === 'assistant' && j.message && j.message.usage && !sample) sample = j;
}
console.log('line types:', JSON.stringify(types));

if (sample) {
  const c = JSON.parse(JSON.stringify(sample));
  if (c.message.content) c.message.content = '[...]';
  console.log('=== sample assistant line (content elided):');
  console.log(JSON.stringify(c, null, 1).slice(0, 2200));
}

// Distinct top-level keys across assistant lines + model ids across a few files.
const models = new Set();
const keys = new Set();
let costUSDSeen = 0;
let scanned = 0;
const dirs = fs.readdirSync(root).slice(0, 14);
for (const dir of dirs) {
  const dirPath = path.join(root, dir);
  let st;
  try {
    st = fs.statSync(dirPath);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  for (const f of fs.readdirSync(dirPath).slice(0, 4)) {
    if (!f.endsWith('.jsonl')) continue;
    scanned++;
    const content = fs.readFileSync(path.join(dirPath, f), 'utf8');
    for (const l of content.split('\n')) {
      if (!l) continue;
      let j;
      try {
        j = JSON.parse(l);
      } catch {
        continue;
      }
      if (j.type !== 'assistant' || !j.message) continue;
      Object.keys(j).forEach((k) => keys.add(k));
      if (j.message.model) models.add(j.message.model);
      if (typeof j.costUSD === 'number') costUSDSeen++;
    }
  }
}
console.log('=== across', scanned, 'files:');
console.log('assistant top-level keys:', [...keys].sort().join(', '));
console.log('models seen:', [...models].sort().join(', '));
console.log('lines with costUSD:', costUSDSeen);

// stats-cache.json — what does Claude Code itself cache?
const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json');
if (fs.existsSync(statsPath)) {
  const raw = fs.readFileSync(statsPath, 'utf8');
  console.log('=== stats-cache.json (' + raw.length + ' bytes), preview:');
  console.log(raw.slice(0, 1500));
}
