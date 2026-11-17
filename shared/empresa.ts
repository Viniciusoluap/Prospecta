// Endereço da sede como o site já mostra (rodapé da Home e dados estruturados do SEO). Fonte única: o termo de
// consentimento (EPIC-024 S-12) usa este mesmo texto, para não haver dois endereços diferentes.
export const SEDE = { rua: "R. Gonçalves Dias, 1993 - Juçara", cidade: "Imperatriz", uf: "MA", cep: "65900-545" } as const;

/** "R. Gonçalves Dias, 1993 - Juçara, Imperatriz - MA, 65900-545" */
export const ENDERECO_DA_SEDE = `${SEDE.rua}, ${SEDE.cidade} - ${SEDE.uf}, ${SEDE.cep}`;
