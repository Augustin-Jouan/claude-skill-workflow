// Lecture de .workflow/spec.md : seules les exigences en titre (`### EX-n — titre`) comptent.
// Un EX-n cité dans le texte courant n'en définit pas.

export interface Exigence {
  id: string;
  titre: string;
}

export interface LectureSpec {
  exigences: Exigence[];
  erreurs: string[];
}

const TITRE_EXIGENCE = /^#{1,6}\s+(EX-\d+)\s+[-–—]\s+(.+?)\s*#*\s*$/;

export function lireSpec(contenu: string): LectureSpec {
  const exigences: Exigence[] = [];
  const erreurs: string[] = [];

  for (const ligne of contenu.split(/\r?\n/)) {
    const m = TITRE_EXIGENCE.exec(ligne);
    if (!m) continue;
    const [, id, titre] = m;
    if (exigences.some((e) => e.id === id)) erreurs.push(`${id} est défini plusieurs fois dans la spec.`);
    else exigences.push({ id, titre });
  }

  if (exigences.length === 0) {
    erreurs.push('La spec ne contient aucune exigence : chaque exigence est un titre « ### EX-n — titre ».');
  }
  return { exigences, erreurs };
}

// Texte complet des exigences demandées (titre et corps, jusqu'au titre suivant de même niveau ou plus haut),
// pour le prompt de l'exécuteur.
export function sectionsExigences(contenu: string, ids: string[]): string {
  const lignes = contenu.replace(/\r\n/g, '\n').split('\n');
  const sections: string[] = [];
  for (const id of ids) {
    const debut = lignes.findIndex((l) => TITRE_EXIGENCE.exec(l)?.[1] === id);
    if (debut < 0) continue;
    const niveau = /^#+/.exec(lignes[debut])?.[0].length ?? 1;
    let fin = debut + 1;
    while (fin < lignes.length && !(/^#+\s/.test(lignes[fin]) && (/^#+/.exec(lignes[fin])?.[0].length ?? 0) <= niveau)) fin++;
    sections.push(lignes.slice(debut, fin).join('\n').trimEnd());
  }
  return sections.join('\n\n');
}
