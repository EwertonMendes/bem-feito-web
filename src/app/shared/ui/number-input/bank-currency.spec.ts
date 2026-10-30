import {describe,expect,it} from 'vitest';
import {MAX_BANK_CURRENCY_CENTS,bankCurrencyCents,bankCurrencyFromAmount,
  formatBankCurrency,pastedCurrencyCents} from './bank-currency';

describe('bank-style currency input',()=>{
  it('shifts digits from the right without typing separators',()=>{
    const digits=['1','2','3','4','5'];
    const displays=digits.map((_,i)=>formatBankCurrency(bankCurrencyCents(digits.slice(0,i+1).join(''))));
    expect(displays).toEqual(['0,01','0,12','1,23','12,34','123,45']);
  });
  it('deletes the least significant cent (including all the way to zero)',()=>{
    expect(bankCurrencyCents('1,2')).toBe(12);
    expect(bankCurrencyCents('0,0')).toBe(0);
    expect(formatBankCurrency(0)).toBe('0,00');
  });
  it('accepts pastes with or without a currency symbol and separators',()=>{
    expect(pastedCurrencyCents('R$ 1.234,56')).toBe(123456);
    expect(pastedCurrencyCents('25,50')).toBe(2550);
    expect(pastedCurrencyCents('1000')).toBe(1000);
    expect(pastedCurrencyCents('R$ -25,50')).toBe(null);
    expect(pastedCurrencyCents('abc')).toBe(null);
  });
  it('converts prefilled form values without losing cents',()=>{
    expect(bankCurrencyFromAmount(14.9)).toBe(1490);
    expect(bankCurrencyFromAmount(0.1+0.2)).toBe(30);
    expect(formatBankCurrency(bankCurrencyFromAmount(1234.56))).toBe('1.234,56');
  });
  it('rejects non-finite values and safely caps very long input',()=>{
    expect(bankCurrencyFromAmount(NaN)).toBe(0);
    expect(bankCurrencyCents('999999999999999999999')).toBe(MAX_BANK_CURRENCY_CENTS);
    expect(bankCurrencyCents('')).toBe(0);
    expect(bankCurrencyCents('00001')).toBe(1);
  });
});
