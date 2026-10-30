// Protection des tests existants par l'AST (workflow-dev.md, 4.3) :
// chaque bloc describe / it / test existant est identifié par son chemin de noms, et son texte normalisé
// (sans commentaires ni mise en forme) doit rester identique. Les hooks, helpers et autres instructions
// existants aussi. Ajouter des tests, des helpers ou des imports reste permis ; renommer = supprimer.

import ts from 'typescript';
import { appelDeTest, ligneDe, lireSource, racineAppel } from './ast-tests.ts';
import type { Constat } from './constat.ts';

const HOOKS = ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'];
const imprimante = ts.createPrinter({ removeComments: true });

interface Unite {
  libelle: string;
  texte: string;
  ligne: number;
  test: boolean;
}

function normaliser(noeud: ts.Node, source: ts.SourceFile): string {
  return imprimante
    .printNode(ts.EmitHint.Unspecified, noeud, source)
    .replace(/\s+/g, ' ')
    .replace(/ ?([.,;:(){}[\]=<>+\-*/!?&|]) ?/g, '$1');
}

function nomDeclare(s: ts.Statement): string | null {
  if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) {
    return s.name.text;
  }
  if (ts.isVariableStatement(s)) return s.declarationList.declarations.map((d) => d.name.getText()).join(', ');
  if (ts.isExportAssignment(s)) return 'default';
  return null;
}

function unites(code: string, chemin: string): Map<string, Unite> {
  const source = lireSource(code, chemin);
  const resultat = new Map<string, Unite>();
  const occurrences = new Map<string, number>();
  const ajouter = (base: string, unite: Unite) => {
    const n = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, n);
    resultat.set(`${base}#${n}`, unite);
  };

  const collecter = (instructions: readonly ts.Statement[], portee: string[]) => {
    const ou = portee.length > 0 ? ` (dans « ${portee.join(' > ')} »)` : '';
    for (const s of instructions) {
      if (ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s)) continue;
      const ligne = ligneDe(source, s.getStart(source));

      if (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression)) {
        const appel = s.expression;
        const test = appelDeTest(appel);
        if (test) {
          const premier = appel.arguments[0];
          const nom = ts.isStringLiteralLike(premier) ? premier.text : premier.getText(source);
          const chemin = [...portee, nom];
          if (test.genre === 'test') {
            ajouter(`test ${chemin.join(' > ')}`, { libelle: `le test « ${chemin.join(' > ')} »`, texte: normaliser(appel, source), ligne, test: true });
            continue;
          }
          // Un describe : son en-tête (fonction, modificateurs, table .each, options) puis son contenu.
          const corps = appel.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)) as ts.ArrowFunction | ts.FunctionExpression | undefined;
          const entete = [normaliser(appel.expression, source), ...appel.arguments.filter((a) => a !== corps).map((a) => normaliser(a, source))].join('|');
          ajouter(`describe ${chemin.join(' > ')}`, { libelle: `le describe « ${chemin.join(' > ')} »`, texte: entete, ligne, test: true });
          if (corps && ts.isBlock(corps.body)) collecter(corps.body.statements, chemin);
          else if (corps) ajouter(`corps ${chemin.join(' > ')}`, { libelle: `le describe « ${chemin.join(' > ')} »`, texte: normaliser(corps.body, source), ligne, test: true });
          continue;
        }
        const r = racineAppel(appel.expression);
        if (r && HOOKS.includes(r.racine)) {
          ajouter(`hook ${portee.join(' > ')} ${r.racine}`, { libelle: `le hook ${r.racine}${ou}`, texte: normaliser(s, source), ligne, test: false });
          continue;
        }
      }

      const nom = nomDeclare(s);
      if (nom) {
        ajouter(`declaration ${portee.join(' > ')} ${nom}`, { libelle: `le helper ${nom}${ou}`, texte: normaliser(s, source), ligne, test: false });
        continue;
      }
      const texte = normaliser(s, source);
      ajouter(`instruction ${portee.join(' > ')} ${texte}`, { libelle: `l'instruction « ${texte.slice(0, 60)} »${ou}`, texte, ligne, test: false });
    }
  };

  collecter(source.statements, []);
  return resultat;
}

export function comparerTestsExistants(avant: string, apres: string, chemin: string): Constat[] {
  const anciennes = unites(avant, chemin);
  const nouvelles = unites(apres, chemin);
  const constats: Constat[] = [];
  for (const [cle, u] of anciennes) {
    const n = nouvelles.get(cle);
    if (!n) {
      constats.push({
        regle: u.test ? 'test-existant-supprime' : 'test-existant-modifie',
        niveau: 'bloquant',
        fichier: chemin,
        ligne: u.ligne,
        message: `${u.libelle} a été supprimé ou renommé (ligne ${u.ligne} avant la tâche).`,
      });
    } else if (n.texte !== u.texte) {
      constats.push({ regle: 'test-existant-modifie', niveau: 'bloquant', fichier: chemin, ligne: n.ligne, message: `${u.libelle} a été modifié.` });
    }
  }
  return constats;
}
