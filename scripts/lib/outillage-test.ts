// Outillage de test que les motifs de fichiers de test ne voient pas : le setup déclaré au runner, les fichiers
// qui remplacent des modules (jest.mock, vi.mock) et les modules que seuls des tests importent (fausse API, jeux
// de données). Ce n'est pas du code à muter : Stryker instrumente les fabriques de jest.mock(), que jest refuse
// alors de charger, et un survivant dans une doublure ne demande aucun test.

import { posix } from 'node:path';

const CLES_SETUP = /["']?\b(setupFiles|setupFilesAfterEnv|globalSetup|globalTeardown)\b["']?\s*:\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/g;
const CHAINE = /["']([^"']+)["']/g;

// Chemins relatifs à la racine, lus dans le texte des configs (package.json, jest.config.*, vitest.config.*) :
// une expression régulière suffit au JSON comme au TS, et ne demande pas d'exécuter la config.
export function setupsDeclares(configs: string[]): string[] {
  const chemins: string[] = [];
  for (const texte of configs) {
    for (const [, , valeur] of texte.matchAll(CLES_SETUP)) {
      for (const [, chemin] of valeur.matchAll(CHAINE)) chemins.push(posix.normalize(chemin.replace(/^<rootDir>\//, '')).replace(/^\.\//, ''));
    }
  }
  return [...new Set(chemins)];
}

const REMPLACE_DES_MODULES = /\b(jest|vi)\.(mock|doMock|unstable_mockModule)\s*\(/;
const IMPORTS = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
const sansExtension = (f: string) => f.replace(/\.[cm]?[jt]sx?$/i, '').replace(/\/index$/, '');
// « remise.test.ts », « publication.e2e.test.tsx » → « remise », « publication ».
const radical = (f: string) => posix.basename(f).split('.')[0];

// Module visé par un import : relatif au fichier qui importe, ou alias de la racine (@/, ~/). null : un paquet.
function cible(importeur: string, specifieur: string): string | null {
  if (specifieur.startsWith('.')) return sansExtension(posix.normalize(posix.join(posix.dirname(importeur), specifieur)));
  if (/^[@~]\//.test(specifieur)) return sansExtension(specifieur.slice(2));
  return null;
}

// depot : chemin → contenu des fichiers de code du dépôt. Un candidat est de l'outillage s'il est déclaré en setup,
// s'il remplace des modules, ou si tout ce qui l'importe et tout ce qui l'entoure est un test ou de l'outillage,
// sans qu'un test porte son nom.
// Un module que personne n'importe (page d'expo-router, point d'entrée) reste du code.
export function outillageDeTest(o: { candidats: string[]; depot: ReadonlyMap<string, string>; setups: string[]; estTest: (f: string) => boolean }): Set<string> {
  const setups = new Set(o.setups.map(sansExtension));
  const importeurs = new Map<string, string[]>();
  for (const [fichier, texte] of o.depot) {
    for (const [, specifieur] of texte.matchAll(IMPORTS)) {
      const vise = cible(fichier, specifieur);
      if (vise !== null) importeurs.set(vise, [...(importeurs.get(vise) ?? []), fichier]);
    }
  }
  const nomsDeTests = new Set([...o.depot.keys()].filter(o.estTest).map(radical));
  const outillage = new Set([...o.depot.keys()].filter((f) => !o.estTest(f) && (setups.has(sansExtension(f)) || REMPLACE_DES_MODULES.test(o.depot.get(f) ?? ''))));
  const support = (f: string) => o.estTest(f) || outillage.has(f);
  const voisins = (f: string) => [...o.depot.keys()].filter((v) => v !== f && posix.dirname(v) === posix.dirname(f));
  // Un module importé par la seule fausse API est lui-même de l'outillage : on propage jusqu'à stabilité.
  // Les voisins doivent l'être aussi : une page que le routeur charge par convention n'est importée que par
  // des tests, mais elle vit parmi d'autres pages, pas dans un dossier de tests comme e2e/.
  for (let change = true; change; ) {
    change = false;
    for (const f of o.depot.keys()) {
      if (support(f) || nomsDeTests.has(radical(f))) continue;
      const par = importeurs.get(sansExtension(f)) ?? [];
      if (par.length > 0 && par.every(support) && voisins(f).every(support)) {
        outillage.add(f);
        change = true;
      }
    }
  }
  return new Set(o.candidats.filter((f) => outillage.has(f)));
}
