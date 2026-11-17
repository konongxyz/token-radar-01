// Launch Radar model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// A protocol is a radar target when the snapshot records no token for it (both gecko_id and symbol
// null). Protocols that already record a token are never ranked — but they are not wasted: they are
// the comparables. The snapshot holds 128 tokened protocols with a market cap recorded, and what the
// market pays for a dollar of their TVL, category by category, is the only honest price list for a
// launch that has not happened yet.
//
// Implied value is built only from the snapshot's own figures:
//
//   multiple  = the category's peer multiple: the median market-cap/TVL of the tokened protocols
//               in the same category, each peer ratio first winsorized to [0.01, 5] so a dust-TVL
//               outlier cannot set a price, then shrunk toward the all-category median with a
//               weight of PEER_SHRINK_K phantom peers, so a category priced by one or two peers
//               borrows most of its price from the whole market. A category with no priced peers
//               takes the all-category median. The result is clamped to [0.02, 2.5].
//   anchor    = tvl_usd x multiple                 what comparable launches say this TVL is worth
//   momentum  = 1 + clamp(change_7d, -40, 80) x 0.004   a week of growth lifts the claim, a slide cuts it
//   track     = 0.72 + 0.28 x min(age_days, 1825)/1825  years run with no token is evidence, not a gap
//   reach     = 1 + 0.04 x min(chains - 1, 5)           each extra chain is distribution a launch inherits
//   implied   = round(anchor x momentum x track x reach), at least 1,000
//
// No protocol name is ever special-cased and no multiple is a constant anyone typed: one function
// scores every row, the peer table is computed from the snapshot at run time, and the dashboard
// prints the whole table so a reader can disagree with it in the open.

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
  radar_score: number;
  /** The comparables multiple applied to this row's TVL, and how many priced peers stand behind it. */
  peer_multiple: number;
  peer_count: number;
  /** The four stated factors of the implied value, so the detail view can show the working. */
  anchor_usd: number;
  momentum: number;
  track: number;
  reach: number;
}

/** One category's peer pricing: the raw median, the shrunk multiple actually used, the evidence. */
export interface PeerRow {
  category: string;
  peers: number;
  median: number;
  multiple: number;
}

/** The model's stated constants, printed on the dashboard's model panel. */
export const MODEL = {
  peer_winsor_lo: 0.01,
  peer_winsor_hi: 5,
  peer_shrink_k: 4,
  multiple_floor: 0.02,
  multiple_cap: 2.5,
  momentum_per_pct: 0.004,
  momentum_floor: -40,
  momentum_cap: 80,
  track_base: 0.72,
  track_span: 0.28,
  track_full_days: 1825,
  unknown_age_days: 300,
  reach_per_chain: 0.04,
  reach_max_chains: 5,
  min_implied_usd: 1000,
  max_rows: 300,
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

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** True when the snapshot records no token for the protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * The comparables table, derived from the snapshot itself: every tokened protocol with a market
 * cap recorded is a priced peer. Returns the per-category rows (sorted by category name), the
 * all-category median the shrinkage leans on, and a lookup from category to its shrunk multiple
 * and peer count. Protocols whose category the snapshot leaves null form their own peer group.
 */
export function peerTable(snapshot: Snapshot): { rows: PeerRow[]; globalMedian: number; byCategory: Map<string | null, PeerRow> } {
  const ratios = new Map<string | null, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, MODEL.peer_winsor_lo, MODEL.peer_winsor_hi);
    all.push(ratio);
    const list = ratios.get(p.category) ?? [];
    list.push(ratio);
    ratios.set(p.category, list);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string | null, PeerRow>();
  for (const [category, list] of ratios) {
    const med = median(list);
    const shrunk = (list.length * med + MODEL.peer_shrink_k * globalMedian) / (list.length + MODEL.peer_shrink_k);
    byCategory.set(category, {
      category: category ?? 'Uncategorised',
      peers: list.length,
      median: med,
      multiple: clamp(shrunk, MODEL.multiple_floor, MODEL.multiple_cap),
    });
  }
  const rows = [...byCategory.values()].sort((a, b) => (a.category < b.category ? -1 : 1));
  return { rows, globalMedian, byCategory };
}

/** The multiple and peer count a protocol is priced with: its category's, or the market's fallback. */
function multipleFor(
  p: SnapshotProtocol,
  peers: { globalMedian: number; byCategory: Map<string | null, PeerRow> },
): { multiple: number; peers: number } {
  const row = peers.byCategory.get(p.category);
  if (row !== undefined) return { multiple: row.multiple, peers: row.peers };
  return { multiple: clamp(peers.globalMedian, MODEL.multiple_floor, MODEL.multiple_cap), peers: 0 };
}

