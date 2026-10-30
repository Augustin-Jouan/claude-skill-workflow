---
name: workflow
description: À utiliser quand l'utilisateur tape /workflow dans un dépôt git pour développer une fonctionnalité avec son workflow spec → plan → exécution contrôlée par scripts, ou pour reprendre un workflow en cours (un dossier .workflow/<slug>/ existe pour la branche courante).
disable-model-invocation: true
---

# Workflow de développement

**Principe :** tu conduis les étapes et tu dialogues avec l'utilisateur, mais tu ne valides rien toi-même. Chaque étape se termine par une commande `wf`, et seul son code de sortie te fait avancer.

`wf` désigne `node "<dossier de ce skill>/scripts/wf.ts"` (le dossier est indiqué en tête du skill chargé). Lance-la toujours depuis la racine du dépôt.

## Codes de sortie

| Code | Signification | Ce que tu fais |
|---|---|---|
| 0 | Étape validée | Tu passes à la suite |
| 1 | Échec à corriger | Tu corriges ce que le rapport indique et tu relances la même commande |
| 2 | Erreur d'outil ou commande pas encore implémentée | Tu arrêtes le workflow et tu montres le message à l'utilisateur |
| 3 | Décision de l'utilisateur requise | 🛑 Tu montres la question et tu attends sa réponse |

La dernière ligne de sortie, `WF_RESULT {...}`, donne le détail en JSON. Un code 1 qui revient 3 fois pour la même raison devient un 🛑 : montre le rapport à l'utilisateur.

**🛑 = arrêt :** tu montres ce qui est demandé, tu termines ton tour et tu attends la réponse. Quand l'utilisateur valide, tu lances `wf state avancer --note "<ce qu'il a validé>"`. Il refuse (code 1) tant que l'étape n'est pas réellement terminée (spec sans `EX-n`, plan sans `wf check-plan` vert sur sa version actuelle) : corrige ce qu'il liste.

## Étapes

### 0. Démarrer ou reprendre
1. `wf state`. Si un workflow est en cours sur cette branche, annonce l'étape et reprends-la.
2. Sinon, choisis le parcours avec l'utilisateur selon `references/parcours.md`, propose un nom court, puis `wf setup --parcours <micro|court|complet> --slug <nom>`.

`wf audit` et `wf executer` se lancent en arrière-plan (`run_in_background`). Leur sortie montre en direct ce que fait Cursor (lignes `┊`) : c'est pour l'utilisateur, qui la suit dans le détail du shell, ou avec `wf suivre` dans un autre terminal. À leur notification, lis la sortie sans ces lignes : `grep -v '^  ┊' <fichier de sortie> | tail -n 40`. Le verdict est la dernière ligne, `WF_RESULT`. Ne lis jamais le direct : il coûterait des jetons pour rien.

Chaque branche `wf/<slug>` a son dossier `.workflow/<slug>/`, que `wf state` affiche. Dans ce skill et ses références, `.workflow/spec.md` veut dire `.workflow/<slug>/spec.md`, et ainsi de suite ; les messages de `wf` donnent déjà le chemin complet. Ne touche pas aux dossiers des autres branches.

### 1. Spec → `.workflow/spec.md`
Brainstorming avec l'utilisateur, une question à la fois. Rédige ensuite la spec : une section `### EX-n — titre` par exigence (comportement attendu, cas limites). Un numéro `EX-n` n'est jamais réutilisé.
🛑 Relecture de la spec. Tu appliques ses corrections. En parcours micro, il ajuste directement ici.

### 2. Audit de la spec (parcours complet)
`wf audit spec` en arrière-plan, puis tri selon `references/tri-audit.md`. S'il y a des rejets : 🛑 Relecture des rejets. Sans rejet, tu enchaînes seul. Tu modifies la spec, puis `wf journal audit ...`. Après un code 2 « hors format », `wf audit <phase> --reprendre` relit la dernière réponse sans relancer Cursor, seulement si l'utilisateur le demande.

