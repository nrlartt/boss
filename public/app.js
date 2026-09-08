const $ = (id) => document.getElementById(id);

const state = {
  planId: null,
  approvalId: null,
  symbol: "BTCUSDT",
  chartTf: "1h",
  tapeFilter: "",
  directApi: false,
  sma20: null,
  live: null,
  fallback: null,
  sparks: {},
  knownAlerts: new Set(),
  tapeCollapsed: false,
  notifyPermission: "default",
};

function syncNotifyBar() {
  const bar = $("notify-bar");
  if (!bar || !("Notification" in window)) {
    document.body.classList.remove("notify-prompt");
    return;
  }
  state.notifyPermission = Notification.permission;
  const show = Notification.permission !== "granted";
  bar.hidden = !show;
  document.body.classList.toggle("notify-prompt", show);
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  const result = await Notification.requestPermission();
  state.notifyPermission = result;
  syncNotifyBar();
  return result === "granted";
}

function pushBrowserAlert(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: `boss-${body.slice(0, 48)}` });
  } catch {
    /* desktop notifications unavailable */
  }
}

function renderPulseRows(rows, emptyText) {
  if (!rows?.length) return `<p class="meta">${emptyText}</p>`;
  return rows
    .map(
      (row) => `
      <div class="signal-row">
        <span><b>${row.symbol}</b> ${row.extra ?? ""}</span>
        <span class="${clsChange(row.changePct)}">${row.changePct ? `${Number(row.changePct).toFixed(2)}%` : "—"}</span>
      </div>`,
    )
    .join("");
}

function setGateMode(mode) {
  const signals = $("gate-signals");
  const idle = $("gate-idle");
  if (mode === "plan") {
    if (signals) signals.hidden = true;
    if (idle) idle.hidden = true;
  } else {
    if (signals) signals.hidden = false;
    if (idle) idle.hidden = true;
    $("verdict").textContent = "signals";
    $("verdict").className = "meta verdict-tag verdict-CLEAR";
  }
}

function renderGateMoverRows(rows, kind) {
  if (!rows?.length) return `<p class="meta">No ${kind} on tape.</p>`;
  return rows
    .map(
      (row) => `
      <button type="button" class="signal-row signal-pick" data-pick-symbol="${row.symbol}">
        <span><b>${row.symbol.replace("USDT", "")}</b></span>
        <span class="${clsChange(row.changePct)}">${Number(row.changePct).toFixed(2)}%</span>
      </button>`,
    )
    .join("");
}

function renderGateSignals(data) {
  const el = $("gate-signals");
  if (!el || state.planId) return;
  const hits = data.signals?.symbolHits ?? {};
  const base = data.base ?? data.symbol.replace(/USDT|USDC|FDUSD$/i, "");
  const macro = data.macro ?? {};
  const trending = data.signals?.trending ?? [];
  const smartMoney = data.signals?.smartMoney ?? [];
  const asOf = data.asOf?.slice(11, 19) ?? "—";

  el.innerHTML = `
    <section class="gate-signal-block">
      <header class="gate-signal-head">
        <h3>${base} scan</h3>
        <span class="meta">${asOf} UTC</span>
      </header>
      <div class="signal-row"><span>Web3 trending board</span><span class="${hits.trending ? "up" : "dn"}">${hits.trending ? `${hits.trending.symbol} · ${hits.trending.extra}` : "not listed"}</span></div>
      <div class="signal-row"><span>Smart-money inflow</span><span class="${hits.smartMoney ? "up" : "dn"}">${hits.smartMoney ? `${hits.smartMoney.symbol} · ${hits.smartMoney.extra}` : "not listed"}</span></div>
      <div class="signal-row"><span>Fear & Greed</span><span>${macro.fearGreed ?? "n/a"} ${macro.fearGreedLabel ?? ""}</span></div>
      <div class="signal-row"><span>CoinGecko trending</span><span class="${macro.coingeckoTrending ? "up" : "dn"}">${macro.coingeckoTrending ? "yes" : "no"}</span></div>
      ${macro.summary ? `<p class="gate-signal-note">${macro.summary}</p>` : ""}
    </section>
    <section class="gate-signal-block">
      <header class="gate-signal-head"><h3>Web3 trending</h3><span class="meta">BSC 24h</span></header>
      ${trending.length ? trending.slice(0, 5).map((row) => `
        <button type="button" class="signal-row signal-pick" data-pick-symbol="${row.symbol}USDT">
          <span><b>${row.symbol}</b> ${row.extra ?? ""}</span>
          <span class="${clsChange(row.changePct)}">${row.changePct ? `${Number(row.changePct).toFixed(2)}%` : "—"}</span>
        </button>`).join("") : `<p class="meta">Trending board empty.</p>`}
    </section>
    <section class="gate-signal-block">
      <header class="gate-signal-head"><h3>Smart-money inflow</h3><span class="meta">24h</span></header>
      ${smartMoney.length ? smartMoney.slice(0, 5).map((row) => `
        <button type="button" class="signal-row signal-pick" data-pick-symbol="${row.symbol}USDT">
          <span><b>${row.symbol}</b> ${row.extra ?? ""}</span>
          <span class="${clsChange(row.changePct)}">${row.changePct ? `${Number(row.changePct).toFixed(2)}%` : "—"}</span>
        </button>`).join("") : `<p class="meta">Inflow board empty.</p>`}
    </section>
    <section class="gate-signal-block">
      <header class="gate-signal-head"><h3>Tape movers</h3><span class="meta">Spot 24h</span></header>
      <p class="gate-signal-label">Top gainers</p>
      ${renderGateMoverRows(data.tapeMovers?.gainers, "gainers")}
      <p class="gate-signal-label">Top losers</p>
      ${renderGateMoverRows(data.tapeMovers?.losers, "losers")}
    </section>
    <div class="gate-signal-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-cmd="analyze ${data.symbol}">Full report</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cmd="plan buy 5 usdt ${data.symbol}">Plan buy 5</button>
    </div>
  `;

  for (const btn of el.querySelectorAll("[data-pick-symbol]")) {
    btn.addEventListener("click", () => {
      void selectMarketSymbol(btn.dataset.pickSymbol);
    });
  }
  for (const btn of el.querySelectorAll("[data-cmd]")) {
    btn.addEventListener("click", () => {
      $("command").value = btn.dataset.cmd;
      void runCommand(btn.dataset.cmd);
    });
  }
}

