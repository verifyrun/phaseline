// Inspect the source token before accepting a binary64 integer as exact evidence.
// The first object key that appears twice in already valid JSON text, or undefined.
// JSON.parse keeps only the last value, so a repeated key would hide evidence.
export function repeatedKey(text) {
  const open=[];
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==="{") open.push(new Set());
    else if(c==="[") open.push(null);
    else if(c==="}" || c==="]") open.pop();
    else if(c==='"') {
      let end=i+1;
      while(text[end]!=='"') end+=text[end]==="\\"?2:1;
      let next=end+1;
      while(" \t\r\n".includes(text[next])) next++;
      const keys=open.at(-1);
      if(keys && text[next]===":") {
        const key=JSON.parse(text.slice(i,end+1));
        if(keys.has(key)) return key;
        keys.add(key);
      }
      i=end;
    }
  }
}

export function readJSON(text) {
  const value=parseExact(text), repeated=repeatedKey(text);
  if(repeated!==undefined) throw Error("The key "+JSON.stringify(repeated)+" appears twice in one object.");
  return value;
}

function parseExact(text) {
  return JSON.parse(text, (key, value, context) => {
    if (typeof value !== "number") return value;
    if (!Number.isFinite(value)) throw Error("Number outside the supported range.");
    if (!Number.isInteger(value)) return value; // The typed field validator handles fractions.
    if (!Number.isSafeInteger(value)) throw Error("Integer outside the exact supported range.");
    if (!context?.source) throw Error("Exact number parsing needs Node 22+ or a browser with JSON source support.");
    const [mantissa, exponent = "0"] = context.source.toLowerCase().split("e");
    const [whole, fraction = ""] = mantissa.replace(/^-/, "").split(".");
    const digits = whole + fraction;
    if (/^0+$/.test(digits)) return 0;
    const zeros = digits.match(/0*$/)[0].length;
    if (Number(exponent) + zeros < fraction.length)
      throw Error("A fractional observation rounds to an integer. Supply exact evidence.");
    return value;
  });
}

export function exactValue(value, depth=0) {
  if (depth>16) return false;
  if (value===null || typeof value==="boolean" || Number.isSafeInteger(value)) return true;
  if (typeof value==="string") return value.length<=8192;
  if (Array.isArray(value)) return value.length<=1024 && value.every(v=>exactValue(v,depth+1));
  if (typeof value!=="object") return false;
  const entries=Object.entries(value);
  return entries.length<=1024 && entries.every(([k,v])=>k.length<=256 && exactValue(v,depth+1));
}
