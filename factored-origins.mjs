// Enumerate the models of the supplied origin constraint. The controller
// receives its public signal only; the independent verifier enumerates origins.
import {DecisionDiagram} from "./decision-diagram.mjs";

export function symbolicOrigins(model, retained, spend, visit) {
  const counters={nodes:0,edges:0,calls:0}, widths=model.variables;
  const diagram=new DecisionDiagram(widths,counters,spend);
  const compile=physicalFormula(diagram,spend);
  const root=compile(model.initial);
  const world=Array(widths.length).fill(0);
  function enumerate(index,node) {
    spend();
    if(node===0)return;
    if(index===widths.length) {
      if(node!==1)throw Error("Incomplete origin diagram traversal.");
      visit(world.slice());return;
    }
    const point=diagram.nodes[node];
    const limit=retained && !retained.has(index)?1:widths[index];
    for(let v=0;v<limit;v++){
      world[index]=v;
      enumerate(index+1,point?.level===index?point.branches[v]:node);
    }
  }
  enumerate(0,root);
  return counters;
}

// Reuse the same declared predicate semantics without enumerating satisfying worlds.
export function physicalFormula(diagram,spend) {
  const widths=diagram.widths;
  function compile(f) {
    spend();
    if(typeof f==="boolean") return Number(f);
    if(Array.isArray(f)) {
      const [i,value]=f;
      spend(widths[i]);
      const nodes=Array.from({length:widths[i]},(_,v)=>Number(v===value));
      return diagram.make(i,nodes);
    }
    if(Object.hasOwn(f,"not"))return diagram.not(compile(f.not));
    if(Object.hasOwn(f,"one")) {
      let none=1, one=0;
      for(const child of f.one) {
        const c=compile(child);
        one=diagram.ite(c,none,one);
        none=diagram.and(none,diagram.not(c));
      }
      return one;
    }
    const all=Object.hasOwn(f,"all");
    let result=Number(all);
    for(const child of all?f.all:f.any) {
      if(result===Number(!all))break;
      const next=compile(child);
      result=all?diagram.and(result,next):diagram.or(result,next);
    }
    return result;
  }
  return compile;
}
