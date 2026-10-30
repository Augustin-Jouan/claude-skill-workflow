// wf trace — vérifie que chaque EX-n de .workflow/spec.md apparaît dans au moins un nom de test
// (`it` / `test`) des fichiers *.test.* / *.spec.* du dépôt, suivis ou non.
// Code 0 si toutes les exigences sont tracées, 1 avec la liste des absentes sinon.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dossierWorkflow, fichiersDuDepot, racineDepot } from '../lib/depot.ts';
import { terminer } from '../lib/result.ts';
import { lireSpec } from '../lib/spec.ts';
import { estFichierDeTestCode, tracerExigences } from '../lib/trace.ts';

const C = 'trace';

export async function run(_args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });

  const cheminSpec = join(dossierWorkflow(racine), 'spec.md');
  if (!existsSync(cheminSpec)) terminer({ statut: 'ECHEC', commande: C, message: '.workflow/spec.md est absent.' });
  const spec = lireSpec(readFileSync(cheminSpec, 'utf8'));
  if (spec.erreurs.length > 0) {
    terminer({ statut: 'ECHEC', commande: C, message: `Spec invalide :\n${spec.erreurs.map((e) => `- ${e}`).join('\n')}` });
  }

  const fichiers = fichiersDuDepot(racine)
    .filter((f) => estFichierDeTestCode(f) && existsSync(join(racine, f)))
    .map((chemin) => ({ chemin, code: readFileSync(join(racine, chemin), 'utf8') }));
  const { absentes, trouvees } = tracerExigences(spec.exigences, fichiers);

  if (absentes.length > 0) {
    terminer({
      statut: 'ECHEC',
      commande: C,
      message: `${absentes.length} exigence(s) sans test qui les nomme :\n${absentes
        .map((id) => `- ${id} — ${spec.exigences.find((e) => e.id === id)?.titre}`)
        .join('\n')}`,
      details: { absentes, trouvees, fichiersAnalyses: fichiers.length },
    });
  }
  terminer({
    statut: 'OK',
    commande: C,
    message: `Les ${spec.exigences.length} exigence(s) apparaissent dans un nom de test (${fichiers.length} fichier(s) de test analysé(s)).`,
    details: { trouvees, fichiersAnalyses: fichiers.length },
  });
}
