// Conditions de sortie des étapes, vérifiées par « wf state avancer » avant toute transition.
// Le dernier passage de check-plan est enregistré avec l'empreinte de la spec et du plan :
// un plan ou une spec modifiés depuis exigent un nouveau check-plan vert.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dernierAudit } from './audits.ts';
import { git } from './depot.ts';
import { lireChangements } from './diff.ts';
import type { Etape } from './etat.ts';
import { conditionsFin, lireFin } from './fin.ts';
import { lirePlan } from './plan.ts';
import { lireRun } from './run-etat.ts';
import { lireSpec } from './spec.ts';

interface PassageCheckPlan {
  date: string;
  ok: boolean;
  spec: string;
  plan: string;
}

const FICHIER_PASSAGE = 'check-plan.json';

function empreinte(dossier: string, fichier: string): string | null {
  const chemin = join(dossier, fichier);
  return existsSync(chemin) ? createHash('sha256').update(readFileSync(chemin)).digest('hex') : null;
}

export function enregistrerCheckPlan(dossier: string, ok: boolean): void {
  const passage: PassageCheckPlan = {
    date: new Date().toISOString(),
    ok,
    spec: empreinte(dossier, 'spec.md') ?? '',
    plan: empreinte(dossier, 'plan.md') ?? '',
  };
  writeFileSync(join(dossier, FICHIER_PASSAGE), `${JSON.stringify(passage, null, 2)}\n`);
}

function checkPlanAJour(dossier: string): string | null {
  const chemin = join(dossier, FICHIER_PASSAGE);
  if (!existsSync(chemin)) return "« wf check-plan » n'a jamais été lancé sur ce plan.";
  const passage = JSON.parse(readFileSync(chemin, 'utf8')) as PassageCheckPlan;
  if (!passage.ok) return 'Le dernier « wf check-plan » a échoué : corrige le plan et relance-le.';
  if (passage.spec !== empreinte(dossier, 'spec.md') || passage.plan !== empreinte(dossier, 'plan.md')) {
    return 'La spec ou le plan ont changé depuis le dernier « wf check-plan » vert : relance-le.';
  }
  return null;
}

export function conditionsDeSortie(etape: Etape, dossier: string): string[] {
  if (etape === 'spec') {
    const chemin = join(dossier, 'spec.md');
    if (!existsSync(chemin)) return ['.workflow/spec.md est absent.'];
    return lireSpec(readFileSync(chemin, 'utf8')).erreurs;
  }
  if (etape === 'audit-spec') return triEnregistre(dossier, ['spec']);
  if (etape === 'plan' || etape === 'audit-plan' || etape === 'matrice') {
    const probleme = checkPlanAJour(dossier);
    const tri = etape === 'audit-plan' ? triEnregistre(dossier, ['plan', 'spec-plan']) : [];
    return probleme ? [probleme, ...tri] : tri;
  }
  if (etape === 'execution') return executionTerminee(dossier);
  if (etape === 'fin') {
    const racine = dirname(dossier);
    return conditionsFin(lireFin(dossier), git(['rev-parse', 'HEAD'], racine), lireChangements(racine).length === 0);
  }
  return [];
}

// Quitter une étape d'audit demande un audit lancé, et le tri de son dernier passage enregistré par
// « wf journal audit » : sans rejet à relire, Claude enchaîne seul, mais jamais sans ce tri.
function triEnregistre(dossier: string, phases: string[]): string[] {
  const audits = phases.flatMap((phase) => {
    const audit = dernierAudit(dossier, phase);
    return audit ? [{ phase, numero: audit.numero }] : [];
  });
  if (audits.length === 0) return [`Aucun audit à cette étape : lance « wf audit ${phases.join(' » ou « wf audit ')} ».`];
  const chemin = join(dossier, 'journal.jsonl');
  const tris = existsSync(chemin)
    ? readFileSync(chemin, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { type?: string; phase?: string; audit?: number })
        .filter((l) => l.type === 'audit')
    : [];
  return audits
    .filter((a) => !tris.some((t) => t.phase === a.phase && t.audit === a.numero))
    .map((a) => `Le tri de audits/${a.phase}-${a.numero}.md n'est pas enregistré : « wf journal audit --phase ${a.phase} --remontes N --acceptes N --rejetes N ».`);
}

function executionTerminee(dossier: string): string[] {
  const probleme = checkPlanAJour(dossier);
  if (probleme) return [probleme];
  if (!existsSync(join(dossier, 'run.json'))) return ["« wf run-plan » n'a jamais été lancé."];
  const run = lireRun(dossier);
  if (run.attente) return ['Une question de run-plan attend sa réponse (.workflow/question.md).'];
  const taches = lirePlan(readFileSync(join(dossier, 'plan.md'), 'utf8')).plan?.taches ?? [];
  const restantes = taches.filter((t) => run.taches[t.id]?.statut !== 'commitee').map((t) => t.id);
  return restantes.length > 0 ? [`Tâches pas encore committées par run-plan : ${restantes.join(', ')}.`] : [];
}
