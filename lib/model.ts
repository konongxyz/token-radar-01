// Launch Radar model, v3: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// A protocol is a radar target when the snapshot records no token for it (both gecko_id and symbol
// null). Protocols that already record a token are never ranked — but they are not wasted: they are
// the comparables. The snapshot holds 128 tokened protocols with a market cap recorded, and they are
// the only price list for a launch that has not happened yet.
//
// The v2 model priced a protocol as TVL x a category median multiple, then moved it by three
// adjustment factors whose weights (0.004, 0.72 + 0.28, 0.04) were constants someone typed. This
// model types none of them. It fits, on the 128 priced peers:
//
//   log(mcap) = intercept + slope x (log TVL - mean log TVL) + category effect + error
//
// a comparables curve: one global slope, and a per-category intercept shrunk toward zero by the
// category's peer count (n / (n + 8)), so a category priced by one peer borrows the market's curve
// instead of that peer's luck. Implied value = exp of the fitted line at the protocol's TVL and
// category. The dashboard prints the fitted coefficients, so a reader can disagree in the open.
//
// The three v2 factors were fitted too, as extra terms (momentum from the 7-day change, track from
// the days run with no token, reach from the chain count). Their fitted weights, standard errors
// and out-of-sample behaviour are computed below and printed on the dashboard's methodology panel:
// the weights are within noise of zero, one of them changes sign between the two halves of the
// record, and a model carrying them prices held-out peers worse on every test this data allows
// (leave-one-out and both walk-forward splits). The shipped model therefore carries no factor
// adjustment — not because the factors were assumed away, but because they were measured and the
// measurement rejected them. The validation figures on the page are this code's own output.
//
// Every pre-token protocol is ranked, all 342: the ones the house's watchlist rule sets aside as
// products of a token that already trades are ranked too, each carrying its flag and the reason
// for it, so the board accounts for the whole snapshot by name. The 416 tokened protocols are
// listed by name as the live comparables they are.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One board row, as board.json carries it and the dashboard renders it. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  /** Why this row is a product of a token that already trades, or null for a launch candidate. */
  flag: string | null;
  /** The fitted curve's value at this TVL before the category effect, in whole dollars. */
  curve_usd: number;
  /** The category effect applied, as a multiplier (1 when the category has no priced peers). */
  category_x: number;
  /** How many priced peers stand behind this row's category effect. */
  peer_count: number;
}

/** One tokened protocol, listed by name in the dashboard's already-live view. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  /** mcap / TVL where both are recorded, else null. */
  multiple: number | null;
}

/** One category's fitted effect: the multiplier and the peer count behind it. */
export interface CategoryEffect {
  category: string;
  peers: number;
  effect_x: number;
}

/** An error summary of one test: predictions against recorded market caps, in log space. */
export interface ErrStat {
  n: number;
  /** The median miss, as a multiple: half the test peers were priced within this factor. */
  median_miss_x: number;
  /** The 75th-percentile miss, as a multiple. */
  p75_miss_x: number;
  within_2x_pct: number;
  within_3x_pct: number;
}

/** One fitted factor weight from the factored model, with its standard error. */
export interface FactorWeight {
  name: string;
  weight: number;
  se: number;
}

/** The fitted model, as the dashboard's methodology panel prints it. */
export interface FitInfo {
  peer_count: number;
  intercept: number;
  slope: number;
  mean_log_tvl: number;
  shrink_k: number;
  r_squared: number;
  /** The curve's implied multiple (category-neutral) at three reference sizes. */
  curve_points: { tvl: number; multiple: number }[];
  /** The momentum/track/reach weights of the factored fit, which the shipped model does not carry. */
  factors: FactorWeight[];
  /** The same weights fitted on each walk-forward training half: their stability, or lack of it. */
  factor_train_weights: { cutoff: string; momentum: number; track: number; reach: number }[];
}

