// Un constat de verify : bloquant (la tâche est rejetée) ou signalé (relu par l'arbitre).

export interface Constat {
  regle: string;
  niveau: 'bloquant' | 'signale';
  fichier: string;
  ligne?: number;
  message: string;
}

export const CODE_SOURCE = /\.[cm]?[jt]sx?$/i;

export function sansExtension(chemin: string): string {
  return chemin.replace(CODE_SOURCE, '').replace(/\/index$/, '');
}
