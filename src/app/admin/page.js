'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase, firebaseConfigurado } from '@/lib/firebase';
import SetupNotice from '@/components/SetupNotice';
import Comanda from '@/components/Comanda';
import {
  CATEGORIAS_ACOMP,
  CATEGORIAS_BEBIDA,
  PAGAMENTOS,
  SEED_ITEMS,
  TAMANHOS,
  DEFAULT_CONFIG,
  mesclarConfig,
  rotuloStatus,
} from '@/lib/defaults';
import { centavosParaCampo, formatBRL, parseReais } from '@/lib/money';
import { calcularTroco, verificarPedido } from '@/lib/pricing';
import { numeroWhatsApp } from '@/lib/message';

const porOrdem = (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
const hora = (o) => (o.createdAt?.toDate ? o.createdAt.toDate() : null);

function proximoStatus(o) {
  if (o.status === 'confirmado') return { para: 'preparo', texto: 'Começar a preparar' };
  if (o.status === 'preparo') return { para: 'pronto', texto: o.tipo === 'retirada' ? 'Pronto para retirada' : 'Pronto' };
  if (o.status === 'pronto') {
    return o.tipo === 'entrega'
      ? { para: 'saiu', texto: 'Saiu para entrega' }
      : { para: 'concluido', texto: 'Cliente retirou (concluir)' };
  }
  if (o.status === 'saiu') return { para: 'concluido', texto: 'Entregue (concluir)' };
  return null;
}

export default function Admin() {
  const [fb, setFb] = useState(undefined);
  const [user, setUser] = useState(undefined);
  const [aba, setAba] = useState('pedidos');
  const [config, setConfig] = useState(null);
  const [items, setItems] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [semPermissao, setSemPermissao] = useState(false);
  const [imprimir, setImprimir] = useState(null);
  const anteriorNovos = useRef(null);

  useEffect(() => {
    document.title = 'Painel — Restaurante Dona Augusta';
    const f = getFirebase();
    if (!f) {
      setFb(null);
      return undefined;
    }
    setFb(f);
    return onAuthStateChanged(f.auth, (u) => setUser(u || null));
  }, []);

  // Dados (só depois de entrar)
  useEffect(() => {
    if (!fb || !user) return undefined;
    setSemPermissao(false);
    const negado = (e) => {
      if (e?.code === 'permission-denied') setSemPermissao(true);
    };
    const u1 = onSnapshot(doc(fb.db, 'config', 'restaurante'), (s) => setConfig(s.exists() ? s.data() : false), negado);
    const u2 = onSnapshot(collection(fb.db, 'items'), (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))), negado);
    const u3 = onSnapshot(
      query(collection(fb.db, 'orders'), orderBy('createdAt', 'desc'), limit(150)),
      (s) => setPedidos(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      negado
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, [fb, user]);

  const novos = pedidos.filter((p) => p.status === 'novo').length;

  // Aviso sonoro e no título quando chega pedido novo
  useEffect(() => {
    document.title = novos > 0 ? `(${novos}) NOVO PEDIDO — Dona Augusta` : 'Painel — Restaurante Dona Augusta';
    if (anteriorNovos.current !== null && novos > anteriorNovos.current) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.25, 0.5].forEach((t) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 880;
          g.gain.value = 0.2;
          o.connect(g);
          g.connect(ctx.destination);
          o.start(ctx.currentTime + t);
          o.stop(ctx.currentTime + t + 0.15);
        });
      } catch (e) {
        /* sem som */
      }
    }
    anteriorNovos.current = novos;
  }, [novos]);

  // Impressão: mostra a comanda, abre a janela de impressão e esconde de novo
  useEffect(() => {
    if (!imprimir || !fb) return undefined;
    const depois = () => setImprimir(null);
    window.addEventListener('afterprint', depois);
    const t = setTimeout(() => {
      window.print();
      updateDoc(doc(fb.db, 'orders', imprimir.pedido.id), { impressoes: increment(1) }).catch(() => {});
    }, 200);
    const limpa = setTimeout(depois, 120000);
    return () => {
      clearTimeout(t);
      clearTimeout(limpa);
      window.removeEventListener('afterprint', depois);
    };
  }, [imprimir, fb]);

  if (!firebaseConfigurado || fb === null) return <SetupNotice />;
  if (fb === undefined || user === undefined) return <div className="container"><p className="muted">Carregando...</p></div>;
  if (user === null) return <Login fb={fb} />;

  const cfg = mesclarConfig(config || null);

  return (
    <>
      <div className="container wide no-print">
        <div className="row spread">
          <div>
            <h1>Painel — {cfg.nome}</h1>
            <p className="small muted">{user.email}</p>
          </div>
          <button className="btn secondary small" onClick={() => signOut(fb.auth)}>Sair</button>
        </div>

        {semPermissao && (
          <div className="alert">
            Este e-mail (<b>{user.email}</b>) não tem permissão para usar o painel. Confira se ele está na lista de
            responsáveis nas regras do Firestore (arquivo firestore.rules) e se o e-mail está verificado.
          </div>
        )}

        <div className="tabs">
          <button className={`tab ${aba === 'pedidos' ? 'on' : ''}`} onClick={() => setAba('pedidos')}>
            Pedidos{novos > 0 ? ` (${novos} novo${novos > 1 ? 's' : ''})` : ''}
          </button>
          <button className={`tab ${aba === 'cardapio' ? 'on' : ''}`} onClick={() => setAba('cardapio')}>Cardápio de hoje</button>
          <button className={`tab ${aba === 'config' ? 'on' : ''}`} onClick={() => setAba('config')}>Configurações</button>
        </div>

        {aba === 'pedidos' && (
          <Pedidos fb={fb} pedidos={pedidos} config={cfg} onPrint={(pedido, copia) => setImprimir({ pedido, copia })} />
        )}
        {aba === 'cardapio' && <Cardapio fb={fb} items={items} configExiste={config !== false && config !== null} />}
        {aba === 'config' && <Configuracoes key={JSON.stringify(config)} fb={fb} config={cfg} />}
      </div>

      {imprimir && (
        <Comanda pedido={imprimir.pedido} restaurante={cfg.nome} largura={cfg.larguraPapel} copia={imprimir.copia} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ Login */

function Login({ fb }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');

  async function google() {
    setErro('');
    try {
      await signInWithPopup(fb.auth, new GoogleAuthProvider());
    } catch (e) {
      setErro(
        e?.code === 'auth/unauthorized-domain'
          ? 'Este endereço do site ainda não foi autorizado no Firebase (Authentication > Configurações > Domínios autorizados).'
          : 'Não foi possível entrar com o Google. Tente de novo.'
      );
    }
  }

  async function emailSenha(ev) {
    ev.preventDefault();
    setErro('');
    try {
      await signInWithEmailAndPassword(fb.auth, email.trim(), senha);
    } catch (e) {
      setErro('E-mail ou senha incorretos.');
    }
  }

  return (
    <div className="container">
      <h1>Painel do restaurante</h1>
      <div className="card">
        <p>Entre com o e-mail autorizado.</p>
        <button className="btn full" onClick={google}>Entrar com o Google</button>
        <p className="center muted small">ou</p>
        <form onSubmit={emailSenha}>
          <label className="field" htmlFor="em">E-mail</label>
          <input id="em" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className="field" htmlFor="se">Senha</label>
          <input id="se" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          <p><button className="btn secondary full" type="submit">Entrar com e-mail e senha</button></p>
        </form>
        {erro && <div className="alert">{erro}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Pedidos */

function Pedidos({ fb, pedidos, config, onPrint }) {
  const [filtro, setFiltro] = useState('ativos');
  const [aberto, setAberto] = useState(null);
  const [msg, setMsg] = useState('');

  const lista = useMemo(() => {
    const hoje = new Date().toDateString();
    return pedidos.filter((p) => {
      if (filtro === 'ativos') return !['concluido', 'cancelado'].includes(p.status);
      if (filtro === 'hoje') return hora(p)?.toDateString() === hoje || !hora(p);
      return true;
    });
  }, [pedidos, filtro]);

  async function mudarStatus(o, para) {
    setMsg('');
    try {
      await updateDoc(doc(fb.db, 'orders', o.id), { status: para });
    } catch (e) {
      setMsg('Não consegui atualizar o pedido. Tente de novo.');
    }
  }

  async function aceitar(o) {
    setMsg('');
    try {
      const contador = doc(fb.db, 'counters', 'pedidos');
      const ref = doc(fb.db, 'orders', o.id);
      const numero = await runTransaction(fb.db, async (tx) => {
        const [c, p] = await Promise.all([tx.get(contador), tx.get(ref)]);
        if (!p.exists() || p.data().status !== 'novo') throw new Error('ja-tratado');
        const prox = (c.exists() ? c.data().valor : 0) + 1;
        tx.set(contador, { valor: prox });
        tx.update(ref, { numero: prox, status: 'confirmado' });
        return prox;
      });
      onPrint({ ...o, numero, status: 'confirmado' }, false);
    } catch (e) {
      setMsg(e.message === 'ja-tratado' ? 'Este pedido já foi aceito por outra pessoa.' : 'Não consegui aceitar o pedido. Tente de novo.');
    }
  }

  async function cancelar(o) {
    if (!window.confirm('Cancelar este pedido?')) return;
    mudarStatus(o, 'cancelado');
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        {[['ativos', 'Em andamento'], ['hoje', 'Hoje'], ['todos', 'Todos']].map(([k, t]) => (
          <button key={k} className={`tab ${filtro === k ? 'on' : ''}`} onClick={() => setFiltro(k)}>{t}</button>
        ))}
      </div>
      {msg && <div className="alert">{msg}</div>}
      {lista.length === 0 && <div className="card muted">Nenhum pedido nesta lista.</div>}

      {lista.map((o) => {
        const d = hora(o);
        const avisos = verificarPedido(o, config);
        const prox = proximoStatus(o);
        const troco = o.pagamento === 'dinheiro' && o.trocoPara ? calcularTroco(o.total, o.trocoPara) : null;
        const expandido = aberto === o.id || o.status === 'novo';
        return (
          <div className={`card order ${o.status}`} key={o.id}>
            <div className="row spread" onClick={() => setAberto(aberto === o.id ? null : o.id)} style={{ cursor: 'pointer' }}>
              <div>
                <b>{o.numero ? `#${o.numero}` : `Código ${o.id.slice(0, 5).toUpperCase()}`}</b>{' '}
                <span className={`badge ${o.status}`}>{rotuloStatus(o.status, o.tipo)}</span>
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

                <div className="row" style={{ marginTop: 10 }}>
                  {o.status === 'novo' && (
                    <>
                      <button className="btn ok" onClick={() => aceitar(o)}>Aceitar e imprimir</button>
                      <button className="btn danger" onClick={() => cancelar(o)}>Recusar</button>
                    </>
                  )}
                  {prox && <button className="btn" onClick={() => mudarStatus(o, prox.para)}>{prox.texto}</button>}
                  {o.numero && (
                    <button className="btn secondary" onClick={() => onPrint(o, true)}>Imprimir cópia</button>
                  )}
                  {!['novo', 'concluido', 'cancelado'].includes(o.status) && (
                    <button className="btn danger" onClick={() => cancelar(o)}>Cancelar</button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* --------------------------------------------------------------- Cardápio */

function Cardapio({ fb, items, configExiste }) {
  const [msg, setMsg] = useState('');

  async function marcarTodos(valor) {
    if (!window.confirm(valor ? 'Marcar TUDO como disponível hoje?' : 'Marcar TUDO como esgotado? (use no começo do dia e depois marque o que tem)')) return;
    try {
      for (let i = 0; i < items.length; i += 400) {
        const b = writeBatch(fb.db);
        items.slice(i, i + 400).forEach((it) => b.update(doc(fb.db, 'items', it.id), { disponivel: valor }));
        await b.commit();
      }
    } catch (e) {
      setMsg('Não consegui atualizar. Tente de novo.');
    }
  }

  async function carregarInicial() {
    try {
      const b = writeBatch(fb.db);
      if (!configExiste) b.set(doc(fb.db, 'config', 'restaurante'), DEFAULT_CONFIG);
      const jaTem = new Set(items.map((i) => i.nome));
      SEED_ITEMS.filter((s) => !jaTem.has(s.nome)).forEach((s, idx) => {
        b.set(doc(collection(fb.db, 'items')), { ...s, disponivel: true, ordem: idx + 1 });
      });
      await b.commit();
      setMsg('Configuração inicial carregada. Agora cadastre os acompanhamentos e proteínas.');
    } catch (e) {
      setMsg('Não consegui carregar a configuração inicial (confira as regras do Firestore e o e-mail autorizado).');
    }
  }

  const secoes = [
    ...CATEGORIAS_ACOMP.map((c) => ({ chave: `a-${c.id}`, titulo: c.nome, tipo: 'acomp', categoria: c.id, lista: items.filter((i) => i.tipo === 'acomp' && i.categoria === c.id) })),
    { chave: 'p-g1', titulo: 'Proteínas — Grupo 1', tipo: 'proteina', grupo: 'g1', lista: items.filter((i) => i.tipo === 'proteina' && i.grupo === 'g1') },
    { chave: 'p-g2', titulo: 'Proteínas — Grupo 2', tipo: 'proteina', grupo: 'g2', lista: items.filter((i) => i.tipo === 'proteina' && i.grupo === 'g2') },
    ...CATEGORIAS_BEBIDA.map((c) => ({ chave: `b-${c.id}`, titulo: c.nome, tipo: 'bebida', categoria: c.id, lista: items.filter((i) => i.tipo === 'bebida' && i.categoria === c.id) })),
  ];

  return (
    <>
      <div className="info">
        <b>Como usar no dia a dia:</b> o que estiver marcado como “tem hoje” aparece para o cliente. Para montar o cardápio do
        dia, toque em “Esgotar tudo” e marque só o que foi feito. Se algo acabar, desmarque na hora.
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn secondary small" onClick={() => marcarTodos(false)}>Esgotar tudo</button>
        <button className="btn secondary small" onClick={() => marcarTodos(true)}>Marcar tudo como disponível</button>
        {items.length === 0 && <button className="btn small" onClick={carregarInicial}>Carregar configuração inicial</button>}
      </div>
      {msg && <div className="info">{msg}</div>}

      {secoes.map((s) => (
        <Secao key={s.chave} fb={fb} secao={s} setMsg={setMsg} />
      ))}
    </>
  );
}

function Secao({ fb, secao, setMsg }) {
  const lista = [...secao.lista].sort(porOrdem);
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [volume, setVolume] = useState('');
  const ehBebida = secao.tipo === 'bebida';

  async function adicionar(ev) {
    ev.preventDefault();
    setMsg('');
    const n = nome.trim();
    if (!n) return;
    const dado = { nome: n, tipo: secao.tipo, disponivel: true, ordem: (lista.at(-1)?.ordem ?? 0) + 1 };
    if (secao.categoria) dado.categoria = secao.categoria;
    if (secao.grupo) dado.grupo = secao.grupo;
    if (ehBebida) {
      const p = parseReais(preco);
      if (!p) {
        setMsg('Bebida precisa de preço. Informe o valor (ex.: 6,50).');
        return;
      }
      dado.preco = p;
      dado.volume = volume.trim();
    }
    try {
      await addDoc(collection(fb.db, 'items'), dado);
      setNome('');
      setPreco('');
      setVolume('');
    } catch (e) {
      setMsg('Não consegui salvar o item.');
    }
  }

  async function mover(i, dir) {
    const a = lista[i];
    const b = lista[i + dir];
    if (!a || !b) return;
    // Reatribui ordens sequenciais para evitar empates
    const nova = lista.map((x, idx) => ({ id: x.id, ordem: idx + 1 }));
    const t = nova[i].ordem;
    nova[i].ordem = nova[i + dir].ordem;
    nova[i + dir].ordem = t;
    const batch = writeBatch(fb.db);
    nova.forEach((x) => batch.update(doc(fb.db, 'items', x.id), { ordem: x.ordem }));
    await batch.commit().catch(() => setMsg('Não consegui reordenar.'));
  }

  return (
    <div className="card">
      <h2>{secao.titulo}</h2>
      {lista.length === 0 && <p className="muted small">Nenhum item cadastrado.</p>}
      {lista.map((it, i) => (
        <ItemLinha key={it.id} fb={fb} it={it} i={i} total={lista.length} mover={mover} setMsg={setMsg} />
      ))}
      <form className="inline-form" onSubmit={adicionar}>
        <input type="text" placeholder={ehBebida ? 'Nome da bebida' : 'Nome do item'} value={nome} onChange={(e) => setNome(e.target.value)} />
        {ehBebida && (
          <>
            <input type="text" placeholder="Volume (ex.: 350 ml)" value={volume} onChange={(e) => setVolume(e.target.value)} style={{ maxWidth: 170 }} />
            <input type="text" inputMode="decimal" placeholder="Preço" value={preco} onChange={(e) => setPreco(e.target.value)} style={{ maxWidth: 110 }} />
          </>
        )}
        <button className="btn small" type="submit">Adicionar</button>
      </form>
    </div>
  );
}

function ItemLinha({ fb, it, i, total, mover, setMsg }) {
  const [edit, setEdit] = useState(false);
  const [nome, setNome] = useState(it.nome);
  const [preco, setPreco] = useState(centavosParaCampo(it.preco));
  const [volume, setVolume] = useState(it.volume || '');
  const ehBebida = it.tipo === 'bebida';

  async function salvar() {
    const dado = { nome: nome.trim() };
    if (!dado.nome) return;
    if (ehBebida) {
      const p = parseReais(preco);
      if (!p) {
        setMsg('Informe um preço válido para a bebida.');
        return;
      }
      dado.preco = p;
      dado.volume = volume.trim();
    }
    try {
      await updateDoc(doc(fb.db, 'items', it.id), dado);
      setEdit(false);
    } catch (e) {
      setMsg('Não consegui salvar.');
    }
  }

  async function remover() {
    if (!window.confirm(`Apagar "${it.nome}" de vez? Para só esconder hoje, use "tem hoje".`)) return;
    await deleteDoc(doc(fb.db, 'items', it.id)).catch(() => setMsg('Não consegui apagar.'));
  }

  if (edit) {
    return (
      <div className="inline-form" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
        <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
        {ehBebida && (
          <>
            <input type="text" value={volume} onChange={(e) => setVolume(e.target.value)} style={{ maxWidth: 140 }} />
            <input type="text" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} style={{ maxWidth: 100 }} />
          </>
        )}
        <button className="btn small" onClick={salvar}>Salvar</button>
        <button className="btn secondary small" onClick={() => setEdit(false)}>Cancelar</button>
      </div>
    );
  }

  return (
    <div className="item-line">
      <label className="switch">
        <input
          type="checkbox"
          checked={it.disponivel !== false}
          onChange={(e) => updateDoc(doc(fb.db, 'items', it.id), { disponivel: e.target.checked }).catch(() => setMsg('Não consegui atualizar.'))}
        />
        <span style={{ opacity: it.disponivel === false ? 0.5 : 1 }}>
          {it.nome}
          {ehBebida ? ` ${it.volume || ''} — ${formatBRL(it.preco)}` : ''}
        </span>
      </label>
      <div className="row">
        <span className="small muted">{it.disponivel === false ? 'esgotado' : 'tem hoje'}</span>
        <button className="btn secondary small" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">↑</button>
        <button className="btn secondary small" disabled={i === total - 1} onClick={() => mover(i, 1)} aria-label="Descer">↓</button>
        <button className="btn secondary small" onClick={() => setEdit(true)}>Editar</button>
        <button className="btn danger small" onClick={remover}>Apagar</button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Configurações */

function Configuracoes({ fb, config }) {
  const [f, setF] = useState({
    nome: config.nome,
    whatsapp: config.whatsapp,
    larguraPapel: config.larguraPapel,
    aceitandoPedidos: config.aceitandoPedidos !== false,
    g1P: centavosParaCampo(config.precos.g1.P),
    g1G: centavosParaCampo(config.precos.g1.G),
    g2P: centavosParaCampo(config.precos.g2.P),
    g2G: centavosParaCampo(config.precos.g2.G),
    grupoSemProteina: config.grupoSemProteina,
    precoSemProteinaConfirmado: Boolean(config.precoSemProteinaConfirmado),
    bairros: config.bairros.map((b) => ({ nome: b.nome, taxa: centavosParaCampo(b.taxa) })),
  });
  const [msg, setMsg] = useState('');
  const [erros, setErros] = useState([]);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function salvar() {
    setMsg('');
    const e = [];
    const p = { g1P: parseReais(f.g1P), g1G: parseReais(f.g1G), g2P: parseReais(f.g2P), g2G: parseReais(f.g2G) };
    if (Object.values(p).some((v) => !v)) e.push('Preencha os quatro preços das marmitas.');
    const zap = numeroWhatsApp(f.whatsapp);
    if (zap.length < 12) e.push('Informe o WhatsApp do restaurante com DDD (ex.: 31 99999-8888).');
    if (!f.nome.trim()) e.push('Informe o nome do restaurante.');
    const bairros = [];
    for (const b of f.bairros) {
      if (!b.nome.trim() && !b.taxa.trim()) continue;
      const t = parseReais(b.taxa);
      if (!b.nome.trim() || t === null) {
        e.push('Cada bairro precisa de nome e taxa (pode ser 0).');
        break;
      }
      bairros.push({ nome: b.nome.trim(), taxa: t });
    }
    const nomes = bairros.map((b) => b.nome.toLowerCase());
    if (new Set(nomes).size !== nomes.length) e.push('Há bairros repetidos na tabela.');
    setErros(e);
    if (e.length) return;

    const dado = {
      nome: f.nome.trim(),
      whatsapp: zap,
      larguraPapel: Number(f.larguraPapel) === 58 ? 58 : 80,
      aceitandoPedidos: f.aceitandoPedidos,
      precos: { g1: { P: p.g1P, G: p.g1G }, g2: { P: p.g2P, G: p.g2G } },
      grupoSemProteina: f.grupoSemProteina,
      precoSemProteinaConfirmado: f.precoSemProteinaConfirmado,
      bairros,
      maxAcompanhamentos: 6,
    };
    try {
      await setDoc(doc(fb.db, 'config', 'restaurante'), dado);
      setMsg('Configurações salvas.');
    } catch (err) {
      setMsg('Não consegui salvar. Confira as regras do Firestore e o e-mail autorizado.');
    }
  }

  return (
    <>
      {erros.length > 0 && <div className="alert"><ul>{erros.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      {msg && <div className="info">{msg}</div>}

      <div className="card">
        <h2>Restaurante</h2>
        <label className="field" htmlFor="cn">Nome</label>
        <input id="cn" type="text" value={f.nome} onChange={(e) => set('nome', e.target.value)} />
        <label className="field" htmlFor="cw">WhatsApp que recebe os pedidos (com DDD)</label>
        <input id="cw" type="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="31 99999-8888" />
        <label className="field" htmlFor="cp">Largura do papel da impressora térmica</label>
        <select id="cp" value={f.larguraPapel} onChange={(e) => set('larguraPapel', e.target.value)}>
          <option value={80}>80 mm</option>
          <option value={58}>58 mm</option>
        </select>
        <p>
          <label className="switch">
            <input type="checkbox" checked={f.aceitandoPedidos} onChange={(e) => set('aceitandoPedidos', e.target.checked)} />
            Recebendo pedidos pelo link
          </label>
        </p>
      </div>

      <div className="card">
        <h2>Preço das marmitas</h2>
        <div className="grid2">
          <div><label className="field">Grupo 1 — Pequena (R$)</label><input type="text" inputMode="decimal" value={f.g1P} onChange={(e) => set('g1P', e.target.value)} /></div>
          <div><label className="field">Grupo 1 — Grande (R$)</label><input type="text" inputMode="decimal" value={f.g1G} onChange={(e) => set('g1G', e.target.value)} /></div>
          <div><label className="field">Grupo 2 — Pequena (R$)</label><input type="text" inputMode="decimal" value={f.g2P} onChange={(e) => set('g2P', e.target.value)} /></div>
          <div><label className="field">Grupo 2 — Grande (R$)</label><input type="text" inputMode="decimal" value={f.g2G} onChange={(e) => set('g2G', e.target.value)} /></div>
        </div>
        <h3>Marmita sem proteína</h3>
        <p className="small muted">Não há desconto: a marmita sem proteína cobra o preço do grupo abaixo.</p>
        <select value={f.grupoSemProteina} onChange={(e) => set('grupoSemProteina', e.target.value)}>
          <option value="g1">Preço do Grupo 1</option>
          <option value="g2">Preço do Grupo 2</option>
        </select>
        <p>
          <label className="switch">
            <input type="checkbox" checked={f.precoSemProteinaConfirmado} onChange={(e) => set('precoSemProteinaConfirmado', e.target.checked)} />
            Confirmo esse preço (só assim a opção “Sem proteína” aparece para o cliente)
          </label>
        </p>
      </div>

      <div className="card">
        <h2>Taxa de entrega por bairro</h2>
        <p className="small muted">O cliente escolhe o bairro e já vê a taxa. Bairro fora da lista fica “taxa a confirmar”.</p>
        {f.bairros.map((b, i) => (
          <div className="table-edit" key={i}>
            <input type="text" placeholder="Bairro" value={b.nome} onChange={(e) => set('bairros', f.bairros.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
            <input type="text" inputMode="decimal" placeholder="Taxa (R$)" value={b.taxa} onChange={(e) => set('bairros', f.bairros.map((x, j) => (j === i ? { ...x, taxa: e.target.value } : x)))} />
            <button className="btn danger small" onClick={() => set('bairros', f.bairros.filter((_, j) => j !== i))}>Remover</button>
          </div>
        ))}
        <button className="btn secondary small" onClick={() => set('bairros', [...f.bairros, { nome: '', taxa: '' }])}>+ Adicionar bairro</button>
      </div>

      <button className="btn full" onClick={salvar}>Salvar configurações</button>
    </>
  );
}
