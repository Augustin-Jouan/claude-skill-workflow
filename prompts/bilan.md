# Bilan du workflow — {{branche}}

Une branche vient de terminer le workflow de développement (parcours {{parcours}}). Ton rôle : dire comment améliorer **le workflow lui-même**, d'après ce que cette branche a réellement rencontré. Tu ne juges pas le code du projet.

Le workflow :
- spec avec des exigences `EX-n`, audits Cursor de la spec et du plan, plan en YAML validé par `check-plan`, matrice relue par le développeur ;
- `run-plan` : un exécuteur Cursor par tâche, `verify` (règles bloquantes et signalées), suite complète et typecheck, arbitre Claude après des rejets ou sur les signalements, questions au développeur, budgets ;
- `finish` : traçabilité, suite complète, typecheck, review neuve.

Ce qu'on peut changer : `prompts/executeur.md`, `prompts/arbitre.md`, les autres prompts, `config/defaults.ts` (seuils, budgets, fichiers verrouillés, modèles), une règle de `verify`, `references/plan-yaml.md` (format et règles du plan), `references/parcours.md`, les étapes de `SKILL.md`.

Règles de ta réponse :
- Chaque suggestion cite au moins un fait de la liste ci-dessous par son id (`E3`). Pas de conseil général sans fait observé.
- Une règle qui a bloqué un vrai problème n'est pas une difficulté : range-la dans `controles_utiles`. Ne propose d'assouplir un contrôle que si les faits montrent un faux positif (le développeur ou l'arbitre a donné raison au code, le même rejet revient sur du code correct).
- Au plus 5 suggestions, les plus utiles d'abord. Aucune suggestion est une bonne réponse si la branche s'est déroulée sans difficulté.
- La proposition dit quoi changer et où, assez précisément pour être appliquée telle quelle.

Réponds uniquement par ce bloc YAML :

```yaml
suggestions:
  - titre: "…"
    faits: ["E3", "E7"]
    cause: regle-trop-stricte   # ou faux-positif, consigne-executeur, plan, spec, budget, outil, autre
    proposition: "…"
    ou: "prompts/executeur.md"
    priorite: haute             # ou moyenne, basse
controles_utiles:
  - regle: "…"
    faits: ["E5"]
    raison: "…"
```

## Faits relevés (journal, étapes, DEVIATIONS.md)

{{evenements}}

## Fin de branche (contexte, non citable)

{{fin}}
