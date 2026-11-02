// wf run-plan — orchestrateur des tâches (workflow-dev.md, section 4). Un script, pas un LLM.
// Pour chaque tâche, dans l'ordre des depends_on : couverture si refactor, exécuteur (Cursor), protection de
// .workflow/ et du skill, eslint --fix et formateur, verify, suite complète et typecheck comparés à leur état
// de départ, puis commit ; ou relance, arbitre (Claude), question au développeur. Budget et journal à chaque pas.
// Code 0 quand toutes les tâches sont committées ; 3 avec .workflow/question.md quand il faut le développeur.
// Reprend là où il s'était arrêté : l'état vit dans .workflow/run.json.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { CONFIG } from '../../config/defaults.ts';
import { preparerArbreAncien, supprimerArbreAncien } from '../lib/arbre-ancien.ts';
import { premierFautif } from '../lib/bisect.ts';
import { sujetDeCommit } from '../lib/commit.ts';
import { CODE_SOURCE } from '../lib/constat.ts';
import { dossierWorkflow, git, gitBrut, messageGit, racineDepot } from '../lib/depot.ts';
import { lireChangements, type Changement } from '../lib/diff.ts';
import { lireEtat, type Etat } from '../lib/etat.ts';
import { remplir } from '../lib/gabarit.ts';
import { correspond } from '../lib/glob.ts';
import { ajouterAuJournal } from '../lib/journal.ts';
import { appelerLlm } from '../lib/llm.ts';
import { modeleExecuteur } from '../lib/modeles.ts';
import { apresArbitre, apresVerdict, appliquerReponse, type Action, type MotifArbitre, type Verdict } from '../lib/orchestration.ts';
import { lirePlan, type Tache } from '../lib/plan.ts';
import { photographier, restaurer, type Zone } from '../lib/protection.ts';
import { ordreTaches } from '../lib/regles-plan.ts';
import { lireDecision, lireRemontee, type Decision } from '../lib/reponses-llm.ts';
import { localiser, terminer, type Resultat } from '../lib/result.ts';
import { depassement, echecsAdmis, ecrireRun, estJalon, lireRun, nouvelleTache, suiteLente, tempsRestantMs, type Attente, type EtatRun } from '../lib/run-etat.ts';
import { binaireLocal, corrigerFichiers, detecterRunner, lancerTests, type Runner } from '../lib/runner.ts';
import { conditionsDeSortie } from '../lib/sortie.ts';
import { sectionsExigences } from '../lib/spec.ts';
import { comparerSuite, consigneTypecheck, echecsSuite, lancerCouverture, lancerTsc, lireQuarantaine, nouvellesErreurs } from '../lib/suite.ts';
import { estFichierDeTest } from '../lib/verification.ts';

const C = 'run-plan';
const SKILL = fileURLToPath(new URL('../../', import.meta.url));
const PROMPTS = join(SKILL, 'prompts');
const WF = join(SKILL, 'scripts', 'wf.ts');

const LIBELLES_ARBITRE: Record<MotifArbitre, string> = {
  signalements: 'la vérification a produit des signalements.',
  rejets: `la tâche a été rejetée ${CONFIG.seuils.rejetsAvantArbitre} fois.`,
  remontee: "l'exécuteur a remonté un problème.",
};

function afficher(message: string): void {
  process.stdout.write(`· ${message}\n`);
}

// Chemin relatif au dépôt pour ce qui est dedans (.workflow/…), absolu pour les fichiers du skill.
function cheminLisible(racine: string, fichier: string): string {
  const r = relative(racine, fichier);
  return r.startsWith('..') || isAbsolute(r) ? fichier : r.replaceAll('\\', '/');
}

function empreinte(fichier: string): string {
  return createHash('sha256').update(readFileSync(fichier)).digest('hex');
}

interface Contexte {
  racine: string;
  dossier: string;
  etat: Etat;
  plan: Tache[];
  ordre: string[];
  jalons: string[];
  spec: string;
  empreintePlan: string;
  run: EtatRun;
  runner: Runner;
  binaire: string;
  quarantaine: string[];
}

function sauver(ctx: Contexte): void {
  ecrireRun(ctx.dossier, ctx.run);
}

function arreter(ctx: Contexte, r: Resultat): never {
  sauver(ctx);
  terminer(r);
}

function journal(ctx: Contexte, ligne: Record<string, unknown>): void {
  ajouterAuJournal(ctx.dossier, ctx.etat, ligne);
}

