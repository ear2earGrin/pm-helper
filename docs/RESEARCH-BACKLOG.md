# Research backlog — evidence-backed candidate improvements

What the academic literature and hedge-fund/CTA practice say works, mapped onto this
system. Each candidate carries its evidence strength and a test plan. Nothing here
enters the rules without walk-forward proof — this file is a queue, not a to-do list.

Compiled 2026-07 from: Moskowitz/Ooi/Pedersen "Time Series Momentum" (JFE 2012),
AQR "A Century of Evidence on Trend-Following" (Hurst/Ooi/Pedersen), Harvey et al
"The Impact of Volatility Targeting" (2018, Man Group), Koijen et al "Carry" (2018),
Carver "Systematic Trading"/"Advanced Futures Trading Strategies", Clenow "Following
the Trend", Faith "Way of the Turtle", crypto-specific: Liu/Tsyvinski (NBER w24877),
Han/Kang/Ryu (SSRN 4675565, realistic-cost crypto momentum), Huang/Sangiorgi/Urquhart
(SSRN 4825389, volume-weighted crypto TSM), CMU "The Crypto Carry Trade" (Christin
et al), plus 2025-26 market-structure reporting.

## Verdict first

A diversified CTA/managed-futures fund running trend on crypto would use, at core:
**time-series momentum entries, volatility-scaled position sizing, multi-horizon
signal ensembles, regime/vol gates, portfolio-level risk caps, and carry as a
separate sleeve.** We already have most of the skeleton. The genuinely new,
evidence-backed additions are ranked below.

## Tier 1 — strong evidence, fits our data, queue for validation

### 1. Portfolio-level volatility targeting
- **What**: scale total exposure down when realized portfolio vol runs above target
  (and modestly up when below). We size per-trade off ATR, but nothing caps the
  portfolio when everything gets wild at once.
- **Evidence**: Harvey et al (2018) across 60+ assets: vol targeting raises Sharpe
  for risk assets (crypto is the definition of one), cuts left tails and vol-of-vol.
  The effect is strongest exactly in leverage-effect assets. Conditional vol
  targeting (2020 FAJ) refines it further.
- **Test**: add `targetVolPct`; when trailing 20d realized portfolio vol > target,
  scale new-entry risk% proportionally. Ablate vs fixed 1%.

### 2. Multi-horizon ensemble ("the CTA workhorse")
- **What**: run the same Donchian logic at 2-3 horizons (e.g. 20/10, 55/20) and
  average the exposure, instead of betting everything on one lookback.
- **Evidence**: every diversified CTA program does this; averaged momentum across
  short/medium/long windows is the standard construction. Reduces
  parameter-luck risk — the plateau IS the edge.
- **Cost**: complexity. Conflicts mildly with "follow to the dot" — mitigate by
  making it two concurrent sub-systems each at half risk, mechanically identical.
- **Test**: variant 14 (55/20) already predeclared; if BOTH 20/10 and 55/20 show
  standalone edge, test the 50/50 blend.

### 3. Funding carry as a SEPARATE market-neutral sleeve (not a trend input)
- **What**: short perp + long spot on the same asset harvests the funding rate with
  ~no price risk. This is a different strategy, not a trend improvement.
- **Evidence**: CMU study: crypto carry Sharpe ~6.45 (2020-2023 sample) — but
  compressed to ~4 in 2024 and NEGATIVE in 2025. The easy carry era is over;
  it now pays only episodically (bull-euphoria funding spikes).
- **Verdict**: low priority now. Revisit only when scanner shows sustained extreme
  funding; could be a manual playbook page, not code.

## Tier 2 — worth knowing, already covered or queued

- **Breakout vs MA-crossover**: literature says roughly equivalent trend-capture
  ("A Century of Profitable Industry Trends": Donchian/Keltner channels effective
  across 100 years). Our Donchian choice is fine. Do not churn entry style.
- **Pyramiding** (Turtle): right-tail enhancer, queued post-baseline.
- **Crisis-alpha short book**: CTAs keep shorts for convexity in crashes even at
  lower standalone Sharpe. Judge our short book on portfolio contribution, not
  standalone P&L — but only if it isn't outright negative after funding.
- **Breadth (Grinold)**: more independent bets beats better signals. Crypto's
  internal correlation (~one factor in stress) caps breadth at ~2-3 effective bets.
  The real breadth upgrade would be non-crypto futures — out of scope for now.

## Ruled on: Market Cipher / WaveTrend (owner's paid TradingView indicator)

Decision (2026-07-18, post-ablation): NOT a candidate for the mechanical system.
Market Cipher is a closed-source bundle of public-domain oscillators (WaveTrend /
LazyBear, RSI variants, money flow). The 15-variant ablation demonstrated on the
owner's own data that oscillator layers on price SUBTRACT edge in this system
(every added condition reduced expectancy). Closed-source also means it cannot be
replicated exactly, so it cannot be honestly backtested.

Sanctioned use instead: the DISCRETIONARY lane. Cipher-assisted manual trades go
through the Checker page and are logged as discretionary, keeping a separate
scorecard from system trades. After ~6 months the two tracks can be compared —
measuring whether the owner's discretion beats the machine is a legitimate and
interesting experiment. If anyone insists on testing WaveTrend mechanically, it
must be implemented from the public LazyBear formula as a predeclared variant and
judged on data the choice wasn't made on.

## Tier 3 — hedge-fund practices we deliberately skip

- Cross-sectional momentum (long winners / short losers among coins): crypto
  evidence is WEAK vs time-series momentum (Han/Kang/Ryu; ACFR study) and it
  doubles turnover. Skip.
- ML/feature-stacked entries: needs data and infrastructure we don't have; decays
  fast; unfalsifiable for a solo operator. Skip.
- HFT/market-making, basis arbitrage at scale, options overlays: infrastructure
  businesses, not strategies. Skip.

## Standing warning from the 2025-26 literature

Crypto time-series momentum remains statistically real but **the edge is
compressing**: realistic-cost studies kill many published momentum results, carry
returns went negative in 2025, and post-ETF Bitcoin trades increasingly like a
macro asset (2026 reporting: "losing the momentum trade"). Consequences for us:
1. Walk-forward re-validation on a schedule is not optional hygiene — it's the
   main defense against trading a dead edge.
2. The 20% drawdown circuit breaker matters more than any entry tweak.
3. Expect the honest baseline to be less glamorous than 2020-21 folklore suggests.
