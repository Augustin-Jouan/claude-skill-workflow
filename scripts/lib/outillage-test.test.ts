import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outillageDeTest, setupsDeclares } from './outillage-test.ts';

test('lit les fichiers de setup déclarés à jest (package.json, projets compris) et à vitest', () => {
  const pkg = JSON.stringify({
    jest: {
      projects: [
        { displayName: 'unit', setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'] },
        { displayName: 'e2e', setupFilesAfterEnv: ['<rootDir>/e2e/setup.ts'], globalSetup: './e2e/global.ts' },
      ],
    },
  });
  assert.deepEqual(setupsDeclares([pkg]), ['jest.setup.ts', 'e2e/setup.ts', 'e2e/global.ts']);
  const vitest = "export default defineConfig({ test: { setupFiles: ['./src/test/setup.ts', \"src/polyfills\"], environment: 'jsdom' } });";
  assert.deepEqual(setupsDeclares([vitest]), ['src/test/setup.ts', 'src/polyfills']);
  assert.deepEqual(setupsDeclares(['{"name":"x"}']), []);
});

test("le setup, les fichiers qui remplacent des modules et ce que seuls des tests importent ne sont pas du code à muter", () => {
  // Cas réel (AVI) : Stryker instrumentait les fabriques de jest.mock() du setup, jest refusait de les charger et
  // le dry run échouait ; e2e/fakeApi.ts, importé par les seuls tests e2e, aurait donné des survivants sans objet.
  const depot = new Map([
    ['jest.setup.ts', "jest.mock('expo-font', () => ({}));"],
    ['e2e/setup.ts', "import { reponse } from './fakeApi';\njest.mock('expo-router');"],
    ['e2e/fakeApi.ts', "import { format } from './outils/format';\nexport const API = 1;"],
    ['e2e/outils/format.ts', 'export const format = 1;'],
    ['e2e/publication.e2e.test.tsx', "import { API } from './fakeApi';"],
    ['src/doublures.ts', "vi.mock('../api', () => ({}));"],
    ['src/prix.ts', 'export const prix = 1;'],
    ['src/panier.ts', "import { prix } from './prix';"],
    ['src/prix.test.ts', "import { prix } from '@/src/prix';"],
    ['src/remise.ts', 'export const remise = 1;'],
    ['src/remise.test.ts', "import { remise } from './remise';"],
    ['app/edit/[id].tsx', 'export default function Page() {}'],
    // Le routeur charge les pages par convention : seuls les tests les importent, elles restent du code.
    ['app/_layout.tsx', "import { Carte } from '@/components/Carte';"],
    ['app/index.tsx', 'export default function Accueil() {}'],
    ['components/Carte.tsx', 'export function Carte() {}'],
    ['components/Bouton.tsx', 'export function Bouton() {}'],
    ['e2e/parcours.e2e.test.tsx', "import Layout from '@/app/_layout';"],
  ]);
  const candidats = ['jest.setup.ts', 'e2e/setup.ts', 'e2e/fakeApi.ts', 'e2e/outils/format.ts', 'src/doublures.ts', 'src/prix.ts', 'src/remise.ts', 'app/edit/[id].tsx', 'app/_layout.tsx', 'components/Carte.tsx'];
  const outillage = outillageDeTest({ candidats, depot, setups: ['jest.setup.ts'], estTest: (f) => /\.test\.tsx?$/.test(f) });
  // src/remise.ts n'est importé que par remise.test.ts : c'est le code que ce test vise, il reste à muter.
  assert.deepEqual([...outillage].sort(), ['e2e/fakeApi.ts', 'e2e/outils/format.ts', 'e2e/setup.ts', 'jest.setup.ts', 'src/doublures.ts']);
});