/** Every validation figure the dashboard prints, computed here at build time. */
export interface ValidationInfo {
  loo_curve: ErrStat;
  loo_factored: ErrStat;
  loo_baseline: ErrStat;
  walk_forward: {
    cutoff: string;
    train_n: number;
    test_n: number;
    curve: ErrStat;
    factored: ErrStat;
    baseline: ErrStat;
  }[];
}

/** The model's stated choices: the shrinkage weight and the factor fit's scaling band. Nothing
 *  else in the model is a chosen number — the curve, the effects and the factor weights are fit. */
export const MODEL = {
  shrink_k: 8,
  factor_band: 40,
  min_implied_usd: 1000,
  wf_cutoffs: ['2023-12-31', '2024-06-30'],
};

/** Parse and lightly validate the sealed snapshot text. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** Whole days between two YYYY-MM-DD dates, or null when either is unusable. */
export function daysBetween(from: string | null, to: string): number | null {
  if (from === null) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** True when the snapshot records no token for the protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** The priced peers: tokened protocols with a market cap and a TVL recorded. They are the fit. */
export function pricedPeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

// ---------------------------------------------------------------------------
// The fit. Ordinary least squares on the normal equations, solved by
// Gauss-Jordan; the inverse's diagonal gives the coefficients' standard errors.
// ---------------------------------------------------------------------------

function ols(X: number[][], y: number[]): { beta: number[]; se: number[] } {
  const k = X[0]!.length;
  const n = X.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) xtx[r]![c]! += X[i]![r]! * X[i]![c]!;
      xty[r]! += X[i]![r]! * y[i]!;
    }
  }
  // Invert XtX by Gauss-Jordan on the augmented identity.
  const m: number[][] = xtx.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    const swap = m[c]!;
    m[c] = m[piv]!;
    m[piv] = swap;
    const d = m[c]![c]!;
    for (let j = 0; j < 2 * k; j++) m[c]![j]! /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * k; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  const inv = m.map((row) => row.slice(k));
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j]!, 0));
  const rss = y.reduce((s, yi, i) => {
    const pred = X[i]!.reduce((a, x, j) => a + x * beta[j]!, 0);
    return s + (yi - pred) ** 2;
  }, 0);
  const s2 = rss / Math.max(1, n - k);
  const se = beta.map((_, j) => Math.sqrt(Math.max(0, s2 * inv[j]![j]!)));
  return { beta, se };
}

/** One peer as the regression sees it. zTrack is null when the snapshot gives no start date. */
interface PeerObs {
  p: SnapshotProtocol;
  cat: string;
  logTvl: number;
  y: number;
  zMom: number;
  zTrack: number | null;
  zReach: number;
}

function observe(p: SnapshotProtocol, asOf: string): PeerObs {
  const age = daysBetween(p.listed_at, asOf);
  return {
    p,
    cat: p.category ?? 'Uncategorised',
    logTvl: Math.log(p.tvl_usd),
    y: Math.log(p.mcap_usd ?? 1),
    zMom: clamp(p.change_7d ?? 0, -MODEL.factor_band, MODEL.factor_band) / MODEL.factor_band,
    zTrack: age === null ? null : Math.min(age, 1825) / 1825,
    zReach: Math.min(Math.max(p.chains.length - 1, 0), 5) / 5,
  };
}

interface Fit {
  factored: boolean;
  beta: number[];
  se: number[];
  meanLogTvl: number;
  /** The track value an undated protocol is given: the dated peers' mean, neither credit nor penalty. */
  zTrackMean: number;
  effects: Map<string, { log: number; peers: number }>;
  rSquared: number;
}

