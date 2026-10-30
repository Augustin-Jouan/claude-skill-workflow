// wf finish [--sans-mutation] — fin de branche (workflow-dev.md, 5), à l'étape fin, une fois run-plan terminé.
// 1. traçabilité des EX-n ; 2. suite complète (une fois) et typecheck, comparés à l'état de départ de run-plan ;
// 3. Stryker sur le code changé par la branche, puis analyse LLM des survivants du code des tâches feature ;
// 4. review par un contexte neuf (spec, DEVIATIONS.md, diff). Écrit .workflow/fin.md et fin.json.
// Code 0 : fin.md prêt pour la revue finale. 1 : traçabilité ou suite en échec (nouvelle tâche au plan).
// --sans-mutation : seulement sur demande explicite du développeur ; noté dans fin.md et le journal.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { CONFIG } from '../../config/defaults.ts';
import { lireArguments } from '../lib/args.ts';
import { CODE_SOURCE } from '../lib/constat.ts';
import { dossierWorkflow, fichiersDuDepot, git, gitBrut, racineDepot } from '../lib/depot.ts';
import { lignesModifiees, lireChangements } from '../lib/diff.ts';
import { lireEtat, type Etat } from '../lib/etat.ts';
import { ecrireFin, ecrireMutationFaite, lireMutationFaite, lireVerdictReview, mutationReutilisable, oublierMutationFaite, resumerJournal, type Fin, type MutationFaite } from '../lib/fin.ts';
import { remplir } from '../lib/gabarit.ts';
import { correspond } from '../lib/glob.ts';
import { ajouterAuJournal } from '../lib/journal.ts';
import { appelerLlm, commandeDeLancement, executer, type Reponse } from '../lib/llm.ts';
import { choisirAnalyses, cleMutant, configStryker, formaterMutants, incrementalReutilisable, lireAnalyseSurvivants, lireMutants, trierSurvivants, type AnalyseSurvivants, type FichierMutation } from '../lib/mutation.ts';
import { lirePlan } from '../lib/plan.ts';
import { terminer } from '../lib/result.ts';
import { echecsAdmis, lireRun } from '../lib/run-etat.ts';
import { binaireLocal, detecterRunner, lancerTests, type Runner } from '../lib/runner.ts';
import { conditionsDeSortie } from '../lib/sortie.ts';
import { lireSpec, sectionsExigences } from '../lib/spec.ts';
import { comparerSuite, echecsSuite, lancerTsc, lireQuarantaine, nouvellesErreurs } from '../lib/suite.ts';
import { estFichierDeTestCode, tracerExigences } from '../lib/trace.ts';
import { estFichierDeTest } from '../lib/verification.ts';

const C = 'finish';
const SKILL = fileURLToPath(new URL('../../', import.meta.url));
const PROMPTS = join(SKILL, 'prompts');
const STRYKER = join(SKILL, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');
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

async function llm(ctx: Contexte, role: 'survivants' | 'review', prompt: string, nom: string, minutes: number): Promise<Reponse> {
  const { outil, modele } = CONFIG.modeles[role];
  let r: Reponse;
  try {
    // La review juge le diff dans son contexte : elle lit le dépôt (la branche est committée, HEAD est l'état final).
    r = await appelerLlm({ outil, modele, mode: 'ask', racine: ctx.racine, prompt, fichierPrompt: join(ctx.dossier, 'llm', `fin-${nom}.md`), timeoutMs: minutes * 60_000, lecture: role === 'review' });
  } catch (e) {
    terminer({ statut: 'ERREUR_OUTIL', commande: C, message: e instanceof Error ? e.message : String(e) });
  }
  journal(ctx, { type: 'llm', role, dureeMs: r.dureeMs, tokens: r.tokens, erreur: r.erreur || null });
  if (r.erreur) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `Appel ${role} en erreur : ${r.erreur} (détail dans .workflow/llm/).` });
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

// --- 3 : mutation testing ---

function fichiersDeLaBranche(ctx: Contexte): string[] {
  return git(['-c', 'core.quotePath=false', 'diff', '--name-only', ctx.base, ctx.head], ctx.racine)
    .split(/\r?\n/)
    .filter((f) => f && CODE_SOURCE.test(f) && !estFichierDeTest(f, CONFIG.fichiersTest) && existsSync(join(ctx.racine, f)))
    .filter((f) => !CONFIG.verrouilles.some((v) => correspond(f, v.split('#')[0])));
}

