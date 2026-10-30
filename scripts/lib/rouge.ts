// Contrôle « rouge » des tâches fix (workflow-dev.md, 4.3) : lancé sur le code d'avant la tâche,
// chaque test de régression doit échouer sur une assertion. Un test qui passe déjà, ou qui échoue
// à la compilation ou sur une erreur d'exécution, ne prouve pas la correction : la tâche est rejetée.
// Un test ajouté hors plan qui passe déjà sur l'ancien code est signalé.

import { blocsDeTest } from './ast-tests.ts';
import type { Constat } from './constat.ts';
import { normaliserNomTest } from './nom-test.ts';
import type { TestPrevu } from './plan.ts';
import type { Rapport, ResultatTest } from './runner.ts';

const ASSERTION = /^(\w*AssertionError\b|(Error: )?expect[.(])/;

export function estEchecAssertion(message: string): boolean {
  const premiere = message.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n')[0];
  return ASSERTION.test(premiere);
}

function echoueSurAssertion(t: ResultatTest): boolean {
  return t.statut === 'failed' && t.echecs.some(estEchecAssertion);
}

export function jugerRouge(tests: TestPrevu[], fichiers: string[], rapport: Rapport, nouveaux: string[]): Constat[] {
  const constats: Constat[] = [];
  const candidats = (nom: string) =>
    rapport.tests.filter((t) => fichiers.includes(t.fichier) && normaliserNomTest(t.titre) === normaliserNomTest(nom));
  const bloque = (regle: string, fichier: string, message: string) => constats.push({ regle, niveau: 'bloquant', fichier, message });

  for (const test of tests.filter((t) => !t.comportement_existant)) {
    const resultats = candidats(test.nom);
    const fichier = resultats[0]?.fichier ?? fichiers.join(', ');
    // Avec .each, il suffit qu'un cas échoue sur une assertion : les autres peuvent passer légitimement.
    if (resultats.some(echoueSurAssertion)) continue;
    const erreur = resultats.find((t) => t.statut === 'failed');
    if (erreur) {
      bloque('rouge-sans-assertion', fichier, `« ${test.nom} » échoue sur l'ancien code, mais pas sur une assertion :\n${(erreur.echecs[0] ?? '').split('\n')[0]}`);
    } else if (resultats.some((t) => t.statut === 'passed')) {
      bloque('rouge-deja-vert', fichier, `« ${test.nom} » passe déjà sur l'ancien code : il ne prouve pas la correction.`);
    } else {
      const compilation = fichiers.filter((f) => rapport.erreursFichier[f]);
      if (resultats.length === 0 && compilation.length > 0) {
        bloque('rouge-compilation', compilation.join(', '), `« ${test.nom} » ne compile pas sur l'ancien code :\n${rapport.erreursFichier[compilation[0]].split('\n')[0]}`);
      } else {
        bloque('rouge-non-execute', fichier, `« ${test.nom} » n'a pas été exécuté sur l'ancien code.`);
      }
    }
  }

  const prevus = tests.map((t) => normaliserNomTest(t.nom));
  for (const titre of nouveaux.filter((n) => !prevus.includes(normaliserNomTest(n)))) {
    const resultats = candidats(titre);
    if (resultats.length > 0 && resultats.every((t) => t.statut === 'passed')) {
      constats.push({
        regle: 'test-ajoute-deja-vert',
        niveau: 'signale',
        fichier: resultats[0].fichier,
        message: `« ${titre} », ajouté hors plan, passe déjà sur l'ancien code.`,
      });
    }
  }
  return constats;
}

export function nouveauxTitres(avant: string | null, apres: string, chemin: string): string[] {
  const titres = (code: string) => blocsDeTest(code, chemin).filter((b) => b.genre === 'test').map((b) => b.nom);
  const anciens = new Set((avant === null ? [] : titres(avant)).map(normaliserNomTest));
  return [...new Set(titres(apres))].filter((t) => !anciens.has(normaliserNomTest(t)));
}
