# Format du plan (`.workflow/plan.md`)

Le plan est du Markdown. Les scripts ne lisent que ses blocs ```` ```yaml ````. Le premier bloc est l'en-tête ; chaque bloc suivant décrit une ou plusieurs tâches. Les tâches du plan servent directement de découpage.

Donne à chaque tâche un titre `## Tn — titre` au-dessus de son bloc : c'est le sujet de son commit. Décris ce que la tâche apporte, en moins de 65 caractères (au-delà, il est coupé).

## En-tête

```yaml
parcours: court            # micro | court | complet
# Parcours court uniquement, si aucune tâche E2E n'a de sens :
e2e_non_applicable: "correctif interne, aucun parcours utilisateur modifié"
# Facultatif : tâches après lesquelles la suite complète est lancée
jalons: [T3, T6]
```

Aucun autre champ n'est accepté, dans l'en-tête comme dans les tâches : une faute de frappe (`depend_on`) fait échouer `check-plan`.

## Tâche

```yaml
- id: T3
  type: feature            # feature | fix | refactor
  difficulte: simple       # simple | complexe
  e2e: false               # true pour une tâche d'intégration / E2E
  exigences: [EX-2, EX-4]
  depends_on: [T1]
  fichiers_prevus:
    - src/billing/invoice.ts
    - src/billing/invoice.test.ts
  tests:
    - nom: "EX-2 — refuse une facture sans client"
      assertions: ["lève InvoiceError"]
      comportement_existant: false
  tests_modifiables:
    - fichier: test/fixtures/invoice.ts
      raison: "ajout du champ client obligatoire"
```

## Champs

- `type`
  - `feature` : de nouveaux tests sont obligatoires.
  - `fix` : au moins un test de régression, marqué `comportement_existant: false`. `wf verify` le lance sur l'ancien code (HEAD) : il doit y échouer sur une assertion. Un test qui ne fait que figer un comportement déjà correct prend `comportement_existant: true` et n'est pas soumis à ce contrôle.
  - `refactor` : aucun changement de comportement. Si la couverture des `fichiers_prevus` est sous le seuil, ajoute d'abord une tâche `feature` de tests de caractérisation (`comportement_existant: true`).
- `difficulte` : choisit le modèle Cursor de l'exécuteur (`config/defaults.ts`, `modeles.executeur`).
  - `simple` : changement local et guidé par les tests prévus (une fonction, un module, un motif déjà présent dans le code). Modèle rapide (composer-2.5).
  - `complexe` : logique délicate (algorithme, concurrence, cas limites nombreux), plusieurs modules à coordonner, ou code existant à comprendre avant d'agir. Modèle de raisonnement (Grok 4.6), plus lent.
  - En cas de doute, `simple` : une tâche simple rejetée une fois par verify passe d'elle-même au modèle complexe.
- `tests` (tâches `feature` et `fix`) : un nom `EX-n — …` et **une ou deux assertions clés**, pas plus. Le nom est recopié tel quel dans le `it` / `test`.
- `fichiers_prevus` : tous les fichiers que la tâche crée ou modifie, tests compris.
- `tests_modifiables` : fichiers de test existants que la tâche peut modifier ou supprimer, chacun avec une raison. Liste vide par défaut.
- `e2e: true` : tâche d'intégration / E2E explicite.
- Parcours micro : seuls `id`, `type`, `exigences`, `fichiers_prevus` et `tests` sont obligatoires ; `difficulte` vaut `simple` par défaut.

Ajoute des jalons seulement si la suite complète prend plus de 2 minutes.

## Règles de `check-plan`

Chaque violation est préfixée par le nom de sa règle. Il échoue si :
- `[format]` le YAML est invalide, une `difficulte` n'est ni `simple` ni `complexe`, un champ est inconnu, manquant ou du mauvais type, un test a zéro ou plus de deux assertions, un `id` est dupliqué ;
- `[spec]` la spec n'a aucun titre `EX-n — titre`, ou en définit un deux fois ;
- `[parcours]` l'en-tête ne reprend pas le parcours du workflow ;
- `[exigence-inconnue]` une tâche cite un `EX-n` absent de la spec ;
- `[couverture-tache]` / `[couverture-test]` un `EX-n` de la spec n'est couvert par aucune tâche, ou par aucun test ;
- `[tests-manquants]` une tâche `feature` ou `fix` n'a pas de `tests` ;
- `[fix-sans-regression]` une tâche `fix` n'a aucun test avec `comportement_existant: false` ;
- `[nom-test]` un nom de test ne commence pas par `EX-n — ` avec une exigence de sa tâche ;
- `[nom-duplique]` deux tests prévus portent le même nom (casse, espaces et tirets `-` `–` `—` confondus) ;
- `[raison-manquante]` une entrée de `tests_modifiables` n'a pas de raison ;
- `[dependance-inconnue]` / `[cycle]` un `depends_on` cite une tâche inexistante ou crée un cycle ;
- `[jalon-inconnu]` un jalon cite une tâche inexistante ;
- `[e2e]` il n'y a aucune tâche `e2e: true`, sauf en parcours court avec un `e2e_non_applicable` justifié (règle absente en micro, dérogation interdite en complet, inutile s'il y a une tâche E2E).

Quand il passe, il génère `.workflow/matrice.md` (exigence → tâche(s) → test(s) → assertions, plus l'ordre d'exécution et la difficulté de chaque tâche). Tu n'écris jamais la matrice à la main. Quand il échoue, il supprime la matrice précédente. `wf state avancer` refuse de quitter les étapes plan, audit-plan et matrice tant que le dernier `check-plan` n'est pas vert sur la spec et le plan actuels.
