# Audit de plan d'exécution

Un script a déjà vérifié la structure du plan (couverture des exigences, dépendances, noms de tests). Tu juges uniquement ce qu'un script ne peut pas juger. Tu ne reviens pas sur le contenu de la spécification.

Vérifie :
1. Les assertions prévues vérifient bien l'exigence qu'elles portent.
2. L'ordre des tâches a du sens au-delà des dépendances déclarées.
3. Aucune tâche qui change un comportement existant n'oublie un fichier dans `tests_modifiables`.
4. Les `fichiers_prevus` sont plausibles et complets, au vu du code existant.

Réponds uniquement par une liste numérotée, une ligne par point, de la forme :

`A-<n> [bloquant|majeur|mineur] <T-x ou EX-x> — <problème> — <suggestion>`

Si tu ne trouves rien, réponds `Aucun point.`

## Spécification (pour contexte)

{{spec}}

## Plan

{{plan}}

## Matrice de traçabilité

{{matrice}}
