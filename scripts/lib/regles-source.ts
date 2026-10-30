// Règles de code appliquées aux lignes modifiées par la tâche, par l'AST et non par eslint :
// elles ne dépendent ni de la config du projet ni de ses plugins, et aucun commentaire ne les désactive.
// Bloquant : règles eslint verrouillées (annexe de workflow-dev.md), todo / fails, timeouts.
// Signalé : `!`, `as unknown as`, catch qui avale l'erreur, assertions faibles seules, mock du module testé.

import { posix } from 'node:path';
import ts from 'typescript';
import { blocsDeTest, ligneDe, lireSource, racineAppel } from './ast-tests.ts';
import { sansExtension, type Constat } from './constat.ts';

export interface OptionsAnalyse {
  lignes: Set<number> | null;
  estTest: boolean;
  // Fichiers non-test prévus par la tâche, sans extension : un mock qui les vise est signalé.
  modulesTestes: string[];
}

const COMMENTAIRE_TS = /@ts-(ignore|expect-error|nocheck)\b/;
const ASSERTION = /^(expect|assert)/i;
const ASSERTIONS_FAIBLES = ['toBeDefined', 'toBeTruthy'];

function parcourir(noeud: ts.Node, visite: (n: ts.Node) => void): void {
  visite(noeud);
  ts.forEachChild(noeud, (enfant) => parcourir(enfant, visite));
}

function fonctionDuTest(appel: ts.CallExpression): ts.ArrowFunction | ts.FunctionExpression | null {
  const fn = [...appel.arguments].reverse().find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  return (fn as ts.ArrowFunction | ts.FunctionExpression | undefined) ?? null;
}

function avaleLErreur(clause: ts.CatchClause): boolean {
  let relance = false;
  let utilise = false;
  const nom = clause.variableDeclaration && ts.isIdentifier(clause.variableDeclaration.name) ? clause.variableDeclaration.name.text : null;
  parcourir(clause.block, (n) => {
    if (ts.isThrowStatement(n)) relance = true;
    if (nom && ts.isIdentifier(n) && n.text === nom) utilise = true;
  });
  return !relance && !utilise;
}

export function analyserSource(code: string, chemin: string, opts: OptionsAnalyse): Constat[] {
  const source = lireSource(code, chemin);
  const constats: Constat[] = [];
  const dansDiff = (ligne: number) => opts.lignes === null || opts.lignes.has(ligne);
  const plageDansDiff = (debut: number, fin: number) => {
    for (let l = debut; l <= fin; l++) if (dansDiff(l)) return true;
    return false;
  };
  const ajouter = (regle: string, niveau: Constat['niveau'], ligne: number, message: string) => {
    if (dansDiff(ligne)) constats.push({ regle, niveau, fichier: chemin, ligne, message });
  };

  const commentairesVus = new Set<number>();
  const lireCommentaires = (plages: ts.CommentRange[] | undefined) => {
    for (const c of plages ?? []) {
      if (commentairesVus.has(c.pos)) continue;
      commentairesVus.add(c.pos);
      const m = COMMENTAIRE_TS.exec(code.slice(c.pos, c.end));
      if (m) ajouter('ban-ts-comment', 'bloquant', ligneDe(source, c.pos), `Commentaire @ts-${m[1]} interdit.`);
    }
  };

  parcourir(source, (n) => {
    lireCommentaires(ts.getLeadingCommentRanges(code, n.getFullStart()));
    lireCommentaires(ts.getTrailingCommentRanges(code, n.getEnd()));
    if (n.kind === ts.SyntaxKind.EndOfFileToken) return;
    const ligne = ligneDe(source, n.getStart(source));

    if (n.kind === ts.SyntaxKind.AnyKeyword) ajouter('no-explicit-any', 'bloquant', ligne, '`any` interdit.');
    if (ts.isNonNullExpression(n)) ajouter('non-null', 'signale', ligne, 'Assertion non-null `!`.');
    if (ts.isAsExpression(n) && ts.isAsExpression(n.expression) && n.expression.type.kind === ts.SyntaxKind.UnknownKeyword) {
      ajouter('as-unknown-as', 'signale', ligne, '`as unknown as` contourne le typage.');
    }
    if (ts.isCatchClause(n) && avaleLErreur(n)) ajouter('catch-avale', 'signale', ligne, "Ce catch avale l'erreur (ni relance ni utilisation).");

    if (!ts.isCallExpression(n)) return;
    const r = racineAppel(n.expression);
    if (!r) return;
    const [premier] = r.modificateurs;
    if ((r.racine === 'vi' && premier === 'setConfig') || (r.racine === 'jest' && premier === 'setTimeout')) {
      ajouter('timeout', 'bloquant', ligne, 'Modifier les timeouts de test est interdit.');
    }
    const cible = n.arguments[0];
    if (opts.estTest && ['vi', 'jest'].includes(r.racine) && ['mock', 'doMock'].includes(premier ?? '') && cible && ts.isStringLiteral(cible) && cible.text.startsWith('.')) {
      const module = sansExtension(posix.normalize(posix.join(posix.dirname(chemin), cible.text)));
      if (opts.modulesTestes.map(sansExtension).includes(module)) {
        ajouter('mock-module-teste', 'signale', ligne, `${r.racine}.${premier}('${cible.text}') vise le module testé.`);
      }
    }
  });

  if (opts.estTest) {
    for (const b of blocsDeTest(code, chemin)) {
      const nom = `« ${b.chemin.join(' > ')} »`;
      const focalise = b.modificateurs.includes('only') || ['fit', 'fdescribe', 'ftest'].includes(b.fonction);
      const desactive = b.modificateurs.includes('skip') || b.fonction.startsWith('x');
      const fn = fonctionDuTest(b.appel);
      const enAttente = b.modificateurs.includes('todo') || b.modificateurs.includes('fails') || (b.genre === 'test' && !fn && b.appel.arguments.length < 2);
      if (focalise) ajouter('no-focused-tests', 'bloquant', b.ligne, `${nom} est focalisé.`);
      if (desactive) ajouter('no-disabled-tests', 'bloquant', b.ligne, `${nom} est désactivé.`);
      if (enAttente) ajouter('todo-fails', 'bloquant', b.ligne, `${nom} : todo / fails interdits.`);
      if (b.genre !== 'test' || !fn || focalise || desactive || enAttente || !plageDansDiff(b.ligne, b.ligneFin)) continue;

      let assertions = 0;
      const matchers: string[] = [];
      parcourir(fn, (n) => {
        if (!ts.isCallExpression(n)) return;
        const r = racineAppel(n.expression);
        if (!r || !ASSERTION.test(r.racine)) return;
        assertions++;
        if (r.racine === 'expect' && r.modificateurs.length > 0) matchers.push(r.modificateurs[r.modificateurs.length - 1]);
      });
      if (assertions === 0) {
        constats.push({ regle: 'expect-expect', niveau: 'bloquant', fichier: chemin, ligne: b.ligne, message: `${nom} ne contient aucune assertion.` });
      } else if (matchers.length > 0 && matchers.every((m) => ASSERTIONS_FAIBLES.includes(m))) {
        constats.push({ regle: 'assertions-faibles', niveau: 'signale', fichier: chemin, ligne: b.ligne, message: `${nom} n'utilise que ${[...new Set(matchers)].join(', ')}.` });
      }
    }
  }
  return constats;
}
