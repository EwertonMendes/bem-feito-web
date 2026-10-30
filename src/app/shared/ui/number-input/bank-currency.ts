/**
 * Bank-style BRL input: the user's digits are cents (12345 => R$ 123,45).
 * All arithmetic is done with safe integer cents; no separator parsing or
 * floating-point accumulation while the user types.
 */
export const MAX_BANK_CURRENCY_CENTS=999_999_999_999_999;
const brl=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

export function bankCurrencyCents(raw:string):number{
  const digits=raw.replace(/\D/g,'').replace(/^0+(?=\d)/,'');
  return Math.min(Number(digits||'0'),MAX_BANK_CURRENCY_CENTS);
}
export function bankCurrencyFromAmount(amount:number):number{
  if(!Number.isFinite(amount))return 0;
  return Math.max(0,Math.min(Math.round(amount*100),MAX_BANK_CURRENCY_CENTS));
}
export function formatBankCurrency(cents:number):string{
  return brl.format(Math.max(0,Math.min(Math.round(cents),MAX_BANK_CURRENCY_CENTS))/100);
}
/** A formatted clipboard value and an unformatted bank-entry digit sequence
 * both represent the same number of centavos; reject a negative price. */
export function pastedCurrencyCents(text:string):number|null{
  if(text.trim().startsWith('-')||!/[0-9]/.test(text))return null;
  return bankCurrencyCents(text);
}
