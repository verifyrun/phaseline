// Ask about receiver settings only when a measured output can change the proposed delivery.
import {analyze} from "./inquiry.mjs";

export function inquireOutput(settings, measure, proposed, {known, readable, budget}) {
  if (!Array.isArray(settings) || settings.length > 7 ||
      settings.some(s => typeof s !== "string" || !s.trim()) ||
      new Set(settings).size !== settings.length) throw Error("Name up to seven distinct Boolean settings.");
  if (!known || typeof known !== "object" || Array.isArray(known) ||
      Object.entries(known).some(([k,v]) => !settings.includes(k) || typeof v !== "boolean") ||
      !Array.isArray(readable) || new Set(readable).size !== readable.length ||
      readable.some(k => !settings.includes(k)) || !Number.isSafeInteger(budget) || budget < 0)
    throw Error("Supply the receiver's observed values, allowed questions and remaining budget.");
  if (typeof proposed !== "string" || typeof measure !== "function") throw Error("Supply proposed text and a repeatable measurement.");
  const unknown = settings.filter(s => !Object.hasOwn(known,s));
  const fields = unknown.map((_,i) => "setting"+i);
  const histories = [];
  for (let mask=0; mask < 2**unknown.length; mask++) {
    const values = unknown.map((_,i) => Boolean(mask & (1<<i)));
    const configuration = Object.freeze({...known,...Object.fromEntries(unknown.map((s,i) => [s,values[i]]))});
    const actual = measure(configuration);
    if (typeof actual !== "string" || actual !== measure(configuration)) throw Error("The destination must return repeatable text for every measured configuration.");
    histories.push({id:String(mask), facts:{...Object.fromEntries(fields.map((f,i)=>[f,values[i]])), matches:actual===proposed}});
  }
  const rules = [...fields,"matches"].map(f => "fact "+f+" from probe."+f+" owner receiver").concat("guarantee deliver when matches");
  const offers = fields.flatMap((f,i) => readable.includes(unknown[i]) ? ["offer "+f+" cost 1"] : []);
  const observer = ["question deliver","observe none",...offers,"budget "+budget];
  const {cells:[cell]} = analyze(rules.join("\n"),observer.join("\n"),{histories});
  const common = {scope:"declared_boolean_settings", configurations:histories.length};
  if (cell.status==="determined") return {...common,status:"decided",matches:cell.answer};
  if (cell.status==="inquiry_available") return {...common,status:"ask",setting:unknown[fields.indexOf(cell.firstObservation.fact)]};
  return {...common,status:"hold",reason:cell.status};
}
