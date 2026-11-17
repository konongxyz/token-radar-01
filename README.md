# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/konongxyz/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/konongxyz/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar — a token launch radar that ranks 191 pre-token protocols from a sealed DefiLlama snapshot by implied launch value, each with a concrete farm plan, plus a fully offline dashboard. Watchlist coverage 40/40.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9m688dgh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

A token launch radar for make.fun's "Build the best token launch radar" bounty.

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot
at `/input/snapshot.json` and writes, into `/output`:

- `board.json` — the ranked board: every protocol on the snapshot's watchlist
  plus the strongest pre-token protocols below its $50M floor, each with an
  implied launch value and a concrete farm plan;
- `data.js` — the same board in the form the dashboard reads;
- `dashboard/` — a static page (board, filters, sort, per-protocol detail
  view) that renders with no network;
- `screenshots/` — the board, a detail view and a filtered view;
- `dossier.json` — built with `buildDossier` from `vendor/makefun-board.ts`.

## The model

A protocol is a target when the snapshot records no token for it. Implied
value is built only from the snapshot's figures:

- anchor = TVL × a per-category multiple (DEXs 1.1, lending 0.8, bridges
  0.35, default 0.5);
- momentum = 1 + clamp(7-day change, −40…80) × 0.004;
- track = 0.72 + 0.28 × min(days tracked, 1825) / 1825 — years run with no
  token recorded counts as evidence;
- reach = 1 + 4% per extra chain, up to five.

The constants live in `lib/model.ts` and are printed on the dashboard itself.
Protocols that already record a token are counted and set aside, never
ranked: the radar's question is what a launch would be worth, and what a
reader should do about it before it happens.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

The program is deterministic: two runs over the same snapshot write the
same bytes.