function poser(ctx: Contexte, a: Omit<Attente, 'plan' | 'reponse'>): never {
  ctx.run.attente = { ...a, plan: ctx.empreintePlan, reponse: null };
  const texte = [
    '# Question de run-plan',
    '',
    `- Tâche : ${a.tache ?? '(branche)'}`,
    `- Motif : ${a.motif}`,
    '',
    a.question,
    '',
    '---',
    'Réponds avec « wf answer "<réponse>" », puis relance « wf run-plan ».',
    'Pour une replanification : amende le plan, consigne la raison dans .workflow/DEVIATIONS.md, « wf check-plan », puis relance « wf run-plan » (la question tombe d\'elle-même).',
  ].join('\n');
  writeFileSync(join(ctx.dossier, 'question.md'), `${texte}\n`);
  journal(ctx, { type: 'question', tache: a.tache, motif: a.motif });
  arreter(ctx, { statut: 'ATTENTE_UTILISATEUR', commande: C, message: `Question en attente (.workflow/question.md) :\n\n${a.question}`, details: ctx.run.attente });
}

// Temps passé dans un pas de la tâche, compté pour son budget et celui de la branche.
function compter(ctx: Contexte, id: string, debut: number): void {
  const ms = Date.now() - debut;
  ctx.run.dureeMs += ms;
  ctx.run.taches[id].dureeMs += ms;
}

// --- Reprise, verrou et état de départ ---

function verrouiller(dossier: string): void {
  const verrou = join(dossier, 'run.lock');
  if (existsSync(verrou)) {
    const pid = Number(readFileSync(verrou, 'utf8'));
    let vivant = false;
    try {
      process.kill(pid, 0);
      vivant = pid !== process.pid;
    } catch {
      vivant = false;
    }
    if (vivant) terminer({ statut: 'ECHEC', commande: C, message: `run-plan tourne déjà dans ce dépôt (processus ${pid}).` });
  }
  writeFileSync(verrou, String(process.pid));
  process.on('exit', () => rmSync(verrou, { force: true }));
}

function reprendre(ctx: Contexte): void {
  const a = ctx.run.attente;
  if (!a) return;
  if (a.plan !== ctx.empreintePlan) {
    afficher('Le plan a changé depuis la question : elle est caduque, la tâche reprend de zéro.');
    const ancienne = a.tache ? ctx.run.taches[a.tache] : undefined;
    // Compteurs de décision remis à zéro ; tentatives, temps et appels déjà consommés restent (fichiers llm/ et budget).
    if (a.tache && ancienne) ctx.run.taches[a.tache] = { ...nouvelleTache(), tentatives: ancienne.tentatives, dureeMs: ancienne.dureeMs, appelsLlm: ancienne.appelsLlm };
    // Un jalon rouge replanifié n'est pas revérifié : la tâche corrective est suivie d'un nouveau jalon.
    if (a.motif === 'jalon' && a.tache) ctx.run.jalonsVerifies.push(a.tache);
    journal(ctx, { type: 'replanification', tache: a.tache, motif: a.motif });
    ctx.run.attente = null;
    return;
  }
  if (a.reponse === null) {
    arreter(ctx, { statut: 'ATTENTE_UTILISATEUR', commande: C, message: `Question toujours en attente (.workflow/question.md) :\n\n${a.question}`, details: a });
  }
  if (a.motif === 'budget-branche') ctx.run.rallonges++;
  if (a.motif === 'jalon' && a.tache) {
    ctx.run.jalonsVerifies.push(a.tache);
    ctx.run.echecsAcceptes.push(...(a.echecs ?? []));
    ctx.run.dernierJalonVert = git(['rev-parse', 'HEAD'], ctx.racine);
  } else if (a.tache && ctx.run.taches[a.tache]) {
    ctx.run.taches[a.tache] = appliquerReponse(ctx.run.taches[a.tache], a.motif, a.reponse);
  }
  journal(ctx, { type: 'regle-tranchee', tache: a.tache, motif: a.motif, issue: 'tranche-developpeur' });
  ctx.run.attente = null;
}

// Sans fichiers : suite complète. Avec des fichiers de code : seulement les tests qui en dépendent.
function lancerSuite(ctx: Contexte, nom: string, lies: string[] = []): { echecs: string[]; instables: string[]; ms: number } {
  const debut = Date.now();
  const sortie = join(ctx.dossier, 'rapports', `${nom}-suite.json`);
  const lancer = () => echecsSuite(lancerTests(ctx.racine, ctx.runner, ctx.binaire, lies, sortie, lies.length > 0));
  let echecs = lancer();
  let instables: string[] = [];
  if (echecs.length > 0) {
    // Un échec est relancé une fois avant de compter (workflow-dev.md, 4.5).
    const relance = lancer();
    instables = echecs.filter((e) => !relance.includes(e));
    echecs = relance;
  }
  return { echecs, instables, ms: Date.now() - debut };
}