async function lancerStryker(ctx: Contexte, fichiers: string[]): Promise<{ resultats: FichierMutation[]; incremental: boolean }> {
  if (!existsSync(STRYKER)) {
    terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `Stryker est absent du skill : lance « npm install » dans ${SKILL}.` });
  }
  const rapport = join(ctx.dossier, 'rapports', 'mutation.json');
  const config = configStryker({
    runner: ctx.runner,
    binaire: relative(ctx.racine, ctx.binaire).replaceAll('\\', '/'),
    fichiers,
    dossier: relative(ctx.racine, ctx.dossier).replaceAll('\\', '/'),
    concurrence: Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2))),
  });
  // Commit du dernier run de Stryker : les résultats gardés ne valent que si seul le code muté a changé depuis.
  const incrementalFichier = join(ctx.dossier, 'stryker-incremental.json');
  const marque = join(ctx.dossier, 'stryker-incremental.commit');
  const precedent = existsSync(marque) ? readFileSync(marque, 'utf8').trim() : null;
  let changes: string[] | null = null;
  if (precedent) {
    try {
      changes = git(['-c', 'core.quotePath=false', 'diff', '--name-only', precedent, ctx.head], ctx.racine).split(/\r?\n/).filter(Boolean);
    } catch {
      changes = null;
    }
  }
  const incremental = existsSync(incrementalFichier) && incrementalReutilisable(changes, fichiers);
  if (!incremental) rmSync(incrementalFichier, { force: true });
  const fichierConfig = join(ctx.dossier, 'stryker.config.json');
  writeFileSync(fichierConfig, `${JSON.stringify(config, null, 2)}\n`);
  afficher(`Mutation testing (Stryker, ${incremental ? 'incrémental' : 'complet'}) sur ${fichiers.length} fichier(s)…`);
  const r = await executer(
    { commande: process.execPath, args: [STRYKER, 'run', relative(ctx.racine, fichierConfig)], shell: false },
    { cwd: ctx.racine, timeoutMs: CONFIG.seuils.mutationMinutes * 60_000, env: { ...process.env, CI: 'true', FORCE_COLOR: '0' } },
  );
  mkdirSync(join(ctx.dossier, 'rapports'), { recursive: true });
  writeFileSync(join(ctx.dossier, 'rapports', 'stryker.log'), `code ${r.code}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}\n`);
  journal(ctx, { type: 'mutation', fichiers: fichiers.length, dureeMs: r.dureeMs, code: r.code, depasse: r.depasse, incremental });
  if (r.depasse || r.code !== 0 || !existsSync(rapport)) {
    const cause = r.depasse ? `délai de ${CONFIG.seuils.mutationMinutes} min dépassé` : `code ${r.code}`;
    terminer({
      statut: 'ERREUR_OUTIL',
      commande: C,
      message: `Stryker a échoué (${cause}) : voir .workflow/rapports/stryker.log.\n${(r.stderr || r.stdout).slice(-1500)}`,
    });
  }
  const resultats = lireMutants(JSON.parse(readFileSync(rapport, 'utf8')));
  // Stryker compte un Timeout comme tué : si tous les mutants finissent ainsi, le score ne mesure rien.
  const total = resultats.reduce((s, f) => s + f.total, 0);
  if (total > 0 && resultats.every((f) => f.timeouts === f.total)) {
    terminer({
      statut: 'ERREUR_OUTIL',
      commande: C,
      message: `Stryker : les ${total} mutants ont tous dépassé le délai, le score ne veut rien dire (runner trop lent ou bloqué). Voir .workflow/rapports/stryker.log.`,
    });
  }
  writeFileSync(marque, `${ctx.head}
`);
  return { resultats, incremental };
}

// Fichiers touchés par les commits des tâches feature, avec leurs exigences.
function codeDesFeatures(ctx: Contexte): Map<string, string[]> {
  const plan = lirePlan(readFileSync(join(ctx.dossier, 'plan.md'), 'utf8')).plan?.taches ?? [];
  const run = lireRun(ctx.dossier);
  const parFichier = new Map<string, string[]>();
  for (const t of plan.filter((x) => x.type === 'feature')) {
    const commit = run.taches[t.id]?.commit;
    if (!commit) continue;
    for (const f of git(['-c', 'core.quotePath=false', 'show', '--name-only', '--format=', commit], ctx.racine).split(/\r?\n/).filter(Boolean)) {
      parFichier.set(f, [...new Set([...(parFichier.get(f) ?? []), ...t.exigences])]);
    }
  }
  return parFichier;
}

