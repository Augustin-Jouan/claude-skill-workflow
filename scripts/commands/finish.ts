// wf finish — fin de branche (workflow-dev.md, 5), à l'étape fin, une fois run-plan terminé.
// 1. traçabilité des EX-n ; 2. suite complète (une fois) et typecheck, comparés à l'état de départ de run-plan ;
// 3. review par un contexte neuf (spec, DEVIATIONS.md, diff). Écrit .workflow/fin.md et fin.json.
// Code 0 : fin.md prêt pour la revue finale. 1 : traçabilité ou suite en échec (nouvelle tâche au plan).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../config/defaults.ts';
import { dossierWorkflow, fichiersDuDepot, git, gitBrut, racineDepot } from '../lib/depot.ts';
import { lireChangements } from '../lib/diff.ts';
import { lireEtat, type Etat } from '../lib/etat.ts';
import { ecrireFin, ligneCouverture, lireVerdictReview, resumerJournal } from '../lib/fin.ts';
import { remplir } from '../lib/gabarit.ts';
import { ajouterAuJournal } from '../lib/journal.ts';
import { appelerLlm, type Reponse } from '../lib/llm.ts';
import { terminer } from '../lib/result.ts';
import { echecsAdmis, lireRun } from '../lib/run-etat.ts';
import { binaireLocal, detecterRunner, lancerTests, type Runner } from '../lib/runner.ts';
import { conditionsDeSortie } from '../lib/sortie.ts';
import { lireSpec } from '../lib/spec.ts';
import { comparerSuite, echecsSuite, lancerTsc, lireQuarantaine, nouvellesErreurs } from '../lib/suite.ts';
import { estFichierDeTestCode, tracerExigences } from '../lib/trace.ts';

const C = 'finish';
const SKILL = fileURLToPath(new URL('../../', import.meta.url));
const PROMPTS = join(SKILL, 'prompts');
const DIFF_MAX_LIGNES = 6000;

function afficher(message: string): void {
  process.stdout.write(`· ${message}\n`);
}

interface Contexte {
  racine: string;
  dossier: string;
  etat: Etat;
  base: string;
  head: string;
  runner: Runner;
  binaire: string;
  spec: string;
}

function journal(ctx: Contexte, ligne: Record<string, unknown>): void {
  ajouterAuJournal(ctx.dossier, ctx.etat, ligne);
}

async function llm(ctx: Contexte, prompt: string): Promise<Reponse> {
  const { outil, modele } = CONFIG.modeles.review;
  let r: Reponse;
  try {
    // La review juge le diff dans son contexte : elle lit le dépôt (la branche est committée, HEAD est l'état final).
    r = await appelerLlm({ outil, modele, mode: 'ask', racine: ctx.racine, prompt, fichierPrompt: join(ctx.dossier, 'llm', 'fin-review.md'), timeoutMs: CONFIG.seuils.reviewMinutes * 60_000, lecture: true });
  } catch (e) {
    terminer({ statut: 'ERREUR_OUTIL', commande: C, message: e instanceof Error ? e.message : String(e) });
  }
  journal(ctx, { type: 'llm', role: 'review', dureeMs: r.dureeMs, tokens: r.tokens, erreur: r.erreur || null });
  if (r.erreur) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `Appel review en erreur : ${r.erreur} (détail dans .workflow/llm/).` });
  return r;
}

// --- 1 et 2 : traçabilité, suite complète, typecheck ---

