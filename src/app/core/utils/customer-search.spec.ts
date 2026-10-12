import { describe, it, expect } from 'vitest';
import { normalizeCustomerSearch } from './customer-search';
describe('customer search', () => {
  it('ignores accents, spaces and letter casing',()=> {
    expect(normalizeCustomerSearch('  JOÃO   da  Silva ')).toBe('joao da silva');
  });
});
