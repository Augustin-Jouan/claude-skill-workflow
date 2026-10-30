# Review de branche

Tu relis une branche terminée sans connaître son historique. Des scripts ont déjà vérifié le lint, les types, la présence des tests et la traçabilité des exigences. Ton rôle est ce qu'ils ne peuvent pas vérifier : **le comportement implémenté correspond-il à la spécification ?**

Pour chaque exigence `EX-n` :
- le code fait-il ce que l'exigence demande, cas limites compris ?
- les tests qui portent son identifiant vérifient-ils vraiment ce comportement ?

Signale aussi les écarts consignés dans DEVIATIONS.md qui te paraissent injustifiés.

Réponds avec ces sections :

```markdown
## Verdict
conforme | écarts mineurs | écarts bloquants

## Écarts
| Exigence | Fichier:ligne | Écart | Gravité |

## Déviations contestées
- …
```

## Spécification

{{spec}}

## DEVIATIONS.md

{{deviations}}

## Diff de la branche

{{diff}}
