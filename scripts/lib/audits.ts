// Audits bruts de .workflow/audits/ : <phase>-<n>.md (réponse de Cursor) et <phase>-<n>.json (points lus).
// « wf journal audit » vérifie que le tri compte bien tous les points du dernier audit de la phase.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lireResultat } from './llm.ts';

function numeros(dossier: string, phase: string): number[] {
  const audits = join(dossier, 'audits');
  if (!existsSync(audits)) return [];
  const motif = new RegExp(`^${phase}-(\\d+)\\.json$`);
  return readdirSync(audits)
    .map((f) => motif.exec(f)?.[1])
    .filter((n) => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

export function dernierAudit(dossier: string, phase: string): { numero: number; points: string[] } | null {
  const numero = numeros(dossier, phase).at(-1);
  if (numero === undefined) return null;
  const { points } = JSON.parse(readFileSync(join(dossier, 'audits', `${phase}-${numero}.json`), 'utf8')) as { points: string[] };
  return { numero, points };
}

// « wf audit <phase> --reprendre » : relit la réponse du dernier appel de la phase dans .workflow/llm/, au lieu de
// relancer un audit de plusieurs minutes. Seulement si ce prompt a été envoyé avec la spec et le plan actuels
// (la relance « hors format » lui ajoute une consigne à la fin) et si la réponse n'a pas déjà été enregistrée.
export function derniereReponse(dossier: string, phase: string, prompt: string): { texte: string; horodatage: number } | { erreur: string } {
  const llm = join(dossier, 'llm');
  const motif = new RegExp(`^audit-${phase}-(\\d+)\\.md$`);
  const horodatage = existsSync(llm)
    ? readdirSync(llm)
        .map((f) => Number(motif.exec(f)?.[1]))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b)
        .at(-1)
    : undefined;
  if (horodatage === undefined) return { erreur: `Aucun appel d'audit ${phase} à reprendre dans .workflow/llm/.` };

  const base = join(llm, `audit-${phase}-${horodatage}`);
  if (!readFileSync(`${base}.md`, 'utf8').startsWith(prompt)) {
    return { erreur: `La spec ou le plan a changé depuis le dernier audit ${phase} : relance-le sans --reprendre.` };
  }
  const audit = dernierAudit(dossier, phase);
  if (audit) {
    const { date } = JSON.parse(readFileSync(join(dossier, 'audits', `${phase}-${audit.numero}.json`), 'utf8')) as { date: string };
    if (Date.parse(date) >= horodatage) return { erreur: `La dernière réponse de l'audit ${phase} est déjà enregistrée (audits/${phase}-${audit.numero}.md).` };
  }
  if (!existsSync(`${base}.sortie.txt`)) return { erreur: `Le dernier appel d'audit ${phase} n'a pas laissé de sortie (interrompu ?) : relance-le sans --reprendre.` };

  const brut = readFileSync(`${base}.sortie.txt`, 'utf8');
  const stdout = brut.split('\n--- stdout\n')[1]?.split('\n--- stderr\n')[0] ?? '';
  const lu = lireResultat(stdout);
  return lu.erreur ? { erreur: `Le dernier appel d'audit ${phase} n'a pas de réponse exploitable : ${lu.erreur.split('\n')[0]}` } : { texte: lu.texte, horodatage };
}

// Rend le chemin du .md écrit.
export function enregistrerAudit(dossier: string, phase: string, texte: string, points: string[]): string {
  const numero = (numeros(dossier, phase).at(-1) ?? 0) + 1;
  mkdirSync(join(dossier, 'audits'), { recursive: true });
  const fichier = join(dossier, 'audits', `${phase}-${numero}.md`);
  writeFileSync(fichier, `${texte.trim()}\n`);
  writeFileSync(join(dossier, 'audits', `${phase}-${numero}.json`), `${JSON.stringify({ date: new Date().toISOString(), points }, null, 2)}\n`);
  return fichier;
}
