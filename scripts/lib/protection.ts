// Protection des fichiers que git ne voit pas : .workflow/ (exclu de git) et les fichiers du skill.
// run-plan les photographie avant l'exécuteur et remet tout en place après : fichier modifié ou
// supprimé restauré, fichier créé effacé. Chaque changement rejette la tâche.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export interface Zone {
  dossier: string;
  // Chemins relatifs au dossier (fichiers ou dossiers entiers) que l'exécuteur peut changer.
  exclus: string[];
}

export type Photo = Map<string, Buffer>;

function fichiers(zone: Zone): string[] {
  if (!existsSync(zone.dossier)) return [];
  const exclu = (chemin: string) => {
    const rel = relative(zone.dossier, chemin).replace(/\\/g, '/');
    return zone.exclus.some((e) => rel === e || rel.startsWith(`${e}/`));
  };
  const resultat: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (exclu(chemin)) continue;
      if (entree.isDirectory()) parcourir(chemin);
      else if (entree.isFile()) resultat.push(chemin);
    }
  };
  parcourir(zone.dossier);
  return resultat;
}

export function photographier(zones: Zone[]): Photo {
  return new Map(zones.flatMap(fichiers).map((f) => [f, readFileSync(f)]));
}

export function restaurer(photo: Photo, zones: Zone[]): string[] {
  const changes: string[] = [];
  const actuels = new Set(zones.flatMap(fichiers));
  for (const f of actuels) {
    if (!photo.has(f)) {
      rmSync(f, { force: true });
      changes.push(f);
    }
  }
  for (const [f, contenu] of photo) {
    if (actuels.has(f) && readFileSync(f).equals(contenu)) continue;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, contenu);
    changes.push(f);
  }
  return changes;
}