/** Fit the comps model on a set of peers, with or without the three factor terms. */
function fitPeers(peers: SnapshotProtocol[], asOf: string, factored: boolean): Fit {
  const obs = peers.map((p) => observe(p, asOf));
  const dated = obs.filter((o) => o.zTrack !== null);
  const zTrackMean = dated.length > 0 ? dated.reduce((s, o) => s + o.zTrack!, 0) / dated.length : 0.5;
  const meanLogTvl = obs.reduce((s, o) => s + o.logTvl, 0) / obs.length;
  const X = obs.map((o) =>
    factored
      ? [1, o.logTvl - meanLogTvl, o.zMom, o.zTrack ?? zTrackMean, o.zReach]
      : [1, o.logTvl - meanLogTvl],
  );
  const y = obs.map((o) => o.y);
  const { beta, se } = ols(X, y);
  const resid = obs.map((o, i) => y[i]! - X[i]!.reduce((s, x, j) => s + x * beta[j]!, 0));
  // Category effects: each category's mean residual, shrunk toward zero by its peer count.
  const byCat = new Map<string, number[]>();
  obs.forEach((o, i) => {
    const list = byCat.get(o.cat) ?? [];
    list.push(resid[i]!);
    byCat.set(o.cat, list);
  });
  const effects = new Map<string, { log: number; peers: number }>();
  for (const [cat, list] of byCat) {
    const mean = list.reduce((s, r) => s + r, 0) / list.length;
    effects.set(cat, { log: (list.length / (list.length + MODEL.shrink_k)) * mean, peers: list.length });
  }
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = obs.reduce((s, o, i) => {
    const pred = X[i]!.reduce((a, x, j) => a + x * beta[j]!, 0) + (effects.get(o.cat)?.log ?? 0);
    return s + (y[i]! - pred) ** 2;
  }, 0);
  return { factored, beta, se, meanLogTvl, zTrackMean, effects, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

/** The fitted log value of one protocol under a fit. */
function predictLog(fit: Fit, p: SnapshotProtocol, asOf: string): number {
  const o = observe(p, asOf);
  let v = fit.beta[0]! + fit.beta[1]! * (o.logTvl - fit.meanLogTvl) + (fit.effects.get(o.cat)?.log ?? 0);
  if (fit.factored) {
    v += fit.beta[2]! * o.zMom + fit.beta[3]! * (o.zTrack ?? fit.zTrackMean) + fit.beta[4]! * o.zReach;
  }
  return v;
}

/** Summarise prediction errors against recorded market caps. */
function errStat(pairs: { pred: number; actual: number }[]): ErrStat {
  const abs = pairs.map(({ pred, actual }) => Math.abs(pred - Math.log(actual))).sort((a, b) => a - b);
  const n = abs.length;
  const pick = (q: number) => abs[Math.min(n - 1, Math.floor(q * n))]!;
  const within = (factor: number) => (abs.filter((e) => e <= Math.log(factor)).length / n) * 100;
  return {
    n,
    median_miss_x: round2(Math.exp(pick(0.5))),
    p75_miss_x: round2(Math.exp(pick(0.75))),
    within_2x_pct: Math.round(within(2) * 10) / 10,
    within_3x_pct: Math.round(within(3) * 10) / 10,
  };
}

/** Leave-one-out: refit without each peer in turn and price it. */
function loo(peers: SnapshotProtocol[], asOf: string, factored: boolean): ErrStat {
  const pairs: { pred: number; actual: number }[] = [];
  for (let i = 0; i < peers.length; i++) {
    const rest = peers.filter((_, j) => j !== i);
    const fit = fitPeers(rest, asOf, factored);
    pairs.push({ pred: predictLog(fit, peers[i]!, asOf), actual: peers[i]!.mcap_usd! });
  }
  return errStat(pairs);
}

/** The flat baseline's prediction for one peer: TVL x the median peer multiple of a training set. */
function baselinePredict(train: SnapshotProtocol[], p: SnapshotProtocol): number {
  const med = median(train.map((q) => clamp(q.mcap_usd! / q.tvl_usd, 0.01, 5)));
  return Math.log(p.tvl_usd * med);
}

function looBaseline(peers: SnapshotProtocol[]): ErrStat {
  const pairs = peers.map((p, i) => ({
    pred: baselinePredict(peers.filter((_, j) => j !== i), p),
    actual: p.mcap_usd!,
  }));
  return errStat(pairs);
}

/** Walk forward on the listing-date axis: fit on peers listed by the cutoff, price the later ones. */
function walkForward(
  peers: SnapshotProtocol[],
  asOf: string,
  cutoff: string,
): ValidationInfo['walk_forward'][number] {
  const dated = peers.filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => p.listed_at! <= cutoff);
  const test = dated.filter((p) => p.listed_at! > cutoff);
  const run = (factored: boolean) => {
    const fit = fitPeers(train, asOf, factored);
    return errStat(test.map((p) => ({ pred: predictLog(fit, p, asOf), actual: p.mcap_usd! })));
  };
  return {
    cutoff,
    train_n: train.length,
    test_n: test.length,
    curve: run(false),
    factored: run(true),
    baseline: errStat(test.map((p) => ({ pred: baselinePredict(train, p), actual: p.mcap_usd! }))),
  };
}

/** Every validation figure the dashboard prints, computed from the snapshot's priced peers. */
export function validateModel(peers: SnapshotProtocol[], asOf: string): ValidationInfo {
  return {
    loo_curve: loo(peers, asOf, false),
    loo_factored: loo(peers, asOf, true),
    loo_baseline: looBaseline(peers),
    walk_forward: MODEL.wf_cutoffs.map((cutoff) => walkForward(peers, asOf, cutoff)),
  };
}

/** The fitted model as the dashboard prints it, plus the factored fit's weights for the verdict. */
export function fitInfo(peers: SnapshotProtocol[], asOf: string, curve: Fit, factored: Fit): FitInfo {
  const names = ['momentum (7-day change)', 'track (days run, no token)', 'reach (chains)'];
  const factors: FactorWeight[] = names.map((name, i) => ({
    name,
    weight: round3(factored.beta[i + 2]!),
    se: round3(factored.se[i + 2]!),
  }));
  const factor_train_weights = MODEL.wf_cutoffs.map((cutoff) => {
    const dated = peers.filter((p) => p.listed_at !== null && p.listed_at <= cutoff);
    const fit = fitPeers(dated, asOf, true);
    return {
      cutoff,
      momentum: round3(fit.beta[2]!),
      track: round3(fit.beta[3]!),
      reach: round3(fit.beta[4]!),
    };
  });
  const curve_points = [10_000_000, 100_000_000, 1_000_000_000].map((tvl) => ({
    tvl,
    multiple: round3(Math.exp(curve.beta[0]! + curve.beta[1]! * (Math.log(tvl) - curve.meanLogTvl)) / tvl),
  }));
  return {
    peer_count: peers.length,
    intercept: round3(curve.beta[0]!),
    slope: round3(curve.beta[1]!),
    mean_log_tvl: round3(curve.meanLogTvl),
    shrink_k: MODEL.shrink_k,
    r_squared: round3(curve.rSquared),
    curve_points,
    factors,
    factor_train_weights,
  };
}

// ---------------------------------------------------------------------------
// Flags: why a pre-token protocol is a product of a token that already trades.
// The house's watchlist rule, applied per protocol so the reason can be stated.
// ---------------------------------------------------------------------------

const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** The stated reason this protocol is set aside as a product of a live token, or null. */
export function flagReason(p: SnapshotProtocol): string | null {
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') {
    return 'a bridge: the value it carries belongs to the assets it moves and their issuers, not to a launch of its own';
  }
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking') {
    return 'a staking product of a token that already trades: any value accrues to the parent asset, not to a launch of its own';
  }
  if (p.category === 'Restaked BTC') {
    return 'restaked Bitcoin: a product of BTC, which already trades';
  }
  if (p.category === 'CEX') {
    return "an exchange's balance-sheet record: a token, if one ever comes, is the exchange's own, and this TVL is its custody, not a product waiting to launch";
  }
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    return 'a product of a token that already trades, by its category';
  }
  if (VERSION_SUFFIX.test(p.name)) {
    return 'its name carries a version marker: a rerun of a protocol line that already launched under an earlier version';
  }
  if (PRODUCT_WORD.test(p.name)) {
    return 'its name says wrapped, staked or staking: a wrapped or staked product of a token that already trades';
  }
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name === prefix || p.name.startsWith(`${prefix} `) || p.name.startsWith(`${prefix}-`)) {
      return "its name begins with an exchange's name: an exchange product, not an independent launch candidate";
    }
  }
  return null;
}

