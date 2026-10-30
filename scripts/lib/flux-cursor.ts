// Lecture du flux --output-format stream-json de la CLI Cursor : une ligne lisible par action (fichier lu ou
// modifié, commande lancée et son code, réflexion, réponse), écrite dans .workflow/cursor.log pour « wf suivre ».

import { isAbsolute, relative } from 'node:path';

type Objet = Record<string, unknown>;

// Lignes du direct de Cursor sur la sortie des commandes wf (audit, run-plan, executer) : visibles dans le détail
// du shell d'arrière-plan. Le préfixe les distingue de la progression du workflow (« · »).
export const DIRECT = '  ┊ ';

export function enDirect(ligne: string, heure: string): string {
  return `${DIRECT}${heure}  ${ligne}`;
}

// Au-delà, la réflexion en cours est affichée sans attendre sa fin : Grok réfléchit parfois plusieurs minutes.
const REFLEXION_MAX = 400;
const EXTRAIT = 300;

const VERBES: Record<string, string> = { read: 'lit', edit: 'modifie', write: 'écrit', delete: 'supprime', ls: 'liste', glob: 'cherche' };

function objet(v: unknown): Objet {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objet) : {};
}

function uneLigne(texte: string, max = EXTRAIT): string {
  const plat = texte.replace(/\s+/g, ' ').trim();
  return plat.length > max ? `${plat.slice(0, max)}…` : plat;
}

export class LecteurFlux {
  private reflexion = '';
  private readonly racine: string;

  constructor(racine: string) {
    this.racine = racine;
  }

  lire(ligne: string): string[] {
    let e: Objet;
    try {
      e = objet(JSON.parse(ligne));
    } catch {
      return [];
    }
    if (e.type === 'thinking') return this.penser(e);
    const sorties = this.viderReflexion();
    if (e.type === 'tool_call') {
      const d = this.outil(e);
      if (d) sorties.push(d);
    } else if (e.type === 'assistant') {
      const contenu = Array.isArray(objet(e.message).content) ? (objet(e.message).content as unknown[]) : [];
      const texte = contenu.map((c) => objet(c).text).filter((t) => typeof t === 'string').join(' ');
      if (texte.trim()) sorties.push(`dit : ${uneLigne(texte)}`);
    } else if (e.type === 'result') {
      sorties.push(`${e.is_error ? 'en erreur' : 'terminé'} en ${Math.round(Number(e.duration_ms) / 1000)} s`);
    }
    return sorties;
  }

  private penser(e: Objet): string[] {
    if (e.subtype === 'delta' && typeof e.text === 'string') {
      this.reflexion += e.text;
      if (this.reflexion.length <= REFLEXION_MAX) return [];
      const extrait = `réfléchit : ${uneLigne(this.reflexion.slice(0, EXTRAIT), EXTRAIT)}…`;
      this.reflexion = '';
      return [extrait];
    }
    return e.subtype === 'completed' ? this.viderReflexion() : [];
  }

  private viderReflexion(): string[] {
    const texte = uneLigne(this.reflexion);
    this.reflexion = '';
    return texte ? [`réfléchit : ${texte}`] : [];
  }

  private chemin(p: unknown): string {
    if (typeof p !== 'string') return '?';
    return (isAbsolute(p) ? relative(this.racine, p) : p).replaceAll('\\', '/');
  }

  private outil(e: Objet): string | null {
    const [cle, valeur] = Object.entries(objet(e.tool_call)).find(([k]) => k.endsWith('ToolCall')) ?? [];
    if (!cle) return null;
    const nom = cle.slice(0, -'ToolCall'.length);
    const appel = objet(valeur);
    const args = objet(appel.args);

    if (e.subtype === 'started') {
      if (nom === 'shell') return `$ ${uneLigne(String(args.command ?? ''))}`;
      if (nom === 'grep') return `grep « ${uneLigne(String(args.pattern ?? ''), 80)} »`;
      if (nom === 'glob') return `cherche ${uneLigne(String(args.globPattern ?? args.pattern ?? ''), 80)}`;
      if (args.path !== undefined) return `${VERBES[nom] ?? nom} ${this.chemin(args.path)}`;
      return nom;
    }
    if (e.subtype !== 'completed') return null;

    const resultat = objet(appel.result);
    const erreur = objet(resultat.error);
    if (Object.keys(erreur).length > 0) return `  → échec : ${uneLigne(String(erreur.errorMessage ?? erreur.message ?? JSON.stringify(erreur)), 200)}`;
    // Une commande au code non nul arrive en « failure », avec la même forme que « success ».
    const succes = objet(resultat.success ?? resultat.failure);
    if (nom === 'shell' && typeof succes.exitCode === 'number') {
      const derniere = String(succes.stderr || succes.stdout || '').trim().split(/\r?\n/).pop() ?? '';
      return succes.exitCode === 0 ? '  → code 0' : `  → code ${succes.exitCode}${derniere ? ` : ${uneLigne(derniere, 200)}` : ''}`;
    }
    if (typeof succes.linesAdded === 'number') return `  → +${succes.linesAdded} −${Number(succes.linesRemoved ?? 0)}`;
    return null;
  }
}
