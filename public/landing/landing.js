async function refreshLiveStrip() {
  const dot = document.getElementById("live-dot");
  const status = document.getElementById("live-status");
  const meta = document.getElementById("live-meta");
  const btc = document.getElementById("hero-btc");
  const latency = document.getElementById("hero-latency");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (!data.binanceSpot?.reachable) {
      dot?.classList.add("off");
      if (status) status.textContent = "Engine offline";
      if (meta) meta.textContent = data.binanceSpot?.error ?? "Feed unreachable";
      return;
    }
    dot?.classList.remove("off");
    const last = data.binanceSpot.sample?.last;
    if (status) status.textContent = data.hosted ? "BOSS · live desk" : "BOSS · engine connected";
    if (meta) meta.textContent = `Binance Spot · ${data.binanceSpot.latencyMs ?? "—"} ms · mainnet feed`;
    if (btc && last) btc.textContent = `BTC ${Number(last).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (latency) latency.textContent = `${data.binanceSpot.latencyMs ?? "—"} ms`;
    renderMcpSnippet(data.mcp, data.hosted);
    runTerminalDemo(last);
  } catch (error) {
    dot?.classList.add("off");
    if (status) status.textContent = "Engine checking…";
    if (meta) meta.textContent = String(error.message || error);
  }
}

function renderMcpSnippet(bossUrl, hosted) {
  const el = document.getElementById("mcp-snippet");
  if (!el) return;
  const boss = bossUrl || (hosted ? `${location.origin}/mcp` : "http://127.0.0.1:8790/mcp");
  const note = hosted
    ? "// Hosted — use this URL in Cursor MCP settings"
    : "// Local — npm start, then use this URL";
  el.textContent = `${note}
// .cursor/mcp.json
{
  "mcpServers": {
    "binance": { "url": "https://agent.binance.com/mcp/agentic" },
    "boss": { "url": "${boss}" }
  }
}`;
}

function runTerminalDemo(btcLast) {
  const el = document.getElementById("hero-terminal");
  if (!el) return;
  const last = btcLast ? Number(btcLast).toFixed(2) : "—";
  el.innerHTML = `
<div><span class="prompt">$</span> <span class="cmd">analyze BTCUSDT</span></div>
<div class="out">→ observation BTCUSDT last ${last}</div>
<div class="out">→ Web3 pulse + Fear &amp; Greed + RSS headlines</div>
<div><span class="prompt">$</span> <span class="cmd">plan buy 50 usdt BTCUSDT</span></div>
<div class="warn">→ verdict UNKNOWN · BALANCE_SUFFICIENT needs account</div>
<div><span class="prompt">$</span> <span class="cmd">boss_attach_account · re-plan</span></div>
<div class="out">→ verdict CLEAR · notional 50.00 USDT · lot aligned</div>
<div><span class="prompt">$</span> <span class="cmd">EXECUTE</span></div>
<div class="out">→ approval token minted (60s, single-use)</div>
<div class="out">→ Agent OS sends packet.params unchanged · stamp boss_*</div>`;
}

refreshLiveStrip();
renderMcpSnippet(null, location.hostname !== "127.0.0.1" && location.hostname !== "localhost");
setInterval(refreshLiveStrip, 8000);
