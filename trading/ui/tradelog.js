// TRADE LOG view — localStorage-persisted journal with Obsidian Markdown export.
// Vanilla port of src/pages/TradeLog.jsx. Persistence + Markdown live in the ported
// data/tradeLog.js (unchanged); this file is only UI.

import {
  loadTrades, addTrade, closeTrade, updateTrade, deleteTrade,
  exportTradesJSON, importTrades,
  tradeToObsidianMarkdown, obsidianFilename,
} from "../data/tradeLog.js";
import { el, clear, append } from "./dom.js";
import { fmt, ymd } from "./format.js";

const ASSETS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];

function tradePnl(t) {
  if (!t.exit) return null;
  return (t.direction === "LONG" ? 1 : -1) * t.entry.qty * (t.exit.price - t.entry.price);
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function today() { return new Date().toISOString().slice(0, 10); }

function downloadBlob(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function mount(root) {
  const noticeEl = el("div");
  const statsEl = el("div", { class: "tr-stats" });
  const openHost = el("div");
  const closedHost = el("div");
  let modalEl = null;

  function notice(msg, ms = 3000) {
    clear(noticeEl);
    if (!msg) return;
    noticeEl.appendChild(el("div", { class: "tr-notice" }, msg));
    if (ms) setTimeout(() => clear(noticeEl), ms);
  }

  function statCard(label, value, tone) {
    return el("div", { class: "tr-stat" },
      el("div", { class: "tr-metric-label" }, label.toUpperCase()),
      el("div", { class: `tr-stat-value ${tone ? "tr-" + tone : ""}` }, value));
  }

  function closeModal() {
    if (modalEl) { modalEl.remove(); modalEl = null; }
  }

  function openModal(title, body, onSave) {
    closeModal();
    const card = el("div", { class: "tr-modal", onClick: (e) => e.stopPropagation() },
      el("div", { class: "tr-modal-head" },
        el("div", { class: "tr-modal-title" }, title),
        el("button", { class: "tr-modal-x", type: "button", onClick: closeModal }, "×")),
      el("div", { class: "tr-modal-body" }, ...body),
      el("div", { class: "tr-modal-foot" },
        el("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: closeModal }, "CANCEL"),
        el("button", { class: "btn btn-primary btn-sm", type: "button", onClick: onSave }, "SAVE")));
    modalEl = el("div", { class: "tr-overlay", onClick: closeModal }, card);
    root.appendChild(modalEl);
  }

  function field(label, control) {
    return el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, label), control);
  }

  function actionButton(label, onClick, kind, title) {
    return el("button", {
      class: `tr-act ${kind ? "tr-act--" + kind : ""}`, type: "button", onClick, title: title || label,
    }, label);
  }

  function tradeTable(trades, showClose) {
    const head = ["Date", "Asset", "Dir", "Entry", "Stop", "Qty", "Risk $", "Exit", "PnL", "R", "Actions"];
    const body = el("tbody", null, ...trades.map((t) => {
      const pnl = tradePnl(t);
      const r = pnl !== null && t.entry?.riskDollar ? pnl / t.entry.riskDollar : null;
      const pnlTone = pnl > 0 ? "tr-pos" : pnl < 0 ? "tr-neg" : "tr-mut";
      return el("tr", null,
        el("td", { class: "tr-td" }, ymd(t.entry?.time)),
        el("td", { class: "tr-td tr-strong" }, t.asset),
        el("td", { class: `tr-td tr-strong ${t.direction === "LONG" ? "tr-pos" : "tr-neg"}` }, t.direction),
        el("td", { class: "tr-td" }, fmt(t.entry?.price, 4)),
        el("td", { class: "tr-td" }, fmt(t.entry?.stop, 4)),
        el("td", { class: "tr-td" }, fmt(t.entry?.qty, 6)),
        el("td", { class: "tr-td" }, fmt(t.entry?.riskDollar, 2)),
        el("td", { class: "tr-td" }, t.exit ? `${ymd(t.exit.time)} @ ${fmt(t.exit.price, 4)}` : "-"),
        el("td", { class: `tr-td ${pnlTone}` }, fmt(pnl, 2)),
        el("td", { class: "tr-td" }, fmt(r, 2)),
        el("td", { class: "tr-td" }, el("div", { class: "tr-act-row" },
          showClose ? actionButton("close", () => openCloseModal(t)) : null,
          actionButton("edit", () => openEditModal(t)),
          actionButton("md", () => copyMd(t), null, "Copy Markdown"),
          actionButton("↓", () => downloadBlob(obsidianFilename(t), tradeToObsidianMarkdown(t), "text/markdown"), null, "Download .md"),
          actionButton("×", () => removeTrade(t), "danger", "Delete"),
        )),
      );
    }));
    return el("div", { class: "tr-table-wrap" },
      el("table", { class: "tr-table" },
        el("thead", null, el("tr", null, ...head.map((h) => el("th", { class: "tr-th" }, h)))),
        body));
  }

  function section(title, content) {
    return el("div", { class: "tr-section" }, el("div", { class: "tr-section-title" }, title), content);
  }

  function empty(text) { return el("div", { class: "tr-empty" }, text); }

  // ---- actions ----
  function copyMd(t) {
    navigator.clipboard?.writeText(tradeToObsidianMarkdown(t))
      .then(() => notice(`Copied ${obsidianFilename(t)} to clipboard.`))
      .catch(() => notice("Clipboard unavailable."));
  }
  function removeTrade(t) {
    if (confirm("Delete this trade?")) { deleteTrade(t.id); render(); }
  }
  function handleImport(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = importTrades(String(reader.result));
        render();
        notice(`Imported ${n} trades.`);
      } catch (err) {
        notice(`Import error: ${err.message}`, 5000);
      }
    };
    reader.readAsText(file);
  }

  function openCloseModal(t) {
    const exitDate = el("input", { class: "tr-input", type: "date", value: t.exit?.time ? ymd(t.exit.time) : today() });
    const exitPrice = el("input", { class: "tr-input", value: t.exit?.price ?? "" });
    const reason = el("select", { class: "tr-input" },
      ...["trailing stop hit", "regime flip", "discretionary exit", "manual stop"].map((rv) =>
        el("option", { value: rv, selected: (t.exit?.reason ?? "trailing stop hit") === rv }, rv)));
    openModal("CLOSE TRADE", [
      el("div", { class: "tr-grid-2" }, field("Exit date", exitDate), field("Exit price", exitPrice)),
      field("Reason", reason),
    ], () => {
      closeTrade(t.id, {
        time: Math.floor(new Date(exitDate.value + "T12:00:00Z").getTime() / 1000),
        price: num(exitPrice.value),
        reason: reason.value,
      });
      closeModal(); render();
    });
  }

  function openEditModal(t) {
    const notes = el("textarea", { class: "tr-input tr-textarea" }); notes.value = t.notes ?? "";
    openModal("EDIT TRADE", [field("Notes", notes)], () => {
      updateTrade(t.id, { notes: notes.value });
      closeModal(); render();
    });
  }

  function openNewModal() {
    const f = {
      asset: el("select", { class: "tr-input" }, ...ASSETS.map((a) => el("option", { value: a }, a))),
      direction: el("select", { class: "tr-input" }, el("option", { value: "LONG" }, "LONG"), el("option", { value: "SHORT" }, "SHORT")),
      entryDate: el("input", { class: "tr-input", type: "date", value: today() }),
      price: el("input", { class: "tr-input" }),
      stop: el("input", { class: "tr-input" }),
      qty: el("input", { class: "tr-input" }),
      riskDollar: el("input", { class: "tr-input" }),
      leverage: el("input", { class: "tr-input" }),
      regimeState: el("select", { class: "tr-input" }, ...["LONG_OK", "SHORT_OK", "FLAT", "WARMUP"].map((s) => el("option", { value: s }, s))),
      weeklySma: el("input", { class: "tr-input" }),
      weeklyHist: el("input", { class: "tr-input" }),
      weeklyAdx: el("input", { class: "tr-input" }),
      weeklyRsi: el("input", { class: "tr-input" }),
      dailyClose: el("input", { class: "tr-input" }),
      dailyRsi: el("input", { class: "tr-input" }),
      dailyAtr: el("input", { class: "tr-input" }),
      signalReason: el("input", { class: "tr-input" }),
      notes: el("textarea", { class: "tr-input tr-textarea" }),
    };
    openModal("NEW TRADE", [
      el("div", { class: "tr-grid-2" },
        field("Asset", f.asset), field("Direction", f.direction),
        field("Entry date", f.entryDate), field("Entry price", f.price),
        field("Stop price", f.stop), field("Quantity", f.qty),
        field("Risk $", f.riskDollar), field("Leverage", f.leverage)),
      el("div", { class: "tr-section-title tr-section-title--sub" }, "WEEKLY REGIME (at entry)"),
      el("div", { class: "tr-grid-4" },
        field("State", f.regimeState), field("50W SMA", f.weeklySma),
        field("MACD hist", f.weeklyHist), field("ADX", f.weeklyAdx), field("RSI", f.weeklyRsi)),
      el("div", { class: "tr-section-title tr-section-title--sub" }, "DAILY SIGNAL (at entry)"),
      el("div", { class: "tr-grid-4" },
        field("Close", f.dailyClose), field("RSI(14)", f.dailyRsi),
        field("ATR(14)", f.dailyAtr), field("Reason / setup", f.signalReason)),
      field("Notes", f.notes),
    ], () => {
      const entryTime = Math.floor(new Date(f.entryDate.value + "T12:00:00Z").getTime() / 1000);
      addTrade({
        asset: f.asset.value,
        direction: f.direction.value,
        entry: {
          time: entryTime, price: num(f.price.value), stop: num(f.stop.value),
          qty: num(f.qty.value), riskDollar: num(f.riskDollar.value), leverage: num(f.leverage.value),
        },
        regimeSnapshot: {
          state: f.regimeState.value, sma: num(f.weeklySma.value), hist: num(f.weeklyHist.value),
          adx: num(f.weeklyAdx.value), rsi: num(f.weeklyRsi.value),
        },
        signalSnapshot: {
          action: f.direction.value, reason: f.signalReason.value,
          close: num(f.dailyClose.value), rsi: num(f.dailyRsi.value), atr: num(f.dailyAtr.value),
        },
        notes: f.notes.value,
        systemSource: "manual",
      });
      closeModal(); render();
    });
  }

  // ---- render ----
  function render() {
    const trades = loadTrades();
    const open = trades.filter((t) => t.status === "OPEN");
    const closed = trades.filter((t) => t.status === "CLOSED");

    let pnl = 0, wins = 0, losses = 0, rSum = 0;
    for (const t of closed) {
      const p = tradePnl(t) || 0;
      pnl += p;
      if (p > 0) wins++; else losses++;
      if (t.entry?.riskDollar) rSum += p / t.entry.riskDollar;
    }
    const avgR = closed.length ? rSum / closed.length : 0;

    clear(statsEl);
    append(statsEl, [
      statCard("Open", String(open.length)),
      statCard("Closed", String(closed.length)),
      statCard("Wins / Losses", `${wins} / ${losses}`),
      statCard("Win rate", closed.length ? `${((wins / closed.length) * 100).toFixed(1)}%` : "-"),
      statCard("Realized PnL", `${fmt(pnl, 2)} USDT`, pnl > 0 ? "pos" : pnl < 0 ? "neg" : null),
      statCard("Avg R (closed)", fmt(avgR, 2)),
    ]);

    clear(openHost);
    openHost.appendChild(section("OPEN POSITIONS",
      open.length ? tradeTable(open, true) : empty("No open positions.")));

    clear(closedHost);
    closedHost.appendChild(section("CLOSED",
      closed.length ? tradeTable(closed.slice().reverse(), false) : empty("No closed trades yet.")));
  }

  const importInput = el("input", { type: "file", accept: "application/json", class: "tr-hidden-file",
    onChange: (e) => { const file = e.target.files?.[0]; if (file) handleImport(file); e.target.value = ""; } });

  clear(root);
  root.appendChild(
    el("div", { class: "tr-view" },
      el("div", { class: "tr-header" },
        el("div", null,
          el("h1", { class: "tr-title" }, "TRADE LOG"),
          el("div", { class: "tr-subtitle" },
            "Persisted in this browser. Every trade exports as Obsidian-flavored Markdown with "
            + "YAML frontmatter — drop the file into your vault and your Memory Wiki indexes it."),
        ),
        el("div", { class: "tr-header-actions" },
          el("button", { class: "btn btn-primary", type: "button", onClick: openNewModal }, "NEW TRADE"),
          el("button", { class: "btn btn-ghost btn-sm", type: "button",
            onClick: () => downloadBlob(`trades-${today()}.json`, exportTradesJSON(), "application/json") }, "EXPORT JSON"),
          el("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: () => importInput.click() }, "IMPORT JSON"),
          el("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: exportAllMd }, "EXPORT ALL TO MD"),
          importInput,
        ),
      ),
      noticeEl, statsEl, openHost, closedHost,
    ),
  );

  function exportAllMd() {
    const trades = loadTrades();
    if (!trades.length) { notice("No trades to export."); return; }
    const combined = trades.map((t) =>
      `\n\n<!-- file: ${obsidianFilename(t)} -->\n${tradeToObsidianMarkdown(t)}`).join("\n");
    downloadBlob(`trades-bundle-${today()}.md`, combined, "text/markdown");
  }

  render();

  return function cleanup() { closeModal(); };
}
