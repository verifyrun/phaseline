// Infer a candidate from labeled examples. An observed association cannot authorize an action.
export function suggestPrerequisite(traces) {
  if (!Array.isArray(traces) || traces.length > 100000) throw Error("Supply at most 100,000 traces.");
  const frequencies = new Map(), pairs = new Map();
  let acted = 0;
  for (const trace of traces) {
    if (!trace || typeof trace.acted !== "boolean" || !Array.isArray(trace.seen) || trace.seen.length > 32
        || trace.seen.some(x => typeof x !== "string" || !x.length || x.length > 128)
        || new Set(trace.seen).size !== trace.seen.length) throw Error("Each trace needs distinct observed feature names and a Boolean acted label.");
    const seen = [...trace.seen].sort();
    const side = trace.acted ? 1 : 0;
    if (trace.acted) acted++;
    for (let i=0; i<seen.length; i++) {
      const a=seen[i];
      if (!frequencies.has(a)) frequencies.set(a,[0,0]);
      if (frequencies.size>64) throw Error("At most 64 distinct features are supported.");
      frequencies.get(a)[side]++;
      for (let j=0; j<i; j++) {
        const key=JSON.stringify([seen[j],a]);
        if (!pairs.has(key)) pairs.set(key,[0,0]);
        pairs.get(key)[side]++;
      }
    }
  }
  const waited = traces.length-acted;
  if (!acted || !waited) return {status:"insufficient_evidence", reason:"both_outcomes_required"};
  let best=0, alternatives=0, winner;
  function consider(features, [falsePositive,truePositive]) {
    const gain=truePositive*waited-falsePositive*acted; // Balanced accuracy relative to chance.
    if (gain<=0 || gain<best) return;
    if (gain>best || (gain===best && features.length<winner.features.length)) {
      best=gain; alternatives=0; winner={features,truePositive,falsePositive,falseNegative:acted-truePositive,trueNegative:waited-falsePositive};
    }
    if (features.length===winner.features.length) alternatives++;
  }
  for (const name of [...frequencies.keys()].sort()) consider([name],frequencies.get(name));
  for (const key of [...pairs.keys()].sort()) consider(JSON.parse(key),pairs.get(key));
  return winner ? {status:"candidate",scope:"supplied_traces",...winner,equalBest:alternatives}
    : {status:"insufficient_evidence",reason:"no_predictive_positive_feature"};
}
