# Review des corrections

Une première review a relu toute la branche et relevé des écarts. Le développeur en a retenu une partie, et une tâche de correction vient d'être committée. Tu relis **seulement cette correction** : le diff ci-dessous part du commit de la review précédente. Des scripts ont déjà vérifié le lint, les types, la présence des tests et la suite complète.

Vérifie :
- que chaque écart corrigé par ce diff l'est vraiment, cas limites compris, et qu'un test le vérifie ;
- que la correction ne casse pas un comportement de la spécification.

Ne relis pas le reste de la branche, déjà revu. Un écart de la review précédente que ce diff ne touche pas n'a pas été retenu par le développeur : ne le signale pas à nouveau.

Le diff ne montre que les lignes changées. Le dépôt est ton dossier de travail, dans l'état final de la branche : lis avec Read, Grep et Glob le code qu'il appelle sans le montrer, au lieu de supposer ce qu'il fait. N'écris pas d'appel d'outil dans ta réponse : elle ne contient que les sections ci-dessous.

Réponds avec ces sections :

```markdown
## Verdict
conforme | écarts mineurs | écarts bloquants

## Écarts
| Exigence | Fichier:ligne | Écart | Gravité |

## Déviations contestées
- …
```

## Écarts relevés par la review précédente

{{precedents}}

## Spécification

{{spec}}

## DEVIATIONS.md

{{deviations}}

## Diff des corrections

{{diff}}