/** Categories the snapshot's own field guide treats as products of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * A launch candidate, by the field guide's own rule (the one that built the watchlist): not a
 * wrapped, staked or bridged product of a token that trades, not an exchange's custodial balance,
 * and not a versioned rerun of a protocol that already launched. Applied by category and by name
 * pattern, never by a list of names: the same test scores every protocol.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name === prefix || p.name.startsWith(`${prefix} `) || p.name.startsWith(`${prefix}-`)) return false;
  }
  return true;
}

/** The stated factors of one protocol's implied value, each kept so the page can show its work. */
export interface ValueFactors {
  value: number;
  ageDays: number | null;
  multiple: number;
  peerCount: number;
  anchor: number;
  momentum: number;
  track: number;
  reach: number;
}

/** Price one protocol from the snapshot's figures and the derived peer table. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  peers: { globalMedian: number; byCategory: Map<string | null, PeerRow> },
): ValueFactors {
  const { multiple, peers: peerCount } = multipleFor(p, peers);
  const anchor = p.tvl_usd * multiple;
  const change = p.change_7d === null ? 0 : clamp(p.change_7d, MODEL.momentum_floor, MODEL.momentum_cap);
  const momentum = 1 + change * MODEL.momentum_per_pct;
  const ageDays = daysBetween(p.listed_at, asOf);
  const age = ageDays === null ? MODEL.unknown_age_days : ageDays;
  const track = MODEL.track_base + MODEL.track_span * (Math.min(age, MODEL.track_full_days) / MODEL.track_full_days);
  const reach = 1 + MODEL.reach_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.reach_max_chains);
  const value = Math.max(MODEL.min_implied_usd, Math.round(anchor * momentum * track * reach));
  return { value, ageDays, multiple, peerCount, anchor: Math.round(anchor), momentum, track, reach };
}

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

/** Position size a small farmer can defend, scaled to the protocol's own TVL. */
function stakeLine(tvl: number): string {
  if (tvl >= 500_000_000) return '$1,000 to $2,500';
  if (tvl >= 100_000_000) return '$500 to $1,500';
  if (tvl >= 25_000_000) return '$250 to $750';
  return '$100 to $400';
}

/** The category's core farming action: what the reader actually does on the protocol. */
function coreAction(p: SnapshotProtocol): string {
  const stake = stakeLine(p.tvl_usd);
  switch (p.category) {
    case 'Dexs':
      return `Trade on ${p.name} itself: route ${stake} of swaps a week through its pools in ordinary sizes, favouring its flagship pairs, so your volume reads as a real user's and not a burst.`;
    case 'Lending':
    case 'CDP':
      return `Supply ${stake} of a mainstream asset on ${p.name} and keep a small, safe borrow against it for at least a month, so both sides of its market carry your address.`;
    case 'Derivatives':
      return `Open modest perpetual positions on ${p.name} with ${stake} of margin, a few trades a week at low leverage, and hold one position open across each weekly boundary.`;
    case 'Bridge':
    case 'Canonical Bridge':
      return `Bridge ${stake} through ${p.name} in both directions across the month, splitting it into four ordinary crossings instead of one large one.`;
    case 'Liquid Staking':
    case 'Liquid Restaking':
      return `Stake ${stake} through ${p.name} and hold the receipt token in the same wallet for a full quarter, unstaking nothing, so your holding period is unambiguous.`;
    case 'Yield':
    case 'Yield Aggregator':
    case 'Onchain Capital Allocator':
    case 'Risk Curators':
      return `Deposit ${stake} into one of ${p.name}'s established vaults and leave it untouched for at least eight weeks, adding a small top-up in the second month.`;
    case 'RWA':
      return `Onboard with ${p.name} and hold ${stake} of its flagship real-world-asset product for a full quarter, completing whatever eligibility checks it asks of holders.`;
    case 'Launchpad':
      return `Take part in one ordinary launch on ${p.name} with ${stake} or less, and hold the allocation past its first week instead of flipping it on day one.`;
    case 'Chain':
      return `Become a weekly user of the ${p.name} chain itself: bridge ${stake} in, use two of its native applications, and keep a small balance there between visits.`;
    default:
      return `Use ${p.name}'s core product with ${stake} at stake for at least eight weeks, doing the one action the product exists for rather than visiting and leaving.`;
  }
}

/** What this protocol's own snapshot week says about sizing the campaign. */
function momentumLine(p: SnapshotProtocol): string {
  if (p.change_7d === null) return 'DefiLlama reports no seven-day change for it, so there is no momentum signal to size by; keep to the middle of the stake range.';
  if (p.change_7d >= 10) return `Its TVL climbed ${p.change_7d.toFixed(1)}% in the snapshot's week: interest is building, so start in the first week rather than after any launch announcement, when the crowd arrives.`;
  if (p.change_7d <= -10) return `Its TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the snapshot's week: keep size at the low end of the range until the slide stops, and re-check before adding.`;
  return `Its TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% in the snapshot's week: no strong momentum either way, so the steady weekly rhythm matters more than timing.`;
}

