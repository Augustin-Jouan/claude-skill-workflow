# Mutants survivants — {{fichier}}

Le mutation testing a laissé survivre les mutants ci-dessous dans du code de tâches `feature`. Un mutant survivant signale un comportement qu'aucun test ne vérifie.

Pour chaque mutant :
- s'il est équivalent (le comportement ne change pas), dis-le et explique pourquoi ;
- sinon, propose un test qui le tue.

Les tests proposés passeront par l'orchestrateur comme une tâche `feature` de caractérisation. Chaque test a **une ou deux assertions, jamais plus**. Un troisième point à vérifier, même sur le même mutant, va dans un test de plus. Un test peut tuer plusieurs mutants. Son nom commence par « EX-n — », avec un tiret cadratin.

Réponds uniquement par ce bloc YAML :

```yaml
equivalents:
  - mutant: "<id>"
    raison: "…"
tests:
  - nom: "EX-n — …"          # une exigence existante de la spec
    assertions: ["…"]         # une ou deux, jamais plus
    comportement_existant: true
    mutants: ["<id>", "…"]
```

## Exigences

{{exigences}}

## Mutants survivants

{{mutants}}

## Code du fichier

{{code}}
