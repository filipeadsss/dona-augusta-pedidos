import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBRL, parseReais, centavosParaCampo } from '../src/lib/money.js';
import {
  precoMarmita,
  grupoDaMarmita,
  calcularPedido,
  calcularTroco,
  acompanhamentosValidos,
  taxaDoBairro,
  verificarPedido,
} from '../src/lib/pricing.js';
import { mesclarConfig } from '../src/lib/defaults.js';
import { montarMensagem, numeroWhatsApp, linkWhatsApp } from '../src/lib/message.js';

const sp = (s) => s.replace(/\s/g, ' ');
const config = mesclarConfig({
  bairros: [
    { nome: 'Centro', taxa: 400 },
    { nome: 'Eldorado', taxa: 600 },
  ],
  precoSemProteinaConfirmado: true,
});

test('dinheiro: formatação e leitura', () => {
  assert.equal(sp(formatBRL(2200)), 'R$ 22,00');
  assert.equal(sp(formatBRL(105)), 'R$ 1,05');
  assert.equal(parseReais('12,50'), 1250);
  assert.equal(parseReais('R$ 1.250,00'), 125000);
  assert.equal(parseReais('50'), 5000);
  assert.equal(parseReais('abc'), null);
  assert.equal(parseReais(''), null);
  assert.equal(centavosParaCampo(1250), '12,50');
});

test('preços das marmitas: grupo 1 e grupo 2, pequena e grande', () => {
  assert.equal(precoMarmita(config, 'P', 'g1'), 2200);
  assert.equal(precoMarmita(config, 'G', 'g1'), 2500);
  assert.equal(precoMarmita(config, 'P', 'g2'), 2600);
  assert.equal(precoMarmita(config, 'G', 'g2'), 3000);
  assert.equal(precoMarmita(config, 'X', 'g1'), null);
});

test('sem proteína não recebe desconto: usa o grupo configurado', () => {
  assert.equal(grupoDaMarmita(config, null), 'g1');
  assert.equal(precoMarmita(config, 'G', grupoDaMarmita(config, null)), 2500);
  const c2 = mesclarConfig({ grupoSemProteina: 'g2' });
  assert.equal(precoMarmita(c2, 'G', grupoDaMarmita(c2, null)), 3000);
  assert.equal(grupoDaMarmita(config, { grupo: 'g2' }), 'g2');
});

test('limite de seis acompanhamentos', () => {
  assert.equal(acompanhamentosValidos(0), true);
  assert.equal(acompanhamentosValidos(6), true);
  assert.equal(acompanhamentosValidos(7), false);
});

test('pedido: soma marmitas e bebidas, taxa de entrega uma única vez', () => {
  const marmitas = [{ preco: 2500 }, { preco: 2600 }, { preco: 2200 }];
  const bebidas = [
    { precoUnit: 500, qtd: 2 },
    { precoUnit: 1000, qtd: 1 },
  ];
  const r = calcularPedido({ marmitas, bebidas, tipo: 'entrega', taxaEntrega: 600 });
  assert.equal(r.subtotal, 2500 + 2600 + 2200 + 1000 + 1000);
  assert.equal(r.taxa, 600);
  assert.equal(r.total, r.subtotal + 600);
  assert.equal(r.taxaAConfirmar, false);
});

test('retirada não recebe taxa; bairro fora da tabela fica a confirmar', () => {
  const marmitas = [{ preco: 2500 }];
  const ret = calcularPedido({ marmitas, bebidas: [], tipo: 'retirada', taxaEntrega: null });
  assert.equal(ret.taxa, 0);
  assert.equal(ret.taxaAConfirmar, false);
  assert.equal(ret.total, 2500);
  const fora = calcularPedido({ marmitas, bebidas: [], tipo: 'entrega', taxaEntrega: null });
  assert.equal(fora.taxaAConfirmar, true);
  assert.equal(fora.total, 2500);
});

test('taxa por bairro', () => {
  assert.equal(taxaDoBairro(config, 'Centro'), 400);
  assert.equal(taxaDoBairro(config, 'Eldorado'), 600);
  assert.equal(taxaDoBairro(config, 'Outro lugar'), null);
});