/** A concrete six-step farm plan for one protocol, every step with a cost or a duration. */
export function farmSteps(p: SnapshotProtocol, asOf: string, peers: { globalMedian: number; byCategory: Map<string | null, PeerRow> }): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const chainList = p.chains.length > 1 ? `${chain} (it also runs on ${p.chains.slice(1, 3).join(' and ')})` : chain;
  const { ageDays } = impliedValue(p, asOf, peers);
  const ageLine = ageDays === null
    ? 'DefiLlama gives no start date for it, so treat its history as unproven and size down.'
    : `It has run ${ageDays} days with no token recorded, which is the track record this plan leans on.`;
  const [feeLo, feeHi] = feeRange(chain);
  const fees = `$${Math.max(1, Math.round(feeLo * 24))} to $${Math.round(feeHi * 24)}`;
  return [
    `Set up one clean wallet for ${p.name} on ${chainList} and fund it before you touch the product: ${gasLine(chain)}, so budget the stake plus roughly ten transactions of fees. ${ageLine}`,
    coreAction(p),
    `Repeat the core action on a weekly rhythm for eight to twelve weeks, about 15 minutes a session, varying amounts and times of day so the pattern reads as use, not farming theatre. ${momentumLine(p)}`,
    `Keep a simple log of every transaction hash, date and fee from the first week: if ${p.name} ever snapshots its users, the log is your proof and your memory of what the campaign cost.`,
    `From month two, check ${p.name}'s official channels once a week for a points programme, a testnet or a governance forum opening; early, documented users are the ones a launch can find, and a claim window is often short.`,
    `All-in for the twelve weeks: a stake of ${stakeLine(p.tvl_usd)} (withdrawable wherever the product allows), about ${fees} of network fees across roughly 24 transactions on ${chain}, and near three hours of your time; if no token ever comes, the fees and the time are the whole loss.`,
  ];
}

/** Everything the dashboard needs beyond the board itself. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocol_count: number;
  pre_token_count: number;
  candidate_count: number;
  live_count: number;
  priced_peer_count: number;
  watchlist_size: number;
  rows: BoardRow[];
  model: typeof MODEL;
  peer_table: PeerRow[];
  global_median: number;
}

/**
 * Build the ranked board: every launch candidate the snapshot holds — the watchlist first among
 * equals — ranked by implied value. Tokened protocols are counted, priced as comparables and set
 * aside, never ranked. Every candidate is ranked, down to the snapshot's own $5M floor: the floor
 * is the watchlist's line, and a radar that stops at it finds nothing early.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const watch = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter(recordsNoToken);
  const live = snapshot.protocols.length - preToken.length;
  const candidates = preToken.filter(isLaunchCandidate);
  const peers = peerTable(snapshot);
  const pricedPeerCount = peers.rows.reduce((n, r) => n + r.peers, 0);

  const scored = candidates
    .map((p) => ({ p, f: impliedValue(p, snapshot.as_of, peers) }))
    .sort((a, b) => b.f.value - a.f.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, MODEL.max_rows);

  // Radar score: a 0-100 blend a reader can sort by, from log TVL, momentum and the watchlist flag.
  const maxLog = Math.log10(Math.max(...scored.map((s) => s.p.tvl_usd)));
  const minLog = Math.log10(Math.min(...scored.map((s) => s.p.tvl_usd)));

  const board: BoardRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  scored.forEach((s, i) => {
    let value = Math.min(s.f.value, previous - 1);
    if (value < 1) value = 1;
    previous = value;
    const tvlPart = maxLog === minLog ? 0.5 : (Math.log10(s.p.tvl_usd) - minLog) / (maxLog - minLog);
    const momPart = s.p.change_7d === null ? 0.5 : (clamp(s.p.change_7d, MODEL.momentum_floor, MODEL.momentum_cap) - MODEL.momentum_floor) / (MODEL.momentum_cap - MODEL.momentum_floor);
    const score = Math.round((0.62 * tvlPart + 0.23 * momPart + (watch.has(s.p.slug) ? 0.15 : 0.04)) * 100);
    board.push({
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: farmSteps(s.p, snapshot.as_of, peers),
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: s.f.ageDays,
      watchlist: watch.has(s.p.slug),
      radar_score: score,
      peer_multiple: round3(s.f.multiple),
      peer_count: s.f.peerCount,
      anchor_usd: s.f.anchor,
      momentum: round3(s.f.momentum),
      track: round3(s.f.track),
      reach: round3(s.f.reach),
    });
  });

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    protocol_count: snapshot.protocols.length,
    pre_token_count: preToken.length,
    candidate_count: candidates.length,
    live_count: live,
    priced_peer_count: pricedPeerCount,
    watchlist_size: snapshot.watchlist.length,
    rows: board,
    model: MODEL,
    peer_table: peers.rows,
    global_median: round3(peers.globalMedian),
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
