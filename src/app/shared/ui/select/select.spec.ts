import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { filterSelectOptions, normalizeSelectText, type BfSelectOption } from './select';

describe('SelectSearch', () => {
  const options: BfSelectOption[] = [
    { value: '', label: 'Selecione um produto' },
    { value: '1', label: 'Clássica · Pêssego · Mini Florzinhas', description: 'Estoque: 2' },
    { value: '2', label: '+ Aroma · Éros · Massageador', description: 'Estoque: 1' },
    { value: '3', label: '+ Aroma · Tropical · Mini Florzinhas', disabled: true },
  ];

  it('normaliza acentuação, caixa e espaços', () => {
    expect(normalizeSelectText('  PÊSSEGO  ')).toBe('pessego');
  });

  it('filtra pelo rótulo ou descrição e ignora o placeholder quando há busca', () => {
    expect(filterSelectOptions(options, 'pessego').map(o => o.value)).toEqual(['1']);
    expect(filterSelectOptions(options, 'ÉROS').map(o => o.value)).toEqual(['2']);
    expect(filterSelectOptions(options, 'estoque: 1').map(o => o.value)).toEqual(['2']);
    expect(filterSelectOptions(options, 'sem resultados')).toEqual([]);
  });

  it('mantém opções e desabilitados intactos sem busca', () => {
    expect(filterSelectOptions(options, '')).toEqual(options);
    expect(filterSelectOptions(options, 'tropical')[0].disabled).toBe(true);
  });
});
