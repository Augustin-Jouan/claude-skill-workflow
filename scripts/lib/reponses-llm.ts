// Lecture des réponses des LLM : remontée de l'exécuteur, décision de l'arbitre, points d'un audit.
// Une réponse hors format ne passe jamais pour un succès.

export type TypeRemontee = 'contradiction' | 'test_non_modifiable' | 'question';

export interface Remontee {
  type: TypeRemontee;
  message: string;
}

export interface Decision {
  decision: 'accepter' | 'rejeter' | 'question';
  raison: string;
  question: string;
}

const TYPES_REMONTEE: readonly string[] = ['contradiction', 'test_non_modifiable', 'question'];

// Une ligne WF_REMONTEE illisible signale quand même un blocage : elle devient une question.
export function lireRemontee(texte: string): Remontee | null {
  const ligne = texte.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('WF_REMONTEE'));
  if (!ligne) return null;
  try {
    const brut = JSON.parse(ligne.trim().slice('WF_REMONTEE'.length)) as { type?: unknown; message?: unknown };
    const message = typeof brut.message === 'string' && brut.message.trim() ? brut.message.trim() : ligne.trim();
    const type = typeof brut.type === 'string' && TYPES_REMONTEE.includes(brut.type) ? (brut.type as TypeRemontee) : 'question';
    return { type, message };
  } catch {
    return { type: 'question', message: ligne.trim() };
  }
}

export function lireDecision(texte: string): Decision | null {
  for (const bloc of texte.match(/\{[^{}]*\}/g) ?? []) {
    let brut: Record<string, unknown>;
    try {
      brut = JSON.parse(bloc) as Record<string, unknown>;
    } catch {
      continue;
    }
    const { decision, raison } = brut;
    const question = typeof brut.question === 'string' ? brut.question.trim() : '';
    if (decision !== 'accepter' && decision !== 'rejeter' && decision !== 'question') continue;
    if (typeof raison !== 'string' || !raison.trim()) return null;
    if (decision === 'question' && !question) return null;
    return { decision, raison: raison.trim(), question };
  }
  return null;
}

const POINT = /^(?:\d+\.\s*)?(A-\d+) \[(bloquant|majeur|mineur)\] .+ — .+/;

// Un préambule avant le premier point est ignoré : certains modèles annoncent ce qu'ils font, et Cursor colle
// parfois ce texte à la liste, sur la même ligne. La liste enregistrée part du premier point.
const DEBUT_LISTE = /(?:\d+\.\s*)?A-\d+ \[(?:bloquant|majeur|mineur)\]/;

export function lirePointsAudit(texte: string): { points: string[]; erreurs: string[]; liste: string } {
  const debut = texte.search(DEBUT_LISTE);
  if (debut < 0 && /Aucun point\.?\s*$/i.test(texte.trim())) return { points: [], erreurs: [], liste: 'Aucun point.' };
  const liste = (debut < 0 ? texte : texte.slice(debut)).trim();
  const lignes = liste.split(/\r?\n/).map((l) => l.trim().replace(/^`|`$/g, '')).filter(Boolean);
  const points: string[] = [];
  const erreurs: string[] = [];
  for (const ligne of lignes) {
    const m = POINT.exec(ligne);
    if (!m) {
      erreurs.push(`Ligne hors format : « ${ligne.slice(0, 120)} ».`);
      break;
    }
    if (points.includes(m[1])) {
      erreurs.push(`${m[1]} apparaît deux fois.`);
      break;
    }
    points.push(m[1]);
  }
  if (lignes.length === 0) erreurs.push('Audit vide.');
  return { points, erreurs, liste };
}
