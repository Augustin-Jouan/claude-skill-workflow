// Noms de tests prévus : « EX-n — description », recopiés tels quels dans le `it` / `test`.
// La normalisation sert à repérer deux noms qu'un humain confondrait.

const TETE_DE_NOM = /^(EX-\d+)\s+[-–—]\s+\S/i;

export function normaliserNomTest(nom: string): string {
  return nom.normalize('NFC').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

export function exigenceDuNom(nom: string): string | null {
  const m = TETE_DE_NOM.exec(nom.trim());
  return m ? m[1].toUpperCase() : null;
}
