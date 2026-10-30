// wf verify --task <id> — script de vérification d'une tâche, lancé après l'exécuteur, avant le commit.
// Contrôle les changements de l'arbre de travail par rapport à HEAD : fichiers verrouillés, tests existants
// (AST), règles de code verrouillées sur les lignes modifiées, lint du projet, tests prévus présents et verts
// dans le reporter JSON (un échec est relancé une fois), puis, pour un fix, contrôle « rouge » :
// les tests de régression doivent échouer sur une assertion quand on les lance sur le code de HEAD.
// Code 0 accepté, 1 rejeté (rapport), 3 accepté avec signalements à faire trancher.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from '../../config/defaults.ts';
import { preparerArbreAncien, supprimerArbreAncien } from '../lib/arbre-ancien.ts';
import { lireArguments, texte } from '../lib/args.ts';
import { CODE_SOURCE, type Constat } from '../lib/constat.ts';
import { dossierWorkflow, racineDepot } from '../lib/depot.ts';
import { lireChangements } from '../lib/diff.ts';
import { lireEtat } from '../lib/etat.ts';
import { lirePlan } from '../lib/plan.ts';
import { terminer } from '../lib/result.ts';
import { jugerRouge, nouveauxTitres } from '../lib/rouge.ts';
import {
  binaireLocal,
  configEslintPresente,
  detecterRunner,
  filtrerEslint,
  lancerEslint,
  lancerTests,
  verifierTestsPrevus,
} from '../lib/runner.ts';
import { conditionsDeSortie } from '../lib/sortie.ts';
import { estFichierDeTestCode } from '../lib/trace.ts';
import { estFichierDeTest, verifierChangements } from '../lib/verification.ts';

const C = 'verify';

function ligneDeConstat(c: Constat): string {
  const ou = c.ligne ? `${c.fichier}:${c.ligne}` : c.fichier;
  return `- [${c.regle}] ${ou} — ${c.message.replace(/\n/g, '\n    ')}`;
}

