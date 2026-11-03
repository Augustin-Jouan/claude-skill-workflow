import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { CONFIG } from '../../config/defaults.ts';
import { argumentsClaude, argumentsCursor, commandeDeLancement, dossiersDInstallation, environnementClaude, environnementCursor, executer, lireResultat, trouverExecutable } from './llm.ts';

let dossier: string;
before(() => {
  dossier = mkdtempSync(join(tmpdir(), 'wf-llm-'));
});
after(() => rmSync(dossier, { recursive: true, force: true }));

test("trouve un exécutable sur le PATH, avec les extensions de PATHEXT sous Windows, dans l'ordre des noms", () => {
  writeFileSync(join(dossier, 'cursor-agent.cmd'), '');
  const env = { PATH: dossier, PATHEXT: '.EXE;.CMD' };
  assert.equal(trouverExecutable(['agent', 'cursor-agent'], env, 'win32'), join(dossier, 'cursor-agent.cmd'));
  writeFileSync(join(dossier, 'agent.cmd'), '');
  assert.equal(trouverExecutable(['agent', 'cursor-agent'], env, 'win32'), join(dossier, 'agent.cmd'));
  assert.equal(trouverExecutable(['absent'], env, 'win32'), null);
});

test("Cursor installé dans %LOCALAPPDATA% mais absent d'un PATH pas encore rechargé est trouvé quand même", () => {
  const local = join(dossier, 'local');
  mkdirSync(join(local, 'cursor-agent'), { recursive: true });
  writeFileSync(join(local, 'cursor-agent', 'agent.ps1'), '');
  const env = { PATH: join(dossier, 'vide'), PATHEXT: '.EXE;.CMD', LOCALAPPDATA: local };
  const secours = dossiersDInstallation('cursor-agent', env, 'win32');
  assert.equal(trouverExecutable(['agent', 'cursor-agent'], env, 'win32', secours), join(local, 'cursor-agent', 'agent.ps1'));
  assert.deepEqual(dossiersDInstallation('cursor-agent', env, 'linux'), []);
  assert.deepEqual(dossiersDInstallation('claude', env, 'win32'), []);
});

test('un .cmd passe par le shell avec des arguments entre guillemets, un .exe est lancé directement', () => {
  const cmd = commandeDeLancement('C:\\x\\agent.cmd', ['-p', 'Lis C:\\a b\\p.md', '']);
  assert.equal(cmd.shell, true);
  assert.equal(cmd.commande, '"C:\\x\\agent.cmd" "-p" "Lis C:\\a b\\p.md" ""');
  assert.deepEqual(commandeDeLancement('C:\\x\\claude.exe', ['-p']), { commande: 'C:\\x\\claude.exe', args: ['-p'], shell: false });
  assert.throws(() => commandeDeLancement('C:\\x\\agent.cmd', ['a"b']), /shell/);
  assert.throws(() => commandeDeLancement('C:\\x\\agent.cmd', ['100%']), /shell/);
});

test('un .ps1 est lancé par powershell -File', () => {
  const cmd = commandeDeLancement('C:\\x\\agent.ps1', ['-p']);
  assert.equal(cmd.shell, false);
  assert.deepEqual(cmd.args.slice(-3), ['-File', 'C:\\x\\agent.ps1', '-p']);
});

test("lit le résultat JSON de Cursor et de Claude, avec les tokens quand l'outil les donne", () => {
  const cursor = '{"type":"result","subtype":"success","is_error":false,"duration_ms":5,"result":"fait","session_id":"s"}\n';
  assert.deepEqual(lireResultat(cursor), { texte: 'fait', erreur: '', tokens: null });
  const claude = 'bruit\n{"type":"result","is_error":false,"result":"{}","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":2}}';
  assert.deepEqual(lireResultat(claude), { texte: '{}', erreur: '', tokens: 17 });
  // Cursor réel : usage en camelCase.
  const cursorReel = '{"type":"result","is_error":false,"result":"ok","usage":{"inputTokens":100,"outputTokens":20,"cacheReadTokens":300,"cacheWriteTokens":0}}';
  assert.equal(lireResultat(cursorReel).tokens, 420);
  assert.match(lireResultat('{"type":"result","is_error":true,"result":"quota"}').erreur, /quota/);
  assert.match(lireResultat('pas de json').erreur, /JSON/);
});

test('arguments Cursor : écriture forcée pour l\'exécuteur, mode ask en lecture seule pour l\'audit', () => {
  const ecrit = argumentsCursor('composer', 'agent', 'C:\\depot', 'consigne');
  assert.ok(ecrit.includes('--force') && !ecrit.includes('--mode'));
  const lit = argumentsCursor('grok', 'ask', 'C:\\depot', 'consigne');
  assert.ok(!lit.includes('--force'));
  assert.deepEqual(lit.slice(lit.indexOf('--mode'), lit.indexOf('--mode') + 2), ['--mode', 'ask']);
  assert.equal(lit.at(-1), 'consigne');
});

