// wf audit <spec|plan|spec-plan> [--reprendre] — audit headless par Cursor, en mode « ask » (lecture seule),
// avec un modèle choisi selon la taille de la spec (scripts/lib/modeles.ts). Écrit .workflow/audits/<phase>-<n>.md :
// Claude le trie ensuite (references/tri-audit.md). Une réponse hors format est redemandée une fois, puis code 2.
// --reprendre relit la réponse du dernier appel (.workflow/llm/) sans relancer Cursor.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../config/defaults.ts';
import { lireArguments } from '../lib/args.ts';
import { derniereReponse, enregistrerAudit } from '../lib/audits.ts';
import { dossierWorkflow, racineDepot } from '../lib/depot.ts';
import { lireEtat, type Etape, type Parcours } from '../lib/etat.ts';
import { remplir } from '../lib/gabarit.ts';
import { ajouterAuJournal } from '../lib/journal.ts';
import { appelerLlm, type Reponse } from '../lib/llm.ts';
import { modeleAudit } from '../lib/modeles.ts';
import { lirePointsAudit } from '../lib/reponses-llm.ts';
import { terminer } from '../lib/result.ts';
import { lireSpec } from '../lib/spec.ts';
import { conditionsDeSortie } from '../lib/sortie.ts';

const C = 'audit';
const PROMPTS = fileURLToPath(new URL('../../prompts/', import.meta.url));

// Phase d'audit → étape où elle se lance et parcours qui la prévoient.
const PHASES: Record<string, { etape: Etape; parcours: Parcours[] }> = {
  spec: { etape: 'audit-spec', parcours: ['complet'] },
  plan: { etape: 'audit-plan', parcours: ['complet'] },
  'spec-plan': { etape: 'audit-plan', parcours: ['court'] },
};

export async function run(args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });
  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });

  const { positionnels, options } = lireArguments(args);
  const phase = positionnels[0] ?? '';
  const regle = PHASES[phase];
  if (!regle) terminer({ statut: 'ECHEC', commande: C, message: 'Phase attendue : spec, plan ou spec-plan.' });
  if (!regle.parcours.includes(etat.parcours)) {
    terminer({ statut: 'ECHEC', commande: C, message: `L'audit ${phase} n'existe pas en parcours ${etat.parcours}.` });
  }
  if (etat.etape !== regle.etape) {
    terminer({ statut: 'ECHEC', commande: C, message: `L'audit ${phase} se lance à l'étape ${regle.etape} ; étape en cours : ${etat.etape}.` });
  }

  const lire = (f: string) => (existsSync(join(dossier, f)) ? readFileSync(join(dossier, f), 'utf8') : '');
  const valeurs: Record<string, string> = { spec: lire('spec.md') };
  if (phase !== 'spec') {
    const probleme = conditionsDeSortie('plan', dossier);
    if (probleme.length > 0) terminer({ statut: 'ECHEC', commande: C, message: probleme.join(' ') });
    valeurs.plan = lire('plan.md');
    valeurs.matrice = lire('matrice.md');
  }
  const prompt = remplir(readFileSync(join(PROMPTS, `audit-${phase}.md`), 'utf8'), valeurs);

  if (options.reprendre) {
    const reprise = derniereReponse(dossier, phase, prompt);
    if ('erreur' in reprise) terminer({ statut: 'ECHEC', commande: C, message: reprise.erreur });
    const lu = lirePointsAudit(reprise.texte);
    if (lu.erreurs.length > 0) {
      terminer({ statut: 'ECHEC', commande: C, message: `La dernière réponse reste hors format (${lu.erreurs.join(' ')}) : relance l'audit sans --reprendre.` });
    }
    ajouterAuJournal(dossier, etat, { type: 'audit-repris', phase, horodatage: reprise.horodatage });
    auditEcrit(dossier, phase, lu);
  }

  const { outil } = CONFIG.modeles.audit;
  const { modele, raison } = modeleAudit(etat.parcours, lireSpec(valeurs.spec).exigences.length);
  console.log(`· Audit ${phase} avec ${modele} (${raison}). Suivi en direct : « wf suivre ».`);
  let consigne = prompt;
  for (let essai = 1; essai <= 2; essai++) {
    let r: Reponse;
    try {
      r = await appelerLlm({
        outil,
        modele,
        mode: 'ask',
        racine,
        prompt: consigne,
        fichierPrompt: join(dossier, 'llm', `audit-${phase}-${Date.now()}.md`),
        suivi: { fichier: join(dossier, 'cursor.log'), titre: `audit ${phase} · ${modele} (${raison})` },
        timeoutMs: CONFIG.seuils.auditMinutes * 60_000,
      });
    } catch (e) {
      terminer({ statut: 'ERREUR_OUTIL', commande: C, message: e instanceof Error ? e.message : String(e) });
    }
    ajouterAuJournal(dossier, etat, { type: 'llm', role: 'audit', modele, raison, phase, dureeMs: r.dureeMs, tokens: r.tokens, erreur: r.erreur || null });
    if (r.erreur) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `Audit ${phase} impossible : ${r.erreur} (détail dans .workflow/llm/).` });

    const lu = lirePointsAudit(r.texte);
    if (lu.erreurs.length === 0) auditEcrit(dossier, phase, lu);
    consigne = `${prompt}\n\n---\n\nTa réponse précédente était hors format (${lu.erreurs.join(' ')}). Réponds uniquement par la liste demandée, ou par « Aucun point. ».`;
  }
  terminer({
    statut: 'ERREUR_OUTIL',
    commande: C,
    message: `Deux réponses hors format pour l'audit ${phase} : voir .workflow/llm/. Si le lecteur des réponses est en cause, une fois corrigé : « wf audit ${phase} --reprendre » relit la dernière sans relancer l'audit.`,
  });
}

function auditEcrit(dossier: string, phase: string, lu: { points: string[]; liste: string }): never {
  const fichier = enregistrerAudit(dossier, phase, lu.liste, lu.points);
  terminer({
    statut: 'OK',
    commande: C,
    message: `Audit ${phase} écrit dans ${fichier} : ${lu.points.length} point(s). Trie-le selon references/tri-audit.md.`,
    details: { fichier, points: lu.points },
  });
}
