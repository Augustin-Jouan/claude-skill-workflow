// Bilan de fin de branche : ce que le workflow propose d'améliorer en lui-même, à partir de ce que le run
// a réellement rencontré. Chaque fait est un événement numéroté (journal, étapes, DEVIATIONS.md) ;
// une suggestion qui n'en cite aucun, ou en cite un inconnu, est refusée. Rien n'est appliqué au skill.

import { parse } from 'yaml';
import { ETAPES, type Transition } from './etat.ts';

export interface Evenement {
  id: string;
  texte: string;
}

type Ligne = Record<string, unknown>;

const minutes = (ms: unknown) => Math.round(Number(ms) / 60_000);

function decrire(l: Ligne): string | null {
  const qui = String(l.tache ?? 'branche');
  switch (l.type) {
    case 'reference':
      return `Suite de départ : ${Math.round(Number(l.suiteMs) / 1000)} s, ${l.echecs} échec(s), ${l.tsc} erreur(s) de typecheck`;
    case 'llm':
      // Les appels réussis ne disent rien des difficultés : seuls les échecs sont des faits.
      return l.erreur ? `${l.phase ? `audit ${l.phase}` : qui} · appel ${l.role} en erreur : ${l.erreur}` : null;
    case 'regle':
      return `${qui} · règle ${l.regle} (${l.niveau})${l.fichier ? ` · ${l.fichier}` : ''}`;
    case 'question':
      return `${qui} · question au développeur (${l.motif})`;
    case 'reponse':
      return `${qui} · réponse du développeur (${l.motif}) : ${l.reponse}`;
    case 'replanification':
      return `${qui} · replanification (${l.motif})`;
    case 'regle-tranchee':
      return `${qui} · tranché par le développeur (${l.motif})`;
    case 'remontee':
      return `${qui} · remontée de l'exécuteur (${l.remontee})`;
    case 'couverture': {
      const fichiers = (l.fichiers as Array<{ fichier: string; pct: number }>).map((f) => `${f.fichier} ${f.pct} %`).join(', ');
      return `${qui} · couverture avant refactor : ${fichiers} (seuil ${l.seuil} %)`;
    }
    case 'instable':
      return `${qui} · test instable : ${l.test}`;
    case 'arbitrage':
      return `${qui} · arbitre (${l.motif}) : ${l.decision}`;
    case 'jalon':
      return l.ok ? `Jalon ${l.tache} : vert` : `Jalon ${l.tache} : rouge, ${l.regressions} régression(s), premier commit fautif ${l.fautif}`;
    case 'tache':
      return `${qui} · committée en ${l.tentatives} tentative(s), ${l.rejets} rejet(s), ${l.appelsLlm} appel(s) LLM, ${minutes(l.dureeMs)} min`;
    case 'audit':
      return `Audit ${l.phase} : ${l.remontes} point(s) remonté(s), ${l.acceptes} accepté(s), ${l.rejetes} rejeté(s)`;
    case 'manuel':
      return `Phase manuelle ${l.phase} : ${l.minutes} min`;
    case 'review':
      return `Review neuve : ${l.verdict}`;
    case 'fin':
      return `Fin de branche : ${l.ok ? 'contrôles verts' : 'bloquée'}`;
    case 'bilan':
      return null;
    default: {
      const { date: _d, parcours: _p, branche: _b, type, ...reste } = l;
      return `${type} : ${JSON.stringify(reste)}`;
    }
  }
}

function decrireTransition(t: Transition): string {
  if (t.de === null) return `Début du workflow : ${t.note}`;
  return ETAPES.indexOf(t.vers) < ETAPES.indexOf(t.de) ? `Retour de ${t.de} à ${t.vers} : ${t.note}` : `Étape ${t.de} → ${t.vers} : ${t.note}`;
}

export function evenementsBilan(o: { journal: Ligne[]; historique: Transition[]; deviations: string }): Evenement[] {
  const textes = [
    ...o.journal.map(decrire),
    ...o.historique.map(decrireTransition),
    ...o.deviations
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
      .map((l) => `DEVIATIONS.md : ${l.replace(/^[-*]\s+/, '')}`),
  ].filter((t): t is string => t !== null);
  return textes.map((texte, i) => ({ id: `E${i + 1}`, texte }));
}

export const CAUSES = {
  'regle-trop-stricte': 'règle trop stricte',
  'faux-positif': 'faux positif',
  'consigne-executeur': "consigne de l'exécuteur",
  plan: 'plan',
  spec: 'spec',
  budget: 'budget',
  outil: 'outil',
  autre: 'autre',
} as const;

const PRIORITES = ['haute', 'moyenne', 'basse'] as const;

