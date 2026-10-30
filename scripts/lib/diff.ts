// Changements de la tâche : arbre de travail (fichiers non suivis compris) comparé à HEAD.
// L'exécuteur ne commite pas : tout ce qui diffère de HEAD est le travail de la tâche.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitBrut } from './depot.ts';

export interface Changement {
  chemin: string;
  statut: 'ajoute' | 'modifie' | 'supprime';
  avant: string | null;
  apres: string | null;
  // Lignes ajoutées ou modifiées (numérotation du nouveau fichier). null : fichier entièrement nouveau.
  lignes: Set<number> | null;
}

function cheminDuDiff(brut: string): string {
  let chemin = brut.replace(/\t$/, '');
  if (chemin.startsWith('"') && chemin.endsWith('"')) chemin = chemin.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return chemin.replace(/^b\//, '');
}

// Lit un `git diff -U0` : pour chaque fichier, les lignes du nouveau fichier couvertes par un bloc « + ».
export function lignesModifiees(diff: string): Map<string, Set<number>> {
  const resultat = new Map<string, Set<number>>();
  let courant: Set<number> | null = null;
  let precedente = '';
  for (const ligne of diff.split(/\r?\n/)) {
    if (ligne.startsWith('+++ ') && precedente.startsWith('--- ')) {
      const brut = ligne.slice(4);
      courant = brut === '/dev/null' ? null : new Set<number>();
      if (courant) resultat.set(cheminDuDiff(brut), courant);
    } else {
      const bloc = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(ligne);
      if (bloc && courant) {
        const debut = Number(bloc[1]);
        const nombre = bloc[2] === undefined ? 1 : Number(bloc[2]);
        for (let n = debut; n < debut + nombre; n++) courant.add(n);
      }
    }
    precedente = ligne;
  }
  return resultat;
}

export function lireChangements(racine: string): Changement[] {
  const options = ['-c', 'core.quotePath=false'];
  const statuts = git([...options, 'diff', 'HEAD', '--name-status', '--no-renames', '-z'], racine).split('\0').filter(Boolean);
  const nonSuivis = git(['ls-files', '--others', '--exclude-standard', '-z'], racine).split('\0').filter(Boolean);
  const lignes = lignesModifiees(gitBrut([...options, 'diff', 'HEAD', '-U0', '--no-renames', '--no-color', '--no-ext-diff'], racine));

  const entrees: Array<[string, Changement['statut']]> = [];
  for (let i = 0; i + 1 < statuts.length; i += 2) {
    const code = statuts[i][0];
    entrees.push([statuts[i + 1], code === 'A' ? 'ajoute' : code === 'D' ? 'supprime' : 'modifie']);
  }
  for (const chemin of nonSuivis) entrees.push([chemin, 'ajoute']);

  return entrees.map(([chemin, statut]) => {
    const absolu = join(racine, chemin);
    return {
      chemin,
      statut,
      avant: statut === 'ajoute' ? null : gitBrut(['show', `HEAD:${chemin}`], racine),
      apres: statut === 'supprime' || !existsSync(absolu) ? null : readFileSync(absolu, 'utf8'),
      lignes: statut === 'ajoute' ? null : (lignes.get(chemin) ?? new Set<number>()),
    };
  });
}