### 3. Plan → `.workflow/plan.md`
Rédige le plan selon `references/plan-yaml.md`, avec la `difficulte` de chaque tâche (elle choisit le modèle de l'exécuteur). Lance `wf check-plan` jusqu'au code 0.

### 4. Audit du plan (parcours court et complet)
`wf audit plan` (complet) ou `wf audit spec-plan` (court) en arrière-plan, puis tri. S'il y a des rejets : 🛑 Relecture des rejets. Sans rejet, tu enchaînes seul. Tu modifies, `wf journal audit ...`, puis `wf check-plan` jusqu'au code 0.

### 5. Relecture de la matrice (tous les parcours)
Montre `.workflow/matrice.md` en entier. 🛑 Relecture, difficultés comprises. Si une assertion ou une difficulté change : modifie le plan, `wf check-plan`, remontre la matrice.

### 6. Exécution et fin de branche
Lance `wf executer` en arrière-plan (`run_in_background`) et attends sa notification, sans le relancer ni lire son état entre-temps. Il enchaîne `run-plan`, le passage à l'étape `fin` et `finish`, et ne rend la main qu'à une décision du développeur. `--sans-mutation` seulement si l'utilisateur le demande lui-même.
- Code 3 : montre `.workflow/question.md`, 🛑, enregistre la réponse avec `wf answer "<réponse>"` (ses mots, pas les tiens), relance `wf executer`.
  Question de jalon (la suite complète a régressé) : présente-la, l'utilisateur choisit entre continuer (`wf answer`) et une tâche corrective, qui est une replanification. Si la question est une replanification : toi seul amendes le YAML, tu notes la raison dans `.workflow/DEVIATIONS.md`, `wf check-plan`. Si des tests ou des assertions changent, `wf state revenir matrice --note "..."` et retour à l'étape 5.
- Code 1 : montre le message. S'il vient de `finish`, la correction est une nouvelle tâche (`wf state revenir plan`, puis les étapes 3 à 6).
- Code 2 : montre le message et arrête-toi.
- Code 0 : passe à l'étape 7.

### 7. Revue finale
Présente le résumé que `wf executer` a rendu, tel quel, avec le chemin `.workflow/fin.md`. N'ouvre `fin.md` que pour la partie que l'utilisateur demande (review, survivants, journal). 🛑 Revue finale.
Si l'utilisateur retient des tests proposés ou des écarts de la review : `wf state revenir plan --note "..."`, ajoute une tâche (feature avec `comportement_existant: true` pour les tests), puis les étapes 3 à 6. Quand il valide : `wf state avancer --note "..."`. Tu ne pousses rien et tu n'ouvres pas de PR sans demande explicite.

### 8. Bilan du workflow
Une fois l'étape `termine` atteinte, lance `wf bilan` et montre `.workflow/bilan.md` en entier, avec le chemin de sa copie dans le dossier des retours. Ce sont des propositions pour améliorer le workflow : tu n'en appliques aucune, ni au skill ni au projet, sans demande explicite. Code 2 : montre le message ; la branche reste terminée.

## Interdits
- Écrire ou modifier du code ou des tests toi-même aux étapes 6 et 7 : seul l'exécuteur lancé par `wf executer` le fait.
- Lancer `run-plan`, `state avancer` ou `finish` à la place de `wf executer` à l'étape 6.
- Remplacer un contrôle `wf` par ta propre vérification, y compris quand la commande renvoie 2.
- Modifier un fichier verrouillé (liste dans `config/defaults.ts`) ou un fichier de ce skill, y compris pour appliquer une suggestion du bilan.
- Commiter ou pousser le contenu de `.workflow/`.
- Utiliser un autre skill qui écrit dans le dépôt ou committe (brainstorming, writing-plans…) : leurs formats ne sont pas ceux du workflow.

## Signaux d'alerte

| Si tu penses… | Alors |
|---|---|
| « wf n'est pas implémentée, je vérifie à la main » | Arrêt. Le code 2 se signale, il ne se contourne pas. |
| « check-plan bloque pour un détail » | Le détail fait partie du contrat. Corrige. |
| « l'utilisateur a déjà validé quelque chose de proche » | Chaque 🛑 est un nouvel arrêt. |
| « je corrige le code moi-même, ce sera plus rapide » | Étape 6 : seul l'exécuteur de `wf executer` touche au code. |
| « je lis toute la sortie de l'audit ou d'executer » | Le direct de Cursor est pour l'utilisateur : `grep -v '^  ┊'` puis `tail -n 40`. |
| « je lis fin.md en entier pour bien présenter » | Le résumé de `wf executer` suffit ; le reste à la demande. |
| « je lis l'audit et j'avance » | Tri complet et journalisé. Des rejets : montrés, arrêt. |
| « aucun rejet, mais je demande quand même » | Rien à trancher : applique, journalise, annonce, enchaîne. |
