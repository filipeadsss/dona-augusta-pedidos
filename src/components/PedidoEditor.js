'use client';

import { useMemo, useState } from 'react';
import { CATEGORIAS_ACOMP, PAGAMENTOS, TAMANHOS } from '@/lib/defaults';
import { centavosParaCampo, formatBRL } from '@/lib/money';
import { precoMarmita } from '@/lib/pricing';
import {
  descreverMudancas,
  finalizarRascunho,
  marmitaVazia,
  pedidoSalvavel,
  rascunhoDePedido,
  rascunhoVazio,
  reprecificar,
} from '@/lib/order';

const porOrdem = (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');

function Chip({ on, onClick, children, disabled }) {
  return (
    <button type="button" className={`chip ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// Editor usado para EDITAR um pedido existente (pedido) ou CRIAR um pedido novo (pedido = null).
export default function PedidoEditor({ pedido, config, items, onSalvar, onCancelar }) {
  const editando = Boolean(pedido);
  const [r, setR] = useState(() => (pedido ? rascunhoDePedido(pedido, config) : rascunhoVazio()));
  const [erros, setErros] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [addBebida, setAddBebida] = useState('');
  const max = config.maxAcompanhamentos || 6;

  const set = (k, v) => setR((x) => ({ ...x, [k]: v }));
  const setMarmita = (i, fn) =>
    setR((x) => ({ ...x, marmitas: x.marmitas.map((m, j) => (j === i ? reprecificar(fn(m), config) : m)) }));

  const res = useMemo(() => finalizarRascunho(r, config), [r, config]);
  const mudancas = useMemo(
    () => (editando && res.pedido ? descreverMudancas(pedidoSalvavel(pedido), res.pedido) : []),
    [editando, pedido, res.pedido]
  );

  const acompItens = useMemo(() => (items || []).filter((i) => i.tipo === 'acomp'), [items]);
  const proteinas = useMemo(
    () => (items || []).filter((i) => i.tipo === 'proteina').sort((a, b) => String(a.grupo).localeCompare(String(b.grupo)) || porOrdem(a, b)),
    [items]
  );
  const bebidasItens = useMemo(
    () => (items || []).filter((i) => i.tipo === 'bebida' && Number.isInteger(i.preco) && i.preco > 0).sort(porOrdem),
    [items]
  );

  function mudarBairro(valor) {
    setR((x) => {
      const b = config.bairros.find((y) => y.nome === valor);
      return { ...x, bairroSel: valor, taxaTexto: b ? centavosParaCampo(b.taxa) : '' };
    });
  }

  function toggleAcomp(i, nome) {
    setMarmita(i, (m) => {
      if (m.acompanhamentos.includes(nome)) return { ...m, acompanhamentos: m.acompanhamentos.filter((x) => x !== nome) };
      if (m.acompanhamentos.length >= max) return m;
      return { ...m, acompanhamentos: [...m.acompanhamentos, nome] };
    });
  }

  function mudarBebida(idx, delta) {
    setR((x) => ({
      ...x,
      bebidas: x.bebidas
        .map((b, j) => (j === idx ? { ...b, qtd: Math.max(0, Math.min(30, b.qtd + delta)) } : b))
        .filter((b) => b.qtd > 0),
    }));
  }

  function incluirBebida(id) {
    const it = bebidasItens.find((b) => b.id === id);
    setAddBebida('');
    if (!it) return;
    setR((x) => {
      const i = x.bebidas.findIndex((b) => b.nome === it.nome && (b.volume || '') === (it.volume || ''));
      if (i >= 0) return { ...x, bebidas: x.bebidas.map((b, j) => (j === i ? { ...b, qtd: Math.min(30, b.qtd + 1) } : b)) };
      return { ...x, bebidas: [...x.bebidas, { nome: it.nome, volume: it.volume || '', qtd: 1, precoUnit: it.preco }] };
    });
  }

  async function salvar() {
    if (!res.pedido) {
      setErros(res.erros);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setErros([]);
    setSalvando(true);
    try {
      await onSalvar(res.pedido);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="row spread">
        <h2>{editando ? `Editar pedido ${pedido.numero ? `#${pedido.numero}` : `(${pedido.id.slice(0, 5).toUpperCase()})`}` : 'Novo pedido (feito pelo restaurante)'}</h2>
        <button className="btn secondary small" onClick={onCancelar}>Cancelar</button>
      </div>
      {editando ? (
        <div className="info small">As alterações ficam registradas no histórico do pedido, com a data e o e-mail de quem editou.</div>
      ) : (
        <div className="info small">O pedido sai já aceito, com número, e a comanda abre para impressão.</div>
      )}

      {erros.length > 0 && (
        <div className="alert" role="alert">
          <b>Confira antes de salvar:</b>
          <ul>{erros.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Cliente</h3>
        <label className="field" htmlFor="ed-nome">Nome</label>
        <input id="ed-nome" type="text" value={r.nome} onChange={(e) => set('nome', e.target.value)} />
        <label className="field">Atendimento</label>
        <div className="chips">
          <Chip on={r.tipo === 'entrega'} onClick={() => set('tipo', 'entrega')}>Entrega</Chip>
          <Chip on={r.tipo === 'retirada'} onClick={() => set('tipo', 'retirada')}>Retirada no balcão</Chip>
        </div>
        {r.tipo === 'entrega' && (
          <>
            <div className="grid2">
              <div><label className="field">Rua</label><input type="text" value={r.rua} onChange={(e) => set('rua', e.target.value)} /></div>
              <div><label className="field">Número</label><input type="text" value={r.numero} onChange={(e) => set('numero', e.target.value)} /></div>
            </div>
            <label className="field">Bairro</label>
            <select value={r.bairroSel} onChange={(e) => mudarBairro(e.target.value)}>
              <option value="">Escolha o bairro</option>
              {config.bairros.map((b) => <option key={b.nome} value={b.nome}>{b.nome} — {formatBRL(b.taxa)}</option>)}
              <option value="__outro">Outro bairro</option>
            </select>
            {r.bairroSel === '__outro' && (
              <>
                <label className="field">Qual bairro?</label>
                <input type="text" value={r.bairroOutro} onChange={(e) => set('bairroOutro', e.target.value)} />
              </>
            )}
            <div className="grid2">
              <div><label className="field">Complemento</label><input type="text" value={r.complemento} onChange={(e) => set('complemento', e.target.value)} /></div>
              <div><label className="field">Referência</label><input type="text" value={r.referencia} onChange={(e) => set('referencia', e.target.value)} /></div>
            </div>
            <label className="field">Taxa de entrega (R$)</label>
            <input type="text" inputMode="decimal" value={r.taxaTexto} onChange={(e) => set('taxaTexto', e.target.value)} placeholder="Vazio = a confirmar com o cliente" />
            <p className="small muted">Ao escolher o bairro, a taxa da tabela é preenchida. Você pode alterar o valor manualmente.</p>
          </>
        )}
      </div>

      {r.marmitas.map((m, i) => {
        const nomesNoCardapio = new Set(acompItens.map((a) => a.nome));
        const foraDoCardapio = m.acompanhamentos.filter((n) => !nomesNoCardapio.has(n));
        const protFora = m.proteina && !proteinas.some((p) => p.nome === m.proteina.nome) ? m.proteina : null;
        return (
          <div className="card" key={i}>
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Marmita {i + 1}</h3>
              <div className="row">
                <b>{m.proteinaEscolhida && m.preco !== null ? formatBRL(m.preco) : '—'}</b>
                <button className="btn danger small" onClick={() => set('marmitas', r.marmitas.filter((_, j) => j !== i))}>Remover</button>
              </div>
            </div>

            <label className="field">Tamanho</label>
            <div className="chips">
              {Object.entries(TAMANHOS).map(([k, nome]) => (
                <Chip key={k} on={m.tamanho === k} onClick={() => setMarmita(i, (x) => ({ ...x, tamanho: k }))}>{nome}</Chip>
              ))}
            </div>

            <label className="field">Acompanhamentos <span className="counter">{m.acompanhamentos.length} de {max}</span></label>
            {CATEGORIAS_ACOMP.map((c) => {
              const lista = acompItens
                .filter((a) => a.categoria === c.id && (a.disponivel !== false || m.acompanhamentos.includes(a.nome)))
                .sort(porOrdem);
              if (!lista.length) return null;
              return (
                <div key={c.id}>
                  <p className="small muted" style={{ margin: '8px 0 4px' }}>{c.nome}</p>
                  <div className="chips">
                    {lista.map((a) => {
                      const on = m.acompanhamentos.includes(a.nome);
                      return (
                        <Chip key={a.id} on={on} disabled={!on && m.acompanhamentos.length >= max} onClick={() => toggleAcomp(i, a.nome)}>
                          {a.nome}{a.disponivel === false ? ' (esgotado)' : ''}
                        </Chip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {foraDoCardapio.length > 0 && (
              <>
                <p className="small muted" style={{ margin: '8px 0 4px' }}>Do pedido original (fora do cardápio atual)</p>
                <div className="chips">
                  {foraDoCardapio.map((n) => <Chip key={n} on onClick={() => toggleAcomp(i, n)}>{n}</Chip>)}
                </div>
              </>
            )}

            <label className="field">Proteína</label>
            <div className="chips">
              <Chip on={m.proteinaEscolhida && !m.proteina} onClick={() => setMarmita(i, (x) => ({ ...x, proteina: null, proteinaEscolhida: true }))}>
                Sem proteína
              </Chip>
              {protFora && <Chip on onClick={() => {}}>{protFora.nome} (fora do cardápio)</Chip>}
              {proteinas
                .filter((p) => p.disponivel !== false || m.proteina?.nome === p.nome)
                .map((p) => (
                  <Chip
                    key={p.id}
                    on={m.proteina?.nome === p.nome}
                    onClick={() => setMarmita(i, (x) => ({ ...x, proteina: { nome: p.nome, grupo: p.grupo }, proteinaEscolhida: true }))}
                  >
                    {p.nome}
                    <span className="price">{formatBRL(precoMarmita(config, m.tamanho, p.grupo))}{p.disponivel === false ? ' · esgotado' : ''}</span>
                  </Chip>
                ))}
            </div>
          </div>
        );
      })}
      <p><button className="btn secondary" onClick={() => set('marmitas', [...r.marmitas, marmitaVazia()])}>+ Adicionar marmita</button></p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Bebidas</h3>
        {r.bebidas.length === 0 && <p className="muted small">Nenhuma bebida.</p>}
        {r.bebidas.map((b, i) => (
          <div className="item-line" key={`${b.nome}${b.volume}`}>
            <div><b>{b.nome}</b> {b.volume} <span className="muted small">{formatBRL(b.precoUnit)} cada</span></div>
            <div className="qty">
              <button onClick={() => mudarBebida(i, -1)} aria-label="Menos um">−</button>
              <span className="n">{b.qtd}</span>
              <button onClick={() => mudarBebida(i, 1)} aria-label="Mais um">+</button>
            </div>
          </div>
        ))}
        <select value={addBebida} onChange={(e) => incluirBebida(e.target.value)} style={{ marginTop: 10 }}>
          <option value="">+ Adicionar bebida</option>
          {bebidasItens.map((b) => <option key={b.id} value={b.id}>{b.nome} {b.volume} — {formatBRL(b.preco)}</option>)}
        </select>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Pagamento</h3>
        <div className="chips">
          {Object.entries(PAGAMENTOS).map(([k, nome]) => <Chip key={k} on={r.pagamento === k} onClick={() => set('pagamento', k)}>{nome}</Chip>)}
        </div>
        {r.pagamento === 'dinheiro' && (
          <>
            <label className="field">Precisa de troco?</label>
            <div className="chips">
              <Chip on={r.precisaTroco === false} onClick={() => set('precisaTroco', false)}>Não</Chip>
              <Chip on={r.precisaTroco === true} onClick={() => set('precisaTroco', true)}>Sim</Chip>
            </div>
            {r.precisaTroco === true && (
              <>
                <label className="field">Troco para quanto? (R$)</label>
                <input type="text" inputMode="decimal" value={r.trocoTexto} onChange={(e) => set('trocoTexto', e.target.value)} />
              </>
            )}
          </>
        )}
        <label className="field">Recado / observações</label>
        <textarea maxLength={300} value={r.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Resumo</h3>
        <div className="item-line"><span>Subtotal</span><b>{formatBRL(res.calc.subtotal)}</b></div>
        {r.tipo === 'entrega' && (
          <div className="item-line"><span>Entrega</span><b>{res.calc.taxaAConfirmar ? 'a confirmar' : formatBRL(res.calc.taxa)}</b></div>
        )}
        <div className="item-line" style={{ fontSize: 22 }}><b>Total</b><b>{formatBRL(res.calc.total)}</b></div>
      </div>

      {editando && (
        <div className={mudancas.length ? 'info' : 'card muted'}>
          <b>O que vai mudar</b>
          {mudancas.length ? <ul>{mudancas.map((m, i) => <li key={i}>{m}</li>)}</ul> : <p className="small">Nenhuma alteração até agora.</p>}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn ok" onClick={salvar} disabled={salvando || (editando && mudancas.length === 0 && Boolean(res.pedido))}>
          {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar pedido e imprimir'}
        </button>
        <button className="btn secondary" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
