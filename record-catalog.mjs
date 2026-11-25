// The catalog is evaluated inside the enrolled source. Only an authorized, bounded
// projection can leave that reader. A record lookup and an observation of its value are separate.
import {exact,id,need,serial} from "./review-journal.mjs";

const bounded=(x,max)=>Number.isSafeInteger(x) && x>=1 && x<=max;
const name=s=>typeof s==="string" && Buffer.byteLength(s)<=256 && catalogLabel(s).length>0;
export const catalogLabel=s=>s.normalize("NFC").replace(/[ \r\n\t]+/g," ").replace(/^ | $/g,"");
export function validLookup(q) {
  const named=exact(q,["product","type","title","field","time"],["keep"]) && name(q.title) && name(q.type);
  const ranked=exact(q,["product","search","field","time"],["keep"]) && typeof q.search==="string" &&
    q.search.trim().length>0 && Buffer.byteLength(q.search)<=2048;
  return (named || ranked) && id(q.product) && id(q.field) && ["at_lookup","at_use"].includes(q.time) &&
    (q.keep===undefined || (q.keep==="chosen_record" && q.time==="at_use"));
}
export function validCatalog(c) {
  return exact(c,["population","disclosure","maxRows","rowPrice","maxLookups","lookupPrice"],["search"]) && c.population==="project-shared/1" &&
    ["shared-metadata/1","individual-only/1"].includes(c.disclosure) &&
    (c.search===undefined || exact(c.search,["provider","limit","price"]) && id(c.search.provider) &&
      bounded(c.search.limit,3) && bounded(c.search.price,1000000)) &&
    bounded(c.maxRows,4096) && bounded(c.rowPrice,1000) && Number.isSafeInteger(c.maxLookups) && c.maxLookups>=0 &&
    c.maxLookups<=Math.min(c.maxRows,128) && bounded(c.lookupPrice,100000);
}
export function catalogBudget(c,query) {
  if(query.search!==undefined) {
    need(c.search,"no charged search service was enrolled");
    return c.search.price+c.search.limit*c.rowPrice;
  }
  return c.maxRows*c.rowPrice+c.maxLookups*c.lookupPrice;
}

async function searchRecords(query,retention,limits,adapter) {
  const service=limits.search;
  need(service && typeof adapter.search==="function","this source has no enrolled search capability");
  const reply=await adapter.search(structuredClone(query),structuredClone(retention),structuredClone(service));
  need(exact(reply,["product","provider","retention","matches"]) && reply.provider===service.provider &&
    reply.product===query.product && serial(reply.retention)===serial(retention) &&
    Array.isArray(reply.matches) && reply.matches.length<=service.limit,"invalid ranked source response");
  const seen=new Set(),matches=[];
  for(const item of reply.matches) {
    need(exact(item,["record","version","shared"]) && item.shared===true && id(item.record) &&
      Number.isSafeInteger(item.version) && item.version>=1 && !seen.has(item.record),"invalid shared source candidate");
    seen.add(item.record);
    matches.push({record:item.record,version:item.version});
  }
  return {outcome:"suggestions",matches,scope:"ranked proposals from the authorized shared population",provider:service.provider};
}

// The source listing implicitly scopes rows to the adapter's actual principal. Its
// "more" reports unread rows. If an adapter cannot establish completeness, it must
// explicitly return null. A later read can establish historic visibility only under the
// same source-issued snapshot covering both membership and audience changes. A content
// version or a hash of a permission-blind list cannot identify such a snapshot.
export async function locateRecord(query,retention,limits,adapter) {
  need(limits.disclosure==="shared-metadata/1","this individual source cannot disclose shared lookup results");
  if(query.search!==undefined) return searchRecords(query,retention,limits,adapter);
  const view=await adapter.list(structuredClone(query),structuredClone(retention),limits.maxRows);
  need(exact(view,["product","rows","more","retention"],["snapshot"]) && (view.snapshot===undefined || id(view.snapshot)) && view.product===query.product &&
    serial(view.retention)===serial(retention) && Array.isArray(view.rows) &&
    (view.more===null || Number.isSafeInteger(view.more) && view.more>=0),"no permission or complete framing for this catalog");
  const seen=new Set(),matches=[];
  let incomplete=view.more!==0 || view.rows.length>limits.maxRows,lookups=0;
  for(const row of view.rows.slice(0,limits.maxRows)) {
    need(exact(row,["record","version","title","type"],["shared"]) && id(row.record) &&
      Number.isSafeInteger(row.version) && row.version>=1 && name(row.title) && name(row.type) &&
      (row.shared===undefined || typeof row.shared==="boolean") && !seen.has(row.record),"inconsistent catalog row");
    seen.add(row.record);
    if(catalogLabel(row.title)!==catalogLabel(query.title) || catalogLabel(row.type)!==catalogLabel(query.type))continue;
    let share=row.shared;
    if(share===undefined) {
      if(!view.snapshot || lookups===limits.maxLookups || typeof adapter.visibility!=="function") {incomplete=true;continue;}
      lookups++;
      const proof=await adapter.visibility({product:query.product,record:row.record,version:row.version,snapshot:view.snapshot},structuredClone(retention));
      if(!proof || proof.snapshot!==view.snapshot || proof.product!==query.product || proof.record!==row.record || proof.version!==row.version || typeof proof.shared!=="boolean") {
        incomplete=true;continue;
      }
      share=proof.shared;
    }
    if(share && matches.length<2)matches.push({record:row.record,version:row.version});
  }
  // A partial list can prove non-uniqueness with two actual distinct permitted records.
  // With zero or one witness it cannot establish an absence or unique positive.
  const outcome=matches.length>=2?"choice":incomplete?"incomplete":matches.length===1?"located":"absent";
  return {outcome,matches:outcome==="choice" || outcome==="located"?matches:[],scope:"shared records visible to the enrolled reader at lookup"};
}