function controles(ctx: Contexte): { lignes: string[]; bloquants: string[] } {
  const lignes: string[] = [];
  const bloquants: string[] = [];

  const exigences = lireSpec(ctx.spec).exigences;
  const fichiers = fichiersDuDepot(ctx.racine)
    .filter((f) => estFichierDeTestCode(f) && existsSync(join(ctx.racine, f)))
    .map((chemin) => ({ chemin, code: readFileSync(join(ctx.racine, chemin), 'utf8') }));
  const { absentes } = tracerExigences(exigences, fichiers);
  if (absentes.length > 0) {
    bloquants.push(`Traçabilité : ${absentes.join(', ')} n'apparaissent dans aucun nom de test.`);
    lignes.push(`- Traçabilité : ❌ ${absentes.join(', ')} sans test qui les nomme`);
  } else {
    lignes.push(`- Traçabilité : ✅ ${exigences.length} exigence(s) nommée(s) dans un test`);
  }

  afficher('Suite complète…');
  const run = lireRun(ctx.dossier);
  const reference = run.reference ?? { echecs: [], tsc: [] };
  const sortie = join(ctx.dossier, 'rapports', 'fin-suite.json');
  let echecs = echecsSuite(lancerTests(ctx.racine, ctx.runner, ctx.binaire, [], sortie));
  let instables: string[] = [];
  if (echecs.length > 0) {
    const relance = echecsSuite(lancerTests(ctx.racine, ctx.runner, ctx.binaire, [], sortie));
    instables = echecs.filter((e) => !relance.includes(e));
    echecs = relance;
  }
  for (const i of instables) journal(ctx, { type: 'instable', tache: 'fin', test: i });
  const fichierQuarantaine = join(ctx.dossier, 'quarantine.json');
  const quarantaine = existsSync(fichierQuarantaine) ? lireQuarantaine(readFileSync(fichierQuarantaine, 'utf8')) : [];
  const { regressions, enQuarantaine } = comparerSuite(echecsAdmis(run), echecs, quarantaine);
  const notes = [
    reference.echecs.length > 0 ? `${reference.echecs.length} échec(s) déjà présent(s) avant la branche` : '',
    run.echecsAcceptes.length > 0 ? `admis à un jalon : ${run.echecsAcceptes.join(', ')}` : '',
    enQuarantaine.length > 0 ? `en quarantaine : ${enQuarantaine.join(', ')}` : '',
    instables.length > 0 ? `instables : ${instables.join(', ')}` : '',
  ].filter(Boolean);
  if (regressions.length > 0) {
    bloquants.push(`Suite complète : ${regressions.length} régression(s) :\n${regressions.map((r) => `  - ${r}`).join('\n')}`);
    lignes.push(`- Suite complète : ❌ ${regressions.length} régression(s)`);
  } else {
    lignes.push(`- Suite complète : ✅${notes.length > 0 ? ` (${notes.join(' ; ')})` : ''}`);
  }

  const tsc = lancerTsc(ctx.racine);
  const nouvelles = nouvellesErreurs(reference.tsc, tsc ?? []);
  if (nouvelles.length > 0) {
    bloquants.push(`Typecheck : ${nouvelles.length} nouvelle(s) erreur(s) :\n${nouvelles.map((e) => `  - ${e}`).join('\n')}`);
    lignes.push(`- Typecheck : ❌ ${nouvelles.length} nouvelle(s) erreur(s)`);
  } else {
    lignes.push(`- Typecheck : ${tsc === null ? '— (pas de TypeScript dans le projet)' : '✅'}`);
  }
  return { lignes, bloquants };
}

// --- 3 : review neuve ---

async function review(ctx: Contexte): Promise<{ verdict: string | null; texte: string }> {
  afficher('Review par un contexte neuf…');
  const exclus = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].map((f) => `:(exclude,glob)**/${f}`);
  const lignes = gitBrut(['-c', 'core.quotePath=false', 'diff', ctx.base, ctx.head, '--', '.', ...exclus], ctx.racine).split('\n');
  const diff = lignes.length > DIFF_MAX_LIGNES ? `${lignes.slice(0, DIFF_MAX_LIGNES).join('\n')}\n… (${lignes.length - DIFF_MAX_LIGNES} lignes coupées)` : lignes.join('\n');
  const deviations = join(ctx.dossier, 'DEVIATIONS.md');
  const prompt = remplir(readFileSync(join(PROMPTS, 'review-neuve.md'), 'utf8'), {
    spec: ctx.spec,
    deviations: existsSync(deviations) ? readFileSync(deviations, 'utf8') : 'Aucune déviation consignée.',
    diff: `\`\`\`diff\n${diff}\n\`\`\``,
  });
  const r = await llm(ctx, prompt);
  const verdict = lireVerdictReview(r.texte);
  journal(ctx, { type: 'review', verdict: verdict ?? 'illisible' });
  return { verdict, texte: r.texte };
}

