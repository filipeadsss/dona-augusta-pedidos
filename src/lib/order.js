import { centavosParaCampo, formatBRL, parseReais } from './money.js';
import { PAGAMENTOS, TAMANHOS } from './defaults.js';
import { acompanhamentosValidos, calcularPedido, calcularTroco, grupoDaMarmita, precoMarmita } from './pricing.js';

// Campos do pedido que o responsável pode alterar (e que entram na comparação do histórico).
export const CAMPOS_PEDIDO = [
  'nome', 'tipo', 'endereco', 'taxaEntrega', 'taxaAConfirmar', 'pagamento',
  'trocoPara', 'marmitas', 'bebidas', 'observacoes', 'subtotal', 'total',
];

export function pedidoSalvavel(p) {
  const o = {};
  for (const k of CAMPOS_PEDIDO) o[k] = p[k] === undefined ? null : p[k];
  o.observacoes = p.observacoes || '';
  return o;
}

/* ---------- Marmitas no editor ---------- */

export function marmitaParaRascunho(m) {
  return {
    tamanho: m.tamanho,
    acompanhamentos: [...m.acompanhamentos],
    proteina: m.proteina ? { ...m.proteina } : null,
    proteinaEscolhida: true,
    grupoPreco: m.grupoPreco,
    preco: m.preco,
    original: { tamanho: m.tamanho, grupoPreco: m.grupoPreco, preco: m.preco },
  };
}

export function marmitaVazia() {
  return { tamanho: 'G', acompanhamentos: [], proteina: null, proteinaEscolhida: false, grupoPreco: null, preco: null, original: null };
}

// Mantém o preço já cobrado se tamanho e grupo não mudaram; senão usa o preço atual da configuração.
export function reprecificar(m, config) {
  const grupo = grupoDaMarmita(config, m.proteina);
  const igualAoOriginal = m.original && m.original.tamanho === m.tamanho && m.original.grupoPreco === grupo;
  const preco = igualAoOriginal ? m.original.preco : precoMarmita(config, m.tamanho, grupo);
  return { ...m, grupoPreco: grupo, preco };
}

/* ---------- Rascunho do pedido (estado do editor) ---------- */

export function rascunhoVazio() {
  return {
    nome: '',
    tipo: null,
    rua: '',
    numero: '',
    bairroSel: '',
    bairroOutro: '',
    complemento: '',
    referencia: '',
    taxaTexto: '',
    pagamento: null,
    precisaTroco: null,
    trocoTexto: '',
    marmitas: [marmitaVazia()],
    bebidas: [],
    observacoes: '',
  };
}

export function rascunhoDePedido(p, config) {
  const e = p.endereco || {};
  const entrega = p.tipo === 'entrega';
  const naTabela = (config.bairros || []).some((b) => b.nome === e.bairro);
  return {
    nome: p.nome || '',
    tipo: p.tipo,
    rua: e.rua || '',
    numero: e.numero || '',
    bairroSel: entrega ? (naTabela ? e.bairro : e.bairro ? '__outro' : '') : '',
    bairroOutro: entrega && !naTabela ? e.bairro || '' : '',
    complemento: e.complemento || '',
    referencia: e.referencia || '',
    taxaTexto: Number.isInteger(p.taxaEntrega) ? centavosParaCampo(p.taxaEntrega) : '',
    pagamento: p.pagamento,
    precisaTroco: p.pagamento === 'dinheiro' ? Boolean(p.trocoPara) : null,
    trocoTexto: p.trocoPara ? centavosParaCampo(p.trocoPara) : '',
    marmitas: p.marmitas.map(marmitaParaRascunho),
    bebidas: p.bebidas.map((b) => ({ ...b })),
    observacoes: p.observacoes || '',
  };
}

