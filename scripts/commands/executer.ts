// wf executer
// Enchaîne run-plan, le passage de l'étape execution à fin, puis finish, sans repasser par la session qui pilote
// le workflow. S'arrête dès qu'une sous-commande ne rend pas OK : question (3), échec (1), erreur d'outil (2).
// En cas de succès, ne rend qu'un résumé court de .workflow/fin.md.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dossierWorkflow, racineDepot } from '../lib/depot.ts';
import { lireEtat } from '../lib/etat.ts';
import { aRelayer, etapesExecuter, resumerFin, type EtapeExecuter } from '../lib/executer.ts';
import { terminer, type Resultat } from '../lib/result.ts';

const C = 'executer';
const WF = fileURLToPath(new URL('../wf.ts', import.meta.url));

function argumentsDe(etape: EtapeExecuter): string[] {
  if (etape === 'avancer') return ['state', 'avancer', '--note', 'run-plan terminé (wf executer)'];
  if (etape === 'finish') return ['finish'];
  return ['run-plan'];
}

// La progression de la sous-commande (lignes « · ») et le direct de Cursor (« ┊ ») passent tels quels.
// Son verdict (WF_RESULT) est repris par executer, et le message qui le précède n'est pas répété :
// celui de finish demanderait de présenter fin.md en entier.
function lancer(racine: string, args: string[]): Promise<Resultat | null> {
  return new Promise((resoudre) => {
    const enfant = spawn(process.execPath, [WF, ...args], { cwd: racine, stdio: ['ignore', 'pipe', 'pipe'] });
    let resultat: Resultat | null = null;
    let reste = '';
    let erreurs = '';
    let enAttente: string[] = [];
    const vider = (sauf: Set<string> = new Set()) => {
      for (const l of enAttente) if (!sauf.has(l)) process.stdout.write(`${l}\n`);
      enAttente = [];
    };
    const traiter = (ligne: string) => {
      if (ligne.startsWith('WF_RESULT ')) {
        resultat = JSON.parse(ligne.slice('WF_RESULT '.length)) as Resultat;
        vider(new Set(resultat.message.split(/\r?\n/)));
      } else if (aRelayer(ligne)) {
        vider();
        process.stdout.write(`${ligne}\n`);
      } else enAttente.push(ligne);
    };
    enfant.stdout.setEncoding('utf8');
    enfant.stdout.on('data', (morceau: string) => {
      const lignes = (reste + morceau).split(/\r?\n/);
      reste = lignes.pop() ?? '';
      lignes.forEach(traiter);
    });
    enfant.stderr.setEncoding('utf8');
    enfant.stderr.on('data', (morceau: string) => {
      erreurs = (erreurs + morceau).slice(-4000);
    });
    enfant.on('close', () => {
      if (reste) traiter(reste);
      vider();
      if (!resultat && erreurs) process.stderr.write(erreurs);
      resoudre(resultat);
    });
  });
}

export async function run(): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });
  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });
  const etapes = etapesExecuter(etat.etape);
  if (!etapes) terminer({ statut: 'ECHEC', commande: C, message: `executer se lance à l'étape execution ou fin ; étape en cours : ${etat.etape}.` });

  for (const etape of etapes) {
    const r = await lancer(racine, argumentsDe(etape));
    if (!r) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `« wf ${etape} » n'a pas rendu de verdict.` });
    if (r.statut !== 'OK') terminer({ statut: r.statut, commande: C, message: r.message, details: { sousCommande: r.commande, details: r.details } });
  }

  terminer({ statut: 'OK', commande: C, message: resumerFin(readFileSync(join(dossier, 'fin.md'), 'utf8')) });
}
