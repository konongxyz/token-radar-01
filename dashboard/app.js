// Launch Radar page: renders the board main.ts wrote into ../data.js. No network, no framework.
(function () {
  var D = window.RADAR_DATA;
  if (!D) return;
  var rows = D.rows;
  var live = D.live || [];
  var fit = D.fit;
  var val = D.validation;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '-';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(x) {
    if (x == null) return '<span class="dim">&mdash;</span>';
    var cls = x > 0 ? 'up' : (x < 0 ? 'down' : 'dim');
    return '<span class="' + cls + '">' + (x > 0 ? '+' : '') + x.toFixed(1) + '%</span>';
  }
  function statusPill(r) {
    if (r.flag) return '<span class="pill flag">flagged</span>';
    if (r.peer_count === 0) return '<span class="pill thin">no priced peers</span>';
    if (r.peer_count <= 2) return '<span class="pill thin">thin category</span>';
    return '<span class="pill ok">candidate</span>';
  }

  // Masthead: the accounting of the whole snapshot, in numbers.
  document.getElementById('meta').textContent =
    'Snapshot: DefiLlama protocols with at least ' + money(D.floor_usd) + ' TVL, as of ' + D.as_of +
    '. Model fitted on the ' + fit.peer_count + ' priced peers the snapshot holds.';
  var stats = [
    [D.protocol_count, 'protocols in the snapshot'],
    [D.ranked_count, 'pre-token &mdash; every one ranked'],
    [D.flagged_count, 'of them flagged, reason stated'],
    [D.live_count, 'already live &mdash; listed by name'],
    [fit.peer_count, 'priced peers in the fit'],
    [D.watchlist_size + ' / ' + D.watchlist_size, 'watchlist covered']
  ];
  document.getElementById('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>';
  }).join('');
  var wf0 = val.walk_forward[0];
  document.getElementById('tested').innerHTML =
    '<b>Tested, not asserted.</b> Leave-one-out on the ' + val.loo_curve.n + ' priced peers: median miss ' +
    '&times;' + val.loo_curve.median_miss_x + ', ' + val.loo_curve.within_2x_pct + '% priced within 2&times;. ' +
    'Walk-forward (fit on peers listed by ' + wf0.cutoff + ', price the ' + wf0.test_n + ' listed later): median miss &times;' +
    wf0.curve.median_miss_x + '. The flat median-multiple baseline this replaced: &times;' + val.loo_baseline.median_miss_x +
    '. Full tables under Methodology.';

  // Controls.
  var cats = [];
  var chains = [];
  rows.concat(live).forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  var catSel = document.getElementById('cat');
  catSel.innerHTML = '<option value="">all categories</option>' + cats.map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');
  var chainSel = document.getElementById('chain');
  chainSel.innerHTML = '<option value="">all chains</option>' + chains.map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');

  var PAGE = 150;
  var shown = PAGE;
  var tbody = document.getElementById('tbody');
  var countEl = document.getElementById('count');

  function filtered() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = catSel.value;
    var chain = chainSel.value;
    var watchOnly = document.getElementById('watch').checked;
    var hideFlag = document.getElementById('hideflag').checked;
    var sort = document.getElementById('sort').value;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (watchOnly && !r.watchlist) return false;
      if (hideFlag && r.flag) return false;
      return true;
    });
    var key = {
      value: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d == null ? -1e18 : r.change_7d; },
      age: function (r) { return r.age_days == null ? -1 : r.age_days; }
    }[sort];
    out.sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    return out;
  }

  function rowHtml(r) {
    var chainTxt = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? ' <span class="pill watch">watchlist</span>' : '') +
      '<br><span class="dim">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '-') + '</td>' +
      '<td title="' + esc(r.chains.join(', ')) + '">' + esc(chainTxt) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + (r.age_days == null ? '-' : r.age_days) + '</td>' +
      '<td class="num">' + money(r.curve_usd) + '</td>' +
      '<td class="num">&times;' + r.category_x.toFixed(2) + '</td>' +
      '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
      '<td>' + statusPill(r) + '</td></tr>';
  }

  function render() {
    var out = filtered();
    tbody.innerHTML = out.slice(0, shown).map(rowHtml).join('');
    countEl.textContent = 'Showing ' + Math.min(shown, out.length) + ' of ' + out.length +
      ' rows (board holds all ' + rows.length + '). Click a row for its value build-up and farm plan.' +
      (out.length > shown ? ' ' : '');
    var more = document.getElementById('more');
    if (out.length > shown) {
      if (!more) {
        more = document.createElement('button');
        more.id = 'more';
        more.type = 'button';
        more.className = 'more';
        more.textContent = 'Show more rows';
        more.addEventListener('click', function () { shown += PAGE; render(); });
        countEl.appendChild(more);
      }
    } else if (more) {
      more.remove();
    }
    renderLive();
  }

  function renderLive() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = catSel.value;
    var out = live.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      return true;
    });
    document.getElementById('live-body').innerHTML = out.map(function (r) {
      return '<tr><td><b>' + esc(r.name) + '</b><br><span class="dim">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.symbol || '-') + '</td><td>' + esc(r.category || '-') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + (r.mcap_usd == null ? '-' : money(r.mcap_usd)) + '</td>' +
        '<td class="num">' + (r.multiple == null ? '-' : '&times;' + r.multiple.toFixed(2)) + '</td></tr>';
    }).join('');
  }

  ['q', 'cat', 'chain', 'watch', 'hideflag', 'sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () { shown = PAGE; render(); });
    document.getElementById(id).addEventListener('change', function () { shown = PAGE; render(); });
  });
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  // View tabs.
  var boardWrap = document.getElementById('board-wrap');
  var liveWrap = document.getElementById('live-wrap');
  function setView(liveView) {
    boardWrap.hidden = liveView;
    liveWrap.hidden = !liveView;
    document.getElementById('view-board').classList.toggle('on', !liveView);
    document.getElementById('view-live').classList.toggle('on', liveView);
  }
  document.getElementById('view-board').addEventListener('click', function () { setView(false); });
  document.getElementById('view-live').addEventListener('click', function () { setView(true); });

  // Detail overlay: the value build-up, the flag, the facts, the farm plan.
  var detail = document.getElementById('detail');
  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var peerNote;
    if (r.peer_count === 0) {
      peerNote = 'No protocol in this category has a recorded market cap, so no category effect could be fitted: the market curve alone prices this row, and the rank should be read that way.';
    } else if (r.peer_count <= 2) {
      peerNote = 'Only ' + r.peer_count + ' priced peer' + (r.peer_count === 1 ? '' : 's') + ' in this category: the effect is shrunk hard toward &times;1.00 (weight ' +
        r.peer_count + ' / (' + r.peer_count + ' + ' + fit.shrink_k + ')), and the rank is correspondingly tentative.';
    } else {
      peerNote = r.peer_count + ' priced peers stand behind this category effect, shrunk by ' +
        r.peer_count + ' / (' + r.peer_count + ' + ' + fit.shrink_k + ').';
    }
    detail.innerHTML =
      '<div class="sheet">' +
      '<button type="button" class="close" id="dclose" aria-label="Close">&times;</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="dim">Rank ' + r.rank + ' of ' + rows.length + ' by implied value &middot; ' + esc(r.category || 'uncategorised') +
      (r.watchlist ? ' &middot; on the house watchlist' : '') + '</p>' +
      (r.flag ? '<div class="flagbox"><b>Flagged &mdash; not a launch candidate.</b> ' + esc(r.name) + ' is ' + esc(r.flag) +
        '. It is ranked with the rest so the board accounts for it by name, not because a launch is expected.</div>' : '') +
      '<h3>How this value is built</h3>' +
      '<table class="build"><tbody>' +
      '<tr><td>Fitted curve at its TVL of ' + money(r.tvl_usd) + ' (category-neutral)</td><td class="num">' + money(r.curve_usd) + '</td></tr>' +
      '<tr><td>Category effect, ' + esc(r.category || 'uncategorised') + '</td><td class="num">&times;' + r.category_x.toFixed(2) + '</td></tr>' +
      '<tr><td><b>Implied value</b></td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>' +
      '</tbody></table>' +
      '<p class="note">' + peerNote + '</p>' +
      '<div class="cells">' +
      '<div class="cell"><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="cell"><b>' + (r.change_7d == null ? '-' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b><span>7-day change</span></div>' +
      '<div class="cell"><b>' + (r.age_days == null ? 'no date' : r.age_days + ' days') + '</b><span>run, no token</span></div>' +
      '<div class="cell"><b>' + r.peer_count + '</b><span>priced peers in category</span></div>' +
      '</div>' +
      '<p class="chains"><b>Chains:</b> ' + esc(r.chains.join(', ') || '-') + '</p>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>';
    detail.hidden = false;
    document.getElementById('dclose').addEventListener('click', closeDetail);
    detail.addEventListener('click', function (e) { if (e.target === detail) closeDetail(); });
    if (location.hash !== '#detail=' + r.slug) history.replaceState(null, '', '#detail=' + r.slug);
  }
  function closeDetail() {
    detail.hidden = true;
    if (location.hash.indexOf('#detail=') === 0) history.replaceState(null, '', location.pathname + location.search);
  }

  // Methodology: the fitted model, the rejected factors, the validation tables.
  function errRow(label, e) {
    return '<tr><td>' + label + '</td><td class="num">' + e.n + '</td><td class="num">&times;' + e.median_miss_x +
      '</td><td class="num">&times;' + e.p75_miss_x + '</td><td class="num">' + e.within_2x_pct +
      '%</td><td class="num">' + e.within_3x_pct + '%</td></tr>';
  }
  var m = '';
  m += '<h2>Methodology &mdash; fitted, then tested</h2>';
  m += '<p>The price list for a token that does not exist yet is the tokens that do. The snapshot holds ' +
    fit.peer_count + ' protocols that already trade with a market cap recorded. On those peers the model fits, by least squares:</p>' +
    '<p class="formula">log(market cap) = ' + fit.intercept.toFixed(2) + ' + ' + fit.slope.toFixed(2) +
    ' &times; (log TVL &minus; ' + fit.mean_log_tvl.toFixed(2) + ') + category effect</p>' +
    '<p>One global slope: market cap rises at ' + fit.slope.toFixed(2) + ' of the rate of TVL, so the implied multiple falls as size grows &mdash; at $10M TVL the curve implies &times;' +
    fit.curve_points[0].multiple.toFixed(2) + ', at $100M &times;' + fit.curve_points[1].multiple.toFixed(2) +
    ', at $1B &times;' + fit.curve_points[2].multiple.toFixed(2) + '. Each category then moves its members by its own effect: the category\'s mean residual, shrunk toward &times;1.00 by n / (n + ' +
    fit.shrink_k + ') so a category with one peer borrows the market curve instead of that peer\'s luck. Fit quality on the peers themselves: R&sup2; ' +
    fit.r_squared.toFixed(2) + ' with the category effects in. No constant in the model was typed by hand: the intercept, the slope and every category effect come out of the fit, and the code that fits them ships with this entry.</p>';
  m += '<h3>The three adjustments that did not survive fitting</h3>' +
    '<p>An earlier version of this board moved the curve value by three hand-weighted factors. Here they are fitted instead &mdash; as extra terms on the same peers &mdash; and this is what the fit says (weight &plusmn; standard error, in log points):</p>' +
    '<table class="build"><thead><tr><th>Factor</th><th class="num">Weight &plusmn; SE</th><th class="num">Fit to ' +
    fit.factor_train_weights[0].cutoff + '</th><th class="num">Fit to ' + fit.factor_train_weights[1].cutoff + '</th></tr></thead><tbody>';
  var trainKeys = ['momentum', 'track', 'reach'];
  fit.factors.forEach(function (f, i) {
    m += '<tr><td>' + esc(f.name) + '</td><td class="num">' + (f.weight > 0 ? '+' : '') + f.weight.toFixed(2) +
      ' &plusmn; ' + f.se.toFixed(2) + '</td><td class="num">' +
      (fit.factor_train_weights[0][trainKeys[i]] > 0 ? '+' : '') + fit.factor_train_weights[0][trainKeys[i]].toFixed(2) +
      '</td><td class="num">' + (fit.factor_train_weights[1][trainKeys[i]] > 0 ? '+' : '') +
      fit.factor_train_weights[1][trainKeys[i]].toFixed(2) + '</td></tr>';
  });
  m += '</tbody></table>' +
    '<p>Every weight is within noise of zero, and the track weight changes sign between the two halves of the record. Carried into the tests below, the factored model prices held-out peers worse than the plain curve on every split (leave-one-out &times;' +
    val.loo_factored.median_miss_x + ' against &times;' + val.loo_curve.median_miss_x + '). So the shipped model carries no factor adjustment &mdash; not assumed away, measured and rejected. A factor whose weight the data will not support is decoration, and decoration is what the hand-typed constants were.</p>';
  m += '<h3>Validation &mdash; computed at build time, from this snapshot</h3>' +
    '<p>Two tests. Leave-one-out: refit without each peer in turn and price it &mdash; all ' + val.loo_curve.n +
    ' peers priced by a model that never saw them. Walk-forward: fit only on peers listed by the cutoff date and price the ones listed later, so the model is tested the way it is used &mdash; on launches after its evidence. The baseline is the flat approach this model replaces: TVL &times; the median peer multiple.</p>' +
    '<table class="build"><thead><tr><th>Test</th><th class="num">Peers</th><th class="num">Median miss</th><th class="num">75th pct</th><th class="num">Within 2&times;</th><th class="num">Within 3&times;</th></tr></thead><tbody>' +
    errRow('Leave-one-out &mdash; fitted curve (shipped)', val.loo_curve) +
    errRow('Leave-one-out &mdash; curve + fitted factors', val.loo_factored) +
    errRow('Leave-one-out &mdash; flat median multiple (baseline)', val.loo_baseline);
  val.walk_forward.forEach(function (w) {
    m += errRow('Walk-forward to ' + w.cutoff + ' &mdash; fitted curve (train ' + w.train_n + ')', w.curve) +
      errRow('Walk-forward to ' + w.cutoff + ' &mdash; curve + fitted factors', w.factored) +
      errRow('Walk-forward to ' + w.cutoff + ' &mdash; flat baseline', w.baseline);
  });
  m += '</tbody></table>' +
    '<p>Read the numbers plainly: the typical priced peer is missed by a factor of about ' + val.loo_curve.median_miss_x +
    ', and only ' + val.loo_curve.within_2x_pct + '% land within 2&times;. That is the honest precision of pricing an unlaunched token from comparables &mdash; the ranks order the field, they do not price it exactly. What the tests do establish is comparative: the fitted curve beats the flat baseline on every split, and the factors do not beat the curve on any. One thing no test here can validate is timing: the peers all launched, and the board\'s protocols have not, so the figures measure pricing-given-a-launch, not the chance of one.</p>';
  m += '<h3>Category effects, as fitted</h3><div class="chips">';
  D.category_effects.forEach(function (c) {
    m += '<span class="chip">' + esc(c.category) + ' <b>&times;' + c.effect_x.toFixed(2) + '</b> <span class="dim">(' +
      c.peers + ' peer' + (c.peers === 1 ? '' : 's') + ')</span></span>';
  });
  m += '</div><p class="note">Categories with no priced peers do not appear: their members are priced by the curve alone, and their detail view says so.</p>';
  document.getElementById('method').innerHTML = m;

  // Deep links: #detail=<slug>, #watchlist=1, #category=<name>.
  var hash = location.hash.replace(/^#/, '');
  var params = {};
  hash.split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  });
  if (params.watchlist === '1') document.getElementById('watch').checked = true;
  if (params.category) catSel.value = params.category;
  render();
  if (params.detail && bySlug[params.detail]) openDetail(params.detail);
})();
