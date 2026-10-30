// Contrôle de traçabilité : chaque EX-n de la spec apparaît dans au moins un nom de test
// (`it` / `test`, pas `describe`, ni commentaire ni chaîne quelconque).

import { blocsDeTest } from './ast-tests.ts';
import type { Exigence } from './spec.ts';

export interface FichierSource {
  chemin: string;
  code: string;
}

export interface Tracage {
  absentes: string[];
  trouvees: Record<string, string[]>;
}

export function estFichierDeTestCode(chemin: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(chemin);
}

export function tracerExigences(spec: Exigence[], fichiers: FichierSource[]): Tracage {
  const trouvees: Record<string, string[]> = {};
  const motifs = spec.map((ex) => ({ id: ex.id, re: new RegExp(`(?<![A-Za-z0-9])${ex.id}(?!\\d)`, 'i') }));

  for (const f of fichiers) {
    const noms = blocsDeTest(f.code, f.chemin).filter((b) => b.genre === 'test').map((b) => b.nom);
    for (const { id, re } of motifs) {
      if (!noms.some((n) => re.test(n))) continue;
      trouvees[id] = [...new Set([...(trouvees[id] ?? []), f.chemin])];
    }
  }
  return { absentes: spec.map((e) => e.id).filter((id) => !trouvees[id]), trouvees };
}
