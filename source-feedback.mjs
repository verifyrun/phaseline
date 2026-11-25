// A single insertion, deletion, substitution, or adjacent transposition is a useful spelling hint.
function near(a, b) {
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) return near(b, a);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  if (i === a.length) return false;
  return a.slice(i+1) === b.slice(i+1) ||
    (a[i] === b[i+1] && a[i+1] === b[i] && a.slice(i+2) === b.slice(i+2));
}

export function introducedInputs(old, next) {
  const known = new Set([...old.used, ...old.rules.keys(), ...old.bindings.keys(), ...next.bindings.keys(), ...next.rules.keys()]);
  return [...next.used].filter(fact => !old.used.has(fact)).map(fact => ({
    fact, previousGuarantee:old.rules.has(fact), suggestions:[...known].filter(name=>near(fact,name)).sort()
  }));
}

export function sourceFeedback(issued, proposed, result, formatWitness) {
  const lines = [];
  for (const {fact,previousGuarantee,suggestions:matches} of introducedInputs(issued,proposed)) {
    let message = `New input fact: ${fact}. Which record supplies it?`;
    if (previousGuarantee) message += " This name was a guarantee in the issued edition.";
    if (matches.length) message += ` Possible typo. Did you mean ${matches.join(" or ")}?`;
    lines.push(message);
  }
  for (const {id, kind, witness, before, after} of result.changes) {
    const input = witness ?? {};
    const facts = formatWitness(input);
    lines.push([`${id} ${kind}`, ...facts, `before: ${before} → after: ${after}`].join(" · "));
  }
  if (!result.changes.length) lines.push("All declared outcomes preserved.");
  return lines.join("\n");
}
