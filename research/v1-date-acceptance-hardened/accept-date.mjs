#!/usr/bin/env node
// Hardened external acceptance for date-001 (sandbox / Mini control).
// Expected outputs are LITERALS measured from source or required by the
// CHANGED partition. Never build expected values with new Date(y,m,d) /
// Date.UTC(y,m,d) for the cases under test.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(process.argv[2]).href;

// CHANGED: same literal in every TZ (calendar day preserved).
const CHANGED = {
  "2026-09-08": "8 sept 2026",
  "2026-01-01": "1 ene 2026",
  "2026-12-31": "31 dic 2026",
  "2027-01-01": "1 ene 2027",
  "2024-02-29": "29 feb 2024",
  "2028-02-29": "29 feb 2028",
};

// PRESERVED: per-TZ literals measured from source HEAD 19c947b formatters.js
// (research/v1-date-acceptance-hardened/source/measured-outputs.json).
const PRESERVED = {
  "Europe/Madrid": {
    "0001-01-01": "31 dic 1",
    "0099-12-31": "30 dic 99",
    "2027-02-29": "1 mar 2027",
    "2026-09-08T00:00:00Z": "8 sept 2026",
    "2026-01-01T23:00:00Z": "2 ene 2026",
    "Date:2026-09-08T00:00:00Z": "8 sept 2026",
    dateTime_2026_09_08T00: "8 sept, 02:00",
    dateTime_2026_01_01T23: "2 ene, 00:00",
  },
  "America/New_York": {
    "0001-01-01": "31 dic 1",
    "0099-12-31": "30 dic 99",
    "2027-02-29": "28 feb 2027",
    "2026-09-08T00:00:00Z": "7 sept 2026",
    "2026-01-01T23:00:00Z": "1 ene 2026",
    "Date:2026-09-08T00:00:00Z": "7 sept 2026",
    dateTime_2026_09_08T00: "7 sept, 20:00",
    dateTime_2026_01_01T23: "1 ene, 18:00",
  },
  "Asia/Tokyo": {
    "0001-01-01": "1 ene 1",
    "0099-12-31": "31 dic 99",
    "2027-02-29": "1 mar 2027",
    "2026-09-08T00:00:00Z": "8 sept 2026",
    "2026-01-01T23:00:00Z": "2 ene 2026",
    "Date:2026-09-08T00:00:00Z": "8 sept 2026",
    dateTime_2026_09_08T00: "8 sept, 09:00",
    dateTime_2026_01_01T23: "2 ene, 08:00",
  },
};

const PLACEHOLDERS = {
  null: "-",
  undefined: "-",
  "": "-",
  "not-a-date": "-",
};

const NUM_LITERAL = "1234,5";

const TIMEZONES = ["Europe/Madrid", "America/New_York", "Asia/Tokyo"];

function buildChecks(tz) {
  const preserved = PRESERVED[tz];
  // Checks encoded as data; executed in child with TZ set.
  return {
    changed: CHANGED,
    preservedDateShort: {
      "0001-01-01": preserved["0001-01-01"],
      "0099-12-31": preserved["0099-12-31"],
      "2027-02-29": preserved["2027-02-29"],
      "2026-09-08T00:00:00Z": preserved["2026-09-08T00:00:00Z"],
      "2026-01-01T23:00:00Z": preserved["2026-01-01T23:00:00Z"],
    },
    preservedDateObject: preserved["Date:2026-09-08T00:00:00Z"],
    dateTime: {
      "2026-09-08T00:00:00Z": preserved.dateTime_2026_09_08T00,
      "2026-01-01T23:00:00Z": preserved.dateTime_2026_01_01T23,
    },
    placeholders: PLACEHOLDERS,
    num: NUM_LITERAL,
  };
}

let failed = false;
let assertionCount = 0;

for (const TZ of TIMEZONES) {
  const checks = buildChecks(TZ);
  const source = `
import assert from 'node:assert/strict';
import { dateShort, dateTime, num } from ${JSON.stringify(moduleUrl)};
const checks = ${JSON.stringify(checks)};
let n = 0;
for (const [value, want] of Object.entries(checks.changed)) {
  assert.equal(dateShort(value), want, 'CHANGED dateShort ' + value + ' in ' + process.env.TZ);
  n++;
}
for (const [value, want] of Object.entries(checks.preservedDateShort)) {
  assert.equal(dateShort(value), want, 'PRESERVED dateShort ' + value + ' in ' + process.env.TZ);
  n++;
}
assert.equal(dateShort(new Date('2026-09-08T00:00:00Z')), checks.preservedDateObject, 'PRESERVED Date object in ' + process.env.TZ);
n++;
for (const [value, want] of Object.entries(checks.dateTime)) {
  assert.equal(dateTime(value), want, 'PRESERVED dateTime ' + value + ' in ' + process.env.TZ);
  n++;
}
assert.equal(dateShort(null), checks.placeholders.null, 'placeholder null');
assert.equal(dateShort(undefined), checks.placeholders.undefined, 'placeholder undefined');
assert.equal(dateShort(''), checks.placeholders[''], 'placeholder empty');
assert.equal(dateShort('not-a-date'), checks.placeholders['not-a-date'], 'placeholder not-a-date');
n += 4;
assert.equal(num(1234.5, 1), checks.num, 'PRESERVED num');
n++;
console.log('OK', process.env.TZ, 'assertions', n);
`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      env: { PATH: process.env.PATH, OPENSSL_CONF: "/dev/null", TZ },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  const line = (result.stdout || "").trim();
  if (line) console.log(line);
  if (result.status !== 0) {
    failed = true;
    console.error(`FAIL ${TZ}`);
    if (result.stderr) console.error(result.stderr.trim());
  } else {
    const match = /assertions (\d+)/.exec(line);
    if (match) assertionCount += Number(match[1]);
  }
}

if (failed) {
  console.error("ACCEPTANCE_FAIL date cases");
  process.exit(1);
}
console.log(`ACCEPTANCE_OK assertions=${assertionCount} timezones=${TIMEZONES.length}`);
