import { RecipeComponent } from '../../domain/models/catalog.model';

export function aggregateRecipe(recipe: RecipeComponent[]): RecipeComponent[] {
  const inputs = new Map<string, RecipeComponent>();
  for (const component of recipe) {
    if (!component.inputId || !component.unitId || !Number.isFinite(component.quantity) || component.quantity <= 0) {
      throw new Error('A receita contém um insumo ou quantidade inválida.');
    }
    const previous = inputs.get(component.inputId);
    if (previous && previous.unitId !== component.unitId) {
      throw new Error('O mesmo insumo deve usar a mesma unidade na receita.');
    }
    inputs.set(component.inputId, { ...component, quantity: (previous?.quantity ?? 0) + component.quantity });
  }
  return [...inputs.values()];
}
