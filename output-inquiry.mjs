// Decide whether an exact proposed text survives the settings a trusted fixture can read.
import {analyze} from "./inquiry.mjs";

function validName(name) {
  return typeof name === "string" && name.trim().length > 0;
}

function decisionFromRuns(unknown, histories, readable, budget) {
  const fields = unknown.map((_, i) => "setting" + i);
  const rules = [...fields, "matches"].map(f => "fact " + f + " from probe." + f + " owner receiver");
  rules.push("guarantee deliver when matches");
  const offers = fields.flatMap((f, i) => readable.includes(unknown[i]) ? ["offer " + f + " cost 1"] : []);
  const observer = ["question deliver", "observe none", ...offers, "budget " + budget];
  const {cells: [cell]} = analyze(rules.join("\n"), observer.join("\n"), {histories});
  const scope = {scope: "declared_boolean_settings", configurations: histories.length};
  if (cell.status === "determined") return {...scope, status: "decided", matches: cell.answer};
  if (cell.status === "inquiry_available") {
    return {...scope, status: "ask", setting: unknown[fields.indexOf(cell.firstObservation.fact)]};
  }
  return {...scope, status: "hold", reason: cell.status};
}

export function inquireOutput(settings, measure, proposed, {known, readable, budget}) {
  if (!Array.isArray(settings) || !Array.from(settings).every(validName) ||
      new Set(settings).size !== settings.length || settings.length > 7) throw Error("Name up to seven distinct Boolean settings.");
  if (!known || typeof known !== "object" || Array.isArray(known) ||
      Object.entries(known).some(([name, value]) => !validName(name) || typeof value !== "boolean") ||
      !Array.isArray(readable) || !Array.from(readable).every(validName) || new Set(readable).size !== readable.length ||
      !Number.isSafeInteger(budget) || budget < 0) throw Error("Supply observed values as Booleans, allowed questions and the remaining budget.");
  if (typeof proposed !== "string" || typeof measure !== "function") throw Error("Supply proposed text and a repeatable measurement.");

  const names = new Set([...settings, ...Object.keys(known)]);
  while (names.size <= 7) {
    const unknown = [...names].filter(name => !Object.hasOwn(known, name));
    const histories = [];
    let added = false;
    for (let mask = 0; mask < 2 ** unknown.length; mask++) {
      const data = Object.assign(Object.create(null), known);
      const facts = {};
      for (const [i, name] of unknown.entries()) {
        facts["setting" + i] = data[name] = Boolean(mask & (1 << i));
      }
      Object.freeze(data);
      let missing;
      const retry = Error("Fixture read an unmeasured setting.");
      function requireField(name, booleanDomain) {
        if (typeof name === "string" && !Object.hasOwn(data, name)) {
          missing ??= {name, booleanDomain};
          throw retry;
        }
      }
      const config = new Proxy(data, {
        get(target, key) { requireField(key, false); return Reflect.get(target, key); },
        has(target, key) { requireField(key, false); return Reflect.has(target, key); },
        getOwnPropertyDescriptor(target, key) {
          requireField(key, false);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      function readBoolean(name) {
        if (!validName(name)) throw Error("Supply a nonempty Boolean setting name.");
        requireField(name, true);
        return data[name];
      }
      try {
        const value = measure(config, readBoolean);
        if (missing) throw retry;
        const repeated = measure(config, readBoolean);
        if (missing) throw retry;
        if (typeof value !== "string" || value !== repeated) throw Error("The destination must return repeatable text.");
        facts.matches = value === proposed;
        histories.push({id: String(mask), facts});
      } catch (error) {
        if (error !== retry) throw error;
        if (!missing.booleanDomain) {
          return {scope: "declared_boolean_settings", configurations: histories.length,
            status: "hold", reason: "undeclared_setting", setting: missing.name};
        }
        // Restart from the beginning. A setting can be read only on a later conditional path.
        names.add(missing.name);
        added = true;
        break;
      }
    }
    if (!added) return decisionFromRuns(unknown, histories, readable, budget);
  }
  return {scope: "declared_boolean_settings", configurations: 0, status: "hold", reason: "setting_limit"};
}
