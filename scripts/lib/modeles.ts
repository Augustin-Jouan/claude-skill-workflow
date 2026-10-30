// Choix du modèle Cursor selon la difficulté : le modèle léger pour le simple, le lourd pour le complexe.
// La raison est journalisée avec le modèle, pour que la fin de branche et le bilan puissent juger le choix.

import { CONFIG } from '../../config/defaults.ts';
import type { Parcours } from './etat.ts';
import type { Difficulte } from './plan.ts';

export interface ModelesParDifficulte {
  simple: string;
  complexe: string;
}

export interface ChoixModele {
  modele: string;
  raison: string;
}

// Une tâche simple déjà rejetée par verify passe au modèle complexe pour les tentatives suivantes.
export function modeleExecuteur(difficulte: Difficulte, rejets: number, modeles: ModelesParDifficulte = CONFIG.modeles.executeur): ChoixModele {
  if (difficulte === 'complexe') return { modele: modeles.complexe, raison: 'plan : complexe' };
  if (rejets > 0) return { modele: modeles.complexe, raison: `escalade après ${rejets} rejet(s)` };
  return { modele: modeles.simple, raison: 'plan : simple' };
}

export function modeleAudit(
  parcours: Parcours,
  exigences: number,
  modeles: ModelesParDifficulte = CONFIG.modeles.audit,
  maxSimple: number = CONFIG.seuils.auditExigencesSimple,
): ChoixModele {
  if (parcours === 'court') return { modele: modeles.simple, raison: 'parcours court' };
  const raison = `spec de ${exigences} exigence(s)`;
  return { modele: exigences <= maxSimple ? modeles.simple : modeles.complexe, raison };
}
