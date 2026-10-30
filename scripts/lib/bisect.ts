// Recherche du commit qui casse la suite, entre le dernier jalon vert et le commit actuel (workflow-dev.md, 4.7).
// Même principe que git bisect, mais la sonde tourne dans un worktree de .workflow/ : l'arbre de travail
// n'est jamais touché. Les commits vont du plus ancien au plus récent ; le dernier est connu comme fautif.

export async function premierFautif(commits: string[], echoue: (commit: string) => Promise<boolean>): Promise<string> {
  if (commits.length === 0) throw new Error('Aucun commit à départager.');
  let bas = 0;
  let haut = commits.length - 1;
  while (bas < haut) {
    const milieu = Math.floor((bas + haut) / 2);
    if (await echoue(commits[milieu])) haut = milieu;
    else bas = milieu + 1;
  }
  return commits[haut];
}
