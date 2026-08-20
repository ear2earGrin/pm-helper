// Watchlist persistence.
//
// Same storage model as the trade log: the browser's localStorage, so the list
// lives on the visitor's machine and no account is needed. Nothing here talks
// to the network — coingecko.js supplies the live numbers.

const KEY = "yf-trading-watchlist";

/** Stored entries: [{ id, symbol, name, note, addedAt }]. Never throws. */
export function load() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((e) => e && typeof e.id === "string" && e.id)
    .map((e) => ({
      id: e.id,
      symbol: String(e.symbol || "").toUpperCase(),
      name: String(e.name || e.id),
      note: String(e.note || ""),
      addedAt: Number(e.addedAt) || null,
    }));
}

export function save(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
    return true;
  } catch {
    // Private-mode or quota failure. The list stays usable for this session.
    return false;
  }
}

/** Adds a coin unless it is already saved. Returns the new list. */
export function add(entries, coin, now = Date.now()) {
  if (!coin || !coin.id) return entries;
  if (entries.some((e) => e.id === coin.id)) return entries;
  return entries.concat({
    id: coin.id,
    symbol: String(coin.symbol || "").toUpperCase(),
    name: coin.name || coin.id,
    note: "",
    addedAt: now,
  });
}

export function remove(entries, id) {
  return entries.filter((e) => e.id !== id);
}

export function setNote(entries, id, note) {
  return entries.map((e) => (e.id === id ? { ...e, note: String(note || "") } : e));
}
