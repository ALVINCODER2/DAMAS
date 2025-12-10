// utils/constants.js

const standardOpening = [
  [0, "p", 0, "p", 0, "p", 0, "p"], // R0 (b8, d8, f8, h8)
  ["p", 0, "p", 0, "p", 0, "p", 0], // R1 (a7, c7, e7, g7)
  [0, "p", 0, "p", 0, "p", 0, "p"], // R2 (b6, d6, f6, h6)
  [0, 0, 0, 0, 0, 0, 0, 0], // R3 (a5, c5, e5, g5)
  [0, 0, 0, 0, 0, 0, 0, 0], // R4 (b4, d4, f4, h4)
  ["b", 0, "b", 0, "b", 0, "b", 0], // R5 (a3, c3, e3, g3)
  [0, "b", 0, "b", 0, "b", 0, "b"], // R6 (b2, d2, f2, h2)
  ["b", 0, "b", 0, "b", 0, "b", 0], // R7 (a1, c1, e1, g1)
];

const standardOpening10x10 = [
  [0, "p", 0, "p", 0, "p", 0, "p", 0, "p"],
  ["p", 0, "p", 0, "p", 0, "p", 0, "p", 0],
  [0, "p", 0, "p", 0, "p", 0, "p", 0, "p"],
  ["p", 0, "p", 0, "p", 0, "p", 0, "p", 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, "b", 0, "b", 0, "b", 0, "b", 0, "b"],
  ["b", 0, "b", 0, "b", 0, "b", 0, "b", 0],
  [0, "b", 0, "b", 0, "b", 0, "b", 0, "b"],
  ["b", 0, "b", 0, "b", 0, "b", 0, "b", 0],
];

// --- 20 SORTEIOS TABLITA CORRIGIDOS E VERIFICADOS ---
// Nota: 'p' = preta (cima), 'b' = branca (baixo).
// Casas jogáveis:
// R0, R2, R4, R6: Colunas ímpares [1, 3, 5, 7]
// R1, R3, R5, R7: Colunas pares [0, 2, 4, 6]

