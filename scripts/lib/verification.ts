// Contrôles de verify sur les changements de la tâche, sans lancer d'outil : fichiers verrouillés,
// tests existants, fichiers hors plan, dépendances, puis règles de code sur les lignes modifiées.
// Quand un fichier est verrouillé ou est un test existant protégé, la règle bloquante passe avant le signalement.

import { CODE_SOURCE, sansExtension, type Constat } from './constat.ts';
import type { Changement } from './diff.ts';
import { correspond } from './glob.ts';
import type { Tache } from './plan.ts';
import { comparerTestsExistants } from './protection-tests.ts';
import { analyserSource } from './regles-source.ts';
import { estFichierDeTestCode } from './trace.ts';

export interface EntreeVerification {
  tache: Tache;
  changements: Changement[];
  verrouilles: readonly string[];
  fichiersTest: readonly string[];
}

const CHAMPS_DEPENDANCES = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function lireJson(texte: string | null): Record<string, unknown> | null {
  if (texte === null) return null;
  try {
    return JSON.parse(texte) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function verrouillage(c: Changement, motifs: readonly string[]): string | null {
  for (const motif of motifs) {
    const [fichier, champ] = motif.split('#');
    if (!correspond(c.chemin, fichier)) continue;
    if (!champ) return `${c.chemin} est verrouillé (${motif}).`;
    const avant = lireJson(c.avant);
    const apres = lireJson(c.apres);
    if (!avant || !apres) return `${c.chemin} est illisible ou supprimé : son champ « ${champ} » est verrouillé.`;
    if (JSON.stringify(avant[champ] ?? null) !== JSON.stringify(apres[champ] ?? null)) return `Le champ « ${champ} » de ${c.chemin} est verrouillé.`;
  }
  return null;
}

function nouvellesDependances(c: Changement): string[] {
  if (c.chemin !== 'package.json' && !c.chemin.endsWith('/package.json')) return [];
  const avant = lireJson(c.avant) ?? {};
  const apres = lireJson(c.apres) ?? {};
  return CHAMPS_DEPENDANCES.flatMap((champ) => {
    const anciennes = Object.keys((avant[champ] as object | undefined) ?? {});
    return Object.keys((apres[champ] as object | undefined) ?? {}).filter((d) => !anciennes.includes(d));
  });
}

export function estFichierDeTest(chemin: string, fichiersTest: readonly string[]): boolean {
  return estFichierDeTestCode(chemin) || fichiersTest.some((m) => correspond(chemin, m));
}

export function verifierChangements(e: EntreeVerification): Constat[] {
  const { tache } = e;
  const constats: Constat[] = [];
  const modulesTestes = tache.fichiers_prevus.filter((f) => CODE_SOURCE.test(f) && !estFichierDeTestCode(f)).map(sansExtension);

  for (const c of e.changements) {
    const bloque = (regle: string, message: string) => constats.push({ regle, niveau: 'bloquant', fichier: c.chemin, message });

    const verrou = verrouillage(c, e.verrouilles);
    if (verrou) {
      bloque('fichier-verrouille', verrou);
      continue;
    }

    const deps = nouvellesDependances(c);
    if (deps.length > 0) {
      constats.push({ regle: 'nouvelle-dependance', niveau: 'signale', fichier: c.chemin, message: `Nouvelle(s) dépendance(s) : ${deps.join(', ')}.` });
    }

    const estTest = estFichierDeTest(c.chemin, e.fichiersTest);
    const protege = estTest && c.statut !== 'ajoute' && !tache.tests_modifiables.some((m) => m.fichier === c.chemin);
    let prioritaire = false;
    if (protege) {
      if (c.statut === 'supprime') {
        bloque('test-existant-supprime', `${c.chemin} est un fichier de test existant absent de tests_modifiables.`);
        continue;
      }
      if (c.chemin.endsWith('.snap') || c.chemin.includes('__snapshots__/')) {
        bloque('snapshot', `Snapshot mis à jour hors tests_modifiables : ${c.chemin}.`);
        continue;
      }
      if (!CODE_SOURCE.test(c.chemin)) {
        bloque('test-existant-modifie', `${c.chemin} est un fichier de test existant absent de tests_modifiables.`);
        continue;
      }
      const atteintes = comparerTestsExistants(c.avant ?? '', c.apres ?? '', c.chemin);
      constats.push(...atteintes);
      prioritaire = atteintes.length > 0;
    }

    if (!prioritaire && !tache.fichiers_prevus.includes(c.chemin)) {
      constats.push({ regle: 'hors-plan', niveau: 'signale', fichier: c.chemin, message: `${c.chemin} n'est pas dans fichiers_prevus.` });
    }

    if (CODE_SOURCE.test(c.chemin) && c.apres !== null) {
      constats.push(...analyserSource(c.apres, c.chemin, { lignes: c.statut === 'ajoute' ? null : c.lignes, estTest, modulesTestes }));
    }
  }
  return constats;
}