// Valida o rascunho e devolve o pedido pronto para salvar (valores em centavos).
export function finalizarRascunho(r, config) {
  const erros = [];
  const max = config.maxAcompanhamentos || 6;

  const nome = (r.nome || '').trim();
  if (!nome) erros.push('Informe o nome do cliente.');
  if (nome.length > 80) erros.push('O nome está muito longo (máximo 80 letras).');
  if (!r.tipo) erros.push('Escolha entrega ou retirada.');
  if (!r.pagamento) erros.push('Escolha a forma de pagamento.');

  const bairro = r.bairroSel === '__outro' ? (r.bairroOutro || '').trim() : r.bairroSel || '';
  if (r.tipo === 'entrega') {
    if (!(r.rua || '').trim()) erros.push('Informe a rua.');
    if (!(r.numero || '').trim()) erros.push('Informe o número.');
    if (!bairro) erros.push('Informe o bairro.');
  }

  const marmitas = r.marmitas.map((m) => reprecificar(m, config));
  marmitas.forEach((m, i) => {
    if (!m.proteinaEscolhida) erros.push(`Marmita ${i + 1}: escolha uma proteína ou "Sem proteína".`);
    if (!acompanhamentosValidos(m.acompanhamentos.length, max)) {
      erros.push(`Marmita ${i + 1}: no máximo ${max} acompanhamentos.`);
    }
    if (m.preco === null) erros.push(`Marmita ${i + 1}: preço não configurado para este tamanho.`);
  });

  const bebidas = r.bebidas.filter((b) => b.qtd > 0).map((b) => ({ nome: b.nome, volume: b.volume || '', qtd: b.qtd, precoUnit: b.precoUnit }));
  if (marmitas.length + bebidas.length === 0) erros.push('Adicione pelo menos uma marmita ou bebida.');

  let taxaEntrega = null;
  if (r.tipo === 'entrega' && String(r.taxaTexto || '').trim() !== '') {
    const t = parseReais(r.taxaTexto);
    if (t === null) erros.push('Taxa de entrega inválida.');
    else taxaEntrega = t;
  }

  const calc = calcularPedido({
    marmitas: marmitas.filter((m) => m.preco !== null),
    bebidas,
    tipo: r.tipo,
    taxaEntrega,
  });

  let trocoPara = null;
  if (r.pagamento === 'dinheiro' && r.precisaTroco) {
    const valor = parseReais(r.trocoTexto);
    const t = calcularTroco(calc.total, valor);
    if (!t.ok) erros.push(t.erro);
    else trocoPara = valor;
  }

  const obs = (r.observacoes || '').trim();
  if (obs.length > 300) erros.push('O recado está muito longo (máximo 300 letras).');
  if (!erros.length && calc.total <= 0) erros.push('O total do pedido precisa ser maior que zero.');

  if (erros.length) return { erros, pedido: null, calc };

  const pedido = {
    nome,
    tipo: r.tipo,
    endereco:
      r.tipo === 'entrega'
        ? {
            rua: r.rua.trim(),
            numero: r.numero.trim(),
            bairro,
            complemento: (r.complemento || '').trim(),
            referencia: (r.referencia || '').trim(),
          }
        : {},
    taxaEntrega: r.tipo === 'entrega' ? taxaEntrega : null,
    taxaAConfirmar: calc.taxaAConfirmar,
    pagamento: r.pagamento,
    trocoPara,
    marmitas: marmitas.map(({ tamanho, acompanhamentos, proteina, grupoPreco, preco }) => ({
      tamanho,
      acompanhamentos,
      proteina,
      grupoPreco,
      preco,
    })),
    bebidas,
    observacoes: obs,
    subtotal: calc.subtotal,
    total: calc.total,
  };
  return { erros: [], pedido, calc };
}

/* ---------- Histórico: descreve o que mudou ---------- */

const vazio = (v) => (v === null || v === undefined || v === '' ? '(vazio)' : String(v));
const rotuloTaxa = (p) =>
  p.tipo !== 'entrega' ? 'sem entrega' : p.taxaAConfirmar || !Number.isInteger(p.taxaEntrega) ? 'a confirmar' : formatBRL(p.taxaEntrega);
