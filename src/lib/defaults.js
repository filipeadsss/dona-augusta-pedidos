export const CATEGORIAS_ACOMP = [
  { id: 'carboidratos', nome: 'Carboidratos' },
  { id: 'refogados', nome: 'Refogados' },
  { id: 'frituras', nome: 'Frituras' },
  { id: 'saladas', nome: 'Saladas' },
  { id: 'adicionais', nome: 'Cremes e adicionais' },
];

export const CATEGORIAS_BEBIDA = [
  { id: 'sucos', nome: 'Sucos' },
  { id: 'refrigerantes', nome: 'Refrigerantes' },
];

export const TAMANHOS = { P: 'Pequena', G: 'Grande' };

export const PAGAMENTOS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão — crédito ou débito',
};

export const STATUS = {
  novo: 'Novo',
  confirmado: 'Confirmado',
  preparo: 'Em preparo',
  pronto: 'Pronto',
  saiu: 'Saiu para entrega',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export function rotuloStatus(status, tipo) {
  if (status === 'pronto' && tipo === 'retirada') return 'Pronto para retirada';
  return STATUS[status] || status;
}

// Valores iniciais (o responsável edita tudo no painel).
export const DEFAULT_CONFIG = {
  nome: 'Restaurante Dona Augusta',
  whatsapp: '',
  larguraPapel: 80,
  precos: {
    g1: { P: 2200, G: 2500 },
    g2: { P: 2600, G: 3000 },
  },
  grupoSemProteina: 'g1',
  precoSemProteinaConfirmado: false,
  bairros: [],
  maxAcompanhamentos: 6,
  aceitandoPedidos: true,
};

export function mesclarConfig(c) {
  const base = DEFAULT_CONFIG;
  const x = c || {};
  return {
    ...base,
    ...x,
    precos: {
      g1: { ...base.precos.g1, ...(x.precos?.g1 || {}) },
      g2: { ...base.precos.g2, ...(x.precos?.g2 || {}) },
    },
    bairros: Array.isArray(x.bairros) ? x.bairros : [],
  };
}

// Itens com preço conhecido no cardápio físico. Refrigerantes ficam de fora de propósito:
// os preços ainda não foram informados e o sistema não inventa valores.
export const SEED_ITEMS = [
  { nome: 'Suco de limão', tipo: 'bebida', categoria: 'sucos', volume: '300 ml', preco: 500 },
  { nome: 'Suco de abacaxi', tipo: 'bebida', categoria: 'sucos', volume: '300 ml', preco: 900 },
  { nome: 'Suco de laranja', tipo: 'bebida', categoria: 'sucos', volume: '300 ml', preco: 1000 },
  { nome: 'Suco de maracujá', tipo: 'bebida', categoria: 'sucos', volume: '300 ml', preco: 1000 },
  { nome: 'Suco de duas frutas', tipo: 'bebida', categoria: 'sucos', volume: '300 ml', preco: 1400 },
];
