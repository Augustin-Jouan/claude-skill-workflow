// État du workflow d'un dépôt : .workflow/state.json.
// L'ordre des étapes et celles que chaque parcours saute sont fixés ici, pas par le skill.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PARCOURS = ['micro', 'court', 'complet'] as const;
export type Parcours = (typeof PARCOURS)[number];

export const ETAPES = [
  'spec',
  'audit-spec',
  'plan',
  'audit-plan',
  'matrice',
  'execution',
  'fin',
  'termine',
] as const;
export type Etape = (typeof ETAPES)[number];

const SAUTEES: Record<Parcours, Etape[]> = {
  micro: ['audit-spec', 'audit-plan'],
  court: ['audit-spec'],
  complet: [],
};

export function etapesDuParcours(parcours: Parcours): Etape[] {
  return ETAPES.filter((e) => !SAUTEES[parcours].includes(e));
}

export interface Transition {
  de: Etape | null;
  vers: Etape;
  date: string;
  note: string;
}

export interface Etat {
  version: 1;
  parcours: Parcours;
  slug: string;
  branche: string;
  etape: Etape;
  historique: Transition[];
}

function cheminEtat(dossier: string): string {
  return join(dossier, 'state.json');
}

export function lireEtat(dossier: string): Etat | null {
  const fichier = cheminEtat(dossier);
  return existsSync(fichier) ? (JSON.parse(readFileSync(fichier, 'utf8')) as Etat) : null;
}

export function ecrireEtat(dossier: string, etat: Etat): void {
  mkdirSync(dossier, { recursive: true });
  writeFileSync(cheminEtat(dossier), `${JSON.stringify(etat, null, 2)}\n`);
}