const rotuloProteina = (m) => (m.proteina ? m.proteina.nome : 'sem proteína');
const chaveBebida = (b) => `${b.nome}|${b.volume || ''}`;
const nomeBebida = (b) => `${b.nome}${b.volume ? ` ${b.volume}` : ''}`;

export function descreverMudancas(antes, depois) {
  const L = [];
  const cmp = (rotulo, x, y) => {
    if (vazio(x) !== vazio(y)) L.push(`${rotulo}: ${vazio(x)} → ${vazio(y)}`);
  };

  cmp('Nome', antes.nome, depois.nome);
  cmp('Atendimento', antes.tipo === 'entrega' ? 'Entrega' : 'Retirada', depois.tipo === 'entrega' ? 'Entrega' : 'Retirada');
  const ea = antes.endereco || {};
  const ed = depois.endereco || {};
  [['rua', 'Rua'], ['numero', 'Número'], ['bairro', 'Bairro'], ['complemento', 'Complemento'], ['referencia', 'Referência']].forEach(([k, rot]) =>
    cmp(rot, ea[k], ed[k])
  );
  cmp('Taxa de entrega', rotuloTaxa(antes), rotuloTaxa(depois));
  cmp('Pagamento', PAGAMENTOS[antes.pagamento], PAGAMENTOS[depois.pagamento]);
  cmp('Troco para', Number.isInteger(antes.trocoPara) ? formatBRL(antes.trocoPara) : null, Number.isInteger(depois.trocoPara) ? formatBRL(depois.trocoPara) : null);
  cmp('Recado', antes.observacoes, depois.observacoes);

  const ma = antes.marmitas || [];
  const md = depois.marmitas || [];
  const n = Math.max(ma.length, md.length);
  for (let i = 0; i < n; i += 1) {
    const a = ma[i];
    const d = md[i];
    const rot = `Marmita ${i + 1}`;
    if (!a) {
      L.push(`${rot} adicionada: ${TAMANHOS[d.tamanho]}, ${rotuloProteina(d)}, ${formatBRL(d.preco)}`);
      continue;
    }
    if (!d) {
      L.push(`${rot} removida (${TAMANHOS[a.tamanho]}, ${rotuloProteina(a)}, ${formatBRL(a.preco)})`);
      continue;
    }
    cmp(`${rot}, tamanho`, TAMANHOS[a.tamanho], TAMANHOS[d.tamanho]);
    cmp(`${rot}, proteína`, rotuloProteina(a), rotuloProteina(d));
    a.acompanhamentos.filter((x) => !d.acompanhamentos.includes(x)).forEach((x) => L.push(`${rot}: acompanhamento removido: ${x}`));
    d.acompanhamentos.filter((x) => !a.acompanhamentos.includes(x)).forEach((x) => L.push(`${rot}: acompanhamento adicionado: ${x}`));
    if (a.preco !== d.preco) L.push(`${rot}, valor: ${formatBRL(a.preco)} → ${formatBRL(d.preco)}`);
  }

  const ba = new Map((antes.bebidas || []).map((b) => [chaveBebida(b), b]));
  const bd = new Map((depois.bebidas || []).map((b) => [chaveBebida(b), b]));
  for (const [k, b] of ba) {
    const novo = bd.get(k);
    if (!novo) L.push(`Bebida removida: ${b.qtd}x ${nomeBebida(b)}`);
    else if (novo.qtd !== b.qtd) L.push(`Bebida ${nomeBebida(b)}: ${b.qtd}x → ${novo.qtd}x`);
    else if (novo.precoUnit !== b.precoUnit) L.push(`Bebida ${nomeBebida(b)}: valor ${formatBRL(b.precoUnit)} → ${formatBRL(novo.precoUnit)}`);
  }
  for (const [k, b] of bd) {
    if (!ba.has(k)) L.push(`Bebida adicionada: ${b.qtd}x ${nomeBebida(b)}`);
  }

  if (antes.total !== depois.total) L.push(`Total: ${formatBRL(antes.total)} → ${formatBRL(depois.total)}`);
  return L;
}
