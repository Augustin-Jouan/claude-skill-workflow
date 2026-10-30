// Appels des CLI LLM en mode headless : Cursor (exécuteur, audits) et Claude (arbitre).
// Cursor reçoit une consigne courte qui pointe vers le prompt écrit dans .workflow/llm/ : un prompt long ne
// passe pas sur la ligne de commande Windows. Claude le reçoit sur son entrée standard, sans outils.
// Chaque prompt et chaque réponse brute sont gardés dans .workflow/llm/ pour relecture. Les actions de Cursor
// sont écrites au fil de l'eau sur la sortie (lignes « ┊ ») et dans .workflow/cursor.log, que « wf suivre » affiche.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, extname, join } from 'node:path';
import { CONFIG } from '../../config/defaults.ts';
import { enDirect, LecteurFlux } from './flux-cursor.ts';

export interface Lancement {
  commande: string;
  args: string[];
  shell: boolean;
}

export interface Execution {
  code: number | null;
  stdout: string;
  stderr: string;
  depasse: boolean;
  dureeMs: number;
}

// secours : dossiers où l'installateur range l'outil, cherchés après le PATH (voir dossiersDInstallation).
export function trouverExecutable(noms: string[], env: NodeJS.ProcessEnv = process.env, plateforme = process.platform, secours: string[] = []): string | null {
  const dossiers = [...(env.PATH ?? env.Path ?? '').split(plateforme === 'win32' ? ';' : delimiter).filter(Boolean), ...secours];
  const extensions = plateforme === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';'), '.PS1'].map((e) => e.toLowerCase()) : [''];
  for (const nom of noms) {
    for (const dossier of dossiers) {
      for (const ext of extensions) {
        // Sous Windows, un nom sans extension n'est pas exécutable (script shell d'un installateur npm).
        if (plateforme === 'win32' && ext === '') continue;
        const chemin = join(dossier, nom + ext);
        if (existsSync(chemin)) return chemin;
      }
    }
  }
  return null;
}

// Un terminal (ou herdr) ouvert avant l'installation de la CLI Cursor garde l'ancien PATH : on regarde aussi
// là où son installateur Windows la range.
export function dossiersDInstallation(outil: string, env: NodeJS.ProcessEnv = process.env, plateforme = process.platform): string[] {
  if (outil !== 'cursor-agent' || plateforme !== 'win32' || !env.LOCALAPPDATA) return [];
  return [join(env.LOCALAPPDATA, 'cursor-agent')];
}

const DANGEREUX_POUR_CMD = /["%\r\n^&|<>!]/;

export function commandeDeLancement(executable: string, args: string[]): Lancement {
  const ext = extname(executable).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    const refuse = args.find((a) => DANGEREUX_POUR_CMD.test(a));
    if (refuse !== undefined) throw new Error(`Argument impossible à passer sans risque par le shell Windows : ${refuse}`);
    return { commande: [executable, ...args].map((a) => `"${a}"`).join(' '), args: [], shell: true };
  }
  if (ext === '.ps1') {
    return { commande: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args], shell: false };
  }
  return { commande: executable, args, shell: false };
}

function arreterArbre(pid: number): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Déjà terminé.
    }
  }
}

export function executer(
  l: Lancement,
  o: { cwd: string; entree?: string; timeoutMs: number; env?: NodeJS.ProcessEnv; surLigne?: (ligne: string) => void },
): Promise<Execution> {
  const debut = Date.now();
  return new Promise((resolve, reject) => {
    const enfant = spawn(l.commande, l.args, {
      cwd: o.cwd,
      env: o.env ?? process.env,
      shell: l.shell,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let depasse = false;
    let reste = '';
    enfant.stdout.setEncoding('utf8').on('data', (d: string) => {
      stdout += d;
      if (!o.surLigne) return;
      const lignes = (reste + d).split(/\r?\n/);
      reste = lignes.pop() ?? '';
      for (const ligne of lignes) o.surLigne(ligne);
    });
    enfant.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const minuteur = setTimeout(() => {
      depasse = true;
      if (enfant.pid) arreterArbre(enfant.pid);
    }, o.timeoutMs);
    enfant.on('error', (e) => {
      clearTimeout(minuteur);
      reject(e);
    });
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      if (o.surLigne && reste) o.surLigne(reste);
      resolve({ code, stdout, stderr, depasse, dureeMs: Date.now() - debut });
    });
    enfant.stdin.on('error', () => {});
    enfant.stdin.end(o.entree ?? '');
  });
}

// Dernier objet JSON {"type":"result"} de la sortie (stream-json de Cursor, json de Claude).
// Claude compte en snake_case (input_tokens), Cursor en camelCase (inputTokens).
export function lireResultat(stdout: string): { texte: string; erreur: string; tokens: number | null } {
  for (const ligne of stdout.trim().split(/\r?\n/).reverse()) {
    let brut: { type?: string; is_error?: boolean; result?: unknown; usage?: Record<string, unknown> };
    try {
      brut = JSON.parse(ligne) as typeof brut;
    } catch {
      continue;
    }
    if (brut.type !== 'result') continue;
    const texte = typeof brut.result === 'string' ? brut.result : '';
    const tokens = brut.usage
      ? Object.entries(brut.usage).filter(([k, v]) => /tokens$/i.test(k) && typeof v === 'number').reduce((s, [, v]) => s + (v as number), 0)
      : null;
    return { texte, erreur: brut.is_error ? `L'outil signale une erreur : ${texte || ligne}` : '', tokens };
  }
  return { texte: '', erreur: `Aucun résultat JSON dans la sortie de l'outil.\n${stdout.slice(-1000)}`, tokens: null };
}