async function analyser(ctx: Contexte, f: FichierMutation, exigences: string[]): Promise<{ analyse: AnalyseSurvivants; brut: string }> {
  afficher(`Analyse des survivants : ${f.fichier}…`);
  const code = readFileSync(join(ctx.racine, f.fichier), 'utf8')
    .split(/\r?\n/)
    .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
    .join('\n');
  const prompt = remplir(readFileSync(join(PROMPTS, 'survivants.md'), 'utf8'), {
    fichier: f.fichier,
    exigences: sectionsExigences(ctx.spec, exigences) || exigences.join(', '),
    mutants: formaterMutants(f.survivants),
    code: `\`\`\`\n${code}\n\`\`\``,
  });
  const nom = f.fichier.replace(/[^\w.-]+/g, '_');
  const ids = f.survivants.map((m) => m.id);
  let r = await llm(ctx, 'survivants', prompt, `survivants-${nom}`, CONFIG.seuils.arbitreMinutes);
  let analyse = lireAnalyseSurvivants(r.texte, ids);
  if (analyse.erreurs.length > 0) {
    const rappel = `${prompt}\n\n---\n\nTa réponse précédente était hors format (${analyse.erreurs.join(' ')}). Réponds uniquement par le bloc YAML demandé.`;
    r = await llm(ctx, 'survivants', rappel, `survivants-${nom}-2`, CONFIG.seuils.arbitreMinutes);
    analyse = lireAnalyseSurvivants(r.texte, ids);
  }
  return { analyse, brut: r.texte };
}

// vus : survivants soumis à l'analyse, que run écrit dans survivants-vus.json une fois fin.md écrit. Un finish
// interrompu avant (review en erreur) ne doit pas les écarter du finish suivant : leurs tests proposés n'ont pas été vus.
async function mutation(ctx: Contexte, sans: boolean): Promise<{ statut: Fin['mutation']; ligne: string; section: string; testsProposes: number; vus?: string[] }> {
  if (sans) {
    journal(ctx, { type: 'mutation', sautee: true });
    return { statut: 'sautee', ligne: '- Mutation : ⚠️ sautée à la demande du développeur (--sans-mutation)', section: '', testsProposes: 0 };
  }
  const fichiers = fichiersDeLaBranche(ctx);
  if (fichiers.length === 0) {
    return { statut: 'aucun-fichier', ligne: '- Mutation : — aucun fichier de code changé par la branche', section: '', testsProposes: 0 };
  }
  const { resultats, incremental } = await lancerStryker(ctx, fichiers);
  const features = codeDesFeatures(ctx);
  const lignes = lignesModifiees(gitBrut(['-c', 'core.quotePath=false', 'diff', ctx.base, ctx.head, '-U0', '--no-renames', '--no-color', '--no-ext-diff'], ctx.racine));
  const fichierVus = join(ctx.dossier, 'survivants-vus.json');
  const vus = new Set<string>(existsSync(fichierVus) ? (JSON.parse(readFileSync(fichierVus, 'utf8')) as string[]) : []);
  const tries = resultats.map((f) => ({ f, ...trierSurvivants(f, lignes.get(f.fichier) ?? new Set(), vus) }));
  const { analyses, autres } = choisirAnalyses(
    tries.map(({ f, aAnalyser }) => ({ ...f, survivants: aAnalyser })),
    [...features.keys()],
    CONFIG.seuils.strykerFichiersAnalyses,
  );

  const total = resultats.reduce((s, f) => s + f.total, 0);
  const tues = resultats.reduce((s, f) => s + f.tues, 0);
  const score = total === 0 ? 100 : Math.round((tues / total) * 100);
  const parties = [
    '## Mutation testing',
    ['| Fichier | Mutants | Tués (dont Timeout) | Survivants | Score |', '|---|---|---|---|---|', ...resultats.map((f) => `| ${f.fichier} | ${f.total} | ${f.tues} (${f.timeouts}) | ${f.survivants.length} | ${f.score} % |`)].join('\n'),
  ];

  let testsProposes = 0;
  if (analyses.length > 0) parties.push('### Survivants analysés (code des tâches feature)');
  for (const f of analyses) {
    const { analyse, brut } = await analyser(ctx, f, features.get(f.fichier) ?? []);
    parties.push(`#### ${f.fichier}`, formaterMutants(f.survivants));
    if (analyse.erreurs.length > 0) {
      parties.push(`Réponse hors format (${analyse.erreurs.join(' ')}) :\n\n${brut}`);
      continue;
    }
    if (analyse.equivalents.length > 0) parties.push(`Équivalents selon l'analyse :\n${analyse.equivalents.map((e) => `- ${e.mutant} : ${e.raison}`).join('\n')}`);
    if (analyse.tests.length > 0) {
      testsProposes += analyse.tests.length;
      parties.push(`Tests proposés :\n\n\`\`\`yaml\n${stringify(analyse.tests).trimEnd()}\n\`\`\``);
    }
  }
  if (autres.length > 0) {
    parties.push('### Autres survivants (non analysés)', ...autres.map((f) => `#### ${f.fichier}\n${formaterMutants(f.survivants)}`));
  }
  const ecartes = (titre: string, cle: 'horsBranche' | 'dejaProposes') => {
    const avec = tries.filter((t) => t[cle].length > 0);
    if (avec.length > 0) parties.push(titre, ...avec.map((t) => `#### ${t.f.fichier}\n${formaterMutants(t[cle])}`));
  };
  ecartes('### Survivants hors des lignes changées par la branche (non analysés)', 'horsBranche');
  ecartes("### Survivants déjà soumis lors d'une fin précédente, test non retenu (non analysés)", 'dejaProposes');
  for (const f of analyses) for (const m of f.survivants) vus.add(cleMutant(f.fichier, m));
  journal(ctx, { type: 'mutation', score, fichiers: resultats.length, survivants: total - tues, analyses: analyses.length, testsProposes });
  return { statut: 'faite', ligne: `- Mutation : score ${score} % (${tues}/${total} mutants tués, ${resultats.length} fichier(s), Stryker ${incremental ? 'incrémental' : 'complet'})`, section: parties.join('\n\n'), testsProposes, vus: [...vus] };
}

