# Daily and weekly routine

A mechanical system only works if you mechanically run it. This is your checklist.

## Sunday (or Monday before market open) — the weekly review

Time: 15 minutes.

1. **Open `/scanner`** in the app. Click **RUN SCAN**.
2. **Read the regime column for every asset.** Note which assets are `LONG_OK`, `SHORT_OK`, `FLAT`. That's your *entire* tradeable universe for the next 5 days.
3. **For any open positions you hold**: confirm regime hasn't flipped. If it has, the position should already be flagged for exit on the next daily close.
4. **Note major macro events** for the week — FOMC, CPI, NFP — in the discretionary CHECKER. These don't change the mechanical system's signals but help you mentally prepare.
5. **Write one sentence in your trade journal**: "Week of YYYY-MM-DD: regime is [BULL/BEAR/MIXED] across the universe." This is a calibration habit, not analysis.

## Every weekday — the daily check (5 minutes, after the daily close)

1. **`/scanner`** → **RUN SCAN**.
2. **For each open position**, recompute trailing stop from the row in the table. Update your exchange's stop order if it moved.
3. **For any new signal** (action = LONG or SHORT):
   - Verify portfolio rules: under 5 concurrent? Total open risk < 4%? No correlated position already open? Re-entry cooldown over?
   - If all yes: **take the trade exactly as the scanner specifies**. Entry market or limit at the close, stop at the suggested price, size = qty column.
   - If portfolio rules block: **do not take the trade**, even if it "looks great." That's the system working.
4. **If a position's exit reason fires** (stop hit, regime flip): close immediately, no questions.
5. **Log the trade** (open or close) in your journal. Eventually this will be a one-click export.

## What to do when you feel like overriding the system

This will happen. Especially when:
- The system says LONG and the chart "looks toppy"
- The system is FLAT for 6 weeks and you're bored
- The system just had three stop-outs in a row
- A YouTube analyst makes a compelling case for the opposite trade
- You "just know" this one is going to work

**The rule**: you may *skip* a system entry (mechanical → discretionary FLAT). You may NOT take an entry the system didn't signal, and you may NOT skip an exit the system signaled.

Skipping a signal is allowed because the system is opt-in. Taking a non-signal trade and calling it "discretionary" while sizing it like a system trade is what kills accounts.

If you skip an entry, write down why in the journal *before* the bar closes. Read those notes monthly. If you're skipping 30% of signals and your skipped-signal hypothetical PnL is positive, you're sabotaging the system. Either fix your discipline or fix the rules.

## Monthly review

Time: 30 minutes.

1. Open the journal. Read every entry from the month.
2. **Count**: signals fired, signals taken, signals skipped, trades stopped out, trades closed at regime flip.
3. **Compute**: your actual realized P&L vs the "if I had taken every signal" hypothetical.
4. **Note the worst moment** of the month emotionally. Did you stick to the system? If no, what made you deviate?
5. **Re-run the backtest** with the latest data. Has the equity curve and max DD shape changed meaningfully? If yes — investigate. If no — you're on track.

## What success looks like after 6 months

- You took every signal the system fired (or skipped a small minority with documented reasons).
- You did not take any non-signal trades and call them "system trades."
- Your realized P&L is within ~20% of the backtest expectation for the same period.
- You can describe a losing month without emotional charge — "this is what drawdown looks like."

If all four are true, the system is working *and you are working with it*. That's the harder of the two.