/** The stated factors of one protocol's implied value, each kept so the page can show its work. */
export interface ValueFactors {
  value: number;
  ageDays: number | null;
  curveUsd: number;
  categoryX: number;
  peerCount: number;
}

/** Price one pre-token protocol from the fitted curve and its category effect. */
export function impliedValue(p: SnapshotProtocol, asOf: string, fit: Fit): ValueFactors {
  const eff = fit.effects.get(p.category ?? 'Uncategorised');
  const curveUsd = Math.exp(fit.beta[0]! + fit.beta[1]! * (Math.log(p.tvl_usd) - fit.meanLogTvl));
  const categoryX = Math.exp(eff?.log ?? 0);
  const value = Math.max(MODEL.min_implied_usd, Math.round(curveUsd * categoryX));
  return {
    value,
    ageDays: daysBetween(p.listed_at, asOf),
    curveUsd: Math.round(curveUsd),
    categoryX: round3(categoryX),
    peerCount: eff?.peers ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Farm plans: one named deposit per plan, sized to the protocol's own tier,
// with the fee drag on that deposit computed from its chain's fee range.
// ---------------------------------------------------------------------------

/** Gas class of a chain, for honest cost lines in the farm plans. */
function gasLine(chain: string): string {
  if (chain === 'Ethereum') return 'Ethereum gas runs $4 to $25 a transaction at ordinary times';
  if (chain === 'Solana') return 'Solana fees run about $0.05 a transaction';
  if (chain === 'Bitcoin') return 'Bitcoin fees run $1 to $10 a transaction';
  return `${chain} gas runs about $0.05 to $0.50 a transaction`;
}

/** Per-transaction fee range of a chain, for the campaign's all-in cost line. */
function feeRange(chain: string): [number, number] {
  if (chain === 'Ethereum') return [4, 25];
  if (chain === 'Solana') return [0.05, 0.05];
  if (chain === 'Bitcoin') return [1, 10];
  return [0.05, 0.5];
}

/** The one named deposit a plan is sized on, scaled to the protocol's own TVL tier. */
export function depositFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 1000;
  if (tvl >= 250_000_000) return 750;
  if (tvl >= 50_000_000) return 500;
  if (tvl >= 10_000_000) return 250;
  return 150;
}

/** The category's core farming action: what the reader actually does on the protocol. */
function coreAction(p: SnapshotProtocol, deposit: number): string {
  const d = `$${deposit.toLocaleString('en-US')}`;
  switch (p.category) {
    case 'Dexs':
      return `Put the ${d} to work on ${p.name} itself: route swaps through its flagship pairs in ordinary sizes across the week, so the volume reads as a real user's and not a burst.`;
    case 'Lending':
    case 'CDP':
      return `Supply the ${d} in a mainstream asset on ${p.name} and keep a small, safe borrow against it for at least a month, so both sides of its market carry your address.`;
    case 'Derivatives':
      return `Post the ${d} as margin on ${p.name} and trade a few modest perpetual positions a week at low leverage, holding one position open across each weekly boundary.`;
    case 'Bridge':
    case 'Canonical Bridge':
      return `Bridge the ${d} through ${p.name} in both directions across the month, splitting it into four ordinary crossings instead of one large one.`;
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Restaked BTC':
      return `Stake the ${d} through ${p.name} and hold the receipt token in the same wallet for a full quarter, unstaking nothing, so the holding period is unambiguous.`;
    case 'Yield':
    case 'Yield Aggregator':
    case 'Onchain Capital Allocator':
    case 'Risk Curators':
      return `Deposit the ${d} into one of ${p.name}'s established vaults and leave it untouched for at least eight weeks, adding a small top-up in the second month.`;
    case 'RWA':
      return `Onboard with ${p.name} and hold ${d} of its flagship real-world-asset product for a full quarter, completing whatever eligibility checks it asks of holders.`;
    case 'Launchpad':
      return `Take part in one ordinary launch on ${p.name} with the ${d} or less, and hold the allocation past its first week instead of flipping it on day one.`;
    case 'Chain':
      return `Bridge the ${d} onto the ${p.name} chain itself and become a weekly user of two of its native applications, keeping a small balance there between visits.`;
    default:
      return `Use ${p.name}'s core product with the ${d} at stake for at least eight weeks, doing the one action the product exists for rather than visiting and leaving.`;
  }
}

/** A step shaped by this protocol's own facts: its chains, its age, its category's second feature. */
function factStep(p: SnapshotProtocol, deposit: number, ageDays: number | null): string {
  if (p.chains.length >= 2) {
    const half = Math.max(50, Math.round(deposit / 2));
    return `In week two, take $${half.toLocaleString('en-US')} of the position onto ${p.chains[1]} and repeat the core action there: ${p.name} runs on ${p.chains.length} chains, and an address that used two of them leaves a stronger record than one that used one twice.`;
  }
  if (ageDays !== null && ageDays >= 1095) {
    return `It has run ${ageDays} days with no token recorded: join its governance forum, and vote or delegate where it offers one — a protocol this established can already name its long-standing addresses, and yours should be one of them.`;
  }
  switch (p.category) {
    case 'Dexs':
      return `From week three, work a second pair beside the flagship one: a record that shows two pairs reads as a user choosing, not a script repeating.`;
    case 'Lending':
    case 'CDP':
      return `From week three, use the borrow side once as well as the supply side and repay in full: both sides of the market carrying your address is the record that lasts.`;
    case 'Yield':
    case 'Yield Aggregator':
    case 'Onchain Capital Allocator':
    case 'Risk Curators':
      return `From week three, add a second, smaller vault beside the first, so the record shows a choice between its products rather than a single click.`;
    case 'Derivatives':
      return `From week three, trade a second market beside your first, at the same modest size: breadth across its books is what a regular's record looks like.`;
    default:
      return `From week three, use one feature beside the core one — the adjacent product ${p.name} itself puts next to it — so the record shows exploration, not a single repeated click.`;
  }
}

/** What this protocol's own snapshot week says about sizing the campaign. */
function momentumTail(p: SnapshotProtocol): string {
  if (p.change_7d === null) return 'DefiLlama reports no seven-day change for it, so there is no momentum to size by; the steady rhythm is the whole plan.';
  if (p.change_7d >= 10) return `Its TVL climbed ${p.change_7d.toFixed(1)}% in the snapshot's week: interest is building, so the early weeks of the plan are the valuable ones — do not skip them.`;
  if (p.change_7d <= -10) return `Its TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the snapshot's week: keep the deposit at the low end until the slide stops, and re-check before the month-two top-up.`;
  return `Its TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% in the snapshot's week: no strong signal either way, so consistency matters more than timing.`;
}

/** A concrete six-step farm plan for one protocol, sized on one named deposit. */
export function farmSteps(p: SnapshotProtocol, asOf: string, fit: Fit): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const deposit = depositFor(p.tvl_usd);
  const { ageDays } = impliedValue(p, asOf, fit);
  const ageLine = ageDays === null
    ? 'DefiLlama gives no start date for it, so treat its history as unproven and keep the deposit at this size, no larger.'
    : `It has run ${ageDays} days with no token recorded, which is the track record this plan leans on.`;
  const [feeLo, feeHi] = feeRange(chain);
  const txns = 24;
  const feesLo = feeLo * txns;
  const feesHi = Math.max(feesLo, feeHi * txns);
  const feeText = (v: number) => (v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString('en-US')}`);
  const dragLo = Math.round((feesLo / deposit) * 1000) / 10;
  const dragHi = Math.round((feesHi / deposit) * 1000) / 10;
  return [
    `Set up one clean wallet for ${p.name} on ${chain} and fund it with the plan's deposit of $${deposit.toLocaleString('en-US')} plus fee headroom: ${gasLine(chain)}. ${ageLine}`,
    coreAction(p, deposit),
    factStep(p, deposit, ageDays),
    `Repeat the core action on a weekly rhythm for twelve weeks, about 15 minutes a session, varying amounts and times of day so the pattern reads as use, not farming theatre. ${momentumTail(p)}`,
    `Keep a log of every transaction hash, date and fee from the first week, and from month two check ${p.name}'s official channels once a week for a points programme, a testnet or a governance opening: if it ever snapshots its users, the log is your proof, and a claim window is often short.`,
    `All-in for the twelve weeks: the $${deposit.toLocaleString('en-US')} deposit (withdrawable wherever the product allows), ${feeText(feesLo)} to ${feeText(feesHi)} of network fees across about ${txns} transactions on ${chain} — ${dragLo}% to ${dragHi}% of the deposit — and near three hours of your time; if no token ever comes, the fees and the time are the whole loss.`,
  ];
}

