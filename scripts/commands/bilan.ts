// wf bilan : une fois la branche terminée, propose des améliorations du workflow d'après ce qu'elle a rencontré.
// Les faits sont relevés par le script (journal, étapes, DEVIATIONS.md) ; Claude, en contexte neuf, ne peut
// suggérer qu'en les citant. Écrit .workflow/bilan.md et une copie dans le dossier central des retours.
// Ne modifie jamais le skill.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../config/defaults.ts';
import { evenementsBilan, lireBilan, nomFichierRetour, rendreBilan } from '../lib/bilan.ts';
import { dossierWorkflow, git, racineDepot } from '../lib/depot.ts';
import { lireEtat, type Etat } from '../lib/etat.ts';
import { remplir } from '../lib/gabarit.ts';
import { ajouterAuJournal } from '../lib/journal.ts';
import { appelerLlm, type Reponse } from '../lib/llm.ts';
import { terminer } from '../lib/result.ts';

const C = 'bilan';
const PROMPTS = fileURLToPath(new URL('../../prompts/', import.meta.url));
const FIN_MAX_LIGNES = 200;

function lire(chemin: string): string {
  return existsSync(chemin) ? readFileSync(chemin, 'utf8') : '';
}

async function appeler(racine: string, dossier: string, etat: Etat, prompt: string, nom: string): Promise<Reponse> {
  const { outil, modele } = CONFIG.modeles.bilan;
  let r: Reponse;
  try {
    r = await appelerLlm({ outil, modele, mode: 'ask', racine, prompt, fichierPrompt: join(dossier, 'llm', `${nom}.md`), timeoutMs: CONFIG.seuils.bilanMinutes * 60_000 });
  } catch (e) {
    terminer({ statut: 'ERREUR_OUTIL', commande: C, message: e instanceof Error ? e.message : String(e) });
  }
  ajouterAuJournal(dossier, etat, { type: 'llm', role: 'bilan', dureeMs: r.dureeMs, tokens: r.tokens, erreur: r.erreur || null });
  if (r.erreur) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `Appel du bilan en erreur : ${r.erreur} (détail dans .workflow/llm/).` });
  return r;
}

// Nom du dépôt principal, pas du worktree : les bilans d'un même dépôt se rangent ensemble.
function nomDepot(racine: string): string {
  try {
    return basename(dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], racine)));
  } catch {
    return basename(racine);
  }
}

export async function run(_args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });
  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow dans ce dépôt : rien à faire le bilan." });
  if (etat.etape !== 'termine') {
    terminer({ statut: 'ECHEC', commande: C, message: `Le bilan se fait une fois la branche terminée (étape termine) ; étape en cours : ${etat.etape}.` });
  }

  const journal = lire(join(dossier, 'journal.jsonl'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const evenements = evenementsBilan({ journal, historique: etat.historique, deviations: lire(join(dossier, 'DEVIATIONS.md')) });
  const ids = evenements.map((e) => e.id);
  const fin = lire(join(dossier, 'fin.md')).split(/\r?\n/);
  const prompt = remplir(readFileSync(join(PROMPTS, 'bilan.md'), 'utf8'), {
    branche: etat.branche,
    parcours: etat.parcours,
    evenements: evenements.map((e) => `- ${e.id} : ${e.texte}`).join('\n'),
    fin: fin.length > FIN_MAX_LIGNES ? `${fin.slice(0, FIN_MAX_LIGNES).join('\n')}\n[… tronqué]` : fin.join('\n') || '(pas de fin.md)',
  });

  process.stdout.write(`· Bilan de la branche : ${evenements.length} fait(s) relevé(s)…\n`);
  let r = await appeler(racine, dossier, etat, prompt, 'bilan');
  let bilan = lireBilan(r.texte, ids);
  if (bilan.erreurs.length > 0) {
    const rappel = `${prompt}\n\n---\n\nTa réponse précédente était hors format (${bilan.erreurs.join(' ')}). Réponds uniquement par le bloc YAML demandé.`;
    r = await appeler(racine, dossier, etat, rappel, 'bilan-2');
    bilan = lireBilan(r.texte, ids);
  }
  if (bilan.erreurs.length > 0) {
    terminer({
      statut: 'ERREUR_OUTIL',
      commande: C,
      message: `Le bilan est resté hors format après une relance (${bilan.erreurs.join(' ')}). Réponse brute : .workflow/llm/bilan-2.sortie.txt.`,
    });
  }

  // Date du passage à « termine » : relancer le bilan réécrit le même fichier.
  const date = [...etat.historique].reverse().find((t) => t.vers === 'termine')?.date ?? new Date().toISOString();
  const depot = nomDepot(racine);
  const entete = [
    `# Bilan du workflow — ${etat.branche}`,
    `Dépôt ${depot} · parcours ${etat.parcours} · terminé le ${date.slice(0, 10)} · ${evenements.length} fait(s) relevé(s), ${bilan.suggestions.length} suggestion(s) (${CONFIG.modeles.bilan.outil}, ${CONFIG.modeles.bilan.modele})`,
  ].join('\n\n');
  const contenu = rendreBilan(entete, bilan, evenements);
  writeFileSync(join(dossier, 'bilan.md'), contenu);
  mkdirSync(CONFIG.retours.dossier, { recursive: true });
  const central = join(CONFIG.retours.dossier, nomFichierRetour(date, depot, etat.slug));
  writeFileSync(central, contenu);
  ajouterAuJournal(dossier, etat, { type: 'bilan', suggestions: bilan.suggestions.length, fichier: central });

  terminer({
    statut: 'OK',
    commande: C,
    message: `Bilan écrit : .workflow/bilan.md et ${central} (${bilan.suggestions.length} suggestion(s)). Montre-le ; ne modifie pas le skill sans demande de l'utilisateur.`,
    details: { suggestions: bilan.suggestions.length, fichier: central },
  });
}
