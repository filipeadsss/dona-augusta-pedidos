import { formatBRL } from './money.js';

export function grupoDaMarmita(config, proteina) {
  // Sem proteína NÃO tem desconto: usa o grupo de preço escolhido pelo responsável.
  return proteina ? proteina.grupo : config.grupoSemProteina;
}

export function precoMarmita(config, tamanho, grupo) {
  const v = config?.precos?.[grupo]?.[tamanho];
  return Number.isInteger(v) && v > 0 ? v : null;
}

export function acompanhamentosValidos(qtd, max = 6) {
  return Number.isInteger(qtd) && qtd >= 0 && qtd <= max;
}

export function taxaDoBairro(config, nomeBairro) {
  const b = (config?.bairros || []).find((x) => x.nome === nomeBairro);
  return b && Number.isInteger(b.taxa) && b.taxa >= 0 ? b.taxa : null;
}

// marmitas: [{ preco }]   bebidas: [{ precoUnit, qtd }]
// taxaEntrega: centavos, ou null quando o bairro não está na tabela (taxa a confirmar)
export function calcularPedido({ marmitas, bebidas, tipo, taxaEntrega }) {
  let subtotal = 0;
  for (const m of marmitas) subtotal += m.preco;
  for (const b of bebidas) subtotal += b.precoUnit * b.qtd;

  let taxa = 0;
  let taxaAConfirmar = false;
  if (tipo === 'entrega') {
    if (Number.isInteger(taxaEntrega)) taxa = taxaEntrega; // aplicada uma única vez
    else taxaAConfirmar = true;
  }
  return { subtotal, taxa, taxaAConfirmar, total: subtotal + taxa };
}

export function calcularTroco(total, trocoPara) {
  if (!Number.isInteger(trocoPara) || trocoPara <= 0) {
    return { ok: false, erro: 'Informe com quanto você vai pagar em dinheiro.' };
  }
  if (trocoPara < total) {
    return { ok: false, erro: `O valor precisa ser pelo menos ${formatBRL(total)}.` };
  }
  return { ok: true, troco: trocoPara - total };
}

// Confere um pedido salvo com os preços ATUAIS da configuração. Devolve avisos em texto.
export function verificarPedido(pedido, config) {
  const avisos = [];
  let soma = 0;
  (pedido.marmitas || []).forEach((m, i) => {
    const esperado = precoMarmita(config, m.tamanho, m.grupoPreco);
    if (esperado !== m.preco) avisos.push(`Marmita ${i + 1}: preço salvo difere do cadastro atual.`);
    soma += m.preco;
  });
  (pedido.bebidas || []).forEach((b) => {
    soma += b.precoUnit * b.qtd;
  });
  if (soma !== pedido.subtotal) avisos.push('Subtotal não confere com a soma dos itens.');
  const taxa = Number.isInteger(pedido.taxaEntrega) ? pedido.taxaEntrega : 0;
  if (pedido.subtotal + taxa !== pedido.total) avisos.push('Total não confere com subtotal + entrega.');
  return avisos;
}