/** Everything the dashboard needs beyond the board itself. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocol_count: number;
  pre_token_count: number;
  ranked_count: number;
  flagged_count: number;
  live_count: number;
  priced_peer_count: number;
  watchlist_size: number;
  rows: BoardRow[];
  live: LiveRow[];
  fit: FitInfo;
  validation: ValidationInfo;
  category_effects: CategoryEffect[];
  model: typeof MODEL;
}

/**
 * Build the ranked board: every pre-token protocol the snapshot holds, ranked by the fitted
 * model's implied value — launch candidates and flagged products of live tokens alike, each
 * flagged row carrying its reason. Tokened protocols are listed by name as live comparables.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const watch = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter(recordsNoToken);
  const tokened = snapshot.protocols.filter((p) => !recordsNoToken(p));
  const peers = pricedPeers(snapshot);
  const curveFit = fitPeers(peers, snapshot.as_of, false);
  const factoredFit = fitPeers(peers, snapshot.as_of, true);
  const validation = validateModel(peers, snapshot.as_of);
  const fit = fitInfo(peers, snapshot.as_of, curveFit, factoredFit);

  const scored = preToken
    .map((p) => ({ p, f: impliedValue(p, snapshot.as_of, curveFit), flag: flagReason(p) }))
    .sort((a, b) => b.f.value - a.f.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  scored.forEach((s, i) => {
    let value = Math.min(s.f.value, previous - 1);
    if (value < 1) value = 1;
    previous = value;
    board.push({
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: farmSteps(s.p, snapshot.as_of, curveFit),
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: s.f.ageDays,
      watchlist: watch.has(s.p.slug),
      flag: s.flag,
      curve_usd: s.f.curveUsd,
      category_x: s.f.categoryX,
      peer_count: s.f.peerCount,
    });
  });

  const live: LiveRow[] = tokened
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      multiple: p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? round3(p.mcap_usd / p.tvl_usd) : null,
    }))
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  const category_effects: CategoryEffect[] = [...curveFit.effects.entries()]
    .map(([category, e]) => ({ category, peers: e.peers, effect_x: round3(Math.exp(e.log)) }))
    .sort((a, b) => (a.category < b.category ? -1 : 1));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    protocol_count: snapshot.protocols.length,
    pre_token_count: preToken.length,
    ranked_count: board.length,
    flagged_count: board.filter((r) => r.flag !== null).length,
    live_count: tokened.length,
    priced_peer_count: peers.length,
    watchlist_size: snapshot.watchlist.length,
    rows: board,
    live,
    fit,
    validation,
    category_effects,
    model: MODEL,
  };
  return { board, radar };
}

/** The gate's board rules, checked before anything is written: returns the first issue or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!known.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${i + 1}: implied_value_usd ${row.implied_value_usd} is not a whole dollar figure in range`;
    }
    if (row.implied_value_usd > previous) return `row ${i + 1}: implied value rises as rank ascends`;
    if (i > 0 && row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1}: ${row.farm_steps.length} farm steps, outside 3 to 12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters, outside 20 to 600`;
    }
  }
  if (board.length > 1 && allSame) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: one assignment the page reads, no network involved. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR_DATA = ${JSON.stringify(radar)};\n`;
}
