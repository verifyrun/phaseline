// A replacement is an executable Phaseline policy for reviewing proposed answers.
// Its public service signature includes both the three-way verdict and charged work.
import {readEdition,evaluate} from "./contract-language.mjs";

export const MAX_WORK=4;
export const VERDICTS=["allow","refuse","hold"];
export const cell=(position,claim)=>2*position+Number(claim);
export function validSize(size) {
  if (!Number.isSafeInteger(size) || size<1 || size>16) throw Error("Enroll between one and sixteen positions.");
}
export function validInput(size,position,claim) {
  return Number.isSafeInteger(position) && position>=0 && position<size && typeof claim==="boolean";
}
export function validAnswer(answer) {
  return answer && VERDICTS.includes(answer.verdict) && Number.isInteger(answer.work) && answer.work>=1 && answer.work<=MAX_WORK;
}
function bindings(size) {
  return "fact position in slot range 0.."+(size-1)+" from item.position owner receiver\n"+
    "fact claim from item.claim owner receiver\n";
}
const outputs=["permit","refuse",...Array.from({length:MAX_WORK},(_,i)=>"work_"+(i+1))];

export function compileReview(size,source) {
  validSize(size);
  const e=readEdition(source),position=e.bindings.get("position"),claim=e.bindings.get("claim");
  if (e.bindings.size!==2 || position?.unit!=="slot" || position?.owner!=="receiver" ||
      position?.source!=="item.position" || position?.range?.[0]!==0 || position?.range?.[1]!==size-1 ||
      claim?.source!=="item.claim" || claim?.owner!=="receiver" || claim?.unit ||
      [...e.used].some(id=>id!=="position" && id!=="claim") ||
      outputs.some(id=>!e.rules.has(id))) throw Error("The reviewer must implement the enrolled input and verdict/work interface.");
  return (position,claim)=>{
    if (!validInput(size,position,claim)) throw Error("Review input is outside the enrolled domain.");
    const facts={position,claim},cache=new Map(), results=outputs.map(id=>evaluate(e,id,facts,cache));
    const [permit,refuse,...costs]=results;
    if ((permit && refuse) || costs.filter(Boolean).length!==1) throw Error("The review program must return one verdict and one price at every input.");
    return {verdict:permit?"allow":refuse?"refuse":"hold",work:costs.indexOf(true)+1};
  };
}

export function constructReview(size,observations) {
  validSize(size);
  if (!Array.isArray(observations) || observations.length!==2*size || observations.some(o=>!validAnswer(o)))
    throw Error("Constructing this reviewer requires one observed verdict and price for every case.");
  // Share equal truth across the two proposed answers. No incumbent bytes enter construction.
  function cases(matches) {
    const clauses=[];
    for (let k=0;k<size;k++) {
      const f=matches(observations[cell(k,false)]),t=matches(observations[cell(k,true)]);
      if (!f && !t) continue;
      const where="position = "+k+" slot";
      clauses.push(f && t?where:"("+where+" and "+(t?"claim":"not claim")+")");
    }
    return clauses.length?clauses.join(" or "):"false";
  }
  const predicates=[o=>o.verdict==="allow",o=>o.verdict==="refuse",
    ...Array.from({length:MAX_WORK},(_,i)=>o=>o.work===i+1)];
  return bindings(size)+outputs.map((name,i)=>"guarantee "+name+" when "+cases(predicates[i])).join("\n")+"\n";
}

export function certifyReview(size,source,observations) {
  if (!Array.isArray(observations) || observations.length!==2*size || observations.some(o=>!validAnswer(o)))
    throw Error("The predecessor needs an authorized observation for every priced input.");
  const execute=compileReview(size,source);
  for (let k=0;k<2*size;k++) {
    const position=Math.floor(k/2), claim=Boolean(k%2);
    const got=execute(position,claim), expected=observations[k];
    if (got.verdict!==expected.verdict || got.work!==expected.work)
      return {status:"different",witness:{position,claim,expected,proposed:got}};
  }
  return {status:"preserved",cases:2*size};
}
