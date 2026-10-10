import { Kit, Product } from '../models/catalog.model';

/** Deterministic capacitated flow allocation across overlapping kit rules. */
export function allocateKitStock(
  kit: Kit, products: readonly Product[], count = 1, reserved: ReadonlyMap<string, number> = new Map(),
  materialize = true,
): string[] | null {
  if (!kit.active || !Number.isSafeInteger(count) || count < 1 || !kit.components.length) return null;
  const rules = [...kit.components].sort((a, b) => a.order - b.order);
  if (rules.some(rule => !rule.formatId || !Number.isSafeInteger(rule.quantity) || rule.quantity <= 0)) return null;
  const physicalFree = (item: Product): number => Math.max(0, item.stock - (item.reservedPhysicalStock ?? Math.min(item.stock, item.committedStock ?? 0)));
  const available = products.filter(item => item.active && Math.floor(physicalFree(item) - (reserved.get(item.id) ?? 0)) > 0);
  const matching = (rule: typeof rules[number], item: Product): boolean =>
    item.formatId === rule.formatId &&
    (!rule.collectionId || item.collectionId === rule.collectionId) &&
    (!rule.fragranceId || item.fragranceId === rule.fragranceId);
  const requirements = rules.map(rule => Math.floor(rule.quantity * count));
  const target = requirements.reduce((sum, qty) => sum + qty, 0);
  if (!Number.isSafeInteger(target) || target > available.reduce((sum, item) => sum + Math.floor(physicalFree(item) - (reserved.get(item.id) ?? 0)), 0)) return null;
  const source = 0, productStart = rules.length + 1, sink = productStart + available.length;
  interface Edge { to: number; reverse: number; capacity: number; }
  const graph: Edge[][] = Array.from({length: sink + 1}, () => []);
  const addEdge = (from: number, to: number, capacity: number): void => {
    const forward: Edge = {to,reverse:graph[to]!.length,capacity};
    const backward: Edge = {to:from,reverse:graph[from]!.length,capacity:0};
    graph[from]!.push(forward);graph[to]!.push(backward);
  };
  for (let i = 0; i < rules.length; i++) {
    addEdge(source, i+1, requirements[i]!);
    let candidates = 0;
    available.forEach((item, j) => {
      if (matching(rules[i]!, item)) {addEdge(i+1, productStart+j, requirements[i]!);candidates++;}
    });
    if (!candidates) return null;
  }
  available.forEach((item,j) => addEdge(productStart+j,sink,Math.floor(physicalFree(item)-(reserved.get(item.id) ?? 0))));
  let filled = 0;
  while (filled < target) {
    const parentNode = Array(sink + 1).fill(-1) as number[], parentEdge = Array(sink+1).fill(-1) as number[];
    const queue = [source];parentNode[source] = source;
    for(let head=0; head<queue.length && parentNode[sink]===-1; head++){
      const node=queue[head]!;
      graph[node]!.forEach((edge,i)=>{
        if(edge.capacity > 0 && parentNode[edge.to] === -1){
          parentNode[edge.to]=node;parentEdge[edge.to]=i;queue.push(edge.to);
        }
      });
    }
    if (parentNode[sink]===-1) return null;
    let amount=target-filled;
    for(let node=sink;node!==source;node=parentNode[node]!) amount=Math.min(amount,graph[parentNode[node]!]![parentEdge[node]!]!.capacity);
    for(let node=sink;node!==source;node=parentNode[node]!){
      const edge=graph[parentNode[node]!]![parentEdge[node]!]!;
      edge.capacity-=amount;graph[node]![edge.reverse]!.capacity+=amount;
    }
    filled+=amount;
  }
  if (!materialize) return [];
  const result: string[]=[];
  for(let i=0;i<rules.length;i++){
    for(const edge of graph[i+1]!) {
      if(edge.to<productStart || edge.to>=sink) continue;
      const used=graph[edge.to]![edge.reverse]!.capacity;
      for(let n=0;n<used;n++)result.push(available[edge.to-productStart]!.id);
    }
  }
  return result.length===target?result:null;
}

export function availableKitCount(kit: Kit, products: readonly Product[]): number {
  if(!kit.active || !kit.components.length) return 0;
  const stock = products.filter(x=>x.active);
  const physicallyFree = (p: Product) => Math.max(0, p.stock - (p.reservedPhysicalStock ?? Math.min(p.stock, p.committedStock ?? 0)));
  let ceiling=Number.MAX_SAFE_INTEGER;
  const totalUnits=kit.components.reduce((s,r)=>s+r.quantity,0);
  const totalStock=stock.reduce((s,p)=>s+Math.max(0,Math.floor(physicallyFree(p))),0);
  if(totalUnits<=0)return 0;
  ceiling=Math.floor(totalStock/totalUnits);
  for(const rule of kit.components){
    if(!Number.isSafeInteger(rule.quantity) || rule.quantity<=0)return 0;
    const pool=stock.reduce((s,p)=>s+(p.formatId===rule.formatId &&
      (!rule.collectionId||p.collectionId===rule.collectionId) &&
      (!rule.fragranceId||p.fragranceId===rule.fragranceId) ? Math.max(0,Math.floor(p.stock)):0),0);
    ceiling=Math.min(ceiling,Math.floor(pool/rule.quantity));
  }
  let lo=0,hi=ceiling;
  while(lo<hi){
    const mid=lo+Math.ceil((hi-lo)/2);
    if(allocateKitStock(kit,products,mid,new Map(),false)!==null)lo=mid;else hi=mid-1;
  }
  return lo;
}
