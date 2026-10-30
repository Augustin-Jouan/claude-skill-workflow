// Lecture minimale des arguments : positionnels et options --cle valeur / --drapeau.

export interface Arguments {
  positionnels: string[];
  options: Record<string, string | true>;
}

export function lireArguments(args: string[]): Arguments {
  const positionnels: string[] = [];
  const options: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const suivant = args[i + 1];
      if (suivant !== undefined && !suivant.startsWith('--')) {
        options[a.slice(2)] = suivant;
        i++;
      } else {
        options[a.slice(2)] = true;
      }
    } else {
      positionnels.push(a);
    }
  }
  return { positionnels, options };
}

export function texte(options: Arguments['options'], cle: string): string | undefined {
  const v = options[cle];
  return typeof v === 'string' ? v : undefined;
}

export function entier(options: Arguments['options'], cle: string): number | undefined {
  const v = texte(options, cle);
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined;
}
