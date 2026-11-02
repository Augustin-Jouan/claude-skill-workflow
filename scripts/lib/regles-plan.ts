// Règles de check-plan (references/plan-yaml.md) appliquées à un plan déjà lu sans erreur de format.
// Chaque violation porte le nom de sa règle : c'est lui que les tests et le skill référencent.

import type { Parcours } from './etat.ts';
import { exigenceDuNom, normaliserNomTest } from './nom-test.ts';
import type { Plan, Tache, Violation } from './plan.ts';
import type { Exigence } from './spec.ts';

export function verifierPlan(spec: Exigence[], plan: Plan, parcoursEtat: Parcours | null): Violation[] {
  const violations: Violation[] = [];
  const v = (regle: string, message: string, tache?: string) => violations.push({ regle, message, tache });
  const { entete, taches } = plan;
  const idsSpec = new Set(spec.map((e) => e.id));
  const idsTaches = new Set(taches.map((t) => t.id));

  if (parcoursEtat && entete.parcours !== parcoursEtat) {
    v('parcours', `L'en-tête annonce le parcours ${entete.parcours}, le workflow est en parcours ${parcoursEtat}.`);
  }

  for (const t of taches) {
    for (const ex of t.exigences) {
      if (!idsSpec.has(ex)) v('exigence-inconnue', `${t.id} cite ${ex}, absente de la spec.`, t.id);
    }
    if ((t.type === 'feature' || t.type === 'fix') && t.tests.length === 0) {
      v('tests-manquants', `${t.id} est de type ${t.type} : elle doit prévoir des tests.`, t.id);
    }
    if (t.type === 'fix' && t.tests.length > 0 && t.tests.every((test) => test.comportement_existant)) {
      v('fix-sans-regression', `${t.id} est un fix : au moins un test doit échouer sur l'ancien code (comportement_existant: false).`, t.id);
    }
    for (const test of t.tests) {
      const ex = exigenceDuNom(test.nom);
      if (!ex || !t.exigences.includes(ex)) {
        v('nom-test', `${t.id} : « ${test.nom} » doit commencer par « EX-n — » avec une exigence de la tâche (${t.exigences.join(', ') || 'aucune'}).`, t.id);
      }
      // Recopié dans une chaîne JS, « \r\n » devient un vrai retour à la ligne : le test n'est plus retrouvé par son nom.
      if (test.nom.includes('\\')) {
        v('nom-echappement', `${t.id} : « ${test.nom} » contient « \\ ». Écris le caractère en mots (CRLF, LF, tabulation…), sans séquence d'échappement.`, t.id);
      }
    }
    for (const m of t.tests_modifiables) {
      if (m.raison.trim() === '') v('raison-manquante', `${t.id} : ${m.fichier} est modifiable sans raison.`, t.id);
    }
    for (const d of t.depends_on) {
      if (!idsTaches.has(d)) v('dependance-inconnue', `${t.id} dépend de ${d}, qui n'existe pas.`, t.id);
    }
  }

  for (const ex of spec) {
    const couvrantes = taches.filter((t) => t.exigences.includes(ex.id));
    if (couvrantes.length === 0) {
      v('couverture-tache', `${ex.id} (${ex.titre}) n'est couverte par aucune tâche.`);
    } else if (!couvrantes.some((t) => t.tests.some((test) => exigenceDuNom(test.nom) === ex.id))) {
      v('couverture-test', `${ex.id} (${ex.titre}) n'est vérifiée par aucun test prévu.`);
    }
  }

  const parNom = new Map<string, string[]>();
  for (const t of taches) {
    for (const test of t.tests) {
      const cle = normaliserNomTest(test.nom);
      parNom.set(cle, [...(parNom.get(cle) ?? []), `${t.id} « ${test.nom} »`]);
    }
  }
  for (const occurrences of parNom.values()) {
    if (occurrences.length > 1) v('nom-duplique', `Tests prévus au même nom : ${occurrences.join(', ')}.`);
  }

  if (ordreTaches(taches) === null) v('cycle', 'Les depends_on forment un cycle : aucun ordre d\'exécution possible.');

  for (const j of entete.jalons) {
    if (!idsTaches.has(j)) v('jalon-inconnu', `Le jalon ${j} ne correspond à aucune tâche.`);
  }

  verifierE2e(plan, v);
  return violations;
}

function verifierE2e(plan: Plan, v: (regle: string, message: string) => void): void {
  const { parcours, e2e_non_applicable } = plan.entete;
  if (parcours === 'micro') return;
  const aE2e = plan.taches.some((t) => t.e2e);
  const derogation = e2e_non_applicable !== undefined;

  if (parcours === 'complet') {
    if (derogation) v('e2e', 'e2e_non_applicable est interdit en parcours complet.');
    else if (!aE2e) v('e2e', 'Le parcours complet exige au moins une tâche e2e: true.');
    return;
  }
  if (aE2e && derogation) v('e2e', 'Le plan a une tâche e2e: true : retire e2e_non_applicable.');
  else if (!aE2e && !e2e_non_applicable?.trim()) {
    v('e2e', 'Aucune tâche e2e: true : ajoutes-en une, ou justifie e2e_non_applicable dans l\'en-tête.');
  }
}

// Ordre d'exécution : à chaque pas, la première tâche du plan dont les dépendances connues sont faites.
// Les dépendances inconnues sont ignorées ici (règle dédiée) ; null signale un cycle.
export function ordreTaches(taches: Tache[]): string[] | null {
  const ids = new Set(taches.map((t) => t.id));
  const faites: string[] = [];
  const restantes = [...taches];
  while (restantes.length > 0) {
    const i = restantes.findIndex((t) => t.depends_on.every((d) => !ids.has(d) || faites.includes(d)));
    if (i < 0) return null;
    faites.push(restantes.splice(i, 1)[0].id);
  }
  return faites;
}
