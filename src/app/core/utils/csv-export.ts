/** RFC4180-style CSV with semicolon delimiter for pt-BR spreadsheets.
 * Every cell is escaped and user-supplied formula-like text is neutralized.
 */
export function serializeCsv(headers:readonly string[],rows:readonly (readonly (string|number|null|undefined)[])[]):string {
  const field=(value:string|number|null|undefined):string=>{
    let text=value===null||value===undefined?'':String(value);
    if(typeof value==='string' && /^[\s]*[=+@\-\t\r]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return [headers,...rows].map(row=>row.map(field).join(';')).join('\r\n')+'\r\n';
}
export function downloadCsv(filename:string,headers:readonly string[],rows:readonly (readonly (string|number|null|undefined)[])[]):void{
  const csv='\uFEFF'+serializeCsv(headers,rows);
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  try{
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();
  }finally{URL.revokeObjectURL(url);}
}
export function exportCents(value:number):string {return (value/100).toFixed(2).replace('.',',');}
