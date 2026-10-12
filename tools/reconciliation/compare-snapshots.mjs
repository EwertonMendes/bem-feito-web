import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Deterministic, READ-ONLY comparison. Both sources must be normalized exports with stable IDs. */
const domains=['products','inputs','sales','payments','expenses','productions','cashMovements','cashBalanceChecks'];
const ignored=new Set(['createdAt','updatedAt','createdBy','updatedBy','sourceSpreadsheetRow']);
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value!==null && typeof value==='object'){
    return Object.fromEntries(Object.entries(value)
      .filter(([key])=>!ignored.has(key))
      .sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>[key,stable(val)]));
  }
  return value;
}
function signature(value){return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function byId(rows,collection){
  if(!Array.isArray(rows))throw new Error('Coleção '+collection+' precisa ser uma lista.');
  const map=new Map();
  for(const record of rows){
    if(!record||typeof record.id!=='string'||!record.id.trim()||map.has(record.id))
      throw new Error('ID ausente/duplicado em '+collection+'. Resolva antes da comparação.');
    map.set(record.id,record);
  }
  return map;
}
export function compareSnapshots(source,target){
  const details={},totals={matched:0,missing:0,unexpected:0,divergent:0};
  for(const collection of domains){
    const expected=byId(source[collection]??[],collection);
    const actual=byId(target[collection]??[],collection);
    const differences=[];
    for(const [id,record] of expected){
      const other=actual.get(id);
      if(!other){differences.push({id,status:'missing',expectedHash:signature(record)});totals.missing++;continue;}
      const a=signature(record),b=signature(other);
      if(a!==b){differences.push({id,status:'divergent',expectedHash:a,actualHash:b});totals.divergent++;}
      else totals.matched++;
    }
    for(const [id,record] of actual){
      if(expected.has(id))continue;
      differences.push({id,status:'unexpected',actualHash:signature(record)});totals.unexpected++;
    }
    details[collection]={sourceCount:expected.size,targetCount:actual.size,
      differences:differences.sort((a,b)=>a.id.localeCompare(b.id))};
  }
  return {schemaVersion:1,generatedAt:new Date().toISOString(),sourceLabel:source.source??'origem',
    targetLabel:target.source??'destino',totals,details,passed:totals.missing===0&&totals.divergent===0&&totals.unexpected===0};
}
if(process.argv[1] && import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  const [sourcePath,targetPath,reportPath]=process.argv.slice(2);
  if(!sourcePath||!targetPath)throw new Error('Uso: node compare-snapshots.mjs origem.json destino.json [relatorio.json]');
  const [source,target]=await Promise.all([sourcePath,targetPath].map(p=>readFile(resolve(p),'utf8').then(JSON.parse)));
  const result=compareSnapshots(source,target);
  if(reportPath)await writeFile(resolve(reportPath),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(!result.passed)process.exitCode=1;
}
