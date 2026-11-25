// Offline, finite transfer. The caller supplies authenticated source records and
// a separately pinned authority key. Signed mappings remain premises about the world.
import {readEdition} from "./contract-language.mjs";
import {observationTimes,recordReader} from "./evidence-source.mjs";
import {observationPlanner} from "./observation-plan.mjs";
import {variableCodebook,encodeRegion,correspondenceRegion} from "./symbolic-retention.mjs";
import {retain} from "./retention.mjs";

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
export function bridgeBytes(body) {
  return new TextEncoder().encode(JSON.stringify(canonical(["phaseline.carry-authority/1",body])));
}
export async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return Array.from(hash,b => b.toString(16).padStart(2,"0")).join("");
}
const hold = (reason, details={}) => ({status:"hold",reason,...details});

export async function makeBook(source, regime) {
  const variable=regime?.form==="finite-variables/1";
  const {classes} = retain(source,regime).issued;
  const content = {format:variable?"phaseline.variables-book/1":"phaseline.codebook/1",source,regime,classes};
  return {...content,id:await digest(content)};
}

async function checkBook(book) {
  if (!["phaseline.codebook/1","phaseline.variables-book/1"].includes(book?.format)) throw Error("Supply the issued codebook.");
  const expected = await makeBook(book.source,book.regime);
  if (expected.format !== book.format || expected.id !== book.id || JSON.stringify(canonical(expected.classes)) !== JSON.stringify(canonical(book.classes)))
    throw Error("Codebook contents do not match the issued table.");
}

function rowsFor(book) {
  const codes = new Map(book.classes.flatMap(c => c.histories.map(id => [id,c.code])));
  return book.regime.states.map((row,index) => ({...row,index,answer:codes.get(row.id)}));
}

async function obtain(book, packet, rows, account) {
  const {observe,offers,budget} = book.regime;
  const edition = readEdition(book.source);
  const evidence=[];
  const read = recordReader(edition,packet,(fact,binding,records) => {
    evidence.push({fact,binding,records:records.map(row=>observationTimes(row,binding))});
  });
  const snapshot = observe.map(key => [key,read(key)]);
  let remaining = rows.filter(row => snapshot.every(([key,value]) => value === undefined || row.facts[key] === value));
  const reads = [];
  const {plan} = observationPlanner(Object.entries(offers));
  let charge = 0;
  while (remaining.length) {
    const {cost,fact} = plan(remaining);
    if (cost === 0) {
      const body = {format:"phaseline.capture/1",book:book.id,subject:packet.subject,at:packet.at,
        asOf:packet.asOf,evidence:await digest(evidence),predecessor:account.predecessor ?? null,
        code:remaining[0].answer,limit:account.limit,spent:account.spent+charge};
      return {status:"obtained",receipt:{...body,id:await digest(body)},reads};
    }
    if (!Number.isFinite(cost)) {
      const byEvidence = new Map();
      for (const row of remaining) {
        const key = JSON.stringify(Object.keys(offers).map(k=>row.facts[k]));
        const previous = byEvidence.get(key);
        if (previous && previous.answer !== row.answer)
          return hold("available observations cannot distinguish these codes",{histories:[previous.id,row.id],codes:[previous.answer,row.answer],reads});
        byEvidence.set(key,row);
      }
      throw Error("Missing indistinguishable pair.");
    }
    if (cost > Math.min(budget-charge,account.limit-account.spent-charge))
      return hold("observation budget exhausted",{priorSpent:account.spent,reads,neededWorstCase:cost,remaining:Math.min(budget-charge,account.limit-account.spent-charge)});
    const binding=edition.bindings.get(fact);
    charge += offers[fact];
    reads.push({fact,source:binding.source,owner:binding.owner,cost:offers[fact]});
    const value = read(fact);
    if (value === undefined) return hold("missing or conflicting observation",{needs:{fact,...binding},reads,spent:account.spent+charge});
    remaining = remaining.filter(row=>row.facts[fact]===value);
  }
  return hold("the permitted records contradict all admitted histories",{reads});
}

async function obtainVariables(book,compiled,packet,region,account) {
  const result=encodeRegion(compiled,packet,region,account.limit-account.spent);
  const reads=result.evidence.filter(item=>item.cost>0);
  if(result.status!=="encoded") return hold(result.status,{reads,spent:account.spent+result.spent,
    ...(result.worstCaseAdditionalCost!==undefined?{needed:result.worstCaseAdditionalCost}:{}),
    ...(result.possibleCodes?{possibleCodes:result.possibleCodes}:{})});
  const body={format:"phaseline.capture/1",book:book.id,subject:packet.subject,at:packet.at,asOf:packet.asOf,
    evidence:await digest(result.records),predecessor:account.predecessor??null,
    code:result.code,limit:account.limit,spent:account.spent+result.spent};
  return {status:"obtained",receipt:{...body,id:await digest(body)},reads};
}