test("Claude est lancé hors de la session Claude Code qui l'appelle", () => {
  const env = environnementClaude({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_GIT_BASH_PATH: 'C:\\bash.exe', PATH: 'p' });
  assert.deepEqual(env, { CLAUDE_CODE_GIT_BASH_PATH: 'C:\\bash.exe', PATH: 'p', CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(CONFIG.seuils.sortieClaudeJetons) });
});

test("la sortie de Claude est plafonnée : une réponse qui boucle s'arrête en quelques minutes, pas à 128 000 jetons", () => {
  assert.equal(environnementClaude({ CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000' }).CLAUDE_CODE_MAX_OUTPUT_TOKENS, String(CONFIG.seuils.sortieClaudeJetons));
  assert.ok(CONFIG.seuils.sortieClaudeJetons <= 40_000);
  // La réflexion compte dans le plafond : une réponse réelle a pris 17 455 jetons. Au-delà du plafond, la CLI
  // relance le modèle et ne rend que la suite, sans le début du bloc YAML.
  assert.ok(CONFIG.seuils.sortieClaudeJetons >= 30_000);
});

test('Claude sans outils, ou avec les seuls outils de lecture du dépôt', () => {
  const sans = argumentsClaude('opus', false);
  assert.deepEqual(sans.slice(sans.indexOf('--tools'), sans.indexOf('--tools') + 2), ['--tools', '']);
  const lecture = argumentsClaude('opus', true);
  assert.deepEqual(lecture.slice(lecture.indexOf('--tools'), lecture.indexOf('--tools') + 2), ['--tools', 'Read,Grep,Glob']);
  assert.ok(!lecture.some((a) => /Bash|Edit|Write|PowerShell/.test(a)));
  assert.deepEqual(lecture.slice(lecture.indexOf('--model'), lecture.indexOf('--model') + 2), ['--model', 'opus']);
});

test("sous Windows, Cursor ne voit pas l'environnement de Git Bash : il y lancerait ses hooks PowerShell dans bash", () => {
  const env = environnementCursor({ HOME: '/c/Users/moi', USERPROFILE: 'C:\Users\moi', SHELL: '/usr/bin/bash', MSYSTEM: 'MINGW64', PATH: 'p' }, 'win32');
  assert.deepEqual(env, { HOME: 'C:\Users\moi', USERPROFILE: 'C:\Users\moi', PATH: 'p' });
  assert.deepEqual(environnementCursor({ HOME: '/home/moi', SHELL: '/bin/zsh', PATH: 'p' }, 'linux'), { HOME: '/home/moi', SHELL: '/bin/zsh', PATH: 'p' });
});

test("executer transmet l'entrée standard et rend la sortie", async () => {
  const script = join(dossier, 'echo.mjs');
  writeFileSync(script, 'process.stdin.pipe(process.stdout);');
  const r = await executer({ commande: process.execPath, args: [script], shell: false }, { cwd: dossier, entree: 'bonjour', timeoutMs: 10_000 });
  assert.deepEqual([r.code, r.stdout, r.depasse], [0, 'bonjour', false]);
});

test('executer arrête le processus et ses enfants au-delà du délai', async () => {
  const script = join(dossier, 'dort.mjs');
  writeFileSync(script, 'setTimeout(() => {}, 60_000);');
  const debut = Date.now();
  const r = await executer({ commande: process.execPath, args: [script], shell: false }, { cwd: dossier, timeoutMs: 500 });
  assert.equal(r.depasse, true);
  assert.ok(Date.now() - debut < 10_000);
});

test("executer rend la main quand le processus se termine, même si un petit-enfant garde les tuyaux ouverts", async () => {
  // Cas réel : un jest orphelin gardait stdout ouvert, 'close' n'arrivait jamais et run-plan restait figé.
  const script = join(dossier, 'orphelin.mjs');
  writeFileSync(
    script,
    "import { spawn } from 'node:child_process';\n" +
      "const p = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20_000)'], { stdio: 'inherit', detached: true, cwd: '..' });\n" +
      'p.unref();\n' +
      "console.log('pid ' + p.pid);\n",
  );
  const debut = Date.now();
  const r = await executer({ commande: process.execPath, args: [script], shell: false }, { cwd: dossier, timeoutMs: 30_000 });
  const pid = Number(/pid (\d+)/.exec(r.stdout)?.[1]);
  try {
    process.kill(pid);
  } catch {
    // Déjà terminé.
  }
  assert.equal(r.code, 0);
  assert.match(r.stdout, /pid \d+/);
  assert.ok(Date.now() - debut < 8_000, `rendu en ${Date.now() - debut} ms`);
});