export interface Suggestion {
  titre: string;
  faits: string[];
  cause: keyof typeof CAUSES;
  proposition: string;
  ou: string;
  priorite: (typeof PRIORITES)[number];
}

export interface ControleUtile {
  regle: string;
  faits: string[];
  raison: string;
}

export interface Bilan {
  suggestions: Suggestion[];
  utiles: ControleUtile[];
  erreurs: string[];
}

const chaine = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// Réponse attendue de prompts/bilan.md : un bloc YAML { suggestions, controles_utiles }.
// ids : les événements soumis ; un fait hors de cette liste est une invention.
export function lireBilan(texte: string, ids: string[]): Bilan {
  const vide = (erreurs: string[]): Bilan => ({ suggestions: [], utiles: [], erreurs });
  const bloc = /```ya?ml\s*\n([\s\S]*?)```/.exec(texte)?.[1];
  if (bloc === undefined) return vide(['Aucun bloc yaml dans la réponse.']);
  let brut: { suggestions?: unknown; controles_utiles?: unknown };
  try {
    brut = (parse(bloc) ?? {}) as typeof brut;
  } catch (e) {
    return vide([`YAML invalide : ${e instanceof Error ? e.message : String(e)}`]);
  }
  const erreurs: string[] = [];
  if (!Array.isArray(brut.suggestions)) erreurs.push('« suggestions » doit être une liste.');
  if (!Array.isArray(brut.controles_utiles)) erreurs.push('« controles_utiles » doit être une liste.');
  const suggestions = (Array.isArray(brut.suggestions) ? brut.suggestions : []) as Array<Record<string, unknown>>;
  const utiles = (Array.isArray(brut.controles_utiles) ? brut.controles_utiles : []) as Array<Record<string, unknown>>;
  const cites: unknown[] = [];
  const faits = (v: unknown, ou: string) => {
    if (!Array.isArray(v) || v.length === 0 || !v.every(chaine)) erreurs.push(`${ou} : au moins un fait (« E-n ») est requis.`);
    else cites.push(...v);
  };
  suggestions.forEach((s, i) => {
    for (const cle of ['titre', 'proposition', 'ou']) if (!chaine(s?.[cle])) erreurs.push(`suggestions[${i}] : « ${cle} » est requis.`);
    if (!(typeof s?.cause === 'string' && s.cause in CAUSES)) erreurs.push(`suggestions[${i}] : cause parmi ${Object.keys(CAUSES).join(', ')}.`);
    if (!(PRIORITES as readonly unknown[]).includes(s?.priorite)) erreurs.push(`suggestions[${i}] : priorite parmi ${PRIORITES.join(', ')}.`);
    faits(s?.faits, `suggestions[${i}]`);
  });
  utiles.forEach((u, i) => {
    if (!chaine(u?.regle) || !chaine(u?.raison)) erreurs.push(`controles_utiles[${i}] : « regle » et « raison » sont requis.`);
    faits(u?.faits, `controles_utiles[${i}]`);
  });
  for (const id of new Set(cites.map(String))) if (!ids.includes(id)) erreurs.push(`Fait ${id} inconnu : cite un événement de la liste.`);
  if (erreurs.length > 0) return vide(erreurs);
  return { suggestions: suggestions as unknown as Suggestion[], utiles: utiles as unknown as ControleUtile[], erreurs: [] };
}

export function rendreBilan(entete: string, bilan: Bilan, evenements: Evenement[]): string {
  const texte = new Map(evenements.map((e) => [e.id, e.texte]));
  const triees = [...bilan.suggestions].sort((a, b) => PRIORITES.indexOf(a.priorite) - PRIORITES.indexOf(b.priorite));
  const parties = [entete, '## Suggestions'];
  if (triees.length === 0) parties.push('Aucune difficulté qui appelle un changement du workflow.');
  triees.forEach((s, i) => {
    parties.push(
      `### ${i + 1}. ${s.titre} (priorité ${s.priorite})`,
      ['Faits :', ...s.faits.map((f) => `- ${f} : ${texte.get(f)}`)].join('\n'),
      [`- Cause : ${CAUSES[s.cause]}`, `- Proposition : ${s.proposition}`, `- Où : \`${s.ou}\``].join('\n'),
    );
  });
  if (bilan.utiles.length > 0) {
    parties.push('## Contrôles qui ont servi', bilan.utiles.map((u) => `- **${u.regle}** : ${u.raison} (${u.faits.join(', ')})`).join('\n'));
  }
  parties.push("---\n\nPropositions seulement. Rien n'est appliqué au workflow : c'est toi qui décides de ce qui change dans le skill.");
  return `${parties.join('\n\n')}\n`;
}

export function nomFichierRetour(date: string, depot: string, slug: string): string {
  const propre = depot
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${date.slice(0, 10)}-${propre}-${slug}.md`;
}
