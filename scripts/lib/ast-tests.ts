// Lecture des fichiers de test par l'AST TypeScript (TS, TSX, JS) : blocs describe / it / test,
// avec leur chemin de noms. Sert à trace (noms de tests) et à verify (protection des tests existants).

import ts from 'typescript';

const DESCRIBE = ['describe', 'suite', 'xdescribe', 'fdescribe'];
const TESTS = ['it', 'test', 'xit', 'xtest', 'fit', 'ftest'];

export interface BlocDeTest {
  genre: 'describe' | 'test';
  fonction: string;
  modificateurs: string[];
  nom: string;
  chemin: string[];
  ligne: number;
  ligneFin: number;
  appel: ts.CallExpression;
}

export function lireSource(code: string, fichier: string): ts.SourceFile {
  const ext = fichier.slice(fichier.lastIndexOf('.')).toLowerCase();
  const genre =
    ext === '.tsx' ? ts.ScriptKind.TSX
    : ext === '.jsx' ? ts.ScriptKind.JSX
    : ['.js', '.mjs', '.cjs'].includes(ext) ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  return ts.createSourceFile(fichier, code, ts.ScriptTarget.Latest, true, genre);
}

export function ligneDe(source: ts.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

// `it.each([..])('nom', fn)` → { racine: 'it', modificateurs: ['each'] }. null si l'appel ne part pas d'un identifiant.
export function racineAppel(expr: ts.Expression): { racine: string; modificateurs: string[] } | null {
  if (ts.isIdentifier(expr)) return { racine: expr.text, modificateurs: [] };
  if (ts.isPropertyAccessExpression(expr)) {
    const r = racineAppel(expr.expression);
    return r && { racine: r.racine, modificateurs: [...r.modificateurs, expr.name.text] };
  }
  if (ts.isCallExpression(expr)) return racineAppel(expr.expression);
  if (ts.isTaggedTemplateExpression(expr)) return racineAppel(expr.tag);
  return null;
}

function nomDuBloc(arg: ts.Expression | undefined): string {
  if (!arg) return '';
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isTemplateExpression(arg)) return arg.getText().slice(1, -1);
  return arg.getText();
}

export function appelDeTest(noeud: ts.Node): { fonction: string; modificateurs: string[]; genre: BlocDeTest['genre'] } | null {
  if (!ts.isCallExpression(noeud) || noeud.arguments.length === 0) return null;
  const r = racineAppel(noeud.expression);
  if (!r) return null;
  if (DESCRIBE.includes(r.racine)) return { fonction: r.racine, modificateurs: r.modificateurs, genre: 'describe' };
  if (TESTS.includes(r.racine)) return { fonction: r.racine, modificateurs: r.modificateurs, genre: 'test' };
  return null;
}

export function blocsDeTest(code: string, fichier: string): BlocDeTest[] {
  const source = lireSource(code, fichier);
  const blocs: BlocDeTest[] = [];

  const visiter = (noeud: ts.Node, chemin: string[]): void => {
    const test = appelDeTest(noeud);
    if (test && ts.isCallExpression(noeud)) {
      const nom = nomDuBloc(noeud.arguments[0]);
      const cheminBloc = [...chemin, nom];
      blocs.push({
        ...test,
        nom,
        chemin: cheminBloc,
        ligne: ligneDe(source, noeud.getStart()),
        ligneFin: ligneDe(source, noeud.getEnd()),
        appel: noeud,
      });
      // Seuls les arguments sont parcourus : l'appelé (`describe.each([..])`) n'est pas un bloc.
      for (const arg of noeud.arguments) visiter(arg, cheminBloc);
      return;
    }
    ts.forEachChild(noeud, (enfant) => visiter(enfant, chemin));
  };
  visiter(source, []);
  return blocs;
}
