// Launch Radar entry point (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), fits the comps model
// of lib/model.ts on the snapshot's priced peers, ranks every pre-token protocol, writes the
// ranked board to /output/board.json and the dashboard's data to /output/data.js, copies
// dashboard/ and screenshots/ into /output, and finishes with /output/dossier.json from the
// vendored make.fun library. The run is a pure function of the snapshot bytes: run it twice and
// the outputs are identical, byte for byte.
//
// Locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, restated so the program refuses before the scorer has to. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into place, skipping dotfiles; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html');
for (const name of pageFiles) {
  if (!PLAIN_NAME.test(name)) fail(`dashboard/${name}: names are letters, digits and . _ -, 1 to 128 characters`);
}

const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier goes last: the scorer rebuilds it from this same /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols read, ${radar.pre_token_count} record no token, all ${radar.ranked_count} of them ranked (${radar.flagged_count} flagged as products of live tokens), ${radar.live_count} already live\n` +
    `launch radar: model fitted on ${radar.priced_peer_count} priced peers (slope ${radar.fit.slope}); leave-one-out median miss x${radar.validation.loo_curve.median_miss_x}; walk-forward ${radar.validation.walk_forward.map((w) => `${w.cutoff} x${w.curve.median_miss_x}`).join(', ')}\n` +
    `launch radar: board of ${board.length} rows (all ${snapshot.watchlist.length} watchlist protocols covered), top claim ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images), dossier.json under ${out}\n`,
);