export async function captureRecord(book,packet) {
  await checkBook(book);
  if(book.format==="phaseline.variables-book/1") {
    const compiled=variableCodebook(book.source,book.regime);
    return obtainVariables(book,compiled,packet,compiled.machine.reachable,{limit:compiled.machine.budget,spent:0});
  }
  return obtain(book,packet,rowsFor(book),{limit:book.regime.budget,spent:0});
}

export async function carryRecord(oldBook,newBook,previous,authorization,trust,packet) {
  await checkBook(oldBook);
  await checkBook(newBook);
  const receipt=previous?.receipt;
  if (previous?.status !== "obtained" || receipt?.format !== "phaseline.capture/1" || receipt.book !== oldBook.id)
    return hold("missing capture or wrong predecessor codebook");
  const bridge=authorization?.bridge;
  if (!bridge || typeof authorization.signature!=="string" || !/^[0-9a-f]{128}$/.test(authorization.signature) ||
      typeof trust?.key!=="string" || !/^[0-9a-f]{64}$/.test(trust.key) || trust.owner!==bridge.owner)
    return hold("missing bridge or independent authority key");
  const bytes=hex => Uint8Array.from(hex.match(/../g), byte=>parseInt(byte,16));
  const key=await crypto.subtle.importKey("raw",bytes(trust.key),"Ed25519",false,["verify"]);
  if (!await crypto.subtle.verify("Ed25519",key,bytes(authorization.signature),bridgeBytes(bridge)))
    return hold("bridge signature does not match the pinned authority");
  const {id,...body}=receipt;
  if (await digest(body)!==id || bridge?.receipt!==id) return hold("capture differs from the independently admitted receipt");
  if (receipt.subject!==packet?.subject || receipt.at!==packet.at || packet.asOf<receipt.asOf)
    return hold("wrong subject, event or review time");
  if (!Number.isSafeInteger(receipt.limit) || !Number.isSafeInteger(receipt.spent) || receipt.spent<0 || receipt.spent>receipt.limit)
    return hold("invalid prior observation account");
  if (bridge.status!=="approved" || typeof bridge.owner!=="string" || !bridge.owner.trim() ||
      typeof bridge.reference!=="string" || !bridge.reference.trim() || bridge.from!==oldBook.id || bridge.to!==newBook.id ||
      !Number.isSafeInteger(bridge.effectiveFrom) || !Number.isSafeInteger(bridge.validThrough) ||
      bridge.effectiveFrom>packet.asOf || bridge.validThrough<packet.asOf)
    return hold("no applicable authority for this correspondence");
  if(oldBook.format==="phaseline.variables-book/1" || newBook.format==="phaseline.variables-book/1") {
    if(oldBook.format!==newBook.format || !bridge.correspondence || Object.hasOwn(bridge,"successors"))
      return hold("supply matching finite-variable books and one signed field correspondence");
    const old=variableCodebook(oldBook.source,oldBook.regime), revised=variableCodebook(newBook.source,newBook.regime);
    const allowed=correspondenceRegion(old,revised,receipt.code,bridge.correspondence);
    if(allowed.status!=="covered") return hold("no successor for an admissible origin",{unmatchedPredecessor:allowed.unmatchedPredecessor});
    return obtainVariables(newBook,revised,packet,allowed.image,{limit:receipt.limit,spent:receipt.spent,predecessor:id});
  }
  if(Object.hasOwn(bridge,"correspondence")) return hold("enumerated books require an explicit history correspondence");
  const origins=oldBook.classes.find(c=>c.code===receipt.code)?.histories;
  if (!origins || !bridge.successors || typeof bridge.successors!=="object" || Array.isArray(bridge.successors))
    return hold("missing correspondence for the stored code");
  const rows=rowsFor(newBook), ids=new Set(rows.map(row=>row.id)), candidates=new Set();
  for (const origin of origins) {
    const next=Object.hasOwn(bridge.successors,origin) ? bridge.successors[origin] : null;
    if (!Array.isArray(next) || next.length===0 || next.some(id=>!ids.has(id)))
      return hold("missing or invalid successor correspondence",{origin});
    for (const id of next) candidates.add(id);
  }
  return obtain(newBook,packet,rows.filter(row=>candidates.has(row.id)),{limit:receipt.limit,spent:receipt.spent,
    predecessor:{receipt:id,authorization:await digest(authorization)}});
}