async function refreshGateSignals() {
  if (state.planId) return;
  try {
    const data = await api(`/api/signals?symbol=${encodeURIComponent(state.symbol)}`);
    renderGateSignals(data);
  } catch (error) {
    const el = $("gate-signals");
    if (el && !state.planId) {
      el.innerHTML = `<p class="meta gate-loading">${error.message}</p>`;
    }
  }
}

async function selectMarketSymbol(symbol) {
  const sym = symbol.toUpperCase();
  if (!sym.endsWith("USDT")) return;
  state.symbol = sym;
  $("command").value = `analyze ${sym}`;
  for (const row of $("tape").querySelectorAll(".tape-row")) {
    row.classList.toggle("active", row.dataset.symbol === sym);
  }
  connectLive(sym);
  void loadCandles(sym, state.chartTf);
  void refreshGateSignals();
  try {
    const data = await api(`/api/observe?symbol=${encodeURIComponent(sym)}`);
    renderObservation(data.observation, data.signals);
  } catch {
    /* quote will arrive via live stream */
  }
}

function renderWeb3Pulse(pulse) {
  const panel = $("analysis-pulse-panel");
  if (!panel) return;
  if (!pulse) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const hits = pulse.symbolHits ?? {};
  $("analysis-pulse-hits").innerHTML = `
    <div class="signal-row"><span>Web3 trending</span><span class="${hits.trending ? "up" : "dn"}">${hits.trending ? `${hits.trending.symbol} · ${hits.trending.extra}` : "not on board"}</span></div>
    <div class="signal-row"><span>Smart-money inflow</span><span class="${hits.smartMoney ? "up" : "dn"}">${hits.smartMoney ? `${hits.smartMoney.symbol} · ${hits.smartMoney.extra}` : "not on board"}</span></div>
  `;
  $("analysis-pulse-trending").innerHTML = renderPulseRows(pulse.trending, "Trending board empty.");
  $("analysis-pulse-smart").innerHTML = renderPulseRows(pulse.smartMoney, "Smart-money board empty.");
  const macro = pulse.macro ?? {};
  $("analysis-pulse-macro").innerHTML = `
    <div class="signal-row"><span>Fear & Greed</span><span>${macro.fearGreed ?? "n/a"} ${macro.fearGreedLabel ?? ""}</span></div>
    <div class="signal-row"><span>Google News hits</span><span>${macro.googleNewsCount ?? 0}</span></div>
    <div class="signal-row"><span>CoinGecko trending</span><span class="${macro.coingeckoTrending ? "up" : "dn"}">${macro.coingeckoTrending ? "yes" : "no"}</span></div>
    <div class="signal-row"><span>Reddit r/CryptoCurrency</span><span>${macro.redditMentions ?? 0} posts / 24h</span></div>
    <p class="meta" style="margin:10px 0 0">${macro.summary ?? ""}</p>
    <p class="meta">${macro.source ?? ""}</p>
  `;
}