test('troco: precisa cobrir o total e calcula a diferença', () => {
  assert.deepEqual(calcularTroco(5600, 10000), { ok: true, troco: 4400 });
  assert.deepEqual(calcularTroco(5600, 5600), { ok: true, troco: 0 });
  assert.equal(calcularTroco(5600, 5000).ok, false);
  assert.equal(calcularTroco(5600, null).ok, false);
  assert.equal(calcularTroco(5600, 0).ok, false);
});

function pedidoExemplo() {
  return {
    nome: 'Maria',
    tipo: 'entrega',
    endereco: { rua: 'Rua A', numero: '10', bairro: 'Eldorado', complemento: 'casa 2', referencia: '' },
    taxaEntrega: 600,
    taxaAConfirmar: false,
    pagamento: 'dinheiro',
    trocoPara: 10000,
    marmitas: [
      {
        tamanho: 'G',
        acompanhamentos: ['Arroz', 'Feijão'],
        proteina: { nome: 'Frango', grupo: 'g1' },
        grupoPreco: 'g1',
        preco: 2500,
      },
      { tamanho: 'P', acompanhamentos: [], proteina: null, grupoPreco: 'g1', preco: 2200 },
    ],
    bebidas: [{ nome: 'Suco de limão', volume: '300 ml', qtd: 2, precoUnit: 500 }],
    observacoes: 'sem cebola',
    subtotal: 5700,
    total: 6300,
    status: 'novo',
  };
}

test('mensagem do WhatsApp contém os dados do pedido', () => {
  const msg = sp(montarMensagem({ restaurante: 'Restaurante Dona Augusta', pedido: pedidoExemplo(), ref: 'AB12C' }));
  for (const trecho of [
    'Restaurante Dona Augusta',
    'AB12C',
    'Nome: Maria',
    'ENTREGA',
    'Rua A, 10 - Eldorado',
    'Taxa de entrega: R$ 6,00',
    'Marmita 1',
    'Grande',
    'Arroz, Feijão',
    'Proteína: Frango',
    'Marmita 2',
    'sem proteína',
    '2x Suco de limão 300 ml',
    'Total: R$ 63,00',
    'Pagamento: Dinheiro',
    'Troco para R$ 100,00 (troco de R$ 37,00)',
    'sem cebola',
  ]) {
    assert.ok(msg.includes(trecho), `faltou: ${trecho}`);
  }
});

test('mensagem de retirada não traz endereço nem taxa', () => {
  const p = { ...pedidoExemplo(), tipo: 'retirada', endereco: {}, taxaEntrega: null, total: 5700, pagamento: 'pix', trocoPara: null };
  const msg = montarMensagem({ restaurante: 'R', pedido: p, ref: 'X' });
  assert.ok(msg.includes('RETIRADA'));
  assert.ok(!msg.includes('Endereço'));
  assert.ok(!msg.includes('Taxa de entrega'));
});

test('mensagem com taxa a confirmar', () => {
  const p = { ...pedidoExemplo(), taxaEntrega: null, taxaAConfirmar: true, total: 5700 };
  const msg = montarMensagem({ restaurante: 'R', pedido: p, ref: 'X' });
  assert.ok(msg.includes('a confirmar'));
});

test('link e número do WhatsApp', () => {
  assert.equal(numeroWhatsApp('(31) 99999-8888'), '5531999998888');
  assert.equal(numeroWhatsApp('5531999998888'), '5531999998888');
  assert.equal(numeroWhatsApp(''), '');
  assert.equal(linkWhatsApp('5531999998888', 'a b\nc'), 'https://wa.me/5531999998888?text=a%20b%0Ac');
});

test('verificarPedido detecta divergências', () => {
  assert.deepEqual(verificarPedido(pedidoExemplo(), config), []);
  const ruim = { ...pedidoExemplo(), total: 1 };
  assert.ok(verificarPedido(ruim, config).length > 0);
  const preco = pedidoExemplo();
  preco.marmitas[0].preco = 1;
  assert.ok(verificarPedido(preco, config).length > 0);
});