function etablirReference(ctx: Contexte): void {
  if (ctx.run.reference) return;
  afficher('État de départ : suite complète et typecheck sur HEAD…');
  const suite = lancerSuite(ctx, 'reference');
  const tsc = lancerTsc(ctx.racine) ?? [];
  ctx.run.reference = { echecs: suite.echecs, tsc, suiteMs: suite.ms, commit: git(['rev-parse', 'HEAD'], ctx.racine) };
  journal(ctx, { type: 'reference', echecs: suite.echecs.length, tsc: tsc.length, suiteMs: suite.ms });
  if (suiteLente(ctx.run.reference, CONFIG.seuils.suiteRapideSecondes)) {
    afficher(`La suite prend ${Math.round(suite.ms / 1000)} s : après chaque tâche, seuls les tests liés tournent ; la suite complète tourne aux jalons.`);
  }
  sauver(ctx);
}

// --- Une tentative ---

function zonesProtegees(dossier: string): Zone[] {
  return [
    { dossier, exclus: ['DEVIATIONS.md', 'llm', 'rouge', 'bisect', 'run.lock', 'cursor.log'] },
    { dossier: SKILL, exclus: ['node_modules'] },
  ];
}

// localiser : le prompt nomme .workflow/DEVIATIONS.md, qui vit dans le dossier de la branche.
function promptExecuteur(ctx: Contexte, t: Tache, consigne: string | null): string {
  return localiser(
    remplir(readFileSync(join(PROMPTS, 'executeur.md'), 'utf8'), {
      id: t.id,
      tache_yaml: stringify([t]).trimEnd(),
      exigences: sectionsExigences(ctx.spec, t.exigences) || t.exigences.join(', '),
      rapport_rejet: consigne ?? 'Aucun : première tentative.',
      fichiers_verrouilles: CONFIG.verrouilles.map((v) => `\`${v}\``).join(', '),
      typecheck: consigneTypecheck(ctx.racine),
    }),
    relative(ctx.racine, ctx.dossier).replaceAll('\\', '/'),
  );
}

function protege(c: Changement, t: Tache): boolean {
  const testExistant = estFichierDeTest(c.chemin, CONFIG.fichiersTest) && c.statut !== 'ajoute' && !t.tests_modifiables.some((m) => m.fichier === c.chemin);
  const verrouille = CONFIG.verrouilles.some((v) => correspond(c.chemin, v.split('#')[0]));
  return testExistant || verrouille;
}

