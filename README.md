# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/konongxyz/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/konongxyz/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar — a token launch radar that ranks all 342 pre-token protocols from a sealed DefiLlama snapshot by implied launch value from a fitted comparables model, each with a concrete farm plan, plus a fully offline dashboard whose methodology panel prints the model's own validation figures. Watchlist coverage 40/40.

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

- `board.json` — the ranked board: every pre-token protocol the snapshot
  holds, all 342, each with an implied launch value and a concrete farm
  plan; the 144 that are products of tokens that already trade are ranked
  too, each carrying its flag and the stated reason for it;
- `data.js` — the same board in the form the dashboard reads, plus the
  416 already-live protocols by name and the model's fit and validation
  figures;
- `dashboard/` — a static page (board, already-live view, filters, sort,
  per-protocol detail view, methodology panel) that renders with no
  network;
- `screenshots/` — the board, a detail view and a filtered view;
- `dossier.json` — built with `buildDossier` from `vendor/makefun-board.ts`.

## The model

A protocol is a target when the snapshot records no token for it. The
model is fitted, not typed: on the snapshot's 128 priced peers it fits,
by least squares,

    log(market cap) = intercept + slope x (log TVL - mean log TVL) + category effect

One global slope (0.52 on this snapshot: market cap rises at about half
the rate of TVL, so the implied multiple falls with size), and a
per-category effect shrunk toward zero by n / (n + 8), so a category
priced by one peer borrows the market's curve instead of that peer's
luck. Implied value = exp of the fitted line at the protocol's TVL and
category.

The previous version's three adjustment factors (momentum, track, reach)
were fitted as extra terms rather than typed: their weights are within
noise of zero, one changes sign between the two halves of the record,
and a model carrying them prices held-out peers worse on every test —
so the shipped model carries none. The dashboard's methodology panel
prints the weights, the standard errors, and the tests: leave-one-out
median miss x3.86 on the 128 peers, walk-forward x2.91 (fit to
2023-12-31) and x3.32 (fit to 2024-06-30), against x5.09 for the flat
median-multiple baseline this model replaces. All figures are computed
by the program at build time from the sealed snapshot.

The fit is computed from the snapshot at run time in `lib/model.ts` and
printed on the dashboard — coefficients, category effects with the peer
count behind each, and the validation tables — so a reader can disagree
with any of it in the open. Protocols that already record a token are
never ranked: they are the comparables, listed by name in the dashboard's
already-live view. The radar's question is what a launch would be worth,
and what a reader should do about it before it happens.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

The program is deterministic: two runs over the same snapshot write the
same bytes.
