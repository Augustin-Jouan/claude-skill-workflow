# Audit de spécification et de plan (parcours court)

Tu fais en une seule passe l'audit de la spécification et celui du plan. Un script a déjà vérifié la structure du plan. Tu ne proposes pas d'implémentation.

Pour la spécification, cherche :
- les exigences ambiguës, contradictoires ou impossibles à tester ;
- les cas limites et cas d'erreur absents ;
- les impacts non mentionnés sur l'existant.

Pour le plan, vérifie :
1. Les assertions prévues vérifient bien l'exigence qu'elles portent.
2. L'ordre des tâches a du sens au-delà des dépendances déclarées.
3. Aucune tâche qui change un comportement existant n'oublie un fichier dans `tests_modifiables`.
4. Les `fichiers_prevus` sont plausibles et complets.

Réponds uniquement par une liste numérotée, une ligne par point, de la forme :

`A-<n> [bloquant|majeur|mineur] <EX-x, T-x ou "général"> — <problème> — <suggestion>`

Si tu ne trouves rien, réponds `Aucun point.`

## Spécification

{{spec}}

## Plan

{{plan}}

## Matrice de traçabilité

{{matrice}}