function lancerVerify(ctx: Contexte, id: string): { code: number; message: string } {
  const r = spawnSync(process.execPath, [WF, 'verify', '--task', id], { cwd: ctx.racine, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const ligne = (r.stdout ?? '').trim().split(/\r?\n/).reverse().find((l) => l.startsWith('WF_RESULT '));
  if (!ligne) arreter(ctx, { statut: 'ERREUR_OUTIL', commande: C, message: `verify n'a pas rendu de verdict (code ${r.status}).\n${(r.stderr ?? '').slice(-2000)}` });
  const resultat = JSON.parse(ligne.slice('WF_RESULT '.length)) as Resultat & { details?: { bloquants?: unknown[]; signales?: unknown[] } };
  const details = resultat.details ?? {};
  for (const [niveau, liste] of [['bloquant', details.bloquants], ['signale', details.signales]] as const) {
    for (const c of (liste ?? []) as Array<{ regle: string; fichier: string }>) journal(ctx, { type: 'regle', tache: id, regle: c.regle, niveau, fichier: c.fichier });
  }
  return { code: r.status ?? 2, message: resultat.message };
}

async function tentative(ctx: Contexte, t: Tache): Promise<Verdict> {
  const id = t.id;
  const et = ctx.run.taches[id];
  et.tentatives++;
  const numero = et.tentatives;
  const { modele, raison } = modeleExecuteur(t.difficulte, et.rejets);
  afficher(`${id} : tentative ${numero} de l'exécuteur (${modele}, ${raison}). Suivi en direct : « wf suivre ».`);

  const zones = zonesProtegees(ctx.dossier);
  const photo = photographier(zones);
  const headAvant = git(['rev-parse', 'HEAD'], ctx.racine);
  const debut = Date.now();
  let reponse;
  try {
    reponse = await appelerLlm({
      outil: CONFIG.modeles.executeur.outil,
      modele,
      mode: 'agent',
      racine: ctx.racine,
      prompt: promptExecuteur(ctx, t, et.consigne),
      fichierPrompt: join(ctx.dossier, 'llm', `${id}-${numero}-executeur.md`),
      suivi: { fichier: join(ctx.dossier, 'cursor.log'), titre: `${id} tentative ${numero} · ${modele} (${raison})` },
      timeoutMs: Math.max(60_000, tempsRestantMs(ctx.run, id, ctx.etat.parcours, CONFIG.budgets)),
    });
  } catch (e) {
    // La tentative est déjà comptée : le journal doit dire pourquoi elle n'a rien donné.
    const message = e instanceof Error ? e.message : String(e);
    journal(ctx, { type: 'llm', role: 'executeur', modele, raison, tache: id, tentative: numero, dureeMs: Date.now() - debut, tokens: null, erreur: message });
    arreter(ctx, { statut: 'ERREUR_OUTIL', commande: C, message });
  }
  const modifies = restaurer(photo, zones);
  compter(ctx, id, debut);
  ctx.run.appelsLlm++;
  et.appelsLlm++;
  journal(ctx, { type: 'llm', role: 'executeur', modele, raison, tache: id, tentative: numero, dureeMs: reponse.dureeMs, tokens: reponse.tokens, erreur: reponse.erreur || null });

  const bloquants: string[] = modifies.map(
    (f) => `- [fichier-workflow-modifie] ${cheminLisible(ctx.racine, f)} — fichier du workflow ou du skill modifié par l'exécuteur : remis en place.`,
  );
  const headApres = git(['rev-parse', 'HEAD'], ctx.racine);
  if (headApres !== headAvant) {
    git(['reset', '--soft', headAvant], ctx.racine);
    bloquants.push("- [commit-executeur] L'exécuteur a commité : commit annulé (ses changements restent dans l'arbre de travail). Ne commite jamais.");
  }
  if (git(['symbolic-ref', '--short', 'HEAD'], ctx.racine) !== ctx.etat.branche) {
    arreter(ctx, { statut: 'ERREUR_OUTIL', commande: C, message: `L'exécuteur a changé de branche : reviens sur ${ctx.etat.branche} avant de relancer.` });
  }
  for (const b of bloquants) journal(ctx, { type: 'regle', tache: id, regle: /\[(.+?)\]/.exec(b)?.[1], niveau: 'bloquant' });

  if (reponse.depasse) {
    const d = depassement(ctx.run, id, ctx.etat.parcours, CONFIG.budgets);
    poser(ctx, { tache: id, motif: d?.motif ?? 'budget-tache', question: `${reponse.erreur} ${d?.message ?? ''} Continuer (rallonge), simplifier la tâche ou la découper ?` });
  }
  if (reponse.erreur) arreter(ctx, { statut: 'ERREUR_OUTIL', commande: C, message: `Exécuteur en erreur sur ${id} : ${reponse.erreur} (détail dans .workflow/llm/).` });

  const remontee = lireRemontee(reponse.texte);
  if (remontee && bloquants.length === 0) {
    journal(ctx, { type: 'remontee', tache: id, remontee: remontee.type });
    return { type: 'remontee', remontee };
  }

  const debutControles = Date.now();
  const aCorriger = lireChangements(ctx.racine).filter((c) => c.apres !== null && !protege(c, t)).map((c) => c.chemin);
  const outils = corrigerFichiers(ctx.racine, aCorriger);
  if (outils.length > 0) afficher(`${id} : ${outils.join(', ')} sur ${aCorriger.length} fichier(s).`);

  afficher(`${id} : vérification…`);
  const verify = lancerVerify(ctx, id);
  if (verify.code === 2) arreter(ctx, { statut: 'ERREUR_OUTIL', commande: C, message: `verify en erreur sur ${id} : ${verify.message}` });

  const rapport =
    bloquants.length > 0
      ? `Tâche ${id} rejetée.\nBloquant (${bloquants.length}) :\n${bloquants.join('\n')}\n\nVérification des fichiers (wf verify) :\n${verify.message}`
      : verify.message;
  let verdict: Verdict;
  if (bloquants.length > 0 || verify.code === 1) {
    verdict = { type: 'rejete', rapport };
  } else {
    // Suite lente : seulement les tests liés au code changé (les tests de la tâche sont déjà passés dans verify).
    const lente = suiteLente(ctx.run.reference, CONFIG.seuils.suiteRapideSecondes);
    const lies = lireChangements(ctx.racine)
      .filter((c) => c.apres !== null && CODE_SOURCE.test(c.chemin) && !estFichierDeTest(c.chemin, CONFIG.fichiersTest))
      .map((c) => c.chemin);
    afficher(`${id} : ${lente ? `tests liés à ${lies.length} fichier(s) de code` : 'suite complète'} et typecheck…`);
    const suite = lente && lies.length === 0 ? { echecs: [], instables: [], ms: 0 } : lancerSuite(ctx, id, lente ? lies : []);
    for (const i of suite.instables) journal(ctx, { type: 'instable', tache: id, test: i });
    const reference = ctx.run.reference ?? { echecs: [], tsc: [], suiteMs: 0 };
    const { regressions, enQuarantaine } = comparerSuite(echecsAdmis(ctx.run), suite.echecs, ctx.quarantaine);
    const tsc = nouvellesErreurs(reference.tsc, lancerTsc(ctx.racine) ?? []);
    for (const r of regressions) journal(ctx, { type: 'regle', tache: id, regle: 'suite-regression', niveau: 'bloquant', fichier: r.split(' › ')[0] });
    for (const e of tsc) journal(ctx, { type: 'regle', tache: id, regle: 'typecheck', niveau: 'bloquant', fichier: e.split(': ')[0] });
    if (enQuarantaine.length > 0) afficher(`${id} : en quarantaine (non bloquant) : ${enQuarantaine.join(', ')}.`);
    if (regressions.length > 0 || tsc.length > 0) {
      const lignes = [...regressions.map((r) => `- [suite-regression] ${r} — échoue (confirmé à la relance), passait avant la branche.`), ...tsc.map((e) => `- [typecheck] ${e}`)];
      verdict = {
        type: 'rejete',
        rapport: `Tâche ${id} rejetée.\nBloquant (${lignes.length}, suite complète et typecheck) :\n${lignes.join('\n')}\n\nVérification des fichiers (wf verify) :\n${verify.message}`,
      };
    } else {
      verdict = verify.code === 3 ? { type: 'signale', rapport } : { type: 'accepte' };
    }
  }
  compter(ctx, id, debutControles);
  sauver(ctx);
  return verdict;
}

// --- Arbitre ---

function extraitsDiff(ctx: Contexte, rapport: string): string {
  const changements = lireChangements(ctx.racine);
  const cites = changements.filter((c) => rapport.includes(c.chemin));
  if (cites.length === 0) return `Aucun fichier cité. Fichiers changés : ${changements.map((c) => c.chemin).join(', ') || 'aucun'}.`;
  return cites
    .map((c) => {
      const texte =
        c.statut === 'ajoute'
          ? (c.apres ?? '').split('\n').map((l) => `+${l}`).join('\n')
          : gitBrut(['-c', 'core.quotePath=false', 'diff', 'HEAD', '-U3', '--', c.chemin], ctx.racine);
      const lignes = texte.split('\n');
      const tronque = lignes.length > 150 ? `${lignes.slice(0, 150).join('\n')}\n… (${lignes.length - 150} lignes coupées)` : texte;
      return `### ${c.chemin} (${c.statut})\n\n\`\`\`diff\n${tronque}\n\`\`\``;
    })
    .join('\n\n');
}

async function arbitrer(ctx: Contexte, t: Tache, motif: MotifArbitre, rapport: string): Promise<Decision | null> {
  afficher(`${t.id} : arbitre (${motif})…`);
  // La consigne de la tentative porte les réponses du développeur : l'arbitre ne doit pas reposer sa question.
  const consigne = ctx.run.taches[t.id].consigne;
  const prompt = remplir(readFileSync(join(PROMPTS, 'arbitre.md'), 'utf8'), {
    id: t.id,
    motif: LIBELLES_ARBITRE[motif],
    tache_yaml: stringify([t]).trimEnd(),
    rapport: consigne ? `${rapport}\n\nConsigne donnée à l'exécuteur pour cette tentative :\n${consigne}` : rapport,
    extraits_diff: extraitsDiff(ctx, rapport),
  });
  const debut = Date.now();
  let r;
  try {
    r = await appelerLlm({
      outil: CONFIG.modeles.arbitre.outil,
      modele: CONFIG.modeles.arbitre.modele,
      mode: 'ask',
      racine: ctx.racine,
      prompt,
      fichierPrompt: join(ctx.dossier, 'llm', `${t.id}-${ctx.run.taches[t.id].tentatives}-arbitre-${motif}.md`),
      timeoutMs: CONFIG.seuils.arbitreMinutes * 60_000,
      // Sans outil, l'arbitre qui veut lire un test cité par la remontée tourne à vide jusqu'au plafond de sortie.
      lecture: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    journal(ctx, { type: 'llm', role: 'arbitre', tache: t.id, motif, dureeMs: Date.now() - debut, tokens: null, erreur: message });
    arreter(ctx, { statut: 'ERREUR_OUTIL', commande: C, message });
  }
  compter(ctx, t.id, debut);
  ctx.run.appelsLlm++;
  ctx.run.taches[t.id].appelsLlm++;
  journal(ctx, { type: 'llm', role: 'arbitre', tache: t.id, motif, dureeMs: r.dureeMs, tokens: r.tokens, erreur: r.erreur || null });
  if (r.erreur) arreter(ctx, { statut: 'ERREUR_OUTIL', commande: C, message: `Arbitre en erreur sur ${t.id} : ${r.erreur} (détail dans .workflow/llm/).` });
  const decision = lireDecision(r.texte);
  journal(ctx, { type: 'arbitrage', tache: t.id, motif, decision: decision?.decision ?? 'illisible' });
  return decision;
}

// --- Couverture des refactor et commit ---

function verifierCouverture(ctx: Contexte, t: Tache): void {
  const fichiers = t.fichiers_prevus.filter((f) => CODE_SOURCE.test(f) && !estFichierDeTest(f, CONFIG.fichiersTest) && existsSync(join(ctx.racine, f)));
  if (fichiers.length > 0) {
    afficher(`${t.id} : couverture des fichiers à refactorer…`);
    const couverture = lancerCouverture(ctx.racine, ctx.runner, ctx.binaire, fichiers, join(ctx.dossier, 'rapports', `${t.id}-couverture`));
    const seuil = CONFIG.seuils.couvertureRefactor * 100;
    if (!couverture) {
      poser(ctx, { tache: t.id, motif: 'couverture', question: `Impossible de mesurer la couverture de ${t.id} (refactor) : le projet n'a pas de fournisseur de couverture pour ${ctx.runner}. Réponds pour continuer sans cette mesure, ou ajoute le fournisseur au projet.` });
    }
    const sous = couverture.filter((c) => c.pct < seuil);
    if (sous.length > 0) {
      const liste = sous.map((c) => `- ${c.fichier} : ${c.pct} %`).join('\n');
      poser(ctx, {
        tache: t.id,
        motif: 'couverture',
        question: `Couverture sous ${seuil} % pour ${t.id} (refactor) :\n${liste}\n\nAjoute d'abord une tâche feature de tests de caractérisation (comportement_existant: true) dont ${t.id} dépend (replanification), ou réponds pour continuer quand même.`,
      });
    }
  }
  ctx.run.taches[t.id].couvertureVerifiee = true;
  sauver(ctx);
}

function commiter(ctx: Contexte, t: Tache): string | null {
  const sujet = sujetDeCommit(t, readFileSync(join(ctx.dossier, 'plan.md'), 'utf8'), ctx.spec, CONFIG.fichiersTest);
  try {
    git(['add', '-A'], ctx.racine);
    execFileSync('git', ['commit', '-q', '-m', sujet, '-m', `${t.id} — ${t.exigences.join(', ')}`], { cwd: ctx.racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return null;
  } catch (e) {
    git(['reset', '-q'], ctx.racine);
    return messageGit(e);
  }
}

// --- Jalons et bisect (suite lente seulement) ---

// Suite complète au jalon. Une régression confirmée est attribuée par bisect au premier commit fautif
// depuis le dernier jalon vert ; les commits restent acquis, la correction passe par une nouvelle tâche.
async function verifierJalon(ctx: Contexte, id: string): Promise<void> {
  afficher(`Jalon ${id} : suite complète…`);
  const debut = Date.now();
  const suite = lancerSuite(ctx, `jalon-${id}`);
  for (const i of suite.instables) journal(ctx, { type: 'instable', tache: id, test: i });
  const { regressions } = comparerSuite(echecsAdmis(ctx.run), suite.echecs, ctx.quarantaine);
  const head = git(['rev-parse', 'HEAD'], ctx.racine);
  if (regressions.length === 0) {
    ctx.run.jalonsVerifies.push(id);
    ctx.run.dernierJalonVert = head;
    ctx.run.dureeMs += Date.now() - debut;
    journal(ctx, { type: 'jalon', tache: id, ok: true });
    sauver(ctx);
    afficher(`Jalon ${id} : vert.`);
    return;
  }
  const base = ctx.run.dernierJalonVert ?? ctx.run.reference?.commit ?? '';
  const commits = git(['rev-list', '--reverse', `${base}..${head}`], ctx.racine).split(/\r?\n/).filter(Boolean);
  afficher(`Jalon ${id} : ${regressions.length} régression(s), bisect sur ${commits.length} commit(s)…`);
  const fautif = await bisect(ctx, commits, regressions);
  ctx.run.dureeMs += Date.now() - debut;
  const tache = Object.entries(ctx.run.taches).find(([, e]) => e.commit === fautif)?.[0];
  const nom = tache ? `${tache} (${fautif.slice(0, 8)})` : fautif.slice(0, 8);
  journal(ctx, { type: 'jalon', tache: id, ok: false, regressions: regressions.length, fautif: tache ?? fautif.slice(0, 8) });
  poser(ctx, {
    tache: id,
    motif: 'jalon',
    echecs: regressions,
    question: `La suite complète échoue au jalon ${id} (échecs confirmés à la relance, absents au départ) :\n${regressions.map((r) => `- ${r}`).join('\n')}\n\nPremier commit fautif (bisect) : ${nom}.\nLes tâches committées restent acquises : ajoute une tâche corrective au plan (replanification, raison dans DEVIATIONS.md, « wf check-plan »), ou réponds pour continuer quand même.`,
  });
}

// Sonde dans un worktree détaché de .workflow/bisect : seuls les fichiers des tests en régression sont lancés.
async function bisect(ctx: Contexte, commits: string[], regressions: string[]): Promise<string> {
  const arbre = join(ctx.dossier, 'bisect');
  const fichiers = [...new Set(regressions.map((r) => r.split(' › ')[0]))];
  preparerArbreAncien(ctx.racine, arbre, []);
  try {
    return await premierFautif(commits, async (commit) => {
      git(['checkout', '-q', '--detach', commit], arbre);
      const presents = fichiers.filter((f) => existsSync(join(arbre, f)));
      if (presents.length === 0) return false;
      const sortie = join(ctx.dossier, 'rapports', `bisect-${commit.slice(0, 8)}.json`);
      const echoue = () => {
        try {
          return echecsSuite(lancerTests(arbre, ctx.runner, ctx.binaire, presents, sortie)).some((e) => regressions.includes(e));
        } catch {
          return true;
        }
      };
      // Un échec n'est retenu que confirmé à la relance, comme partout ailleurs.
      return echoue() && echoue();
    });
  } finally {
    supprimerArbreAncien(ctx.racine, arbre);
  }
}

// --- Boucle principale ---

async function executerTache(ctx: Contexte, t: Tache): Promise<void> {
  const seuil = CONFIG.seuils.rejetsAvantArbitre;
  ctx.run.taches[t.id] ??= nouvelleTache();
  ctx.run.enCours = t.id;
  sauver(ctx);
  if (t.type === 'refactor' && !ctx.run.taches[t.id].couvertureVerifiee) verifierCouverture(ctx, t);

  for (;;) {
    const d = depassement(ctx.run, t.id, ctx.etat.parcours, CONFIG.budgets);
    if (d) poser(ctx, { tache: t.id, motif: d.motif, question: `${d.message} Continuer (rallonge), simplifier la tâche ou la découper ?` });

    const verdict = await tentative(ctx, t);
    let suite = apresVerdict(ctx.run.taches[t.id], verdict, seuil);
    let action: Action | null = null;
    while (action === null) {
      ctx.run.taches[t.id] = suite.tache;
      sauver(ctx);
      const a = suite.action;
      if (a.type === 'arbitre') {
        const decision = await arbitrer(ctx, t, a.motif, a.rapport);
        suite = apresArbitre(ctx.run.taches[t.id], a.motif, a.rapport, decision, seuil);
      } else if (a.type === 'question') {
        poser(ctx, { tache: t.id, motif: a.motif, question: a.question });
      } else {
        action = a;
      }
    }

    if (action.type === 'relancer') {
      ctx.run.taches[t.id].consigne = action.consigne;
      afficher(`${t.id} : rejetée, relance avec le rapport.`);
      continue;
    }
    const erreur = commiter(ctx, t);
    if (erreur) {
      poser(ctx, { tache: t.id, motif: 'commit', question: `${t.id} est acceptée, mais le commit a échoué (hook du projet ?) :\n\n${erreur}\n\nRéponds avec la consigne à donner à l'exécuteur, ou corrige la cause puis réponds « réessayer ».` });
    }
    const et = ctx.run.taches[t.id];
    et.statut = 'commitee';
    et.commit = git(['rev-parse', 'HEAD'], ctx.racine);
    et.consigne = null;
    ctx.run.enCours = null;
    journal(ctx, { type: 'tache', tache: t.id, statut: 'commitee', commit: et.commit, tentatives: et.tentatives, rejets: et.rejets, appelsLlm: et.appelsLlm, dureeMs: et.dureeMs });
    sauver(ctx);
    afficher(`${t.id} : committée (${et.commit.slice(0, 8)}).`);
    return;
  }
}

export async function run(_args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });
  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });
  if (etat.etape !== 'execution') terminer({ statut: 'ECHEC', commande: C, message: `run-plan se lance à l'étape execution ; étape en cours : ${etat.etape}.` });
  const planNonValide = conditionsDeSortie('plan', dossier);
  if (planNonValide.length > 0) terminer({ statut: 'ECHEC', commande: C, message: `Plan non validé : ${planNonValide.join(' ')}` });
  if (git(['symbolic-ref', '--short', 'HEAD'], racine) !== etat.branche) {
    terminer({ statut: 'ECHEC', commande: C, message: `run-plan travaille sur la branche ${etat.branche} : bascule dessus d'abord.` });
  }

  const lu = lirePlan(readFileSync(join(dossier, 'plan.md'), 'utf8')).plan;
  const plan = lu?.taches ?? [];
  const ordre = ordreTaches(plan) ?? [];
  const pkg = join(racine, 'package.json');
  const runner = existsSync(pkg) ? detecterRunner(JSON.parse(readFileSync(pkg, 'utf8'))) : null;
  if (!runner) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: 'Ni vitest ni jest dans les dépendances du projet : run-plan ne peut pas vérifier les tâches.' });
  const binaire = binaireLocal(racine, runner);
  if (!binaire) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `${runner} est déclaré mais absent de node_modules : lance l'installation du projet.` });

  verrouiller(dossier);
  const fichierQuarantaine = join(dossier, 'quarantine.json');
  let quarantaine: string[] = [];
  try {
    quarantaine = existsSync(fichierQuarantaine) ? lireQuarantaine(readFileSync(fichierQuarantaine, 'utf8')) : [];
  } catch (e) {
    terminer({ statut: 'ECHEC', commande: C, message: e instanceof Error ? e.message : String(e) });
  }

  const ctx: Contexte = {
    racine,
    dossier,
    etat,
    plan,
    ordre,
    jalons: lu?.entete.jalons ?? [],
    spec: readFileSync(join(dossier, 'spec.md'), 'utf8'),
    empreintePlan: empreinte(join(dossier, 'plan.md')),
    run: lireRun(dossier),
    runner,
    binaire,
    quarantaine,
  };
  reprendre(ctx);

  // Des changements non commités n'appartiennent qu'à la tâche en cours.
  const sale = lireChangements(racine).length > 0;
  const enCours = ctx.run.enCours;
  if (sale && (!enCours || !plan.some((t) => t.id === enCours) || ctx.run.taches[enCours]?.statut === 'commitee')) {
    arreter(ctx, {
      statut: 'ECHEC',
      commande: C,
      message: `L'arbre de travail a des changements non commités qui n'appartiennent à aucune tâche en cours${enCours ? ` (${enCours} n'est plus à faire)` : ''} : commite-les, mets-les de côté (git stash) ou jette-les, puis relance.`,
    });
  }
  if (!sale) etablirReference(ctx);

  try {
    const lente = suiteLente(ctx.run.reference, CONFIG.seuils.suiteRapideSecondes);
    for (const id of ordre) {
      const t = plan.find((x) => x.id === id);
      if (t && ctx.run.taches[id]?.statut !== 'commitee') await executerTache(ctx, t);
      if (lente && estJalon(id, ctx.jalons, ordre) && !ctx.run.jalonsVerifies.includes(id)) await verifierJalon(ctx, id);
    }
  } catch (e) {
    arreter(ctx, { statut: 'ERREUR_OUTIL', commande: C, message: `Erreur interne : ${e instanceof Error ? e.message : String(e)}` });
  }

  ctx.run.enCours = null;
  const commits = ordre.map((id) => `${id} ${ctx.run.taches[id]?.commit?.slice(0, 8) ?? '?'}`).join(', ');
  arreter(ctx, {
    statut: 'OK',
    commande: C,
    message: `Toutes les tâches sont committées (${commits}). ${ctx.run.appelsLlm} appel(s) LLM, ${Math.round(ctx.run.dureeMs / 60_000)} min. Lance « wf state avancer ».`,
    details: { taches: ctx.run.taches, appelsLlm: ctx.run.appelsLlm, dureeMs: ctx.run.dureeMs },
  });
}