export function argumentsCursor(modele: string, mode: 'agent' | 'ask', racine: string, consigne: string): string[] {
  const droits = mode === 'ask' ? ['--mode', 'ask'] : ['--force'];
  return ['-p', '--output-format', 'stream-json', '--trust', '--workspace', racine, '--model', modele, ...droits, consigne];
}

// Un claude lancé depuis une session Claude Code se croirait imbriqué dans celle-ci.
export function environnementClaude(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copie = { ...env };
  for (const cle of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete copie[cle];
  return copie;
}

// Sous Windows, lancée depuis Git Bash (HOME en /c/Users/…, SHELL, MSYSTEM), la CLI Cursor exécute ses hooks
// (dont ceux repris de ~/.claude/settings.json) dans bash : écrits pour PowerShell, ils plantent et bloquent
// Read et Shell. On lui rend un environnement Windows.
export function environnementCursor(env: NodeJS.ProcessEnv, plateforme = process.platform): NodeJS.ProcessEnv {
  if (plateforme !== 'win32') return env;
  const { SHELL: _shell, MSYSTEM: _msystem, ...copie } = env;
  return env.USERPROFILE ? { ...copie, HOME: env.USERPROFILE } : copie;
}

export interface Appel {
  outil: string;
  modele: string;
  mode: 'agent' | 'ask';
  racine: string;
  prompt: string;
  // .workflow/llm/<nom>.md ; la réponse brute va dans <nom>.sortie.txt.
  fichierPrompt: string;
  timeoutMs: number;
  // Journal en direct des actions de Cursor (.workflow/cursor.log), et le titre de l'appel qui y sépare les appels.
  suivi?: { fichier: string; titre: string };
}

export interface Reponse {
  texte: string;
  erreur: string;
  depasse: boolean;
  dureeMs: number;
  tokens: number | null;
}

function heure(): string {
  return new Date().toTimeString().slice(0, 8);
}

function suivreCursor(suivi: { fichier: string; titre: string }, racine: string): (ligne: string) => void {
  mkdirSync(dirname(suivi.fichier), { recursive: true });
  const titre = `=== ${suivi.titre} ===`;
  appendFileSync(suivi.fichier, `\n${heure()}  ${titre}\n`);
  if (CONFIG.directSurSortie) process.stdout.write(`${enDirect(titre, heure())}\n`);
  const lecteur = new LecteurFlux(racine);
  return (ligne) => {
    const lignes = lecteur.lire(ligne);
    if (lignes.length === 0) return;
    appendFileSync(suivi.fichier, lignes.map((l) => `${heure()}  ${l}\n`).join(''));
    if (CONFIG.directSurSortie) process.stdout.write(lignes.map((l) => `${enDirect(l, heure())}\n`).join(''));
  };
}

const EXECUTABLES: Record<string, string[]> = { 'cursor-agent': ['agent', 'cursor-agent'], claude: ['claude'] };

export async function appelerLlm(a: Appel): Promise<Reponse> {
  const noms = EXECUTABLES[a.outil];
  if (!noms) throw new Error(`Outil LLM inconnu dans la configuration : ${a.outil}.`);
  const executable = trouverExecutable(noms, process.env, process.platform, dossiersDInstallation(a.outil));
  if (!executable) {
    throw new Error(`${noms.join(' / ')} introuvable sur le PATH : installe et connecte la CLI ${a.outil}. Si elle vient d'être installée, relance le terminal (ou herdr) pour recharger le PATH.`);
  }

  mkdirSync(dirname(a.fichierPrompt), { recursive: true });
  writeFileSync(a.fichierPrompt, a.prompt);
  const cursor = a.outil === 'cursor-agent';
  const args = cursor
    ? argumentsCursor(a.modele, a.mode, a.racine, `Lis le fichier ${a.fichierPrompt} et suis exactement ses instructions.`)
    : ['-p', '--safe-mode', '--tools', '', '--model', a.modele, '--output-format', 'json', '--no-session-persistence'];
  const surLigne = cursor && a.suivi ? suivreCursor(a.suivi, a.racine) : undefined;
  const r = await executer(commandeDeLancement(executable, args), {
    cwd: a.racine,
    surLigne,
    entree: cursor ? '' : a.prompt,
    timeoutMs: a.timeoutMs,
    env: cursor ? environnementCursor(process.env) : environnementClaude(process.env),
  });
  writeFileSync(a.fichierPrompt.replace(/\.md$/, '.sortie.txt'), `code ${r.code}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}\n`);

  if (r.depasse) return { texte: '', erreur: `Délai de ${Math.round(a.timeoutMs / 60_000)} min dépassé.`, depasse: true, dureeMs: r.dureeMs, tokens: null };
  const lu = lireResultat(r.stdout);
  const erreur = lu.erreur || (r.code !== 0 ? `${a.outil} a terminé avec le code ${r.code}.\n${r.stderr.slice(-1000)}` : '');
  return { texte: lu.texte, erreur, depasse: false, dureeMs: r.dureeMs, tokens: lu.tokens };
}
