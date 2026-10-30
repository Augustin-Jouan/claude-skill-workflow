# Tri d'un audit

`wf audit` écrit l'audit brut dans `.workflow/audits/`. L'utilisateur ne le relit pas en détail : tu le tries.

## Ce que tu produis

Écris `.workflow/audits/<phase>-<n>-tri.md`, à côté de l'audit `<phase>-<n>.md` qu'il trie, avec exactement ces deux sections. La suite dépend de la table des rejets (voir « Selon les rejets »).

```markdown
## Rejets (à relire)

| Point | Gravité | Résumé du point | Raison du rejet |
|---|---|---|---|
| A-3 | majeur | … | … |

## Acceptés

- A-1 (bloquant) : … → modification prévue : …
- A-2 (mineur) : … → modification prévue : …
```

- Chaque point de l'audit apparaît une seule fois, soit dans les rejets, soit dans les acceptés, avec son numéro d'origine.
- Un rejet a toujours une raison concrète, liée à la spec, au plan ou au code existant.
- Si un point demande une décision de l'utilisateur, mets-le dans les rejets avec la raison « décision à prendre » et pose la question.

## Selon les rejets

**La table des rejets a au moins une ligne** : 🛑 montre la section **Rejets** à l'utilisateur et attends sa relecture. Ensuite :

1. Applique les points acceptés, plus les rejets que l'utilisateur a renversés.
2. Pose les questions qui restent.
3. Enregistre le tri : `wf journal audit --phase <spec|plan|spec-plan> --remontes N --acceptes N --rejetes N`. Les nombres comptent l'état final, après la relecture de l'utilisateur.

**La table des rejets est vide** : rien n'attend l'utilisateur, tu enchaînes sans lui demander son accord.

1. Applique les points acceptés.
2. Enregistre le tri : `wf journal audit --phase <phase> --remontes N --acceptes N --rejetes 0`.
3. Annonce en une ligne par point ce que tu as changé, avec le chemin de `<phase>-<n>-tri.md`.
4. `wf state avancer --note "audit <phase> : N point(s) appliqué(s), aucun rejet"`, puis passe à l'étape suivante. À l'étape 4, lance d'abord `wf check-plan` jusqu'au code 0.

Dans les deux cas, `wf state avancer` refuse de quitter l'étape d'audit tant que le tri du dernier audit n'est pas enregistré.
