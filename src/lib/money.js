// Todos os valores em dinheiro do sistema são guardados em CENTAVOS (números inteiros).

export function formatBRL(centavos) {
  if (!Number.isInteger(centavos)) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// "12,50" -> 1250 | "R$ 1.250,00" -> 125000 | "30" -> 3000 | "abc" -> null
export function parseReais(texto) {
  if (texto === null || texto === undefined) return null;
  let s = String(texto).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// 1250 -> "12,50" (para preencher campos de edição)
export function centavosParaCampo(centavos) {
  return Number.isInteger(centavos) ? (centavos / 100).toFixed(2).replace('.', ',') : '';
}
