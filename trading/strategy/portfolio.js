export const PORTFOLIO_PARAMS = {
  maxConcurrent: 5,
  maxEntriesPerDay: 1,
  maxOpenRiskPct: 4,
  reentryCooldownDays: 3,
  correlationGroups: [
    ["BTC", "ETH"],
  ],
};

function groupKey(asset, groups) {
  const upper = (asset || "").toUpperCase();
  for (const g of groups) {
    if (g.map((s) => s.toUpperCase()).includes(upper)) return g.join("+");
  }
  return upper;
}

export function checkPortfolioAllows({
  candidate,
  openPositions,
  recentlyStopped,
  todayEntries,
  params = PORTFOLIO_PARAMS,
}) {
  const reasons = [];

  if (openPositions.length >= params.maxConcurrent) {
    reasons.push(`already at ${params.maxConcurrent} concurrent positions`);
  }

  if (todayEntries >= params.maxEntriesPerDay) {
    reasons.push(`already took ${params.maxEntriesPerDay} entry today`);
  }

  const totalOpenRiskPct = openPositions.reduce((s, p) => s + (p.riskPct || 0), 0);
  if (totalOpenRiskPct + (candidate.riskPct || 0) > params.maxOpenRiskPct) {
    reasons.push(
      `open risk would exceed ${params.maxOpenRiskPct}% (current ${totalOpenRiskPct.toFixed(2)}%)`,
    );
  }

  const candGroup = groupKey(candidate.asset, params.correlationGroups);
  const sameGroupSameDir = openPositions.filter(
    (p) => groupKey(p.asset, params.correlationGroups) === candGroup && p.direction === candidate.direction,
  );
  if (sameGroupSameDir.length > 0) {
    reasons.push(`correlated position already open: ${sameGroupSameDir.map((p) => p.asset).join(",")}`);
  }

  const sameDirAlts = openPositions.filter(
    (p) =>
      groupKey(p.asset, params.correlationGroups) !== "BTC+ETH" &&
      p.direction === candidate.direction,
  );
  if (sameDirAlts.length >= 3 && groupKey(candidate.asset, params.correlationGroups) !== "BTC+ETH") {
    reasons.push("3+ alt positions already open in this direction");
  }

  const cooldown = recentlyStopped.find(
    (r) => r.asset.toUpperCase() === candidate.asset.toUpperCase() && r.daysSince < params.reentryCooldownDays,
  );
  if (cooldown) {
    reasons.push(`re-entry cooldown active for ${candidate.asset} (${cooldown.daysSince}d < ${params.reentryCooldownDays}d)`);
  }

  return { allowed: reasons.length === 0, reasons };
}