function setTapeCollapsed(collapsed) {
  state.tapeCollapsed = collapsed;
  const root = document.querySelector('.workspace[data-panel="market"]');
  if (root) root.classList.toggle("tape-collapsed", collapsed);
  try {
    localStorage.setItem("boss-tape-collapsed", collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}
const OUTCOMES = ["AUTHORISED", "FOREIGN", "FORGED", "MISMATCHED", "UNKNOWN_AUTHENTIC"];
const C_UP = "#0ecb81";
const C_DOWN = "#f6465d";
const C_MUTED = "#848e9c";

function switchTab(tab) {
  for (const btn of document.querySelectorAll(".nav-tab")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    const on = panel.dataset.panel === tab;
    panel.classList.toggle("active", on);
    panel.hidden = !on;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || { message: res.statusText };
    throw new Error(`${err.code || "ERROR"}: ${err.message}`);
  }
  return data;
}

function fmt(n, digits = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n ?? "—");
  return x.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function clsChange(pct) {
  const x = Number(pct);
  return x > 0 ? "up" : x < 0 ? "dn" : "";
}

function tickClock() {
  $("clock").textContent = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

async function refreshHealth() {
  try {
    const health = await api("/api/health");
    const pill = $("health-pill");
    if (health.binanceSpot.reachable) {
      pill.textContent = `BTC ${fmt(health.binanceSpot.sample.last, 0)}`;
      pill.className = "pill ok";
    } else {
      pill.textContent = health.binanceSpot.error || "feed down";
      pill.className = "pill bad";
    }
    state.directApi = Boolean(health.directApi);
    $("api-account-btn").hidden = !state.directApi;
    renderHostedBar(health);
  } catch (error) {
    $("health-pill").textContent = String(error.message);
    $("health-pill").className = "pill bad";
    renderHostedBar(null);
  }
}

function renderHostedBar(health) {
  const bar = $("hosted-bar");
  if (!bar) return;
  const show = Boolean(health?.hosted) || location.hostname !== "127.0.0.1" && location.hostname !== "localhost";
  bar.hidden = !show;
  if (!show) return;
  document.body.classList.add("hosted-mode");
  const dot = $("engine-dot");
  const status = $("hosted-status");
  const meta = $("hosted-meta");
  if (!health?.binanceSpot?.reachable) {
    if (dot) dot.className = "live-dot off";
    if (status) status.textContent = "Engine offline — Binance feed unreachable";
    if (meta) meta.textContent = health?.binanceSpot?.error ?? "";
    return;
  }
  if (dot) dot.className = "live-dot";
  if (status) {
    status.textContent = health.hosted
      ? `LIVE · Binance Spot engine · ${health.engine ?? "live"}`
      : "LIVE · local desk";
  }
  if (meta) {
    const lat = health.binanceSpot.latencyMs;
    const sample = health.binanceSpot.sample;
    meta.textContent = sample
      ? `BTC ${fmt(sample.last, 0)} · ${lat}ms · MCP ${health.mcp ?? ""}`
      : `${lat}ms`;
  }
}

async function refreshSession() {
  const session = await api("/api/session");
  state.directApi = Boolean(session.directApi);
  $("kill-btn").textContent = session.mandate.killSwitch ? "Kill switch ON" : "Kill switch";
  $("kill-btn").classList.toggle("on", Boolean(session.mandate.killSwitch));
  $("api-account-btn").hidden = !session.directApi;
  const pill = $("account-pill");
  if (!session.account) {
    pill.textContent = "account absent";
    pill.className = "pill";
    if (session.directApi) {
      try {
        await api("/api/account/api", { method: "POST", body: "{}" });
        return refreshSession();
      } catch {
        /* API keys configured but account fetch failed */
      }
    }
  } else {
    pill.textContent = `${session.account.mode} ${session.accountSummary.assets.join(" ")}`;
    pill.className = "pill ok";
  }
  renderMandate(session);
  renderBoot(session.boot || []);
}

function renderMandate(session) {
  const used = Number(session.dailyNotional || 0);
  const cap = Number(session.mandate.maxDailyNotionalUsdt || 0);
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const chart = $("mandate-chart");
  if (!chart) return;
  chart.innerHTML = `
    <div class="meter-label"><span>UTC day notional</span><span>cap ${fmt(session.mandate.maxNotionalUsdt, 0)} / order</span></div>
    <div class="meter-track"><div class="meter-fill${pct >= 80 ? " hot" : ""}" style="width:${pct}%"></div></div>
    <div class="meter-label"><span>${pct.toFixed(0)}% of daily cap</span><span>kill ${session.mandate.killSwitch ? "ON" : "off"}</span></div>
  `;
  fillMandateForm(session.mandate);
}

function fillMandateForm(mandate) {
  const map = {
    "m-max-order": mandate.maxNotionalUsdt,
    "m-max-daily": mandate.maxDailyNotionalUsdt,
    "m-max-spread": mandate.maxSpreadBps,
    "m-max-drift": mandate.maxPriceDeviationBps,
    "m-allowlist": (mandate.symbolAllowlist || []).join(", "),
  };
  for (const [id, value] of Object.entries(map)) {
    const el = $(id);
    if (el) el.value = value ?? "";
  }
}

function renderBoot(guards) {
  if (!guards.length) {
    $("boot-guards").innerHTML = `<div class="src">Boot banner not in this process yet.</div>`;
    return;
  }
  $("boot-guards").innerHTML = guards
    .map(
      (row) =>
        `<div class="guard"><span class="st-${row.status === "PASS" ? "PASS" : row.status === "FAIL" ? "FAIL" : "UNKNOWN"}">${row.status}</span><span>${row.id}: ${row.detail}</span></div>`,
    )
    .join("");
}

function renderCandles(candles) {
  if (!candles?.length) {
    return `<div class="meta" style="padding:12px">No candle data.</div>`;
  }
  const w = 800;
  const h = 220;
  const pad = { t: 14, r: 10, b: 22, l: 10 };
  const highs = candles.map((c) => Number(c.high));
  const lows = candles.map((c) => Number(c.low));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const innerH = h - pad.t - pad.b;
  const cw = (w - pad.l - pad.r) / candles.length;
  const bodyW = Math.max(2, cw * 0.55);
  const shapes = candles
    .map((c, i) => {
      const open = Number(c.open);
      const close = Number(c.close);
      const high = Number(c.high);
      const low = Number(c.low);
      const up = close >= open;
      const color = up ? C_UP : C_DOWN;
      const x = pad.l + i * cw + cw / 2;
      const y = (v) => pad.t + ((max - v) / span) * innerH;
      const yTop = Math.min(y(open), y(close));
      const bodyH = Math.max(1, Math.abs(y(close) - y(open)));
      return `<line x1="${x.toFixed(1)}" y1="${y(high).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y(low).toFixed(1)}" stroke="${color}" stroke-width="1"/>
        <rect x="${(x - bodyW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${color}"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Candlestick chart">${shapes}</svg>`;
}

async function loadCandles(symbol, tf = state.chartTf) {
  const el = $("candle-chart");
  if (!el) return;
  el.innerHTML = `<div class="meta" style="padding:12px">Loading ${tf} candles…</div>`;
  try {
    const data = await api(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${tf}`);
    el.innerHTML = renderCandles(data.candles);
  } catch (error) {
    el.innerHTML = `<div class="meta" style="padding:12px">${error.message}</div>`;
  }
}

function filterTape() {
  const q = state.tapeFilter;
  for (const row of $("tape").querySelectorAll(".tape-row")) {
    const sym = row.dataset.symbol.toLowerCase();
    const base = sym.replace("usdt", "");
    row.classList.toggle("hidden", Boolean(q && !sym.includes(q) && !base.includes(q)));
  }
}

function renderTapeRows(rows, source, sparks) {
  void source;
  if (sparks) state.sparks = { ...state.sparks, ...sparks };
  $("tape").innerHTML = rows
    .map(
      (row) => `
      <button class="tape-row${row.symbol === state.symbol ? " active" : ""}" data-symbol="${row.symbol}">
        <span>${row.symbol.replace("USDT", "")}</span>
        <span>${fmt(row.last, Number(row.last) > 1000 ? 2 : 4)}</span>
        <span class="${clsChange(row.changePct)}">${Number(row.changePct).toFixed(2)}%</span>
      </button>`,
    )
    .join("");
  filterTape();
}

$("tape").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-symbol]");
  if (!btn) return;
  $("command").value = `analyze ${btn.dataset.symbol}`;
  void runCommand(`analyze ${btn.dataset.symbol}`);
});

async function refreshTape() {
  const tape = await api("/api/tape");
  renderTapeRows(tape.rows, tape.source, tape.sparks);
}

function applyQuote(quote) {
  if (!quote || quote.symbol !== state.symbol) return;
  $("market-title").textContent = quote.symbol;
  const tickAt = quote.asOf ? `${quote.asOf.slice(11, 19)} UTC` : "live";
  $("market-age").textContent = tickAt;
  $("quote").innerHTML = `
    <div class="last-row">
      <div class="last">${fmt(quote.last, 2)}</div>
      <div class="chg ${clsChange(quote.change24hPct)}">${Number(quote.change24hPct).toFixed(2)}%</div>
    </div>
    <div class="stats">
      <div class="kv">Bid / Ask <b>${fmt(quote.bid, 4)} / ${fmt(quote.ask, 4)}</b></div>
      <div class="kv">Spread <b>${fmt(quote.spreadBps, 2)} bps</b></div>
      <div class="kv">24h range <b>${fmt(quote.low24h, 2)} – ${fmt(quote.high24h, 2)}</b></div>
      <div class="kv">1h SMA20 <b>${state.sma20 ? fmt(state.sma20, 2) : "n/a"}</b></div>
      <div class="kv">Imbalance <b>${fmt(quote.book.imbalance, 3)}</b></div>
    </div>
  `;
  renderBook("asks", quote.book.asks.slice(0, 8).reverse(), "asks");
  renderBook("bids", quote.book.bids.slice(0, 8), "bids");
  const spread = $("spread-line");
  if (spread) {
    spread.innerHTML = `<span>${fmt(quote.bid, 2)}</span><span>${fmt(quote.spreadBps, 2)} bps</span><span>${fmt(quote.ask, 2)}</span>`;
  }
  if (quote.symbol === "BTCUSDT") {
    const pill = $("health-pill");
    pill.textContent = `BTC ${fmt(quote.last, 0)}`;
    pill.className = "pill ok";
  }
}

function applyLive(payload) {
  if (payload.tape?.length) renderTapeRows(payload.tape, payload.source, payload.sparks);
  if (payload.quote) applyQuote(payload.quote);
}

function connectLive(symbol) {
  if (state.live) {
    state.live.close();
    state.live = null;
  }
  if (state.fallback) {
    clearInterval(state.fallback);
    state.fallback = null;
  }
  const stream = new EventSource(`/api/live?symbol=${encodeURIComponent(symbol)}`);
  state.live = stream;
  stream.onmessage = (event) => {
    try {
      applyLive(JSON.parse(event.data));
    } catch {
      // Ignore a bad frame.
    }
  };
  stream.onerror = () => {
    stream.close();
    state.live = null;
    if (state.fallback) return;
    state.fallback = setInterval(() => {
      void Promise.all([
        api(`/api/quote?symbol=${encodeURIComponent(state.symbol)}`).then(applyQuote),
        refreshTape(),
      ]).catch(() => {});
    }, 1000);
  };
}

async function refreshReceipts() {
  const rows = await api("/api/receipts");
  $("receipts").innerHTML = rows.length
    ? rows
        .slice(0, 12)
        .map(
          (row) => `
        <div class="receipt">
          <span>${row.stage}</span>
          <span class="verdict-${row.verdict}">${row.verdict}</span>
          <span>${row.summary}</span>
        </div>`,
        )
        .join("")
    : `<div class="src">No receipts yet. Run a plan.</div>`;
}

async function refreshAudit() {
  const audit = await api("/api/audit");
  const pill = $("scope-pill");
  const banner = $("burn-banner");
  if (audit.scope.status === "burned") {
    pill.textContent = "scope burned";
    pill.className = "pill bad";
    banner.hidden = false;
    document.body.classList.add("burn-active");
    $("burn-reason").textContent = audit.scope.reason || "A classified exchange order did not match a BOSS stamp.";
  } else {
    pill.textContent = "scope open";
    pill.className = "pill ok";
    banner.hidden = true;
    document.body.classList.remove("burn-active");
  }
  const c = audit.counters;
  $("audit-src").textContent = `${c.stamps} stamps`;
  $("audit-counts").innerHTML = OUTCOMES.map((key) => `<span>${key} <b>${c[key]}</b></span>`).join("");
  const max = Math.max(...OUTCOMES.map((key) => Number(c[key] || 0)), 1);
  $("audit-bars").innerHTML = OUTCOMES.map((key) => {
    const n = Number(c[key] || 0);
    return `<div class="bar-row"><span>${key}</span><div class="bar-track"><div class="bar-fill ${key}" style="width:${(n / max) * 100}%"></div></div><b>${n}</b></div>`;
  }).join("");
  $("audit-timeline").innerHTML = renderTimeline(audit.series || []);
  $("audit-events").innerHTML = audit.events.length
    ? audit.events
        .slice(0, 8)
        .map(
          (row) => `
        <div class="receipt">
          <span>${row.outcome}</span>
          <span>${row.symbol || "—"}</span>
          <span>${row.explanation}</span>
        </div>`,
        )
        .join("")
    : `<div class="src">No classified exchange orders yet. Mix stays at zero until ingest, reconcile, or a signed poller sees a fill.</div>`;
}

function renderTimeline(series) {
  if (!series.length) {
    return `<div class="src">Timeline fills when BOSS classifies an exchange order.</div>`;
  }
  const w = 280;
  const h = 88;
  const pad = 10;
  const colors = {
    AUTHORISED: C_UP,
    FOREIGN: C_DOWN,
    FORGED: C_DOWN,
    MISMATCHED: "#f0b90b",
    UNKNOWN_AUTHENTIC: C_MUTED,
  };
  const dots = series
    .slice(-48)
    .map((row, index, all) => {
      const x = pad + (index / Math.max(all.length - 1, 1)) * (w - pad * 2);
      const y = h / 2;
      return `<circle cx="${x.toFixed(1)}" cy="${y}" r="4" fill="${colors[row.outcome] || "#ede8dc"}"><title>${row.outcome} ${row.t}</title></circle>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Audit timeline">${dots}</svg>`;
}

function renderAnalysis(analysis) {
  if (!analysis) return;
  switchTab("analysis");
  const shell = $("report-shell");
  shell.classList.add("has-report");
  const empty = $("report-empty");
  if (empty) empty.hidden = true;
  $("report-title").textContent = analysis.symbol;
  $("report-headline").textContent = analysis.summary.headline;
  $("report-asof").textContent = `${analysis.asOf} · research`;
  const bias = $("report-bias");
  bias.textContent = analysis.summary.bias;
  bias.className = `bias-pill ${analysis.summary.bias}`;
  $("report-confidence").textContent = `${analysis.summary.confidence} confidence`;
  $("report-score").textContent = analysis.summary.score > 0 ? `+${analysis.summary.score}` : String(analysis.summary.score);
  const pct = Math.max(0, Math.min(100, ((analysis.summary.score + 100) / 200) * 100));
  $("report-score-bar").style.width = `${pct}%`;
  $("report-technical").innerHTML = `
    <h3>Technical</h3>
    <div class="report-metrics">
      <div class="metric"><span>Last</span><b>${fmt(analysis.technical.last, 2)}</b></div>
      <div class="metric"><span>24h</span><b class="${clsChange(analysis.technical.change24hPct)}">${Number(analysis.technical.change24hPct).toFixed(2)}%</b></div>
      <div class="metric"><span>Range pos</span><b>${analysis.technical.rangePositionPct.toFixed(0)}%</b></div>
      <div class="metric"><span>RSI 1h</span><b>${analysis.technical.rsi14_1h ?? "n/a"}</b></div>
      <div class="metric"><span>Spread</span><b>${fmt(analysis.technical.spreadBps, 2)} bps</b></div>
      <div class="metric"><span>Volume</span><b>${analysis.technical.volumeQuote24h}</b></div>
    </div>
    <ul class="report-list">${analysis.technical.findings.map((row) => `<li>${row}</li>`).join("")}</ul>
  `;
  $("report-trend").innerHTML = `
    <h3>Trend & social</h3>
    <div class="badge-row">
      <span class="badge ${analysis.trend.onTrendingBoard ? "on" : "off"}">Web3 trending</span>
      <span class="badge ${analysis.trend.onSmartMoneyBoard ? "on" : "off"}">Smart money</span>
      <span class="badge on">${analysis.trend.socialPulse}</span>
    </div>
    <ul class="report-list">${analysis.trend.findings.map((row) => `<li>${row}</li>`).join("")}</ul>
  `;
  const news = analysis.news.items.length
    ? analysis.news.items
        .map(
          (row) => `
        <div class="news-item">
          <a href="${row.url}" target="_blank" rel="noopener noreferrer">${row.title}</a>
          <span class="news-meta">${row.source} · ${new Date(row.publishedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
        </div>`,
        )
        .join("")
    : `<p class="src">${analysis.news.unavailable ?? "No headlines matched this symbol."}</p>`;
  $("report-news").innerHTML = `<h3>News</h3>${news}`;
  $("report-actions").innerHTML = analysis.actions
    .map((cmd) => `<button type="button" data-cmd="${cmd}">${cmd}</button>`)
    .join("");
  for (const btn of $("report-actions").querySelectorAll("button")) {
    btn.addEventListener("click", () => {
      $("command").value = btn.dataset.cmd;
      void runCommand(btn.dataset.cmd).catch((error) => {
        $("plan").textContent = error.message;
      });
    });
  }
  $("report-disclaimer").textContent = analysis.disclaimer;
  renderWeb3Pulse(analysis.web3Pulse);
}

function renderObservation(observation, signals) {
  const symbolChanged = state.symbol !== observation.symbol;
  state.symbol = observation.symbol;
  state.sma20 = observation.sma20_1h;
  applyQuote({
    symbol: observation.symbol,
    last: observation.last,
    bid: observation.bid,
    ask: observation.ask,
    spreadBps: observation.spreadBps,
    change24hPct: observation.change24hPct,
    high24h: observation.high24h,
    low24h: observation.low24h,
    asOf: observation.asOf,
    source: observation.sources.ticker,
    book: observation.book,
  });
  if (symbolChanged || !state.live) connectLive(observation.symbol);
  if (symbolChanged) void loadCandles(observation.symbol, state.chartTf);
  if (symbolChanged && !state.planId) void refreshGateSignals();
  void signals;
}

async function refreshPlans() {
  const rows = await api("/api/plans");
  const el = $("plan-history");
  if (!el) return;
  el.innerHTML = rows.length
    ? `<div class="plan-row plan-head-row"><span>Time</span><span>Side</span><span>Order</span><span>Gate</span><span></span></div>${rows
        .slice(0, 40)
        .map(
          (row) => `
        <div class="plan-row">
          <span>${row.createdAt.slice(0, 16).replace("T", " ")}</span>
          <span class="${row.side === "BUY" ? "up" : "dn"}">${row.side}</span>
          <span>${row.quantity} ${row.symbol} · ${row.notional} USDT</span>
          <span class="verdict-${row.verdict}">${row.verdict}</span>
          <button type="button" data-replan="${row.symbol}">Re-plan</button>
        </div>`,
        )
        .join("")}`
    : `<div class="meta" style="padding:14px">No plans yet. Run plan buy … from the command bar.</div>`;
  for (const btn of el.querySelectorAll("[data-replan]")) {
    btn.addEventListener("click", () => {
      const cmd = `plan buy 5 usdt ${btn.dataset.replan}`;
      $("command").value = cmd;
      void runCommand(cmd);
    });
  }
}

function renderAlertRows(rows, containerId, withDelete) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
        <div class="alert-row${row.triggeredAt ? " triggered" : ""}">
          <span><b>${row.symbol.replace("USDT", "")}</b> ${row.direction} ${row.price}${row.triggeredAt ? ` · hit ${row.triggeredAt.slice(11, 19)} UTC` : ""}</span>
          ${withDelete && row.active ? `<button type="button" data-del-alert="${row.id}" title="Remove">×</button>` : "<span></span>"}
        </div>`,
        )
        .join("")
    : `<div class="meta" style="padding:10px 14px">No alerts.</div>`;
  for (const btn of el.querySelectorAll("[data-del-alert]")) {
    btn.addEventListener("click", () => {
      void api(`/api/alerts/${btn.dataset.delAlert}`, { method: "DELETE" }).then(refreshAlerts);
    });
  }
}

async function refreshAlerts() {
  const data = await api("/api/alerts");
  const count = $("alert-count");
  if (count) count.textContent = `${data.active.length} active`;
  renderAlertRows(data.active, "gate-alerts", true);
  renderAlertRows([...data.active, ...data.triggered].slice(0, 24), "alert-ops-list", true);
  for (const row of data.triggered) {
    const key = `${row.id}:${row.triggeredAt}`;
    if (state.knownAlerts.has(key)) continue;
    state.knownAlerts.add(key);
    showAlertToast(`${row.symbol} crossed ${row.direction} ${row.price}`);
  }
  for (const row of data.active) state.knownAlerts.add(row.id);
}

function showAlertToast(message) {
  const toast = $("alert-toast");
  if (toast) {
    toast.hidden = false;
    toast.textContent = message;
    setTimeout(() => {
      toast.hidden = true;
    }, 8000);
  }
  pushBrowserAlert("BOSS price alert", message);
}

async function createAlert(input) {
  await api("/api/alerts", { method: "POST", body: JSON.stringify(input) });
  await refreshAlerts();
}

function renderBook(id, levels, kind) {
  const max = Math.max(...levels.map((l) => Number(l.qty)), 1);
  $(id).className = `book ${kind}`;
  $(id).innerHTML = levels
    .map((level) => {
      const width = Math.max(6, (Number(level.qty) / max) * 100);
      return `<div class="lvl"><div class="bar" style="width:${width}%"></div><span>${fmt(level.price, 4)}</span><span>${fmt(level.qty, 5)}</span></div>`;
    })
    .join("");
}

function renderPlan(plan) {
  switchTab("market");
  state.planId = plan.id;
  state.approvalId = null;
  setGateMode("plan");
  const v = plan.policy.verdict;
  $("verdict").textContent = v;
  $("verdict").className = `meta verdict-tag verdict-${v}`;
  $("plan").innerHTML = `
    <div><strong>${plan.order.side} ${plan.order.quantity} ${plan.order.symbol}</strong></div>
    <div>${plan.order.type}${plan.order.price ? ` @ ${plan.order.price}` : " (market)"} · notional ${plan.order.notional}</div>
    <div>hash ${plan.planHash.slice(0, 16)}… · ${plan.id}</div>
    <div>${plan.notes[0] ?? ""}</div>
    ${v === "UNKNOWN" ? "<div>Attach free USDT (for buys) or base asset (for sells), then run the same plan again.</div>" : ""}
    ${v === "BLOCK" ? "<div>A hard rule failed. Change size, symbol, or the mandate.</div>" : ""}
  `;
  $("rules").innerHTML = plan.policy.rules
    .map(
      (rule) =>
        `<div class="rule"><span>${rule.id}</span><span class="st-${rule.status}">${rule.status}</span><span>${rule.detail}</span></div>`,
    )
    .join("");
  $("gate-mix").innerHTML = `
    <div class="mix"><span>Pass</span><b class="st-PASS">${plan.policy.passCount}</b></div>
    <div class="mix"><span>Fail</span><b class="st-FAIL">${plan.policy.failCount}</b></div>
    <div class="mix"><span>Unknown</span><b class="st-UNKNOWN">${plan.policy.unknownCount}</b></div>
  `;
  $("approve-form").hidden = v !== "CLEAR";
  $("send-row").hidden = true;
  $("packet").hidden = true;
}

async function runCommand(command) {
  $("verdict").textContent = "running";
  const result = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command }),
  });
  if (result.kind === "observe") {
    state.planId = null;
    setGateMode("signals");
    $("approve-form").hidden = true;
    $("send-row").hidden = true;
    $("packet").hidden = true;
    $("verdict").textContent = "report";
    $("verdict").className = "meta verdict-tag verdict-CLEAR";
    switchTab("analysis");
    $("plan").innerHTML = "";
    $("rules").innerHTML = "";
    $("gate-mix").innerHTML = "";
    renderObservation(result.observation, result.signals);
    if (result.analysis) renderAnalysis(result.analysis);
    void refreshGateSignals();
  } else {
    renderObservation(result.plan.observation, result.plan.signals);
    renderPlan(result.plan);
  }
  await refreshReceipts();
  await refreshSession();
  await refreshPlans();
}

$("command-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void runCommand($("command").value).catch((error) => {
    $("verdict").textContent = "error";
    $("plan").textContent = error.message;
  });
});

for (const chip of document.querySelectorAll(".chips button")) {
  chip.addEventListener("click", () => {
    $("command").value = chip.dataset.cmd;
    void runCommand(chip.dataset.cmd).catch((error) => {
      $("plan").textContent = error.message;
    });
  });
}

$("account-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const usdt = $("bal-usdt").value.trim();
  const base = $("bal-base").value.trim();
  const balances = [];
  if (usdt) balances.push({ asset: "USDT", free: usdt });
  if (base) balances.push({ asset: state.symbol.replace(/USDT|USDC|FDUSD$/i, ""), free: base });
  if (!balances.length) {
    $("plan").textContent = "Enter at least one free balance.";
    return;
  }
  void api("/api/account/host", {
    method: "POST",
    body: JSON.stringify({ balances, source: "boss-desk" }),
  })
    .then(() => refreshSession())
    .then(() => {
      if ($("command").value) return runCommand($("command").value);
    })
    .catch((error) => {
      $("plan").textContent = error.message;
    });
});

$("clear-account-btn").addEventListener("click", () => {
  void api("/api/account/clear", { method: "POST", body: "{}" }).then(refreshSession);
});

$("api-account-btn").addEventListener("click", () => {
  void api("/api/account/api", { method: "POST", body: "{}" })
    .then(() => refreshSession())
    .catch((error) => {
      $("plan").textContent = error.message;
    });
});

$("approve-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.planId) return;
  void api("/api/approve", {
    method: "POST",
    body: JSON.stringify({ planId: state.planId, phrase: $("phrase").value }),
  })
    .then((data) => {
      state.approvalId = data.approval.id;
      $("packet").hidden = false;
      $("packet").textContent = JSON.stringify(data.packet, null, 2);
      $("send-row").hidden = !state.directApi;
      return refreshReceipts();
    })
    .catch((error) => {
      $("plan").textContent = error.message;
    });
});

$("send-api-btn").addEventListener("click", () => {
  if (!state.planId || !state.approvalId) return;
  void api("/api/send", {
    method: "POST",
    body: JSON.stringify({
      planId: state.planId,
      approvalId: state.approvalId,
      prefer: "direct-api",
    }),
  })
    .then((sent) => {
      $("packet").hidden = false;
      $("packet").textContent = JSON.stringify(sent, null, 2);
      return refreshReceipts();
    })
    .catch((error) => {
      $("plan").textContent = error.message;
    });
});

$("kill-btn").addEventListener("click", () => {
  void api("/api/mandate")
    .then((mandate) => api("/api/kill", { method: "POST", body: JSON.stringify({ on: !mandate.killSwitch }) }))
    .then(() => refreshSession());
});

$("restore-btn").addEventListener("click", () => {
  void api("/api/scope/restore", { method: "POST", body: "{}" })
    .then(() => Promise.all([refreshAudit(), refreshSession()]))
    .catch((error) => {
      $("plan").textContent = error.message;
    });
});

for (const tab of document.querySelectorAll(".nav-tab")) {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
}

for (const btn of document.querySelectorAll(".tf-tab")) {
  btn.addEventListener("click", () => {
    for (const row of document.querySelectorAll(".tf-tab")) row.classList.remove("active");
    btn.classList.add("active");
    state.chartTf = btn.dataset.tf;
    void loadCandles(state.symbol, state.chartTf);
  });
}

$("tape-search")?.addEventListener("input", (event) => {
  state.tapeFilter = event.target.value.trim().toLowerCase();
  filterTape();
});

$("alert-quick-btn")?.addEventListener("click", () => {
  $("alert-quick-form").hidden = false;
  $("alert-price").value = "";
  $("alert-price").focus();
});

$("alert-quick-cancel")?.addEventListener("click", () => {
  $("alert-quick-form").hidden = true;
});

$("alert-quick-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void createAlert({
    symbol: state.symbol,
    direction: $("alert-dir").value,
    price: $("alert-price").value.trim(),
  })
    .then(() => {
      $("alert-quick-form").hidden = true;
    })
    .catch((error) => showAlertToast(error.message));
});

$("alert-ops-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void createAlert({
    symbol: $("alert-ops-symbol").value.trim() || state.symbol,
    direction: $("alert-ops-dir").value,
    price: $("alert-ops-price").value.trim(),
  })
    .then(() => {
      $("alert-ops-price").value = "";
    })
    .catch((error) => showAlertToast(error.message));
});

$("mandate-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void api("/api/mandate")
    .then((current) =>
      api("/api/mandate", {
        method: "PUT",
        body: JSON.stringify({
          ...current,
          maxNotionalUsdt: $("m-max-order").value.trim(),
          maxDailyNotionalUsdt: $("m-max-daily").value.trim(),
          maxSpreadBps: $("m-max-spread").value.trim(),
          maxPriceDeviationBps: $("m-max-drift").value.trim(),
          symbolAllowlist: $("m-allowlist")
            .value.split(",")
            .map((row) => row.trim().toUpperCase())
            .filter(Boolean),
        }),
      }),
    )
    .then(() => {
      $("mandate-save-msg").textContent = "Saved.";
      return refreshSession();
    })
    .catch((error) => {
      $("mandate-save-msg").textContent = error.message;
    });
});

$("tape-collapse-btn")?.addEventListener("click", () => {
  setTapeCollapsed(!state.tapeCollapsed);
});

$("notify-enable-btn")?.addEventListener("click", () => {
  void requestNotificationPermission();
});

try {
  setTapeCollapsed(localStorage.getItem("boss-tape-collapsed") === "1");
} catch {
  /* ignore */
}
syncNotifyBar();
tickClock();
void refreshHealth();
void refreshSession();
void refreshTape();
void refreshReceipts();
void refreshAudit();
void refreshPlans();
void refreshAlerts();
void refreshGateSignals();
void loadCandles(state.symbol, state.chartTf);
void runCommand("analyze BTCUSDT").catch((error) => {
  $("plan").textContent = error.message;
});
connectLive(state.symbol);
setInterval(() => {
  void refreshSession();
  void refreshAudit();
  void refreshAlerts();
}, 8000);
setInterval(() => {
  void refreshGateSignals();
}, 90_000);
setInterval(() => {
  void loadCandles(state.symbol, state.chartTf);
}, 120_000);
