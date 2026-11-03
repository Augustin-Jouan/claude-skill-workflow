// Configuration par défaut du workflow. Fichier du skill : ni Claude ni l'exécuteur ne le modifient.
// Les budgets sont des valeurs de départ, à recalibrer avec le journal après quelques branches.

import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG = {
  branche: { prefixe: 'wf/' },

  // L'arbitre et la review neuve utilisent un autre modèle que les audits,
  // pour ne pas cumuler les mêmes angles morts.
  // outil « cursor-agent » : CLI Cursor (agent / cursor-agent). Ids exacts : « agent --list-models ».
  modeles: {
    // Audit et exécuteur : modèle choisi selon la difficulté (scripts/lib/modeles.ts).
    // L'exécuteur suit le champ « difficulte » du plan ; l'audit, le parcours et la taille de la spec.
    // grok-4.7-high réfléchissait plus de 15 min sur une spec de 8 exigences : Grok 4.6 pour le complexe.
    audit: { outil: 'cursor-agent', simple: 'composer-2.5', complexe: 'cursor-grok-4.6-high' },
    executeur: { outil: 'cursor-agent', simple: 'composer-2.5', complexe: 'cursor-grok-4.6-high' },
    arbitre: { outil: 'claude', modele: 'opus' },
    review: { outil: 'claude', modele: 'opus' },
    bilan: { outil: 'claude', modele: 'opus' },
  },

  seuils: {
    couvertureRefactor: 0.8,
    suiteRapideSecondes: 120,
    rejetsAvantArbitre: 2,
    controleRougeFeature: false,
    // Au-delà, l'audit d'une spec (parcours complet) passe au modèle complexe.
    auditExigencesSimple: 4,
    auditMinutes: 30,
    arbitreMinutes: 10,
    reviewMinutes: 15,
    bilanMinutes: 10,
    // Plafond de sortie d'une requête Claude, réflexion comprise (réponses réelles : 17 500 jetons au plus). Au-delà,
    // la CLI relance le modèle et ne rend que la fin de la réponse. Sans plafond,
    // une réponse qui boucle (lignes vides à l'infini) court jusqu'à 128 000 jetons, environ 14 min.
    sortieClaudeJetons: 32_000,
  },

  // Direct de Cursor (lignes « ┊ ») sur la sortie de wf audit / run-plan / executer, pour le détail du shell.
  // Purement visuel : Claude filtre ces lignes avant de lire la sortie. .workflow/cursor.log est toujours écrit.
  directSurSortie: true,

  // Bilans de fin de branche (wf bilan), regroupés hors des dépôts pour les relire ensemble.
  retours: { dossier: join(homedir(), '.claude', 'workflow-retours') },

  budgets: {
    tacheMinutes: 30,
    branche: {
      micro: { minutes: 60, appelsLlm: 10 },
      court: { minutes: 180, appelsLlm: 30 },
      complet: { minutes: 480, appelsLlm: 80 },
    },
  },

  // Motifs à la manière de .gitignore : sans « / », ils visent le nom du fichier à toute profondeur ;
  // avec « / », ils partent de la racine du dépôt. Toute modification par l'exécuteur rejette la tâche.
  // Les fichiers de .workflow/ sont exclus de git : verify ne les voit pas. run-plan protège tout .workflow/
  // (sauf DEVIATIONS.md) et les fichiers du skill pendant l'exécuteur.
  verrouilles: [
    'tsconfig*.json',
    'eslint.config.*',
    '.eslintrc*',
    'vitest.config.*',
    'vitest.workspace.*',
    'jest.config.*',
    'package.json#scripts',
    '.github/**',
    '.gitlab-ci.yml',
    '.workflow/state.json',
    '.workflow/quarantine.json',
    '.workflow/journal.jsonl',
  ],

  // Tout ce qui compte comme fichier de test pour les règles de protection.
  fichiersTest: [
    '**/*.test.*',
    '**/*.spec.*',
    '**/__mocks__/**',
    '**/__snapshots__/**',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
  ],
} as const;
