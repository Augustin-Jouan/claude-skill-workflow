// Remplissage des prompts de prompts/*.md : chaque {{cle}} doit recevoir une valeur, et chaque valeur
// une clé. Un écart est un bug de l'outillage, pas un prompt à envoyer à moitié rempli.

const CLE = /\{\{(\w+)\}\}/g;

export function remplir(gabarit: string, valeurs: Record<string, string>): string {
  const cles = new Set([...gabarit.matchAll(CLE)].map((m) => m[1]));
  const manquantes = [...cles].filter((c) => !(c in valeurs));
  const inconnues = Object.keys(valeurs).filter((c) => !cles.has(c));
  if (manquantes.length > 0) throw new Error(`Gabarit : valeur manquante pour ${manquantes.join(', ')}.`);
  if (inconnues.length > 0) throw new Error(`Gabarit : clé absente du gabarit : ${inconnues.join(', ')}.`);
  return gabarit.replace(CLE, (_, cle: string) => valeurs[cle]);
}