export async function run(args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });

  const id = texte(lireArguments(args).options, 'task');
  if (!id) terminer({ statut: 'ECHEC', commande: C, message: '--task <id> est requis.' });

  const dossier = dossierWorkflow(racine);
  if (!lireEtat(dossier)) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });
  const planNonValide = conditionsDeSortie('plan', dossier);
  if (planNonValide.length > 0) terminer({ statut: 'ECHEC', commande: C, message: `Plan non validé : ${planNonValide.join(' ')}` });

  const plan = lirePlan(readFileSync(join(dossier, 'plan.md'), 'utf8')).plan;
  const tache = plan?.taches.find((t) => t.id === id);
  if (!tache) terminer({ statut: 'ECHEC', commande: C, message: `La tâche ${id} n'existe pas dans le plan.` });

  if (CONFIG.seuils.controleRougeFeature) {
    terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Le contrôle « rouge » des tâches feature (seuils.controleRougeFeature) n'est pas encore implémenté." });
  }

  // Un arbre ancien resté d'un passage interrompu fausserait le filtre de fichiers du runner.
  const arbre = join(dossier, 'rouge');
  if (existsSync(arbre)) supprimerArbreAncien(racine, arbre);

  const changements = lireChangements(racine);
  if (changements.length === 0) {
    terminer({ statut: 'ECHEC', commande: C, message: `Aucun changement par rapport à HEAD : la tâche ${id} n'a rien produit.` });
  }

  const constats = verifierChangements({ tache, changements, verrouilles: CONFIG.verrouilles, fichiersTest: CONFIG.fichiersTest });
  const notes: string[] = [];

  try {
    const aLinter = changements.filter((c) => CODE_SOURCE.test(c.chemin) && c.apres !== null);
    const eslint = binaireLocal(racine, 'eslint');
    if (aLinter.length > 0 && eslint && configEslintPresente(racine)) {
      const sortie = lancerEslint(racine, eslint, aLinter.map((c) => c.chemin));
      const lignes = new Map(aLinter.map((c) => [c.chemin, c.statut === 'ajoute' ? null : c.lignes]));
      constats.push(...filtrerEslint(sortie, racine, lignes));
    } else if (aLinter.length > 0) {
      notes.push("Lint du projet non lancé : eslint ou sa configuration est absent du projet. Les règles verrouillées s'appliquent quand même.");
    }

    if (tache.tests.length > 0) {
      const pkg = join(racine, 'package.json');
      const runner = existsSync(pkg) ? detecterRunner(JSON.parse(readFileSync(pkg, 'utf8'))) : null;
      if (!runner) {
        terminer({ statut: 'ERREUR_OUTIL', commande: C, message: 'Ni vitest ni jest dans les dépendances du projet : impossible de vérifier les tests prévus.' });
      }
      const binaire = binaireLocal(racine, runner);
      if (!binaire) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: `${runner} est déclaré mais absent de node_modules : lance l'installation du projet.` });

      const fichiers = tache.fichiers_prevus.filter(estFichierDeTestCode);
      const noms = tache.tests.map((t) => t.nom);
      const sortie = join(dossier, 'rapports', `${id}-tests.json`);
      let resultat = verifierTestsPrevus(noms, fichiers, lancerTests(racine, runner, binaire, fichiers, sortie));
      if (resultat.some((c) => c.regle === 'test-prevu-echec')) {
        // Un échec est relancé une fois ; un test qui passe à la relance est noté instable.
        const relance = verifierTestsPrevus(noms, fichiers, lancerTests(racine, runner, binaire, fichiers, sortie));
        const titre = (c: Constat) => c.message.split('\n')[0];
        const instables = resultat.filter((c) => c.regle === 'test-prevu-echec' && !relance.some((r) => titre(r) === titre(c)));
        for (const c of instables) {
          constats.push({ regle: 'test-instable', niveau: 'signale', fichier: c.fichier, message: `${c.message.split('\n')[0]} Passé à la relance.` });
        }
        resultat = relance;
      }
      constats.push(...resultat);

      if (tache.type === 'fix') {
        if (resultat.length > 0) {
          notes.push('Contrôle « rouge » non lancé : les tests prévus ne passent pas sur le nouveau code.');
        } else {
          const testsDeLaTache = changements.filter((c) => estFichierDeTest(c.chemin, CONFIG.fichiersTest)).map((c) => c.chemin);
          const nouveaux = changements
            .filter((c) => estFichierDeTestCode(c.chemin) && c.apres !== null)
            .flatMap((c) => nouveauxTitres(c.avant, c.apres ?? '', c.chemin));
          try {
            preparerArbreAncien(racine, arbre, testsDeLaTache);
            const ancien = lancerTests(arbre, runner, binaire, fichiers, join(dossier, 'rapports', `${id}-rouge.json`));
            constats.push(...jugerRouge(tache.tests, fichiers, ancien, nouveaux));
          } finally {
            supprimerArbreAncien(racine, arbre);
          }
        }
      }
    }
  } catch (e) {
    terminer({ statut: 'ERREUR_OUTIL', commande: C, message: e instanceof Error ? e.message : String(e) });
  }

  const bloquants = constats.filter((c) => c.niveau === 'bloquant');
  const signales = constats.filter((c) => c.niveau === 'signale');
  const rapport = { tache: id, date: new Date().toISOString(), bloquants, signales, notes };
  mkdirSync(join(dossier, 'rapports'), { recursive: true });
  writeFileSync(join(dossier, 'rapports', `${id}-verify.json`), `${JSON.stringify(rapport, null, 2)}\n`);

  const sections = [
    bloquants.length > 0 ? `Bloquant (${bloquants.length}) :\n${bloquants.map(ligneDeConstat).join('\n')}` : '',
    signales.length > 0 ? `Signalé (${signales.length}) :\n${signales.map(ligneDeConstat).join('\n')}` : '',
    notes.length > 0 ? `Notes :\n${notes.map((n) => `- ${n}`).join('\n')}` : '',
  ].filter(Boolean);
  const corps = sections.length > 0 ? `\n${sections.join('\n\n')}` : '';

  if (bloquants.length > 0) {
    terminer({ statut: 'ECHEC', commande: C, message: `Tâche ${id} rejetée.${corps}`, details: rapport });
  }
  if (signales.length > 0) {
    terminer({ statut: 'ATTENTE_UTILISATEUR', commande: C, message: `Tâche ${id} acceptée avec signalements à trancher.${corps}`, details: rapport });
  }
  terminer({ statut: 'OK', commande: C, message: `Tâche ${id} acceptée : ${changements.length} fichier(s) vérifié(s).${corps}`, details: rapport });
}
