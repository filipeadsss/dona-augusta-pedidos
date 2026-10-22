import { formatBRL } from './money.js';
import { TAMANHOS, PAGAMENTOS } from './defaults.js';
import { calcularTroco } from './pricing.js';

// Aceita "(31) 99999-9999" ou "5531999999999" e devolve só dígitos com DDI 55.
export function numeroWhatsApp(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function linkWhatsApp(numero, texto) {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

// pedido = documento do pedido (mesmo formato salvo no Firestore)
export function montarMensagem({ restaurante, pedido, ref }) {
  const L = [];
  L.push(`*${restaurante}*`);
  L.push(`*Novo pedido* (código ${ref})`);
  L.push('');
  L.push(`Nome: ${pedido.nome}`);
  if (pedido.tipo === 'retirada') {
    L.push('*RETIRADA no restaurante*');
  } else {
    const e = pedido.endereco || {};
    L.push('*ENTREGA*');
    L.push(`Endereço: ${e.rua}, ${e.numero} - ${e.bairro}`);
    if (e.complemento) L.push(`Complemento: ${e.complemento}`);
    if (e.referencia) L.push(`Referência: ${e.referencia}`);
    L.push(
      pedido.taxaAConfirmar
        ? 'Taxa de entrega: a confirmar pelo restaurante'
        : `Taxa de entrega: ${formatBRL(pedido.taxaEntrega)}`
    );
  }

  pedido.marmitas.forEach((m, i) => {
    L.push('');
    L.push(`*Marmita ${i + 1}* - ${TAMANHOS[m.tamanho]} (${formatBRL(m.preco)})`);
    L.push(`Acompanhamentos: ${m.acompanhamentos.length ? m.acompanhamentos.join(', ') : 'nenhum'}`);
    L.push(`Proteína: ${m.proteina ? m.proteina.nome : 'sem proteína'}`);
  });

  if (pedido.bebidas.length) {
    L.push('');
    L.push('*Bebidas*');
    pedido.bebidas.forEach((b) => {
      L.push(`${b.qtd}x ${b.nome}${b.volume ? ` ${b.volume}` : ''} - ${formatBRL(b.precoUnit * b.qtd)}`);
    });
  }

  L.push('');
  L.push(`Subtotal: ${formatBRL(pedido.subtotal)}`);
  if (pedido.tipo === 'entrega' && !pedido.taxaAConfirmar) L.push(`Entrega: ${formatBRL(pedido.taxaEntrega)}`);
  L.push(
    pedido.taxaAConfirmar
      ? `*Total (sem a entrega): ${formatBRL(pedido.total)}*`
      : `*Total: ${formatBRL(pedido.total)}*`
  );

  L.push(`Pagamento: ${PAGAMENTOS[pedido.pagamento]}`);
  if (pedido.pagamento === 'dinheiro') {
    if (pedido.trocoPara) {
      const t = calcularTroco(pedido.total, pedido.trocoPara);
      L.push(`Troco para ${formatBRL(pedido.trocoPara)}${t.ok ? ` (troco de ${formatBRL(t.troco)})` : ''}`);
    } else {
      L.push('Não precisa de troco');
    }
  }
  if (pedido.observacoes) {
    L.push('');
    L.push(`Observações: ${pedido.observacoes}`);
  }
  return L.join('\n');
}
