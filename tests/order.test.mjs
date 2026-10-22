import test from 'node:test';
import assert from 'node:assert/strict';
import { mesclarConfig } from '../src/lib/defaults.js';
import {
  descreverMudancas,
  finalizarRascunho,
  marmitaVazia,
  pedidoSalvavel,
  rascunhoDePedido,
  rascunhoVazio,
  reprecificar,
} from '../src/lib/order.js';
import { inicioPeriodo } from '../src/lib/periodos.js';

const config = mesclarConfig({
  bairros: [
    { nome: 'Centro', taxa: 400 },
    { nome: 'Eldorado', taxa: 600 },
  ],
  precoSemProteinaConfirmado: true,
});

function pedidoBase() {
  return {
    nome: 'Maria',
    tipo: 'entrega',
    endereco: { rua: 'Rua A', numero: '10', bairro: 'Eldorado', complemento: '', referencia: '' },
    taxaEntrega: 600,
    taxaAConfirmar: false,
    pagamento: 'dinheiro',
    trocoPara: 10000,
    marmitas: [
      { tamanho: 'G', acompanhamentos: ['Arroz', 'Feijão'], proteina: { nome: 'Frango', grupo: 'g1' }, grupoPreco: 'g1', preco: 2500 },
    ],
    bebidas: [{ nome: 'Suco de limão', volume: '300 ml', qtd: 2, precoUnit: 500 }],
    observacoes: '',
    subtotal: 3500,
    total: 4100,
    status: 'novo',
  };
}

test('editar sem mexer em nada gera pedido igual e nenhuma mudança', () => {
  const p = pedidoBase();
  const r = rascunhoDePedido(p, config);
  const res = finalizarRascunho(r, config);
  assert.deepEqual(res.erros, []);
  assert.deepEqual(descreverMudancas(pedidoSalvavel(p), res.pedido), []);
  assert.equal(res.pedido.total, 4100);
});

test('trocar tamanho reprecifica; trocar proteína de grupo reprecifica', () => {
  const r = rascunhoDePedido(pedidoBase(), config);
  r.marmitas[0].tamanho = 'P';
  let res = finalizarRascunho(r, config);
  assert.equal(res.pedido.marmitas[0].preco, 2200);
  r.marmitas[0].proteina = { nome: 'Bife', grupo: 'g2' };
  res = finalizarRascunho(r, config);
  assert.equal(res.pedido.marmitas[0].preco, 2600);
  assert.equal(res.pedido.total, 2600 + 1000 + 600);
});

test('preço antigo é mantido quando tamanho e grupo não mudam, mesmo com tabela nova', () => {
  const m = rascunhoDePedido(pedidoBase(), config).marmitas[0];
  const tabelaNova = mesclarConfig({ precos: { g1: { P: 9900, G: 9900 }, g2: { P: 9900, G: 9900 } } });
  assert.equal(reprecificar(m, tabelaNova).preco, 2500);
  assert.equal(reprecificar({ ...m, tamanho: 'P' }, tabelaNova).preco, 9900);
});

test('histórico descreve o que foi editado', () => {
  const antes = pedidoBase();
  const r = rascunhoDePedido(antes, config);
  r.nome = 'Mariana';
  r.marmitas[0].acompanhamentos = ['Arroz', 'Batata'];
  r.marmitas[0].proteina = null;
  r.bebidas[0].qtd = 3;
  r.bebidas.push({ nome: 'Suco de laranja', volume: '300 ml', qtd: 1, precoUnit: 1000 });
  r.bairroSel = 'Centro';
  r.taxaTexto = '4,00';
  const res = finalizarRascunho(r, config);
  assert.deepEqual(res.erros, []);
  const l = descreverMudancas(pedidoSalvavel(antes), res.pedido);
  const txt = l.join('\n');
  for (const t of [
    'Nome: Maria → Mariana',
    'Bairro: Eldorado → Centro',
    'Taxa de entrega: R$',
    'acompanhamento removido: Feijão',
    'acompanhamento adicionado: Batata',
    'proteína: Frango → sem proteína',
    'Bebida Suco de limão 300 ml: 2x → 3x',
    'Bebida adicionada: 1x Suco de laranja 300 ml',
    'Total:',
  ]) {
    assert.ok(txt.replace(/\s/g, ' ').includes(t), `faltou: ${t}\n${txt}`);
  }
});