// --- Commande ---

export async function run(): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });
  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });
  if (etat.etape !== 'fin') terminer({ statut: 'ECHEC', commande: C, message: `finish se lance à l'étape fin ; étape en cours : ${etat.etape}.` });
  const execution = conditionsDeSortie('execution', dossier);
  if (execution.length > 0) terminer({ statut: 'ECHEC', commande: C, message: `L'exécution n'est pas terminée : ${execution.join(' ')}` });
  if (lireChangements(racine).length > 0) {
    terminer({ statut: 'ECHEC', commande: C, message: "L'arbre de travail a des changements non commités : finish juge la branche committée." });
  }

  const pkg = join(racine, 'package.json');
  const runner = existsSync(pkg) ? detecterRunner(JSON.parse(readFileSync(pkg, 'utf8'))) : null;
  if (!runner) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: 'Ni vitest ni jest dans les dépendances du projet.' });
  const binaire = binaireLocal(racine, runner);
  if (!binaire) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `${runner} est déclaré mais absent de node_modules : lance l'installation du projet.` });

  const base = lireRun(dossier).reference?.commit;
  if (!base) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "run.json n'a pas de commit de départ : relance « wf run-plan » (couche 4)." });
  const ctx: Contexte = { racine, dossier, etat, base, head: git(['rev-parse', 'HEAD'], racine), runner, binaire, spec: readFileSync(join(dossier, 'spec.md'), 'utf8') };

  const entete = `# Fin de branche — ${etat.branche}\n\nCommit ${ctx.head.slice(0, 8)} · base ${base.slice(0, 8)} · ${new Date().toISOString()}`;
  const { lignes, bloquants } = controles(ctx);
  if (bloquants.length > 0) {
    writeFileSync(join(dossier, 'fin.md'), `${entete}\n\n## Contrôles\n\n${lignes.join('\n')}\n`);
    ecrireFin(dossier, { date: new Date().toISOString(), head: ctx.head, ok: false, verdict: null });
    journal(ctx, { type: 'fin', ok: false });
    terminer({
      statut: 'ECHEC',
      commande: C,
      message: `Fin de branche bloquée :\n${bloquants.map((b) => `- ${b}`).join('\n')}\n\nLa correction passe par une nouvelle tâche : « wf state revenir plan --note "..." », amende le plan, puis check-plan, matrice, run-plan, finish.`,
      details: { bloquants },
    });
  }

  const rv = await review(ctx);
  const journalBrut = existsSync(join(dossier, 'journal.jsonl')) ? readFileSync(join(dossier, 'journal.jsonl'), 'utf8') : '';
  const lignesJournal = journalBrut.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const couverture = ligneCouverture(lignesJournal);

  const contenu = [
    entete,
    '## Contrôles',
    [...lignes, ...(couverture ? [couverture] : []), `- Review neuve : ${rv.verdict ?? 'verdict illisible (voir ci-dessous)'}`].join('\n'),
    `## Review neuve (${CONFIG.modeles.review.outil}, ${CONFIG.modeles.review.modele})`,
    rv.texte.trim(),
    '## Journal',
    resumerJournal(lignesJournal, Object.fromEntries(Object.entries(CONFIG.modeles).map(([role, m]) => [role, m.outil]))),
  ];
  writeFileSync(join(dossier, 'fin.md'), `${contenu.join('\n\n')}\n`);
  ecrireFin(dossier, { date: new Date().toISOString(), head: ctx.head, ok: true, verdict: rv.verdict });
  journal(ctx, { type: 'fin', ok: true, verdict: rv.verdict });

  terminer({
    statut: 'OK',
    commande: C,
    message: `Fin de branche prête : .workflow/fin.md (review : ${rv.verdict ?? 'illisible'}). Présente-la pour la revue finale.`,
    details: { verdict: rv.verdict },
  });
}
