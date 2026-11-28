// Trace the last introduction of a symptom that survives to the observed receiver.
// The host supplies the actual run boundaries and observations. A configured tool is not a receipt.
export function traceProducer(event, records, hasSymptom) {
  const named = value => typeof value === "string" && value.trim().length > 0;
  if (!event || ![event.run, event.release, event.subject].every(named) ||
      typeof event.before !== "string" || typeof event.after !== "string" ||
      !Number.isInteger(event.steps) || event.steps < 1 || event.steps > 128 ||
      !Array.isArray(records) || typeof hasSymptom !== "function") {
    throw Error("Supply one identified run, its receiving artifact, observed endpoints and stage count.");
  }
  function matches(text) {
    const value = hasSymptom(text);
    if (typeof value !== "boolean") throw Error("The symptom check must return a Boolean.");
    return value;
  }
  const steps = Array.from({length:event.steps + 1}, () => Object.create(null));
  steps[0].output = event.before;
  steps[event.steps].output = event.after;
  for (const record of records) {
    if (!record || ![record.run, record.release, record.subject].every(named)) throw Error("Every receipt needs a run, release and subject.");
    if (record.run !== event.run || record.release !== event.release || record.subject !== event.subject) continue;
    if (!Number.isInteger(record.step) || record.step < 1 || record.step > event.steps) throw Error("Receipt names a stage outside this run.");
    const slot = steps[record.step];
    for (const field of ["output", "tool", "installation"]) {
      if (!Object.hasOwn(record, field)) continue;
      const value = record[field];
      if (field === "output" ? typeof value !== "string" : !named(value)) throw Error("Invalid receipt field: "+field);
      if (Object.hasOwn(slot,field) && slot[field] !== value) return {status:"hold", reason:"conflicting_receipts", step:record.step, field};
      slot[field] = value;
    }
  }
  if (!matches(event.after)) return {status:"absent"};
  for (let step = event.steps; step > 0; step--) {
    const previous = steps[step-1];
    if (!Object.hasOwn(previous,"output")) return {status:"ask", step:step-1, field:"output"};
    if (matches(previous.output)) continue;
    const source = steps[step];
    if (!source.tool) return {status:"ask", step, field:"tool"};
    if (!source.installation) return {status:"ask", step, field:"installation", tool:source.tool};
    return {status:"traced", step, tool:source.tool, installation:source.installation};
  }
  return {status:"preexisting"};
}