const idfTablitaOpenings = [
  {
    name: "1. c3-d4 f6-g5 2. b2-c3 (Clássica)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 (idx 5) vazio
      [0, 0, 0, 0, 0, 0, "p", 0], // R3: g5 (idx 6) ocupado
      [0, 0, 0, "b", 0, 0, 0, 0], // R4: d4 (idx 3) ocupado
      ["b", 0, "b", 0, "b", 0, "b", 0], // R5: c3 (idx 2) ocupado (era de b2)
      [0, 0, 0, "b", 0, "b", 0, "b"], // R6: b2 (idx 1) vazio
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "2. c3-d4 f6-e5 3. d4xf6 g7xe5 (Cruz)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, 0, 0], // R1: g7 (idx 6) vazio
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 (idx 5) vazio
      [0, 0, 0, 0, "p", 0, 0, 0], // R3: e5 (idx 4) ocupado
      [0, 0, 0, 0, 0, 0, 0, 0], // R4: d4 vazio (capturado)
      ["b", 0, 0, 0, "b", 0, "b", 0], // R5: c3 vazio
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "3. c3-d4 f6-g5 3. g3-h4 (Abertura Forte)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 vazio
      [0, 0, 0, 0, 0, 0, "p", 0], // R3: g5 (idx 6) ocupado
      [0, 0, 0, "b", 0, 0, 0, "b"], // R4: d4 (idx 3) e h4 (idx 7) ocupados
      ["b", 0, 0, 0, "b", 0, 0, 0], // R5: c3 e g3 vazios
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "4. c3-b4 f6-e5 3. e3-f4 (Gambito Central)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 vazio
      [0, 0, 0, 0, "p", 0, 0, 0], // R3: e5 (idx 4) ocupado
      [0, "b", 0, 0, 0, "b", 0, 0], // R4: b4 (idx 1) e f4 (idx 5) ocupados
      ["b", 0, 0, 0, 0, 0, "b", 0], // R5: c3 e e3 vazios
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "5. g3-f4 f6-e5 (Defesa Russa)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 vazio
      [0, 0, 0, 0, "p", 0, 0, 0], // R3: e5 (idx 4) ocupado
      [0, 0, 0, 0, 0, "b", 0, 0], // R4: f4 (idx 5) ocupado
      ["b", 0, "b", 0, "b", 0, 0, 0], // R5: g3 vazio
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "6. c3-d4 b6-a5 3. d4-c5 (Ataque C5)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, 0, 0, "p", 0, "p", 0, "p"], // R2: b6 (idx 1) vazio
      ["p", 0, "b", 0, 0, 0, 0, 0], // R3: a5 (idx 0) e c5 (idx 2, branca)
      [0, 0, 0, 0, 0, 0, 0, 0], // R4: d4 vazio
      ["b", 0, 0, 0, "b", 0, "b", 0], // R5: c3 vazio
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "7. e3-d4 d6-c5 3. b2-c3 (Troca Asa)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, "p", 0, "p"], // R2: d6 (idx 3) vazio (movido para c5)
      [0, 0, "p", 0, 0, 0, 0, 0], // R3: c5 (idx 2) ocupado por preta
      [0, 0, 0, "b", 0, 0, 0, 0], // R4: d4 (idx 3) ocupado
      ["b", 0, "b", 0, 0, 0, "b", 0], // R5: e3 vazio
      [0, 0, 0, "b", 0, "b", 0, "b"], // R6: b2 vazio (foi para c3)
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  // Correção: d6 para c5 deixa d6 vazio em R2.
  // Na linha acima [0, "p", "p", "p", 0, "p", 0, "p"] -> indices 1,3,5,7.
  // Se d6 (idx 3) sai, fica 0.

  {
    name: "8. a3-b4 b6-a5 (Simétrica Lateral)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, 0, 0, "p", 0, "p", 0, "p"], // R2: b6 (idx 1) vazio
      ["p", 0, 0, 0, 0, 0, 0, 0], // R3: a5 (idx 0) ocupado
      [0, "b", 0, 0, 0, 0, 0, 0], // R4: b4 (idx 1) ocupado
      [0, 0, "b", 0, "b", 0, "b", 0], // R5: a3 (idx 0) vazio
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "9. c3-d4 h6-g5 3. b2-c3 (Defesa H6)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, "p", 0, 0], // R2: h6 (idx 7) vazio
      [0, 0, 0, 0, 0, 0, "p", 0], // R3: g5 (idx 6) ocupado
      [0, 0, 0, "b", 0, 0, 0, 0], // R4: d4 (idx 3) ocupado
      ["b", 0, "b", 0, "b", 0, "b", 0], // R5: c3 ocupado (veio de b2)
      [0, 0, 0, "b", 0, "b", 0, "b"], // R6: b2 vazio
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "10. g3-h4 f6-e5 3. h2-g3 (Gambito H4)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 (idx 5) vazio
      [0, 0, 0, 0, "p", 0, 0, 0], // R3: e5 (idx 4) ocupado
      [0, 0, 0, 0, 0, 0, 0, "b"], // R4: h4 (idx 7) ocupado
      ["b", 0, "b", 0, "b", 0, "b", 0], // R5: g3 ocupado (veio de h2)
      [0, "b", 0, "b", 0, "b", 0, 0], // R6: h2 vazio
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "11. c3-b4 f6-g5 3. g3-f4 (Ataque Misto)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 vazio
      [0, 0, 0, 0, 0, 0, "p", 0], // R3: g5 ocupado
      [0, "b", 0, 0, 0, "b", 0, 0], // R4: b4 (idx 1) e f4 (idx 5)
      ["b", 0, 0, 0, "b", 0, 0, 0], // R5: c3 e g3 vazios
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "12. e3-f4 f6-e5 3. d2-e3 (Centro Sólido)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 vazio
      [0, 0, 0, 0, "p", 0, 0, 0], // R3: e5 ocupado
      [0, 0, 0, 0, 0, "b", 0, 0], // R4: f4 ocupado
      ["b", 0, "b", 0, "b", 0, "b", 0], // R5: e3 ocupado (veio de d2)
      [0, 0, 0, "b", 0, "b", 0, "b"], // R6: d2 vazio
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "13. c3-d4 f6-g5 3. d4-c5 (Avanço Central)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 vazio
      [0, 0, "b", 0, 0, 0, "p", 0], // R3: c5 (idx 2, branca) e g5 (idx 6, preta)
      [0, 0, 0, 0, 0, 0, 0, 0], // R4: d4 vazio (moveu p c5)
      ["b", 0, 0, 0, "b", 0, "b", 0], // R5: c3 vazio
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "14. a3-b4 f6-e5 3. b2-a3 (Troca Lateral)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 vazio
      [0, 0, 0, 0, "p", 0, 0, 0], // R3: e5 ocupado
      [0, "b", 0, 0, 0, 0, 0, 0], // R4: b4 ocupado
      ["b", 0, "b", 0, "b", 0, "b", 0], // R5: a3 ocupado (veio de b2)
      [0, 0, 0, "b", 0, "b", 0, "b"], // R6: b2 vazio
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "15. c3-d4 d6-c5 3. b2-c3 (Gambito Recusado)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, 0, 0, "p", 0, "p"], // R2: d6 (idx 3) vazio
      [0, 0, "p", 0, 0, 0, 0, 0], // R3: c5 ocupado
      [0, 0, 0, "b", 0, 0, 0, 0], // R4: d4 ocupado
      ["b", 0, "b", 0, "b", 0, "b", 0], // R5: c3 ocupado (veio de b2)
      [0, 0, 0, "b", 0, "b", 0, "b"], // R6: b2 vazio
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "16. e3-d4 f6-g5 3. d4-e5 (Troca Central)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, 0, 0, "p"], // R2: f6 vazio
      [0, 0, 0, 0, "b", 0, "p", 0], // R3: e5 (idx 4, branca) e g5 (idx 6, preta)
      [0, 0, 0, 0, 0, 0, 0, 0], // R4: d4 vazio
      ["b", 0, "b", 0, 0, 0, "b", 0], // R5: e3 vazio
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "17. g3-h4 b6-a5 3. f2-g3 (Abertura Aberta)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, 0, 0, "p", 0, "p", 0, "p"], // R2: b6 (idx 1) vazio
      ["p", 0, 0, 0, 0, 0, 0, 0], // R3: a5 (idx 0) ocupado
      [0, 0, 0, 0, 0, 0, 0, "b"], // R4: h4 (idx 7) ocupado
      ["b", 0, "b", 0, "b", 0, "b", 0], // R5: g3 ocupado (veio de f2)
      [0, "b", 0, "b", 0, 0, 0, "b"], // R6: f2 (idx 5) vazio
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "18. c3-b4 b6-a5 3. b4-c5 (Ataque Duplo)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, 0, 0, "p", 0, "p", 0, "p"], // R2: b6 vazio
      ["p", 0, "b", 0, 0, 0, 0, 0], // R3: a5 e c5(branca)
      [0, 0, 0, 0, 0, 0, 0, 0], // R4: b4 vazio (foi p c5)
      ["b", 0, 0, 0, "b", 0, "b", 0], // R5: c3 vazio
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "19. c3-d4 h6-g5 3. d4-c5 (Gambito H)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, "p", 0, "p", 0, 0], // R2: h6 (idx 7) vazio
      [0, 0, "b", 0, 0, 0, "p", 0], // R3: c5 (idx 2, branca) e g5 (idx 6, preta)
      [0, 0, 0, 0, 0, 0, 0, 0], // R4: d4 vazio
      ["b", 0, 0, 0, "b", 0, "b", 0], // R5: c3 vazio
      [0, "b", 0, "b", 0, "b", 0, "b"],
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
  {
    name: "20. e3-d4 d6-e5 3. f2-e3 (Centro Clássico)",
    board: [
      [0, "p", 0, "p", 0, "p", 0, "p"],
      ["p", 0, "p", 0, "p", 0, "p", 0],
      [0, "p", 0, 0, 0, "p", 0, "p"], // R2: d6 (idx 3) vazio
      [0, 0, 0, 0, "p", 0, 0, 0], // R3: e5 (idx 4) ocupado
      [0, 0, 0, "b", 0, 0, 0, 0], // R4: d4 ocupado
      ["b", 0, "b", 0, "b", 0, "b", 0], // R5: e3 ocupado (veio de f2)
      [0, "b", 0, "b", 0, 0, 0, "b"], // R6: f2 (idx 5) vazio
      ["b", 0, "b", 0, "b", 0, "b", 0],
    ],
  },
];

module.exports = {
  standardOpening,
  standardOpening10x10,
  idfTablitaOpenings,
};
