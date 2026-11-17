// Launch Radar page: renders the board main.ts wrote into ../data.js. No network, no framework.
(function () {
  var D = window.RADAR_DATA;
  if (!D) return;
  var rows = D.rows;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function changeCell(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function signal(r) {
    if (r.watchlist) return '<span class="pill watch">watchlist</span>';
    if (r.radar_score >= 70) return '<span class="pill hot">early + strong</span>';
    if (r.change_7d !== null && r.change_7d >= 15) return '<span class="pill">accelerating</span>';
    if (r.age_days !== null && r.age_days >= 1095) return '<span class="pill">long pre-token run</span>';
    return '<span class="pill">on the radar</span>';
  }

  // Header stats.
  var stats = [
    [D.protocol_count, 'protocols scanned'],
    [D.pre_token_count, 'record no token'],
    [D.candidate_count, 'launch candidates'],
    [D.watchlist_size, 'on the watchlist'],
    [rows.length, 'ranked on the board'],
    [D.priced_peer_count, 'priced peers'],
    [D.live_count, 'already live, set aside']
  ];
  $('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>';
  }).join('');

  // The stated model, in the open: no constant in it was typed by anyone. The multiples are
  // measured from the snapshot's own tokened protocols at run time, and the table below shows
  // every one of them with the number of peers standing behind it.
  var m = D.model;
  $('model-note').innerHTML =
    '<b>How a row earns its rank.</b> Each category is priced by its comparables: the tokened ' +
    'protocols in the snapshot with a market cap recorded are the peers, and a category\'s ' +
    'multiple is the median of their market cap / TVL, winsorized to [' + m.peer_winsor_lo + ', ' +
    m.peer_winsor_hi + '] and shrunk toward the all-category median of ' + D.global_median +
    'x with a weight of ' + m.peer_shrink_k + ' phantom peers, so a thin category borrows the ' +
    'market\'s price instead of one peer\'s. Implied value = TVL x that multiple, moved by the ' +
    '7-day change (<code>1 + change x ' + m.momentum_per_pct + '</code>, clamped), by the length ' +
    'of the pre-token run (up to x' + (m.track_base + m.track_span).toFixed(2) + ' at five years) ' +
    'and by chain reach (+' + (m.reach_per_chain * 100) + '% a chain, five at most). ' +
    'Snapshot of ' + esc(D.as_of) + '; the watchlist floor is ' + money(D.floor_usd) +
    ' and the board reaches below it on purpose: early is the point of a radar.';
  $('peers').innerHTML =
    '<h2>Peer multiples, measured from this snapshot</h2>' +
    '<div class="peer-grid">' +
    D.peer_table.map(function (p) {
      return '<div class="peer"><span class="peer-cat">' + esc(p.category) + '</span>' +
        '<b>' + p.multiple.toFixed(2) + 'x</b>' +
        '<span class="peer-n">median ' + p.median.toFixed(2) + 'x · ' + p.peers +
        (p.peers === 1 ? ' peer' : ' peers') + '</span></div>';
    }).join('') +
    '</div>';

  // Filter options.
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('category').appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
  });

  function currentRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('category').value;
    var chain = $('chain').value;
    var watchOnly = $('watch-only').checked;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (watchOnly && !r.watchlist) return false;
      return true;
    });
    var sort = $('sort').value;
    var key = {
      rank: function (r) { return -r.rank; },
      score: function (r) { return r.radar_score; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; }
    }[sort];
    out.sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    return out;
  }

  function render() {
    var list = currentRows();
    $('count').textContent = list.length + ' of ' + rows.length + ' shown';
    $('empty').hidden = list.length > 0;
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeCell(r.change_7d) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.peer_multiple.toFixed(2) + 'x</td>' +
        '<td class="num"><span class="scorebar"><i style="width:' + r.radar_score + '%"></i></span>' + r.radar_score + '</td>' +
        '<td>' + signal(r) + '</td></tr>';
    }).join('');
    var trs = $('rows').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { openDetail(this.getAttribute('data-slug')); });
    }
  }

  function openDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var d = $('detail');
    d.hidden = false;
    d.innerHTML =
      '<button class="close" id="detail-close">Close</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · rank #' + r.rank + ' of ' + rows.length +
      (r.watchlist ? ' · on the house watchlist' : ' · below the watchlist floor, found early') +
      ' · records no token in the snapshot</p>' +
      '<div class="grid">' +
      '<div class="cell"><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div class="cell"><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="cell"><b>' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + (r.change_7d === null ? '' : r.change_7d.toFixed(1) + '%')) + '</b><span>7d change</span></div>' +
      '<div class="cell"><b>' + r.radar_score + ' / 100</b><span>radar score</span></div>' +
      '<div class="cell"><b>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</b><span>tracked, no token</span></div>' +
      '<div class="cell"><b>' + esc(r.chains.join(', ')) + '</b><span>chains</span></div>' +
      '</div>' +
      '<h3>How this value is built</h3>' +
      '<ul class="build">' +
      '<li>Anchor: TVL ' + money(r.tvl_usd) + ' x the ' + esc(r.category || 'Uncategorised') +
      ' peer multiple ' + r.peer_multiple.toFixed(2) + 'x (median of ' + r.peer_count +
      (r.peer_count === 1 ? ' priced peer' : ' priced peers') + ' in this snapshot, shrunk toward the market median) = <b>' + money(r.anchor_usd) + '</b></li>' +
      '<li>Momentum x' + r.momentum.toFixed(2) + ' from the 7-day TVL change; track record x' + r.track.toFixed(2) +
      ' for ' + (r.age_days === null ? 'an unrecorded start date' : r.age_days + ' days tracked with no token') +
      '; reach x' + r.reach.toFixed(2) + ' for ' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + '.</li>' +
      '<li>Anchor moved by those three factors gives the implied value above: what a launch would ' +
      'be worth if the record stayed as it is, priced the way this market prices its live peers.</li>' +
      '</ul>' +
      '<h3>How to farm it</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    $('detail-close').addEventListener('click', function () { d.hidden = true; });
  }

  ['q', 'category', 'chain', 'watch-only', 'sort'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  render();

  // Deep links the screenshots use: #detail=<slug>, #watchlist=1, #category=<name>.
  var hash = window.location.hash || '';
  var dm = hash.match(/detail=([a-z0-9-]+)/);
  if (dm) openDetail(dm[1]);
  if (hash.indexOf('watchlist=1') >= 0) { $('watch-only').checked = true; render(); }
  var cm = hash.match(/category=([A-Za-z ]+)/);
  if (cm) { $('category').value = decodeURIComponent(cm[1]); render(); }
})();
