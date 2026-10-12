import {describe,expect,it} from 'vitest';
import {serializeCsv,exportCents} from './csv-export';
describe('CSV exports',()=>{
 it('quotes semicolons, newlines and embedded quotes',()=>expect(serializeCsv(['Cliente'],[['João; "Teste"\nPedido']])).toContain('"João; ""Teste""\nPedido"'));
 it('defuses Excel formula injection in untrusted names',()=>expect(serializeCsv(['Nome'],[['=HYPERLINK("evil")']])).toContain('"\'=HYPERLINK'));
 it('formats currency cents as Brazilian decimal',()=>expect(exportCents(19550)).toBe('195,50'));
});
