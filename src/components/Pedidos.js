'use client';

import { useMemo, useState } from 'react';
import { Timestamp, addDoc, arrayUnion, collection, doc, increment, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import PedidoEditor from './PedidoEditor';
import { PAGAMENTOS, TAMANHOS, rotuloStatus } from '@/lib/defaults';
import { formatBRL } from '@/lib/money';
import { calcularTroco, verificarPedido } from '@/lib/pricing';
import { descreverMudancas, pedidoSalvavel } from '@/lib/order';

export const FILTROS = [
  ['ativos', 'Em andamento'],
  ['hoje', 'Hoje'],
  ['semana', 'Esta semana'],
  ['14dias', 'Últimos 14 dias'],
  ['mes', 'Este mês'],
  ['todos', 'Todos'],
];

const hora = (o) => (o.createdAt?.toDate ? o.createdAt.toDate() : null);
const quando = (t) => (t?.toDate ? t.toDate().toLocaleString('pt-BR') : '');

function proximoStatus(o) {
  if (o.status === 'confirmado') return { para: 'preparo', texto: 'Começar a preparar' };
  if (o.status === 'preparo') return { para: 'pronto', texto: o.tipo === 'retirada' ? 'Pronto para retirada' : 'Pronto' };
  if (o.status === 'pronto') {
    return o.tipo === 'entrega' ? { para: 'saiu', texto: 'Saiu para entrega' } : { para: 'concluido', texto: 'Cliente retirou (concluir)' };
  }
  if (o.status === 'saiu') return { para: 'concluido', texto: 'Entregue (concluir)' };
  return null;
}

// Gera o número do pedido e marca como confirmado, tudo numa transação (sem número repetido).
async function numerar(fb, id, extra, entrada) {
  const contador = doc(fb.db, 'counters', 'pedidos');
  const ref = doc(fb.db, 'orders', id);
  return runTransaction(fb.db, async (tx) => {
    const [c, p] = await Promise.all([tx.get(contador), tx.get(ref)]);
    if (!p.exists() || p.data().status !== 'novo') throw new Error('ja-tratado');
    const prox = (c.exists() ? c.data().valor : 0) + 1;
    tx.set(contador, { valor: prox });
    tx.update(ref, { numero: prox, status: 'confirmado', ...extra, historico: arrayUnion(entrada) });
    return prox;
  });
}

export default function Pedidos({ fb, email, pedidos, config, items, filtro, setFiltro, onPrint, silenciarAte }) {
  const [aberto, setAberto] = useState(null);
  const [historicoAberto, setHistoricoAberto] = useState(null);
  const [editor, setEditor] = useState(null); // { pedido } | { pedido: null }
  const [msg, setMsg] = useState('');

  const validos = useMemo(() => pedidos.filter((p) => p.status !== 'cancelado'), [pedidos]);
  const somaPeriodo = useMemo(() => validos.reduce((s, p) => s + (Number.isInteger(p.total) ? p.total : 0), 0), [validos]);

  const entrada = (tipo, mudancas) => ({ tipo, por: email, em: Timestamp.now(), mudancas });

  async function mudarStatus(o, para) {
    setMsg('');
    try {
      await updateDoc(doc(fb.db, 'orders', o.id), {
        status: para,
        historico: arrayUnion(entrada('status', [`Status: ${rotuloStatus(o.status, o.tipo)} → ${rotuloStatus(para, o.tipo)}`])),
      });
    } catch (e) {
      setMsg('Não consegui atualizar o pedido. Tente de novo.');
    }
  }

  async function aceitar(o) {
    setMsg('');
    try {
      const numero = await numerar(fb, o.id, {}, entrada('status', ['Pedido aceito']));
      onPrint({ ...o, numero, status: 'confirmado' }, false);
    } catch (e) {
      setMsg(e.message === 'ja-tratado' ? 'Este pedido já foi aceito por outra pessoa.' : 'Não consegui aceitar o pedido. Tente de novo.');
    }
  }

  function cancelar(o) {
    if (!window.confirm('Cancelar este pedido?')) return;
    mudarStatus(o, 'cancelado');
  }

  async function salvarEdicao(o, novo) {
    setMsg('');
    const mudancas = descreverMudancas(pedidoSalvavel(o), novo);
    if (mudancas.length === 0) {
      setMsg('Nenhuma alteração para salvar.');
      return;
    }
    try {
      await updateDoc(doc(fb.db, 'orders', o.id), {
        ...novo,
        edicoes: increment(1),
        precisaReimprimir: Boolean(o.numero),
        historico: arrayUnion(entrada('edicao', mudancas)),
      });
      setEditor(null);
      setAberto(o.id);
      setMsg(
        o.numero
          ? 'Pedido atualizado. Reimprima a comanda e avise o cliente pelo WhatsApp sobre a mudança.'
          : 'Pedido atualizado.'
      );
    } catch (e) {
      setMsg('Não consegui salvar as alterações. Tente de novo.');
    }
  }

  async function criarPedido(novo) {
    setMsg('');
    if (silenciarAte) silenciarAte.current = Date.now() + 10000;
    try {
      const ref = await addDoc(collection(fb.db, 'orders'), { ...novo, status: 'novo', createdAt: serverTimestamp() });
      const numero = await numerar(fb, ref.id, { origem: 'painel' }, entrada('criacao', [`Pedido criado pelo painel (${email})`]));
      setEditor(null);
      onPrint({ ...novo, id: ref.id, numero, status: 'confirmado', origem: 'painel', createdAt: Timestamp.now() }, false);
    } catch (e) {
      setMsg('Não consegui criar o pedido. Confira a internet e tente de novo.');
    }
  }

  if (editor) {
    return (
      <PedidoEditor
        pedido={editor.pedido}
        config={config}
        items={items}
        onCancelar={() => setEditor(null)}
        onSalvar={(novo) => (editor.pedido ? salvarEdicao(editor.pedido, novo) : criarPedido(novo))}
      />
    );
  }

  return (
    <>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div className="row">
          {FILTROS.map(([k, t]) => (
            <button key={k} className={`tab ${filtro === k ? 'on' : ''}`} onClick={() => setFiltro(k)}>{t}</button>
          ))}
        </div>
        <button className="btn ok" onClick={() => setEditor({ pedido: null })}>+ Novo pedido</button>
      </div>

      <p className="small muted">
        {validos.length} pedido{validos.length === 1 ? '' : 's'} (sem cancelados) · {formatBRL(somaPeriodo)}
        {filtro === 'todos' ? ' · mostrando os 500 mais recentes' : ''}
      </p>
      {msg && <div className="info">{msg}</div>}
      {pedidos.length === 0 && <div className="card muted">Nenhum pedido nesta lista.</div>}

      {pedidos.map((o) => {
        const d = hora(o);
        const avisos = verificarPedido(o, config);
        const prox = proximoStatus(o);
        const troco = o.pagamento === 'dinheiro' && o.trocoPara ? calcularTroco(o.total, o.trocoPara) : null;
        const expandido = aberto === o.id || o.status === 'novo';
        const historico = [...(o.historico || [])].sort((a, b) => (b.em?.toMillis?.() ?? 0) - (a.em?.toMillis?.() ?? 0));
        return (
          <div className={`card order ${o.status}`} key={o.id}>
            <div className="row spread" onClick={() => setAberto(aberto === o.id ? null : o.id)} style={{ cursor: 'pointer' }}>
              <div>
                <b>{o.numero ? `#${o.numero}` : `Código ${o.id.slice(0, 5).toUpperCase()}`}</b>{' '}
                <span className={`badge ${o.status}`}>{rotuloStatus(o.status, o.tipo)}</span>{' '}
                {o.edicoes > 0 && <span className="badge">Editado</span>}{' '}
                {o.origem === 'painel' && <span className="badge">Feito no painel</span>}{' '}
                {o.precisaReimprimir && <span className="badge novo">Reimprimir comanda</span>}
                <div>{o.nome} · {o.tipo === 'entrega' ? `Entrega (${o.endereco?.bairro || ''})` : 'Retirada'}</div>
                <div className="small muted">{d ? d.toLocaleString('pt-BR') : 'agora'}</div>
              </div>
              <b style={{ fontSize: 22 }}>{formatBRL(o.total)}</b>
            </div>

            {o.status === 'novo' && (
              <p className="small" style={{ margin: '8px 0 0' }}>
                Aguardando você conferir a mensagem do cliente no WhatsApp (código <b>{o.id.slice(0, 5).toUpperCase()}</b>).
              </p>
            )}

            {expandido && (
              <div style={{ marginTop: 10 }}>
                {o.marmitas.map((m, i) => (
                  <div className="item-line" key={i} style={{ alignItems: 'flex-start' }}>
                    <div>
                      <b>Marmita {i + 1} — {TAMANHOS[m.tamanho]}</b>
                      <div className="small">{m.acompanhamentos.length ? m.acompanhamentos.join(', ') : 'Sem acompanhamentos'}</div>
                      <div className="small"><b>{m.proteina ? m.proteina.nome : 'SEM PROTEÍNA'}</b></div>
                    </div>
                    <span>{formatBRL(m.preco)}</span>
                  </div>
                ))}
                {o.bebidas.map((b, i) => (
                  <div className="item-line" key={i}>
                    <span>{b.qtd}x {b.nome} {b.volume}</span>
                    <span>{formatBRL(b.precoUnit * b.qtd)}</span>
                  </div>
                ))}
                {o.tipo === 'entrega' && (
                  <p className="small">
                    {o.endereco?.rua}, {o.endereco?.numero} — {o.endereco?.bairro}
                    {o.endereco?.complemento ? ` · ${o.endereco.complemento}` : ''}
                    {o.endereco?.referencia ? ` · ref.: ${o.endereco.referencia}` : ''}
                    <br />
                    Entrega: {o.taxaAConfirmar ? <b>TAXA A CONFIRMAR com o cliente</b> : formatBRL(o.taxaEntrega)}
                  </p>
                )}
                <p className="small">
                  Pagamento: <b>{PAGAMENTOS[o.pagamento]}</b>
                  {troco?.ok ? <> · troco para {formatBRL(o.trocoPara)} (levar {formatBRL(troco.troco)})</> : null}
                  {o.pagamento === 'dinheiro' && !o.trocoPara ? ' · sem troco' : ''}
                </p>
                {o.observacoes && <p className="small"><b>Recado:</b> {o.observacoes}</p>}
                {avisos.length > 0 && (
                  <div className="alert small"><b>Conferir valores:</b><ul>{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
                )}
                {o.edicoes > 0 && !['concluido', 'cancelado'].includes(o.status) && (
                  <div className="info small">Este pedido foi editado. Se o cliente já tinha confirmado, avise a mudança pelo WhatsApp.</div>
                )}

                <div className="row" style={{ marginTop: 10 }}>
                  {o.status === 'novo' && (
                    <>
                      <button className="btn ok" onClick={() => aceitar(o)}>Aceitar e imprimir</button>
                      <button className="btn danger" onClick={() => cancelar(o)}>Recusar</button>
                    </>
                  )}
                  {prox && <button className="btn" onClick={() => mudarStatus(o, prox.para)}>{prox.texto}</button>}
                  {o.status !== 'cancelado' && (
                    <button className="btn secondary" onClick={() => setEditor({ pedido: o })}>Editar pedido</button>
                  )}
                  {o.numero && <button className="btn secondary" onClick={() => onPrint(o, true)}>Imprimir cópia</button>}
                  {!['novo', 'concluido', 'cancelado'].includes(o.status) && (
                    <button className="btn danger" onClick={() => cancelar(o)}>Cancelar</button>
                  )}
                  <button className="btn secondary small" onClick={() => setHistoricoAberto(historicoAberto === o.id ? null : o.id)}>
                    Histórico ({historico.length})
                  </button>
                </div>

                {historicoAberto === o.id && (
                  <div className="card" style={{ background: '#fafafa' }}>
                    <b>Histórico do pedido</b>
                    {historico.length === 0 && <p className="small muted">Sem registros.</p>}
                    {historico.map((h, i) => (
                      <div key={i} className="small" style={{ margin: '8px 0', borderTop: i ? '1px solid var(--line)' : 0, paddingTop: i ? 8 : 0 }}>
                        <b>{h.tipo === 'edicao' ? 'Editado' : h.tipo === 'criacao' ? 'Criado' : 'Status'}</b> · {quando(h.em)} · {h.por}
                        <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                          {(h.mudancas || []).map((m, j) => <li key={j}>{m}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
