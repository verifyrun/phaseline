export function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

export function observationPlanner(candidates, permitted=()=>true) {
  const memo = new Map();
  // Bellman's recurrence: pay for one observation, then allow its worst answer.
  // A useful split strictly reduces the remaining set; known fields cannot split it.
  function plan(subset) {
    const key = subset.map(row => row.index).join(",");
    if (memo.has(key)) return memo.get(key);
    if (memo.size >= 10000) throw Error("Planning limit exceeded (10,000 subproblems).");
    memo.set(key, null);
    let best = { cost:Infinity };
    if (subset.every(row => row.answer === subset[0].answer)) best = { cost:0 };
    else for (const [fact, price] of candidates) {
      if(!permitted(fact,subset)) continue;
      const parts = groupBy(subset, row => row.facts[fact]);
      if (parts.size === 1) continue;
      let cost = price;
      for (const part of parts.values()) {
        cost = Math.max(cost, price + plan(part).cost);
        if (cost >= best.cost) break;
      }
      if (cost < best.cost) best = { cost, fact };
    }
    memo.set(key,best);
    return best;
  }
  return {plan, memo};
}
