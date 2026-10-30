// Code d'avant la tâche, pour le contrôle « rouge » : un worktree git détaché sur HEAD, dans .workflow/
// (exclu de git), auquel on ajoute les fichiers de test de la tâche. L'arbre de travail n'est jamais touché.
// Placé dans le dépôt, il résout ses modules en remontant jusqu'aux node_modules du projet.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git } from './depot.ts';

export function supprimerArbreAncien(racine: string, arbre: string): void {
  try {
    git(['worktree', 'remove', '--force', arbre], racine);
  } catch {
    // Pas de worktree enregistré à cet endroit : il reste au plus un dossier à effacer.
  }
  rmSync(arbre, { recursive: true, force: true });
  git(['worktree', 'prune'], racine);
}

export function preparerArbreAncien(racine: string, arbre: string, fichiersTest: string[]): void {
  supprimerArbreAncien(racine, arbre);
  mkdirSync(dirname(arbre), { recursive: true });
  git(['worktree', 'add', '--detach', '--quiet', arbre, 'HEAD'], racine);
  for (const chemin of fichiersTest) {
    const source = join(racine, chemin);
    const cible = join(arbre, chemin);
    if (existsSync(source)) {
      mkdirSync(dirname(cible), { recursive: true });
      copyFileSync(source, cible);
    } else {
      rmSync(cible, { force: true });
    }
  }
}
