// Sujet du commit d'une tâche : le titre « ## Tn — titre » du plan, sinon les titres de ses exigences.
// Une tâche feature qui ne touche que des fichiers de test est un commit « test ». Coupé à 72 caractères
// sur un mot entier.

import type { Tache } from './plan.ts';
import { estFichierDeTest } from './verification.ts';

const TYPE_COMMIT: Record<Tache['type'], string> = { feature: 'feat', fix: 'fix', refactor: 'refactor' };
const LONGUEUR_MAX = 72;

function titre(id: string, texte: string): string | undefined {
  return new RegExp(`^#{1,6}\\s+${id}\\s+[-–—]\\s+(.+?)\\s*#*\\s*$`, 'm').exec(texte)?.[1];
}

export function sujetDeCommit(t: Tache, plan: string, spec: string, fichiersTest: readonly string[]): string {
  const testsSeuls = t.type === 'feature' && t.fichiers_prevus.length > 0 && t.fichiers_prevus.every((f) => estFichierDeTest(f, fichiersTest));
  const resume = titre(t.id, plan) ?? t.exigences.map((ex) => titre(ex, spec) ?? ex).join(', ');
  const sujet = `${testsSeuls ? 'test' : TYPE_COMMIT[t.type]}: ${resume}`;
  if (sujet.length <= LONGUEUR_MAX) return sujet;
  const coupe = sujet.slice(0, LONGUEUR_MAX - 1);
  const espace = coupe.lastIndexOf(' ');
  return `${espace > 0 ? coupe.slice(0, espace) : coupe}…`;
}
