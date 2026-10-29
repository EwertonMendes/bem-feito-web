import { SoapCostProfile } from '../models/catalog.model';

/** Reference portions per finished soap, confirmed from Bem Feito's 08/10
 * production sheet and 28/10 confirmation. These are editable estimates,
 * not a physical stock ledger or a forced colour/fragrance recipe.
 */
const referenceByName: Record<string, SoapCostProfile> = {
  'mini florzinhas': {baseGrams:3,fragranceMl:1,colorantMl:1,surfactantMl:1},
  'mini florzinha': {baseGrams:3,fragranceMl:1,colorantMl:1,surfactantMl:1},
  'patinha m': {baseGrams:35,fragranceMl:1.5,colorantMl:1,surfactantMl:1.5},
  'patinha g': {baseGrams:55,fragranceMl:1.5,colorantMl:1.5,surfactantMl:1.5},
  'barra arredondada': {baseGrams:87,fragranceMl:2.5,colorantMl:2,surfactantMl:2},
  'massageador': {baseGrams:120,fragranceMl:3,colorantMl:2.5,surfactantMl:2},
  'mini cubinhos': {baseGrams:9,fragranceMl:0.2,colorantMl:0.2,surfactantMl:0.2},
  'mini cubinho': {baseGrams:9,fragranceMl:0.2,colorantMl:0.2,surfactantMl:0.2},
  /** 75–80 g finished weight, scaled from Barra Arredondada; provisional. */
  'floral': {baseGrams:75,fragranceMl:2.2,colorantMl:1.7,surfactantMl:1.7},
};

export function soapCostReference(name: string): SoapCostProfile | null {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
  const profile = referenceByName[normalized];
  return profile ? { ...profile, extraUnitCostCents:0 } : null;
}

export function floralReferenceWeight(name: string): number | null {
  return name.trim().toLocaleLowerCase('pt-BR') === 'floral' ? 77.5 : null;
}