// --- 4 : review neuve ---

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
  const r = await llm(ctx, 'review', prompt, 'review', CONFIG.seuils.reviewMinutes);
  const verdict = lireVerdictReview(r.texte);
  journal(ctx, { type: 'review', verdict: verdict ?? 'illisible' });
  return { verdict, texte: r.texte };
}

// --- Commande ---

export async function run(args: string[]): Promise<void> {
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
    ecrireFin(dossier, { date: new Date().toISOString(), head: ctx.head, ok: false, mutation: 'sautee', verdict: null });
    journal(ctx, { type: 'fin', ok: false });
    terminer({
      statut: 'ECHEC',
      commande: C,
      message: `Fin de branche bloquée :\n${bloquants.map((b) => `- ${b}`).join('\n')}\n\nLa correction passe par une nouvelle tâche : « wf state revenir plan --note "..." », amende le plan, puis check-plan, matrice, run-plan, finish.`,
      details: { bloquants },
    });
  }

  const sans = Boolean(lireArguments(args).options['sans-mutation']);
  const deja = lireMutationFaite(dossier);
  let m: MutationFaite;
  if (deja && mutationReutilisable(deja, ctx.head, sans)) {
    afficher('Mutation et analyse des survivants reprises du finish précédent, arrêté avant fin.md (même commit).');
    journal(ctx, { type: 'mutation', reprise: true });
    m = deja;
  } else {
    m = { head: ctx.head, sans, ...(await mutation(ctx, sans)) };
    ecrireMutationFaite(dossier, m);
  }
  const rv = await review(ctx);
  const journalBrut = existsSync(join(dossier, 'journal.jsonl')) ? readFileSync(join(dossier, 'journal.jsonl'), 'utf8') : '';
  const lignesJournal = journalBrut.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const suite =
    m.testsProposes > 0
      ? `L'analyse des survivants propose ${m.testsProposes} test(s). Pour les ajouter : une tâche feature (comportement_existant: true) au plan, via « wf state revenir plan », puis check-plan, matrice, run-plan et un nouveau finish.`
      : 'Aucun test proposé par l\'analyse des survivants.';

  const contenu = [
    entete,
    '## Contrôles',
    [...lignes, m.ligne, `- Review neuve : ${rv.verdict ?? 'verdict illisible (voir ci-dessous)'}`].join('\n'),
    m.section,
    `## Review neuve (${CONFIG.modeles.review.outil}, ${CONFIG.modeles.review.modele})`,
    rv.texte.trim(),
    '## Journal',
    resumerJournal(lignesJournal, Object.fromEntries(Object.entries(CONFIG.modeles).map(([role, m]) => [role, m.outil]))),
    '## Suite',
    suite,
  ].filter(Boolean);
  writeFileSync(join(dossier, 'fin.md'), `${contenu.join('\n\n')}\n`);
  if (m.vus) writeFileSync(join(dossier, 'survivants-vus.json'), `${JSON.stringify(m.vus, null, 2)}\n`);
  oublierMutationFaite(dossier);
  ecrireFin(dossier, { date: new Date().toISOString(), head: ctx.head, ok: true, mutation: m.statut, verdict: rv.verdict });
  journal(ctx, { type: 'fin', ok: true, mutation: m.statut, verdict: rv.verdict, testsProposes: m.testsProposes });

  terminer({
    statut: 'OK',
    commande: C,
    message: `Fin de branche prête : .workflow/fin.md (review : ${rv.verdict ?? 'illisible'} ; ${m.ligne.slice(2)} ; ${m.testsProposes} test(s) proposé(s)). Présente-la pour la revue finale.`,
    details: { verdict: rv.verdict, mutation: m.statut, testsProposes: m.testsProposes },
  });
}
