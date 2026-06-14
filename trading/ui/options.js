// OPTIONS PAYOFFS view — build a multi-leg options position and draw its profit/loss at
// expiration. Presets (Straddle, Strangle, Strip, Strap, spreads, ...) fill an editable
// legs table; the payoff math lives in the tested pure modules under trading/options/.

import { payoffCurve, breakevens, analyze } from "../options/payoff.js";
import { STRATEGIES, strategyById, DEFAULT_SPOT } from "../options/strategies.js";
import { el, clear, append, svgEl } from "./dom.js";
import { fmt } from "./format.js";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (x) => Math.round(x * 100) / 100;

function niceTicks(min, max, count) {
  if (!(max > min)) return [min];
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

let chartSeq = 0;

function buildChart(legs, spot) {
  const W = 900;
  const H = 440;
  const m = { left: 62, right: 20, top: 22, bottom: 34 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;

  const strikes = legs.map((l) => num(l.strike));
  const refLo = Math.min(spot, ...strikes);
  const refHi = Math.max(spot, ...strikes);
  const pad = Math.max((refHi - refLo) * 0.6, spot * 0.25, 1);
  const smin = Math.max(0, refLo - pad);
  const smax = refHi + pad || refHi + 1;

  const pts = payoffCurve(legs, smin, smax, 240);
  let ymin = 0;
  let ymax = 0;
  for (const p of pts) {
    if (p.pnl < ymin) ymin = p.pnl;
    if (p.pnl > ymax) ymax = p.pnl;
  }
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const yp = (ymax - ymin) * 0.12;
  ymin -= yp;
  ymax += yp;

  const X = (s) => m.left + ((s - smin) / (smax - smin)) * plotW;
  const Y = (v) => m.top + ((ymax - v) / (ymax - ymin)) * plotH;
  const zeroY = Y(0);
  const id = `oc${++chartSeq}`;

  const curve = pts.map((p) => `${X(p.s).toFixed(1)},${Y(p.pnl).toFixed(1)}`).join(" ");
  const area =
    `M ${X(pts[0].s).toFixed(1)} ${zeroY.toFixed(1)} ` +
    pts.map((p) => `L ${X(p.s).toFixed(1)} ${Y(p.pnl).toFixed(1)}`).join(" ") +
    ` L ${X(pts[pts.length - 1].s).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const kids = [];
  kids.push(svgEl("defs", null,
    svgEl("clipPath", { id: `${id}-p` }, svgEl("rect", { x: m.left, y: m.top, width: plotW, height: Math.max(0, zeroY - m.top) })),
    svgEl("clipPath", { id: `${id}-l` }, svgEl("rect", { x: m.left, y: zeroY, width: plotW, height: Math.max(0, m.top + plotH - zeroY) })),
  ));
  kids.push(svgEl("path", { d: area, fill: "rgba(15,217,160,0.16)", "clip-path": `url(#${id}-p)` }));
  kids.push(svgEl("path", { d: area, fill: "rgba(248,113,113,0.16)", "clip-path": `url(#${id}-l)` }));

  for (const t of niceTicks(ymin, ymax, 5)) {
    const y = Y(t);
    kids.push(svgEl("line", { x1: m.left, y1: y, x2: m.left + plotW, y2: y, stroke: "rgba(255,255,255,0.06)" }));
    kids.push(svgEl("text", { x: m.left - 8, y: y + 3, "text-anchor": "end", fill: "#4A5268", "font-size": 10, "font-family": "monospace", text: fmt(t, 0) }));
  }
  for (const t of niceTicks(smin, smax, 6)) {
    const x = X(t);
    kids.push(svgEl("line", { x1: x, y1: m.top, x2: x, y2: m.top + plotH, stroke: "rgba(255,255,255,0.05)" }));
    kids.push(svgEl("text", { x, y: m.top + plotH + 16, "text-anchor": "middle", fill: "#4A5268", "font-size": 10, "font-family": "monospace", text: fmt(t, t < 10 ? 1 : 0) }));
  }

  kids.push(svgEl("line", { x1: m.left, y1: zeroY, x2: m.left + plotW, y2: zeroY, stroke: "#8B93A8", "stroke-dasharray": "4 3" }));

  if (spot >= smin && spot <= smax) {
    const xs = X(spot);
    kids.push(svgEl("line", { x1: xs, y1: m.top, x2: xs, y2: m.top + plotH, stroke: "#F5A623", "stroke-dasharray": "2 3" }));
    kids.push(svgEl("text", { x: xs, y: m.top - 7, "text-anchor": "middle", fill: "#F5A623", "font-size": 10, "font-family": "monospace", text: "SPOT" }));
  }

  for (const b of breakevens(legs, smin, smax)) {
    const xb = X(b);
    kids.push(svgEl("circle", { cx: xb, cy: zeroY, r: 3.5, fill: "#EDF0F7" }));
    kids.push(svgEl("text", { x: xb, y: zeroY - 8, "text-anchor": "middle", fill: "#EDF0F7", "font-size": 10, "font-family": "monospace", text: fmt(b, b < 10 ? 2 : 0) }));
  }

  kids.push(svgEl("polyline", { points: curve, fill: "none", stroke: "#0FD9A0", "stroke-width": 2 }));
  kids.push(svgEl("rect", { x: m.left, y: m.top, width: plotW, height: plotH, fill: "none", stroke: "rgba(255,255,255,0.12)" }));

  return svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`, width: "100%", height: "auto",
    preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": "Option payoff diagram",
  }, ...kids);
}

function card(label, value, tone, sub) {
  return el("div", { class: "tr-metric" },
    el("div", { class: "tr-metric-label" }, label.toUpperCase()),
    el("div", { class: `tr-metric-value ${tone ? "tr-" + tone : ""}` }, value),
    sub ? el("div", { class: "tr-metric-sub" }, sub) : null);
}

function summaryCards(legs, spot) {
  const a = analyze(legs, { spot });
  const cost = a.netCost;
  const costSub = cost > 0 ? "you pay (debit)" : cost < 0 ? "you receive (credit)" : "even";
  return [
    card("Net cost", fmt(Math.abs(cost), 2), cost > 0 ? "neg" : cost < 0 ? "pos" : null, costSub),
    card("Max profit", a.maxProfit === Infinity ? "Unlimited" : fmt(a.maxProfit, 2), "pos"),
    card("Max loss", a.maxLoss === -Infinity ? "Unlimited" : fmt(a.maxLoss, 2), "neg"),
    card("Breakeven", a.breakevens.length ? a.breakevens.map((b) => fmt(b, b < 10 ? 2 : 0)).join("  ·  ") : "—"),
  ];
}

export function mount(root) {
  let spot = DEFAULT_SPOT;
  let strategyId = "long-straddle";
  let legs = strategyById(strategyId).build(spot);

  const blurbEl = el("div", { class: "tr-opt-blurb" });
  const legsHost = el("div", { class: "tr-opt-legs" });
  const diagramHost = el("div", { class: "tr-opt-diagram" });
  const summaryHost = el("div", { class: "tr-opt-summary" });

  function selectEl(options, value, onChange) {
    return el("select", { class: "tr-input", onChange: (e) => onChange(e.target.value) },
      ...options.map((o) => el("option", { value: o, selected: o === value }, o.toUpperCase())));
  }
  function numInput(value, onInput) {
    return el("input", { class: "tr-input", value, inputmode: "decimal", onInput: (e) => onInput(num(e.target.value)) });
  }

  function renderLegs() {
    clear(legsHost);
    legsHost.appendChild(el("div", { class: "tr-opt-leg tr-opt-leg--head" },
      el("span", null, "SIDE"), el("span", null, "TYPE"), el("span", null, "STRIKE"),
      el("span", null, "PREMIUM"), el("span", null, "QTY"), el("span", null, "")));
    legs.forEach((leg, i) => {
      legsHost.appendChild(el("div", { class: "tr-opt-leg" },
        selectEl(["long", "short"], leg.side, (v) => { leg.side = v; renderDiagram(); }),
        selectEl(["call", "put"], leg.type, (v) => { leg.type = v; renderDiagram(); }),
        numInput(leg.strike, (v) => { leg.strike = v; renderDiagram(); }),
        numInput(leg.premium, (v) => { leg.premium = v; renderDiagram(); }),
        numInput(leg.qty ?? 1, (v) => { leg.qty = v; renderDiagram(); }),
        el("button", { class: "tr-act tr-act--danger", type: "button", title: "Remove leg",
          onClick: () => { legs.splice(i, 1); renderLegs(); renderDiagram(); } }, "×")));
    });
  }

  function renderDiagram() {
    clear(diagramHost);
    clear(summaryHost);
    if (!legs.length) {
      diagramHost.appendChild(el("div", { class: "tr-empty" }, "Add at least one leg to see a payoff."));
      return;
    }
    diagramHost.appendChild(buildChart(legs, num(spot)));
    append(summaryHost, summaryCards(legs, num(spot)));
  }

  function setStrategy(id) {
    const strat = strategyById(id);
    if (!strat) return;
    strategyId = id;
    legs = strat.build(num(spot) || DEFAULT_SPOT);
    blurbEl.textContent = strat.blurb;
    renderLegs();
    renderDiagram();
  }

  const stratSelect = el("select", { class: "tr-input", onChange: (e) => setStrategy(e.target.value) },
    ...STRATEGIES.map((s) => el("option", { value: s.id, selected: s.id === strategyId }, s.name)));
  const spotInput = el("input", { class: "tr-input", value: spot, inputmode: "decimal",
    onInput: (e) => { spot = num(e.target.value); renderDiagram(); } });

  clear(root);
  root.appendChild(el("div", { class: "tr-view" },
    el("div", { class: "tr-header" },
      el("div", null,
        el("h1", { class: "tr-title" }, "OPTIONS PAYOFFS"),
        el("div", { class: "tr-subtitle" },
          "Build a multi-leg options position and see its profit/loss at expiration. Pick a preset "
          + "— straddle, strangle, strip, strap, spreads — or edit the legs directly."))),
    el("div", { class: "tr-controls tr-controls--opt" },
      el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "STRATEGY"), stratSelect),
      el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "SPOT / UNDERLYING"), spotInput)),
    blurbEl,
    el("div", { class: "tr-opt-legs-wrap" },
      legsHost,
      el("button", { class: "btn btn-ghost btn-sm", type: "button",
        onClick: () => { legs.push({ type: "call", side: "long", strike: num(spot), premium: round2(num(spot) * 0.05), qty: 1 }); renderLegs(); renderDiagram(); } }, "+ ADD LEG")),
    el("div", { class: "tr-card" },
      el("div", { class: "tr-section-title" }, "PAYOFF AT EXPIRATION"),
      diagramHost),
    summaryHost,
    el("div", { class: "tr-foot" },
      "Payoff is per 1 unit of the underlying at expiration. Premiums are editable illustrative "
      + "defaults, not live option prices. Green = profit, red = loss; the amber line marks spot.")));

  setStrategy(strategyId);
}
