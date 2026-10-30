# Choix du parcours

Pose les critères à l'utilisateur et propose un parcours. C'est lui qui tranche.

## Critères

**Complet** si au moins une condition est vraie :
- plus de 5 tâches estimées ;
- un changement de schéma de données, d'API publique ou d'architecture ;
- une fonctionnalité transverse.

**Micro** si toutes les conditions sont vraies :
- 1 ou 2 tâches estimées ;
- aucun changement de schéma de données, d'API publique ou d'architecture ;
- une fonctionnalité locale (un module, un écran).

**Court** dans tous les autres cas.

En cas de doute entre deux parcours, propose le plus léger. Propose de passer au parcours supérieur si l'audit, `check-plan` ou l'exécuteur révèle plus de complexité que prévu (par exemple un micro qui dépasse 2 tâches).

## Étapes par parcours

| Étape | Micro | Court | Complet |
|---|---|---|---|
| 1. Spec + relecture | oui | oui | oui |
| 2. Audit de la spec | non | non (fusionné avec l'étape 4) | oui |
| 3. Plan + `check-plan` | YAML minimal | oui | oui |
| 4. Audit du plan | non | un seul audit spec + plan | oui |
| 5. Relecture de la matrice | oui | oui | oui |
| 6. Exécution | oui | oui | oui |
| 7. Fin de branche | oui | oui | oui |

`wf state avancer` saute automatiquement les étapes absentes du parcours.

## Tâche E2E

- Micro : non exigée.
- Court : exigée, sauf `e2e_non_applicable` justifié dans l'en-tête du plan.
- Complet : exigée, sans dérogation.
