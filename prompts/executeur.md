# Tâche {{id}}

Tu implémentes une seule tâche d'un plan validé. Un script vérifie ton travail après toi ; tout écart aux règles ci-dessous fait rejeter la tâche.

## La tâche

```yaml
{{tache_yaml}}
```

## Exigences concernées

{{exigences}}

## Rapport du rejet précédent

{{rapport_rejet}}

## Ce que tu dois faire

- Implémente la tâche et les tests prévus. Chaque `tests[].nom` est recopié tel quel dans un `it` / `test`, sans le renommer ni l'omettre.
- Tu peux ajouter des tests si leur nom commence par une exigence de la tâche (`EX-n — …`).
- Un test d'erreur vérifie le type de l'erreur, et son message exact quand la spec le fixe.
- Quand une exigence impose un ordre de validation (par exemple minutes, puis pas, puis mode), chaque cas combine deux entrées invalides qui lèvent des erreurs différentes, par leur type ou leur message : le test échoue si l'ordre est inversé.
- Ne touche qu'aux fichiers de `fichiers_prevus`.
- Ne commite pas : le script le fait.
- {{typecheck}}

## Ce qui fait rejeter la tâche

- `any` sous toutes ses formes ; `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` ; les commentaires `eslint-disable` sont ignorés.
- `.only`, `.skip`, `xit`, `describe.skip`, `test.todo`, `test.fails` ; un test sans assertion.
- Modifier ou supprimer un test existant, un hook partagé ou un helper existant d'un fichier absent de `tests_modifiables`. Renommer un test compte comme le supprimer.
- Mettre à jour un snapshot hors `tests_modifiables` ; augmenter un timeout de test.
- Modifier un fichier verrouillé : {{fichiers_verrouilles}}.
- Un test prévu absent, non exécuté ou en échec.
- Une nouvelle erreur de typecheck, ou un test de la suite complète qui passait et échoue.

## Ce qui est signalé à un arbitre

Fichier hors `fichiers_prevus`, `vi.mock()` / `jest.mock()` du module testé, assertions faibles seules (`toBeDefined()`, `toBeTruthy()`), `!` ou `as unknown as X`, `try/catch` qui avale l'erreur, nouvelle dépendance. Évite-les sauf nécessité réelle.

## Si quelque chose bloque

Arrête-toi, sans contourner, et termine ta réponse par une seule ligne :

`WF_REMONTEE {"type": "contradiction" | "test_non_modifiable" | "question", "message": "<explication>"}`

- `contradiction` : la tâche contredit la spec ou le plan.
- `test_non_modifiable` : tu dois modifier un fichier de test absent de `tests_modifiables`. Ne le modifie pas.
- `question` : une décision importante te manque.

Toute adaptation mineure que tu fais quand même va dans `.workflow/DEVIATIONS.md` (une ligne : tâche, adaptation, raison).
