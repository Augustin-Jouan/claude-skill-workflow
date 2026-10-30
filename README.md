# Skill `workflow`

Mon workflow de développement, lancé par `/workflow` dans n'importe quel dépôt git. Le skill (`SKILL.md`) enchaîne les étapes et dialogue ; les scripts (`scripts/wf.ts`) font toutes les vérifications. Rien n'est installé ni commité dans le dépôt de travail : tout vit dans `.workflow/`, exclu de git localement.

Prérequis : Node ≥ 22.18 (exécute le TypeScript directement), git, et `npm install` une fois dans ce dossier (il installe aussi Stryker, qui n'est donc jamais ajouté au projet). Pour `audit`, `run-plan` et `finish` : Cursor Agent CLI (`agent`, connecté avec `agent login`) et Claude Code (`claude`) dans le PATH. Sous Windows, `agent` est aussi cherché dans `%LOCALAPPDATA%\cursor-agent`, pour un terminal ouvert avant son installation. Vérifie les identifiants de modèles de `config/defaults.ts` avec `agent --list-models`. Plus tard : herdr.

Tests du skill : `npm test` (runner intégré de Node) et `npm run typecheck`.

## Contrat des commandes

`node scripts/wf.ts <commande>` — codes de sortie : 0 validé, 1 échec à corriger, 2 erreur d'outil / non implémenté, 3 décision de l'utilisateur requise. Dernière ligne de stdout : `WF_RESULT {json}`.

| Commande | Rôle | État |
|---|---|---|
| `setup --parcours <p> --slug <nom>` | branche `wf/<nom>`, exclusion locale de `.workflow/`, état initial | ✅ (sans `--worktree`) |
| `state` / `state avancer` / `state revenir <étape>` | étape en cours, transitions selon le parcours, conditions de sortie (spec avec `EX-n`, `check-plan` vert sur la spec et le plan actuels, tri du dernier audit enregistré par `journal audit` pour quitter `audit-spec` et `audit-plan`) | ✅ |
| `journal audit` / `journal manuel` | lignes de mesure dans `journal.jsonl` | ✅ |
| `check-plan` | règles du plan + matrice générée | ✅ |
| `trace` | chaque `EX-n` présent dans un nom de `it` / `test` du dépôt | ✅ |
| `verify --task <id>` | vérification d'une tâche avant son commit (voir ci-dessous) | ✅ couches 1 et 2 |
| `audit <spec\|plan\|spec-plan> [--reprendre]` | audit Cursor headless, lecture seule, format vérifié (un préambule avant le premier point est ignoré). `--reprendre` relit la réponse du dernier appel sans relancer Cursor, si la spec et le plan n'ont pas changé et qu'elle n'est pas déjà enregistrée | ✅ |
| `run-plan` | orchestrateur des tâches (voir ci-dessous) | ✅ couche 3 |
| `answer "<réponse>"` | enregistre la réponse à la question de `run-plan` | ✅ |
| `finish [--sans-mutation]` | fin de branche (voir ci-dessous) | ✅ couche 4 |
| `executer [--sans-mutation]` | enchaîne `run-plan`, le passage à `fin` et `finish` (voir ci-dessous) | ✅ |
| `suivre` | affiche en direct ce que fait Cursor, dans un autre terminal (voir ci-dessous) | ✅ |
| `bilan` | propose des améliorations du workflow d'après ce que la branche a rencontré (voir ci-dessous) | ✅ |
| `setup --worktree` | worktree + espace herdr pour le parallèle | pas prévu : à construire seulement si l'usage en parallèle à la main en montre le besoin |

Une commande non implémentée renvoie 2 : le skill s'arrête et prévient, il ne contourne pas.

## `wf verify --task <id>`

Compare l'arbre de travail à HEAD (l'exécuteur ne commite pas). Code 0 accepté, 1 rejeté, 3 accepté avec signalements à trancher (tranchés par l'arbitre dans `run-plan`). Rapport dans `.workflow/rapports/<id>-verify.json`.

- **Bloquant** : fichier verrouillé (`config/defaults.ts`, y compris les `scripts` du `package.json`) ; test existant hors `tests_modifiables` modifié, supprimé ou renommé, hook ou helper existant touché (comparaison AST) ; snapshot mis à jour ; `any`, `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, `.only`, `.skip`, `x…`, `todo`, `fails`, test sans assertion, changement de timeout ; erreur du lint du projet (commentaires `eslint-disable` ignorés) ; test prévu absent, non exécuté ou en échec dans le reporter JSON.
- **Signalé** : fichier hors `fichiers_prevus`, nouvelle dépendance, `!`, `as unknown as`, catch qui avale l'erreur, assertions faibles seules, mock du module testé, test instable (passé à la relance).
- Les règles de code ne portent que sur les lignes modifiées. Elles sont appliquées par l'AST TypeScript du skill, pas par un plugin eslint : rien à installer dans le projet, aucun conflit avec sa config.
- Le runner (vitest ou jest) et eslint sont ceux du projet, lancés depuis ses `node_modules` avec `CI=true` (aucun snapshot écrit). Sans eslint configuré, seul le lint du projet est sauté, et c'est noté dans le rapport.
- Contrôle « rouge » des tâches `fix`, une fois leurs tests prévus verts. Un worktree git détaché sur HEAD est créé dans `.workflow/rouge` et reçoit les fichiers de test changés par la tâche. Le runner y est lancé (rapport `rapports/<id>-rouge.json`), puis le worktree est toujours supprimé. Chaque test prévu avec `comportement_existant: false` doit y échouer sur une assertion.
  - **Bloquant** : `rouge-deja-vert` (le test passe déjà sur l'ancien code), `rouge-sans-assertion` (il échoue pour une autre raison), `rouge-compilation` (le fichier ne se charge pas), `rouge-non-execute`.
  - **Signalé** : `test-ajoute-deja-vert` (un nouveau test hors plan passe déjà sur l'ancien code).
- Pas encore couverts : contrôle « rouge » des `feature` (option `seuils.controleRougeFeature`), monorepo avec `node_modules` imbriqués (non résolus depuis le worktree rouge), fichiers `setupFiles` / `globalSetup` comptés comme tests, alias d'import (`@/…`) pour repérer le mock du module testé.

## `wf run-plan`

Un script, pas un LLM. Il exécute les tâches dans l'ordre des `depends_on` et reprend là où il s'était arrêté (`.workflow/run.json`). Lance-le en arrière-plan : il peut durer.

1. Premier lancement : suite complète et typecheck sur HEAD. Leurs échecs déjà présents ne bloqueront pas.
2. `refactor` : couverture des fichiers prévus mesurée d'abord (`@vitest/coverage-v8` ou jest). Sous `seuils.couvertureRefactor` ou sans fournisseur : question.
3. Exécuteur Cursor (mode agent, prompt `prompts/executeur.md` avec la tâche, ses exigences et le dernier rapport de rejet). Avant l'appel, `.workflow/` (sauf `DEVIATIONS.md`) et les fichiers du skill sont photographiés, puis remis en place : toute modification est un bloquant `fichier-workflow-modifie`. Un commit de l'exécuteur est annulé (`commit-executeur`).
4. `eslint --fix` et `prettier --write` du projet sur les fichiers changés (hors tests protégés et fichiers verrouillés), puis `wf verify`.
5. Si verify passe : suite complète, échecs relancés une fois (instables journalisés), comparée à l'état de départ et à `quarantine.json` (`[{"fichier", "nom"}]`), plus les nouvelles erreurs de typecheck. Toute régression rejette.
6. Accepté → commit `feat|fix|refactor|test: <titre>` : le titre `## Tn — titre` du plan, à défaut ceux des EX, coupé sur un mot à 72 caractères ; `test` pour une tâche feature dont tous les fichiers prévus sont des tests. Rejeté → relance avec le rapport ; au 2e rejet (`seuils.rejetsAvantArbitre`) l'arbitre Claude donne une consigne, au suivant question. Signalements → arbitre, qui accepte ou rejette. `WF_REMONTEE` de l'exécuteur → arbitre une fois, puis question.
7. Question (code 3) : `.workflow/question.md`. On répond avec `wf answer`, ou on amende le plan (la question devient caduque).

Suite lente (durée de départ au-delà de `seuils.suiteRapideSecondes`) : après chaque tâche, seuls les tests liés aux fichiers de code changés tournent (`vitest related` / `jest --findRelatedTests`), plus le typecheck. La suite complète tourne aux jalons (`jalons:` de l'en-tête du plan, et toujours après la dernière tâche). Une régression confirmée au jalon lance un bisect dans `.workflow/bisect` (worktree détaché, seuls les fichiers de test en régression) entre le dernier jalon vert et HEAD, puis une question qui nomme la tâche fautive. Les commits restent acquis : on ajoute une tâche corrective (replanification) ou on répond pour continuer, et ces échecs ne bloquent plus la suite.

Modèle de l'exécuteur (`modeles.executeur`) : `simple` (composer-2.5) ou `complexe` (Grok 4.6) selon le champ `difficulte` de la tâche. Une tâche simple rejetée une fois par verify passe au modèle complexe pour les tentatives suivantes. Les audits (`modeles.audit`) prennent le modèle simple en parcours court ou pour une spec d'au plus `seuils.auditExigencesSimple` exigences, le complexe sinon. Chaque appel journalise `modele` et `raison`, repris dans la section « Modèles choisis » de `fin.md`.

Budgets (`config/defaults.ts`) : minutes par tâche (30), minutes et appels LLM par branche selon le parcours. Un dépassement est une question ; répondre à celle de la branche accorde une rallonge d'un budget entier.

## `wf finish`

À l'étape `fin`, sur un arbre propre, lancé en arrière-plan.

1. Traçabilité (`wf trace`), suite complète (échecs relancés une fois, comparés à l'état de départ, aux échecs admis aux jalons et à la quarantaine), typecheck. Un bloquant : `fin.md` partiel et code 1 ; la correction passe par une nouvelle tâche (`wf state revenir plan`).
2. Stryker sur les fichiers de code changés depuis le départ de run-plan (hors tests et fichiers verrouillés). Il lance le runner du projet sur les tests liés à chaque mutant (`testRunner: command`), au plus 4 processus à la fois, et écrit tout dans `.workflow/`. Si tous les mutants finissent en Timeout, c'est une erreur d'outil : le score ne mesurerait rien.
3. Survivants du code des tâches `feature`, sur les lignes changées depuis le départ de `run-plan` et jamais soumis lors d'une fin précédente de la branche (`.workflow/survivants-vus.json` : un survivant déjà soumis qui survit encore est un test que le développeur n'a pas retenu). Les autres sont listés à part, sans analyse. Les `seuils.strykerFichiersAnalyses` fichiers qui en ont le plus sont analysés par Claude (`prompts/survivants.md`). Il classe chaque survivant en équivalent ou propose un test `EX-n — …` (1 ou 2 assertions). Une réponse hors format ou qui cite un mutant inconnu est redemandée une fois.
4. Review par un contexte neuf (Claude, `prompts/review-neuve.md`) : spec, `DEVIATIONS.md` et diff de la branche, verdict `conforme`, `écarts mineurs` ou `écarts bloquants`.
5. `.workflow/fin.md` (contrôles, mutation, review, résumé du journal) et `.workflow/fin.json` (commit vérifié). `state avancer` depuis `fin` refuse si HEAD a changé depuis ou si l'arbre n'est pas propre.

`--sans-mutation` saute les étapes 2 et 3, et `fin.md` le signale.

Stryker garde ses résultats d'un run à l'autre (`.workflow/stryker-incremental.json`) seulement si, depuis le commit du run précédent (`.workflow/stryker-incremental.commit`), seuls des fichiers mutés ont changé. Avec `testRunner: command`, il ne voit pas les tests : un test ajouté depuis ne serait pas pris en compte. Sinon le run est complet ; `fin.md` dit lequel des deux a tourné.

Le résumé du journal compte les appels LLM lancés par les scripts et leurs jetons, par outil (Cursor, Claude). La session Claude qui pilote le workflow n'y est pas comptée.

## `wf executer`

C'est ce que lance le skill à l'étape 6, en arrière-plan. Il appelle `run-plan`, puis `state avancer` vers `fin`, puis `finish`, chacun comme sous-processus, et laisse passer leur progression. Depuis l'étape `fin`, seul `finish` tourne. La session qui pilote ne fait donc qu'un appel jusqu'à la revue finale, au lieu de relire chaque sortie.

- Une sous-commande qui ne rend pas 0 arrête la chaîne : executer rend son code et son message (3 : question dans `.workflow/question.md`, 1 : échec, 2 : erreur d'outil). Après `wf answer`, on relance `wf executer`.
- Code 0 : un résumé de `fin.md` d'une dizaine de lignes (contrôles, score de mutation, verdict de la review, suite proposée) et son chemin. La review, les survivants et le journal restent dans `fin.md`.

## `wf suivre`

Cursor tourne en arrière-plan (`--output-format stream-json`) : ses actions sont écrites au fil de l'eau sur la sortie de `wf audit`, `wf run-plan` et `wf executer` (lignes `  ┊ hh:mm:ss  …`, visibles dans le détail du shell d'arrière-plan de Claude Code ; `directSurSortie: false` dans `config/defaults.ts` les coupe. Claude les filtre avant de lire la sortie : elles ne coûtent aucun jeton) et dans `.workflow/cursor.log`, une ligne par action (fichier lu ou modifié, commande et son code, extrait de réflexion, réponse), avec un titre par appel (tâche, tentative, modèle et raison du choix). `wf suivre`, lancé depuis la racine du dépôt dans un autre terminal (ou un autre panneau herdr), affiche les 30 dernières lignes puis suit le fichier ; Ctrl+C pour quitter. Il ne touche à rien. Le flux brut complet reste dans `.workflow/llm/<appel>.sortie.txt`.

## `wf bilan`

À l'étape `termine`, après la revue finale. Le script relève les faits de la branche et les numérote (`E1`, `E2`…) : lignes du journal (règles déclenchées, rejets, arbitrages, questions et réponses, appels LLM en erreur, tests instables, jalons, mutation, review), passages et retours d'étape avec leurs notes, lignes de `DEVIATIONS.md`. Claude (`modeles.bilan`, contexte neuf, `prompts/bilan.md`) propose au plus 5 améliorations du workflow. Chacune cite ses faits, une cause (règle trop stricte, faux positif, consigne de l'exécuteur, plan, spec, budget, outil) et l'endroit à changer. Les règles qui ont arrêté un vrai problème sont rangées à part, comme contrôles qui ont servi. Une réponse hors format, ou qui cite un fait inexistant, est redemandée une fois.

Sortie : `.workflow/bilan.md`, et une copie dans `retours.dossier` (`~/.claude/workflow-retours/<date>-<dépôt>-<branche>.md`) pour relire les bilans de plusieurs branches ensemble. Rien n'est appliqué au skill.

## Travailler en parallèle

À la main, un worktree par fonctionnalité, à côté du dépôt :

1. `git worktree add --detach ../<dépôt>-<nom>` depuis le dépôt.
2. Dans ce dossier : l'installation du projet (`npm ci`, ou celle de son lockfile), et une copie des fichiers non suivis dont ses tests ont besoin (`.env`…).
3. Une session Claude dans ce dossier, puis `/workflow` : `setup` y crée la branche `wf/<nom>`. herdr à côté, un espace par worktree.
4. Après la fusion : `git worktree remove ../<dépôt>-<nom>` depuis le dépôt. Son `.workflow/` part avec lui (copie `fin.md` et `journal.jsonl` avant pour les garder) ; la branche reste.

Vérifié : chaque worktree a son propre `.workflow/`, indépendant des autres et du dépôt principal. L'exclusion est écrite une seule fois dans le `info/exclude` commun à tous les worktrees, et `git status` reste vide partout. Deux worktrees ne peuvent pas prendre le même nom (`setup` refuse, la branche existe déjà). Les worktrees temporaires de verify et du bisect se créent et se suppriment aussi depuis un worktree.

Rien ne limite les runs entre eux : 5 suites de tests, 5 Stryker et 5 exécuteurs peuvent tourner en même temps (CPU, limites de débit de Cursor et de Claude, ports ou base de test du projet).

## Fichiers dans `.workflow/<slug>/` (un dossier par branche `wf/<slug>`)

Chaque commande trouve son dossier d'après la branche courante : les workflows de plusieurs branches ne se mélangent pas (`run.json`, journal, rapports, cache Stryker), et chacun reprend quand on revient sur sa branche. Hors d'une branche `wf/…`, `wf state` répond qu'aucun workflow n'est en cours. Les messages de `wf` et le prompt de l'exécuteur donnent le chemin complet. La quarantaine est propre à chaque branche : ce dossier est protégé pendant l'exécuteur, la racine de `.workflow/` ne l'est pas.

`state.json`, `spec.md`, `plan.md`, `matrice.md`, `cursor.log` (actions de Cursor en direct, pour `wf suivre`), `check-plan.json` (dernier passage et empreintes), `rapports/` (verify, reporter des tests, couverture), `audits/` (`<phase>-<n>.md` et `.json`), `run.json` (état de run-plan), `run.lock`, `llm/` (prompts et sorties brutes des appels), `question.md`, `DEVIATIONS.md`, `journal.jsonl`, `quarantine.json`, `bisect/` (worktree temporaire du bisect), `fin.md`, `fin.json`, `bilan.md`, `stryker.config.json`, `stryker-incremental.json`, `stryker-tmp/`, `rapports/mutation.json` et `rapports/stryker.log`.

## Écarts avec `workflow-dev.md`

- `DEVIATIONS.md` et la quarantaine sont dans `.workflow/` et non dans le dépôt, pour ne rien imposer aux collègues.
- Le « lint verrouillé » n'ajoute pas de règles à la config eslint du projet : verify les applique lui-même par l'AST, puis lance le lint du projet tel quel. Même effet, sans plugin à installer chez les collègues.
- Spec et plan sont toujours deux fichiers. En micro et en court, ils sont écrits d'un seul tenant ; en court, un seul audit couvre les deux.
- L'accord de l'arbitre ne lève jamais un rejet du script : après la consigne de l'arbitre et un nouveau rejet, c'est une question.
- Un échec du commit (hook du projet) est une question, pas un rejet de l'exécuteur.
- Suite complète et typecheck sont comparés à leur état avant la première tâche.
- Le bisect est fait par le script (recherche dichotomique sur les commits des tâches dans un worktree de `.workflow/`), pas par `git bisect` : le dépôt et sa branche ne bougent pas. La dernière tâche est toujours un jalon.
- Des régressions acceptées à un jalon ne bloquent plus ensuite, ni à finish : elles figurent dans `fin.md`.
- Stryker tourne avec le runner du projet en ligne de commande (pas de plugin vitest/jest à installer dans le projet), sans analyse de couverture : plus lent, mais sans trace dans le dépôt. Le score de `fin.md` montre combien de mutants « tués » l'ont été par Timeout.
- Les audits ne comptent pas dans le budget d'appels LLM de la branche. Les jetons ne sont journalisés que pour Claude : Cursor ne les donne pas.

## Ordre de construction

1. `check-plan`, `trace`, `verify` (lint sur lignes modifiées, AST des tests, fichiers verrouillés, tests prévus verts), conditions de sortie dans `state avancer` (fait).
2. Contrôle « rouge » des `fix` (fait).
3. `run-plan`, `answer`, `audit` (appels headless, arbitre, budget, journal) (fait).
4. `finish` : jalons, `bisect`, Stryker, review neuve (fait).
5. `setup --worktree` et intégration herdr : pas prévu : à construire seulement si l'usage en parallèle à la main en montre le besoin.
