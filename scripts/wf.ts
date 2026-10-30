// Point d'entrée unique : node scripts/wf.ts <commande> [options]
// Chaque commande se termine par terminer() ; le code de sortie est le seul verdict (voir lib/result.ts).

import { terminer } from './lib/result.ts';

const COMMANDES: Record<string, string> = {
  setup: 'Prépare la branche et le dossier .workflow/ du dépôt',
  state: "Affiche l'étape en cours, la fait avancer ou revenir",
  journal: "Ajoute une ligne au journal (tri d'audit, phase manuelle)",
  audit: 'Lance un audit Cursor de la spec et/ou du plan',
  'check-plan': 'Valide le plan YAML et génère la matrice de traçabilité',
  'run-plan': 'Exécute les tâches du plan (orchestrateur)',
  answer: 'Enregistre la réponse à une question de run-plan',
  verify: "Script de vérification d'une tâche",
  trace: 'Contrôle que chaque EX-n apparaît dans un nom de test',
  finish: 'Contrôles de fin de branche',
  executer: "Enchaîne run-plan, le passage à l'étape fin et finish ; s'arrête aux décisions du développeur",
  suivre: 'Affiche en direct ce que fait Cursor (à lancer dans un autre terminal)',
  bilan: "Propose des améliorations du workflow, d'après ce que la branche a rencontré",
};

const [nom, ...args] = process.argv.slice(2);

if (!nom || nom === 'help' || nom === '--help') {
  const lignes = Object.entries(COMMANDES).map(([c, r]) => `  ${c.padEnd(11)} ${r}`);
  process.stdout.write(`Usage : node scripts/wf.ts <commande> [options]\n\n${lignes.join('\n')}\n`);
  process.exit(0);
}

if (!(nom in COMMANDES)) {
  terminer({ statut: 'ERREUR_OUTIL', commande: nom, message: `Commande inconnue : ${nom}. Voir « wf help ».` });
}

try {
  const commande = (await import(`./commands/${nom}.ts`)) as { run: (args: string[]) => Promise<void> };
  await commande.run(args);
} catch (e) {
  terminer({
    statut: 'ERREUR_OUTIL',
    commande: nom,
    message: `Erreur interne : ${e instanceof Error ? e.message : String(e)}`,
  });
}

// Une commande qui rend la main sans verdict est un bug de l'outillage, jamais un succès.
terminer({ statut: 'ERREUR_OUTIL', commande: nom, message: "La commande s'est terminée sans verdict." });
