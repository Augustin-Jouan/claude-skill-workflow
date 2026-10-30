// Motifs de fichiers de config/defaults.ts, à la manière de .gitignore :
// sans « / », le motif vise le nom du fichier à toute profondeur ; avec « / », il part de la racine.

function versRegex(motif: string): RegExp {
  let re = '';
  for (let i = 0; i < motif.length; ) {
    if (motif.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 3;
    } else if (motif.startsWith('/**', i) && i + 3 === motif.length) {
      re += '(?:/.*)?';
      i += 3;
    } else if (motif.startsWith('**', i)) {
      re += '.*';
      i += 2;
    } else if (motif[i] === '*') {
      re += '[^/]*';
      i += 1;
    } else if (motif[i] === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += motif[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export function correspond(chemin: string, motif: string): boolean {
  const cible = motif.includes('/') ? chemin : chemin.slice(chemin.lastIndexOf('/') + 1);
  return versRegex(motif).test(cible);
}