test('adicionar e remover marmita aparecem no histórico', () => {
  const antes = pedidoBase();
  const r = rascunhoDePedido(antes, config);
  r.marmitas.push({ ...marmitaVazia(), proteinaEscolhida: true });
  const res = finalizarRascunho(r, config);
  assert.ok(descreverMudancas(pedidoSalvavel(antes), res.pedido).some((x) => x.includes('Marmita 2 adicionada')));
  const volta = descreverMudancas(pedidoSalvavel(res.pedido), pedidoSalvavel(antes));
  assert.ok(volta.some((x) => x.includes('Marmita 2 removida')));
});

test('validações do editor', () => {
  const r = rascunhoVazio();
  let res = finalizarRascunho(r, config);
  assert.ok(res.erros.length >= 3);
  assert.equal(res.pedido, null);

  const ok = rascunhoVazio();
  ok.nome = 'Seu João';
  ok.tipo = 'retirada';
  ok.pagamento = 'pix';
  ok.marmitas = [{ ...marmitaVazia(), tamanho: 'G', proteina: { nome: 'Frango', grupo: 'g1' }, proteinaEscolhida: true, acompanhamentos: ['A', 'B', 'C', 'D', 'E', 'F'] }];
  res = finalizarRascunho(ok, config);
  assert.deepEqual(res.erros, []);
  assert.equal(res.pedido.total, 2500);
  assert.equal(res.pedido.taxaEntrega, null);
  assert.deepEqual(res.pedido.endereco, {});

  ok.marmitas[0].acompanhamentos.push('G');
  res = finalizarRascunho(ok, config);
  assert.ok(res.erros.some((e) => e.includes('no máximo 6')));

  ok.marmitas[0].acompanhamentos.pop();
  ok.marmitas[0].proteinaEscolhida = false;
  res = finalizarRascunho(ok, config);
  assert.ok(res.erros.some((e) => e.includes('proteína')));
});

test('pedido novo pelo painel: entrega com taxa vazia fica a confirmar; troco é validado', () => {
  const r = rascunhoVazio();
  r.nome = 'Dona Rosa';
  r.tipo = 'entrega';
  r.rua = 'Rua B';
  r.numero = '5';
  r.bairroSel = '__outro';
  r.bairroOutro = 'Vila Nova';
  r.pagamento = 'dinheiro';
  r.precisaTroco = true;
  r.trocoTexto = '10';
  r.marmitas = [{ ...marmitaVazia(), proteinaEscolhida: true }];
  let res = finalizarRascunho(r, config);
  assert.ok(res.erros.some((e) => e.includes('pelo menos')));
  r.trocoTexto = '50';
  res = finalizarRascunho(r, config);
  assert.deepEqual(res.erros, []);
  assert.equal(res.pedido.taxaAConfirmar, true);
  assert.equal(res.pedido.taxaEntrega, null);
  assert.equal(res.pedido.endereco.bairro, 'Vila Nova');
  assert.equal(res.pedido.trocoPara, 5000);
});

test('períodos dos filtros (21/10/2026 é uma quarta-feira)', () => {
  const agora = new Date(2026, 9, 21, 15, 30);
  const fmt = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  assert.equal(fmt(inicioPeriodo('hoje', agora)), '2026-10-21');
  assert.equal(fmt(inicioPeriodo('semana', agora)), '2026-10-19');
  assert.equal(fmt(inicioPeriodo('14dias', agora)), '2026-10-8');
  assert.equal(fmt(inicioPeriodo('mes', agora)), '2026-10-1');
  assert.equal(inicioPeriodo('ativos', agora), null);
  // domingo: a semana começa na segunda anterior
  assert.equal(fmt(inicioPeriodo('semana', new Date(2026, 9, 25, 10))), '2026-10-19');
  // segunda-feira: começa no próprio dia
  assert.equal(fmt(inicioPeriodo('semana', new Date(2026, 9, 26, 10))), '2026-10-26');
});
