// Accès au dépôt git courant et au dossier .workflow/<slug>/ de la branche (local, exclu de git).

import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { CONFIG } from '../../config/defaults.ts';
import { definirDossierAffiche } from './result.ts';

export function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

// Sortie brute, sans trim : pour lire le contenu exact d'un fichier à HEAD.
export function gitBrut(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}

// Fichiers suivis et non suivis (hors ignorés), chemins relatifs à la racine avec des « / ».
export function fichiersDuDepot(racine: string): string[] {
  return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], racine).split('\0').filter(Boolean);
}

export function racineDepot(): string | null {
  try {
    return git(['rev-parse', '--show-toplevel'], process.cwd());
  } catch {
    return null;
  }
}

export function brancheCourante(racine: string): string {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], racine);
  } catch {
    return 'HEAD';
  }
}

// Un dossier par branche : .workflow/<slug>/ pour la branche <prefixe><slug>. Les workflows de plusieurs
// branches ne se mélangent pas, et chacun reprend quand on revient sur sa branche. Hors d'une branche de
// workflow, le dossier n'a pas d'état : « aucun workflow en cours ».
export function dossierWorkflow(racine: string, branche = brancheCourante(racine)): string {
  const slug = branche.startsWith(CONFIG.branche.prefixe) ? branche.slice(CONFIG.branche.prefixe.length) : branche;
  const dossier = join(racine, '.workflow', slug.replace(/[\\/:*?"<>|]/g, '-'));
  definirDossierAffiche(relative(racine, dossier).replaceAll('\\', '/'));
  return dossier;
}

export function messageGit(e: unknown): string {
  const stderr = (e as { stderr?: string }).stderr;
  return (stderr || (e instanceof Error ? e.message : String(e))).trim();
}
