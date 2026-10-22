'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { getFirebase, firebaseConfigurado } from '@/lib/firebase';
import SetupNotice from '@/components/SetupNotice';
import { CATEGORIAS_ACOMP, CATEGORIAS_BEBIDA, PAGAMENTOS, TAMANHOS, mesclarConfig } from '@/lib/defaults';
import { formatBRL, parseReais } from '@/lib/money';
import { calcularPedido, calcularTroco, grupoDaMarmita, precoMarmita, taxaDoBairro } from '@/lib/pricing';
import { linkWhatsApp, montarMensagem, numeroWhatsApp } from '@/lib/message';

const FORM_VAZIO = {
  nome: '',
  tipo: null,
  rua: '',
  numero: '',
  bairro: '',
  bairroOutro: '',
  complemento: '',
  referencia: '',
  pagamento: null,
  precisaTroco: null,
  trocoPara: '',
  obs: '',
};
const DRAFT_VAZIO = { tamanho: null, acomp: [], proteinaId: null, editando: null };
const CHAVE_SALVA = 'dona-augusta-cliente';

const porOrdem = (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');

function resolverMarmitas(cart, mapa, config) {
  return cart.map((m) => {
    const prot = m.proteinaId && m.proteinaId !== 'nenhuma' ? mapa.get(m.proteinaId) : null;
    const grupo = grupoDaMarmita(config, prot);
    return {
      uid: m.uid,
      tamanho: m.tamanho,
      acompanhamentos: m.acomp.map((id) => mapa.get(id)?.nome).filter(Boolean),
      proteina: prot ? { nome: prot.nome, grupo: prot.grupo } : null,
      grupoPreco: grupo,
      preco: precoMarmita(config, m.tamanho, grupo),
    };
  });
}

function resolverBebidas(qtds, mapa) {
  return Object.entries(qtds)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => {
      const it = mapa.get(id);
      return it ? { nome: it.nome, volume: it.volume || '', qtd: q, precoUnit: it.preco } : null;
    })
    .filter(Boolean);
}

function bairroFinal(form) {
  return form.bairro === '__outro' ? form.bairroOutro.trim() : form.bairro;
}

export default function Cardapio() {
  const [fb, setFb] = useState(undefined);
  const [config, setConfig] = useState(mesclarConfig(null));
  const [items, setItems] = useState(null);
  const [erroDados, setErroDados] = useState('');

  const [passo, setPasso] = useState(1);
  const [draft, setDraft] = useState(DRAFT_VAZIO);
  const [cart, setCart] = useState([]);
  const [bebidasQtd, setBebidasQtd] = useState({});
  const [form, setForm] = useState(FORM_VAZIO);
  const [erros, setErros] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const f = getFirebase();
    if (!f) {
      setFb(null);
      return undefined;
    }
    setFb(f);
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_SALVA) || 'null');
      if (salvo) setForm((x) => ({ ...x, ...salvo }));
    } catch (e) {
      /* sem armazenamento: segue sem lembrar dados */
    }
    const u1 = onSnapshot(
      doc(f.db, 'config', 'restaurante'),
      (s) => setConfig(mesclarConfig(s.exists() ? s.data() : null)),
      () => setErroDados('Não foi possível carregar o cardápio. Tente de novo em instantes.')
    );
    const u2 = onSnapshot(
      collection(f.db, 'items'),
      (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setErroDados('Não foi possível carregar o cardápio. Tente de novo em instantes.')
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  const mapa = useMemo(() => new Map((items || []).map((i) => [i.id, i])), [items]);
  const acompPorCat = useMemo(
    () =>
      CATEGORIAS_ACOMP.map((c) => ({
        ...c,
        lista: (items || []).filter((i) => i.tipo === 'acomp' && i.categoria === c.id).sort(porOrdem),
      })).filter((c) => c.lista.length > 0),
    [items]
  );
  const proteinas = useMemo(
    () =>
      (items || [])
        .filter((i) => i.tipo === 'proteina')
        .sort((a, b) => String(a.grupo).localeCompare(String(b.grupo)) || porOrdem(a, b)),
    [items]
  );
  const bebidasPorCat = useMemo(
    () =>
      CATEGORIAS_BEBIDA.map((c) => ({
        ...c,
        lista: (items || [])
          .filter((i) => i.tipo === 'bebida' && i.categoria === c.id && Number.isInteger(i.preco) && i.preco > 0)
          .sort(porOrdem),
      })).filter((c) => c.lista.length > 0),
    [items]
  );

  const max = config.maxAcompanhamentos || 6;
  const marmitas = resolverMarmitas(cart, mapa, config);
  const bebidas = resolverBebidas(bebidasQtd, mapa);
  const tipo = form.tipo;
  const bairroSel = bairroFinal(form);
  const taxaEntrega =
    tipo === 'entrega' && form.bairro && form.bairro !== '__outro' ? taxaDoBairro(config, form.bairro) : null;
  const calc = calcularPedido({
    marmitas: marmitas.filter((m) => m.preco !== null),
    bebidas,
    tipo,
    taxaEntrega,
  });
  const draftTemAlgo = draft.tamanho || draft.acomp.length > 0 || draft.proteinaId;

  function toggleAcomp(id) {
    setErros([]);
    setDraft((d) => {
      if (d.acomp.includes(id)) return { ...d, acomp: d.acomp.filter((x) => x !== id) };
      if (d.acomp.length >= max) return d;
      return { ...d, acomp: [...d.acomp, id] };
    });
  }

  function adicionarMarmita() {
    const e = [];
    if (!draft.tamanho) e.push('Escolha o tamanho da marmita.');
    if (!draft.proteinaId) e.push('Escolha uma proteína ou toque em "Sem proteína".');
    if (e.length) {
      setErros(e);
      return;
    }
    const nova = {
      uid: draft.editando || `m${Date.now()}`,
      tamanho: draft.tamanho,
      acomp: draft.acomp,
      proteinaId: draft.proteinaId,
    };
    setCart((c) => (draft.editando ? c.map((m) => (m.uid === draft.editando ? nova : m)) : [...c, nova]));
    setDraft(DRAFT_VAZIO);
    setErros([]);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editarMarmita(uid) {
    const m = cart.find((x) => x.uid === uid);
    if (!m) return;
    setDraft({ tamanho: m.tamanho, acomp: m.acomp, proteinaId: m.proteinaId, editando: uid });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function mudarBebida(id, delta) {
    setBebidasQtd((q) => ({ ...q, [id]: Math.max(0, Math.min(20, (q[id] || 0) + delta)) }));
  }

  function continuarDoPasso1() {
    if (draftTemAlgo) {
      setErros(['Você começou a montar uma marmita. Toque em "Adicionar esta marmita ao pedido" para guardá-la.']);
      return;
    }
    if (cart.length === 0) {
      setErros(['Monte pelo menos uma marmita para continuar.']);
      return;
    }
    setErros([]);
    setPasso(2);
    window.scrollTo({ top: 0 });
  }

  function setCampo(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  // Monta e valida o pedido com os dados mais recentes (config e itens).
  function montarPedido(configAtual, mapaAtual) {
    const problemas = [];
    const ms = resolverMarmitas(cart, mapaAtual, configAtual);
    const bs = resolverBebidas(bebidasQtd, mapaAtual);

    const indisponiveis = new Set();
    cart.forEach((m) => {
      m.acomp.forEach((id) => {
        const it = mapaAtual.get(id);
        if (!it || it.disponivel === false) indisponiveis.add(mapaAtual.get(id)?.nome || 'um item');
      });
      if (m.proteinaId !== 'nenhuma') {
        const it = mapaAtual.get(m.proteinaId);
        if (!it || it.disponivel === false) indisponiveis.add(it?.nome || 'uma proteína');
      }
    });
    Object.keys(bebidasQtd).forEach((id) => {
      if (bebidasQtd[id] > 0) {
        const it = mapaAtual.get(id);
        if (!it || it.disponivel === false) indisponiveis.add(it?.nome || 'uma bebida');
      }
    });
    if (indisponiveis.size) {
      problemas.push(
        `Acabou agora: ${[...indisponiveis].join(', ')}. Volte e escolha outra opção antes de enviar.`
      );
    }
    if (ms.some((m) => m.preco === null)) {
      problemas.push('Não foi possível calcular o preço de uma marmita. Avise o restaurante.');
    }

    const nome = form.nome.trim();
    if (nome.length < 2) problemas.push('Escreva seu nome.');
    if (!form.tipo) problemas.push('Escolha entre entrega ou retirada.');
    const bairro = bairroFinal(form);
    if (form.tipo === 'entrega') {
      if (!form.rua.trim()) problemas.push('Escreva o nome da rua.');
      if (!form.numero.trim()) problemas.push('Escreva o número da casa.');
      if (!bairro) problemas.push('Escolha ou escreva o bairro.');
    }
    if (!form.pagamento) problemas.push('Escolha a forma de pagamento.');

    const taxa =
      form.tipo === 'entrega' && form.bairro && form.bairro !== '__outro'
        ? taxaDoBairro(configAtual, form.bairro)
        : null;
    const c = calcularPedido({ marmitas: ms.filter((m) => m.preco !== null), bebidas: bs, tipo: form.tipo, taxaEntrega: taxa });

    let trocoPara = null;
    if (form.pagamento === 'dinheiro') {
      if (form.precisaTroco === null) {
        problemas.push('Diga se precisa de troco.');
      } else if (form.precisaTroco) {
        const valor = parseReais(form.trocoPara);
        const t = calcularTroco(c.total, valor);
        if (!t.ok) problemas.push(t.erro);
        else trocoPara = valor;
      }
    }

    const pedido = {
      nome,
      tipo: form.tipo,
      endereco:
        form.tipo === 'entrega'
          ? {
              rua: form.rua.trim(),
              numero: form.numero.trim(),
              bairro,
              complemento: form.complemento.trim(),
              referencia: form.referencia.trim(),
            }
          : {},
      taxaEntrega: form.tipo === 'entrega' && !c.taxaAConfirmar ? c.taxa : null,
      taxaAConfirmar: c.taxaAConfirmar,
      pagamento: form.pagamento,
      trocoPara,
      marmitas: ms.map(({ tamanho, acompanhamentos, proteina, grupoPreco, preco }) => ({
        tamanho,
        acompanhamentos,
        proteina,
        grupoPreco,
        preco,
      })),
      bebidas: bs,
      observacoes: form.obs.trim().slice(0, 300),
      subtotal: c.subtotal,
      total: c.total,
      status: 'novo',
    };
    return { pedido, problemas };
  }

  async function enviar() {
    if (enviando) return;
    setErros([]);
    setEnviando(true);
    try {
      // Confere de novo, com dados frescos, se nada acabou e se os preços continuam os mesmos.
      const [snapItens, snapConfig] = await Promise.all([
        getDocs(collection(fb.db, 'items')),
        getDoc(doc(fb.db, 'config', 'restaurante')),
      ]);
      const configAtual = mesclarConfig(snapConfig.exists() ? snapConfig.data() : null);
      const mapaAtual = new Map(snapItens.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      const numeroLoja = numeroWhatsApp(configAtual.whatsapp);

      if (configAtual.aceitandoPedidos === false) {
        setErros(['O restaurante não está recebendo pedidos pelo link neste momento.']);
        return;
      }
      if (!numeroLoja) {
        setErros(['O WhatsApp do restaurante ainda não foi configurado. Avise o restaurante.']);
        return;
      }

      const { pedido, problemas } = montarPedido(configAtual, mapaAtual);
      if (problemas.length) {
        setErros(problemas);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const ref = await addDoc(collection(fb.db, 'orders'), { ...pedido, createdAt: serverTimestamp() });
      const codigo = ref.id.slice(0, 5).toUpperCase();
      const texto = montarMensagem({ restaurante: configAtual.nome, pedido, ref: codigo });
      const url = linkWhatsApp(numeroLoja, texto);

      try {
        localStorage.setItem(
          CHAVE_SALVA,
          JSON.stringify({
            nome: form.nome,
            rua: form.rua,
            numero: form.numero,
            bairro: form.bairro,
            bairroOutro: form.bairroOutro,
            complemento: form.complemento,
            referencia: form.referencia,
          })
        );
      } catch (e) {
        /* ignora */
      }

      setResultado({ url, texto, codigo, total: pedido.total });
      setPasso(4);
      window.scrollTo({ top: 0 });
      setTimeout(() => {
        window.location.href = url;
      }, 400);
    } catch (e) {
      setErros(['Não consegui enviar o pedido. Confira a internet e tente de novo.']);
    } finally {
      setEnviando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(resultado.texto);
      setCopiado(true);
    } catch (e) {
      setCopiado(false);
    }
  }

  function novoPedido() {
    setCart([]);
    setBebidasQtd({});
    setDraft(DRAFT_VAZIO);
    setForm((f) => ({ ...FORM_VAZIO, nome: f.nome, rua: f.rua, numero: f.numero, bairro: f.bairro, bairroOutro: f.bairroOutro, complemento: f.complemento, referencia: f.referencia }));
    setResultado(null);
    setPasso(1);
  }

  if (!firebaseConfigurado || fb === null) return <SetupNotice />;
  if (fb === undefined || items === null) {
    return (
      <div className="container">
        <h1>{config.nome}</h1>
        <p className="muted">{erroDados || 'Carregando o cardápio...'}</p>
      </div>
    );
  }

  const semCardapio = acompPorCat.length === 0 && proteinas.filter((p) => p.disponivel !== false).length === 0;
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  // ---------- Tela final ----------
  if (passo === 4 && resultado) {
    return (
      <div className="container">
        <h1>{config.nome}</h1>
        <div className="goodbox">
          <h2>Pedido registrado!</h2>
          <p>
            Código <b>{resultado.codigo}</b> · Total <b>{formatBRL(resultado.total)}</b>
          </p>
        </div>
        <div className="info">
          <b>Falta só um passo:</b> toque no botão verde para abrir o WhatsApp e depois toque em <b>Enviar</b>. É assim que o
          restaurante confirma seu pedido.
        </div>
        <a className="btn ok full" href={resultado.url}>
          Abrir o WhatsApp e enviar
        </a>
        <p className="center small muted">Se o WhatsApp não abriu sozinho, use o botão acima.</p>
        <button className="btn secondary full" onClick={copiar}>
          {copiado ? 'Mensagem copiada!' : 'Copiar a mensagem do pedido'}
        </button>
        <p style={{ marginTop: 24 }}>
          <button className="btn secondary full" onClick={novoPedido}>
            Fazer outro pedido
          </button>
        </p>
      </div>
    );
  }

  const aceitando = config.aceitandoPedidos !== false;

  return (
    <>
      <div className="container">
        <h1>{config.nome}</h1>
        <p className="muted" style={{ textTransform: 'capitalize' }}>Cardápio de {hoje}</p>
        <div className="steps" aria-label={`Passo ${passo} de 3`}>
          <span className={passo >= 1 ? 'on' : ''} />
          <span className={passo >= 2 ? 'on' : ''} />
          <span className={passo >= 3 ? 'on' : ''} />
        </div>
        <p className="small muted">
          Passo {passo} de 3 — {passo === 1 ? 'Monte sua marmita' : passo === 2 ? 'Bebidas' : 'Entrega e pagamento'}
        </p>

        {!aceitando && (
          <div className="alert">No momento o restaurante não está recebendo pedidos por este link.</div>
        )}
        {erroDados && <div className="alert">{erroDados}</div>}
        {erros.length > 0 && (
          <div className="alert" role="alert">
            <b>Confira antes de continuar:</b>
            <ul>{erros.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        {/* ---------- PASSO 1 ---------- */}
        {passo === 1 && (
          <>
            {semCardapio ? (
              <div className="info">O cardápio de hoje ainda não foi publicado. Volte daqui a pouco.</div>
            ) : (
              <div className="card">
                <h2>{draft.editando ? 'Editando a marmita' : `Marmita ${cart.length + 1}`}</h2>

                <h3>1. Tamanho</h3>
                <div className="chips">
                  {Object.entries(TAMANHOS).map(([k, nome]) => (
                    <button
                      key={k}
                      className={`chip ${draft.tamanho === k ? 'on' : ''}`}
                      onClick={() => { setErros([]); setDraft((d) => ({ ...d, tamanho: k })); }}
                    >
                      {nome}
                    </button>
                  ))}
                </div>

                <h3>
                  2. Acompanhamentos <span className="counter">{draft.acomp.length} de {max}</span>
                </h3>
                <p className="small muted">Escolha até {max}. Pode escolher menos.</p>
                {acompPorCat.map((c) => (
                  <div key={c.id}>
                    <p style={{ fontWeight: 700, margin: '12px 0 6px' }}>{c.nome}</p>
                    <div className="chips">
                      {c.lista.map((it) => {
                        const on = draft.acomp.includes(it.id);
                        const esgotado = it.disponivel === false;
                        const cheio = !on && draft.acomp.length >= max;
                        return (
                          <button
                            key={it.id}
                            className={`chip ${on ? 'on' : ''}`}
                            disabled={esgotado || cheio}
                            onClick={() => toggleAcomp(it.id)}
                            aria-pressed={on}
                          >
                            {it.nome}
                            {esgotado && <span className="price">esgotado</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {draft.acomp.length >= max && <p className="small counter">Você já escolheu {max}. Para trocar, desmarque um.</p>}

                <h3>3. Proteína</h3>
                <p className="small muted">Escolha uma, ou nenhuma.</p>
                <div className="chips">
                  {config.precoSemProteinaConfirmado && (
                    <button
                      className={`chip ${draft.proteinaId === 'nenhuma' ? 'on' : ''}`}
                      onClick={() => { setErros([]); setDraft((d) => ({ ...d, proteinaId: 'nenhuma' })); }}
                    >
                      Sem proteína
                      <span className="price">
                        {draft.tamanho ? formatBRL(precoMarmita(config, draft.tamanho, config.grupoSemProteina)) : 'escolha o tamanho'}
                      </span>
                    </button>
                  )}
                  {proteinas.map((p) => {
                    const on = draft.proteinaId === p.id;
                    const esgotado = p.disponivel === false;
                    return (
                      <button
                        key={p.id}
                        className={`chip ${on ? 'on' : ''}`}
                        disabled={esgotado}
                        onClick={() => { setErros([]); setDraft((d) => ({ ...d, proteinaId: p.id })); }}
                      >
                        {p.nome}
                        <span className="price">
                          {esgotado ? 'esgotado' : draft.tamanho ? formatBRL(precoMarmita(config, draft.tamanho, p.grupo)) : 'escolha o tamanho'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p style={{ marginTop: 18 }}>
                  <button className="btn full" onClick={adicionarMarmita} disabled={!aceitando}>
                    {draft.editando ? 'Salvar alterações da marmita' : 'Adicionar esta marmita ao pedido'}
                  </button>
                </p>
                {draftTemAlgo && !draft.editando && (
                  <button className="btn secondary small" onClick={() => setDraft(DRAFT_VAZIO)}>
                    Limpar escolhas
                  </button>
                )}
              </div>
            )}

            {cart.length > 0 && (
              <div className="card">
                <h2>Seu pedido até agora</h2>
                {marmitas.map((m, i) => (
                  <div className="item-line" key={m.uid} style={{ alignItems: 'flex-start' }}>
                    <div>
                      <b>Marmita {i + 1} — {TAMANHOS[m.tamanho]}</b> · {formatBRL(m.preco)}
                      <div className="small muted">
                        {m.acompanhamentos.length ? m.acompanhamentos.join(', ') : 'Sem acompanhamentos'}
                      </div>
                      <div className="small">{m.proteina ? m.proteina.nome : 'Sem proteína'}</div>
                    </div>
                    <div className="row" style={{ flexShrink: 0 }}>
                      <button className="btn secondary small" onClick={() => editarMarmita(m.uid)}>Editar</button>
                      <button className="btn danger small" onClick={() => setCart((c) => c.filter((x) => x.uid !== m.uid))}>Tirar</button>
                    </div>
                  </div>
                ))}
                <p className="small muted" style={{ marginTop: 10 }}>
                  Quer outra marmita, igual ou diferente? É só montar de novo acima.
                </p>
              </div>
            )}
          </>
        )}

        {/* ---------- PASSO 2 ---------- */}
        {passo === 2 && (
          <div className="card">
            <h2>Quer alguma bebida?</h2>
            <p className="small muted">Pode pular. As bebidas são cobradas à parte.</p>
            {bebidasPorCat.length === 0 && <p className="muted">Hoje não há bebidas disponíveis para pedir pelo link.</p>}
            {bebidasPorCat.map((c) => (
              <div key={c.id}>
                <h3>{c.nome}</h3>
                {c.lista.map((it) => {
                  const esgotado = it.disponivel === false;
                  return (
                    <div className="item-line" key={it.id}>
                      <div>
                        <b>{it.nome}</b> {it.volume && <span className="muted">{it.volume}</span>}
                        <div className="small">{esgotado ? 'esgotado' : formatBRL(it.preco)}</div>
                      </div>
                      {!esgotado && (
                        <div className="qty">
                          <button aria-label={`Tirar um ${it.nome}`} onClick={() => mudarBebida(it.id, -1)}>−</button>
                          <span className="n">{bebidasQtd[it.id] || 0}</span>
                          <button aria-label={`Colocar um ${it.nome}`} onClick={() => mudarBebida(it.id, 1)}>+</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* ---------- PASSO 3 ---------- */}
        {passo === 3 && (
          <>
            <div className="card">
              <h2>Seus dados</h2>
              <label className="field" htmlFor="nome">Seu nome</label>
              <input id="nome" type="text" autoComplete="name" value={form.nome} onChange={(e) => setCampo('nome', e.target.value)} />

              <label className="field">Como você quer receber?</label>
              <div className="chips">
                <button className={`chip ${form.tipo === 'entrega' ? 'on' : ''}`} onClick={() => setCampo('tipo', 'entrega')}>Entrega em casa</button>
                <button className={`chip ${form.tipo === 'retirada' ? 'on' : ''}`} onClick={() => setCampo('tipo', 'retirada')}>Retirar no restaurante</button>
              </div>

              {form.tipo === 'retirada' && <div className="info">Você vai buscar o pedido no restaurante. Sem taxa de entrega.</div>}

              {form.tipo === 'entrega' && (
                <>
                  <label className="field" htmlFor="rua">Rua</label>
                  <input id="rua" type="text" autoComplete="street-address" value={form.rua} onChange={(e) => setCampo('rua', e.target.value)} />
                  <label className="field" htmlFor="numero">Número</label>
                  <input id="numero" type="text" value={form.numero} onChange={(e) => setCampo('numero', e.target.value)} />
                  <label className="field" htmlFor="bairro">Bairro</label>
                  <select id="bairro" value={form.bairro} onChange={(e) => setCampo('bairro', e.target.value)}>
                    <option value="">Escolha seu bairro</option>
                    {config.bairros.map((b) => (
                      <option key={b.nome} value={b.nome}>{b.nome} — entrega {formatBRL(b.taxa)}</option>
                    ))}
                    <option value="__outro">Outro bairro (o restaurante confirma a taxa)</option>
                  </select>
                  {form.bairro === '__outro' && (
                    <>
                      <label className="field" htmlFor="bairroOutro">Qual é o bairro?</label>
                      <input id="bairroOutro" type="text" value={form.bairroOutro} onChange={(e) => setCampo('bairroOutro', e.target.value)} />
                    </>
                  )}
                  <label className="field" htmlFor="compl">Complemento (se tiver)</label>
                  <input id="compl" type="text" value={form.complemento} onChange={(e) => setCampo('complemento', e.target.value)} />
                  <label className="field" htmlFor="ref">Ponto de referência (se quiser)</label>
                  <input id="ref" type="text" value={form.referencia} onChange={(e) => setCampo('referencia', e.target.value)} />
                </>
              )}
            </div>

            <div className="card">
              <h2>Pagamento</h2>
              <div className="chips">
                {Object.entries(PAGAMENTOS).map(([k, nome]) => (
                  <button key={k} className={`chip ${form.pagamento === k ? 'on' : ''}`} onClick={() => setCampo('pagamento', k)}>{nome}</button>
                ))}
              </div>
              {form.pagamento === 'pix' && <p className="small muted">Você combina o Pix com o restaurante pelo WhatsApp.</p>}
              {form.pagamento === 'dinheiro' && (
                <>
                  <label className="field">Precisa de troco?</label>
                  <div className="chips">
                    <button className={`chip ${form.precisaTroco === false ? 'on' : ''}`} onClick={() => setCampo('precisaTroco', false)}>Não</button>
                    <button className={`chip ${form.precisaTroco === true ? 'on' : ''}`} onClick={() => setCampo('precisaTroco', true)}>Sim</button>
                  </div>
                  {form.precisaTroco === true && (
                    <>
                      <label className="field" htmlFor="troco">Troco para quanto?</label>
                      <input id="troco" type="text" inputMode="decimal" placeholder="Ex.: 50" value={form.trocoPara} onChange={(e) => setCampo('trocoPara', e.target.value)} />
                      {(() => {
                        const v = parseReais(form.trocoPara);
                        if (v === null || v === 0) return null;
                        const t = calcularTroco(calc.total, v);
                        return t.ok
                          ? <p className="small"><b>Seu troco será de {formatBRL(t.troco)}</b></p>
                          : <p className="small" style={{ color: 'var(--warn)' }}>{t.erro}</p>;
                      })()}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="card">
              <label className="field" htmlFor="obs" style={{ marginTop: 0 }}>Recado para o restaurante (se quiser)</label>
              <textarea id="obs" maxLength={300} value={form.obs} onChange={(e) => setCampo('obs', e.target.value)} />
            </div>

            <div className="card">
              <h2>Resumo</h2>
              {marmitas.map((m, i) => (
                <div className="item-line" key={m.uid}>
                  <span>Marmita {i + 1} ({TAMANHOS[m.tamanho]}){m.proteina ? ` · ${m.proteina.nome}` : ' · sem proteína'}</span>
                  <b>{formatBRL(m.preco)}</b>
                </div>
              ))}
              {bebidas.map((b, i) => (
                <div className="item-line" key={i}>
                  <span>{b.qtd}x {b.nome}</span>
                  <b>{formatBRL(b.precoUnit * b.qtd)}</b>
                </div>
              ))}
              {tipo === 'entrega' && (
                <div className="item-line">
                  <span>Entrega {bairroSel ? `(${bairroSel})` : ''}</span>
                  <b>{calc.taxaAConfirmar ? 'a confirmar' : formatBRL(calc.taxa)}</b>
                </div>
              )}
              <div className="item-line" style={{ fontSize: 22 }}>
                <b>Total</b>
                <b>{formatBRL(calc.total)}</b>
              </div>
              {calc.taxaAConfirmar && tipo === 'entrega' && (
                <p className="small muted">O restaurante vai confirmar o valor da entrega pelo WhatsApp.</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ---------- Barra fixa ---------- */}
      <div className="bar">
        <div className="inner">
          {passo > 1 && (
            <button className="btn secondary" style={{ flex: '0 0 auto' }} onClick={() => { setErros([]); setPasso(passo - 1); window.scrollTo({ top: 0 }); }}>
              Voltar
            </button>
          )}
          <span className="total">{formatBRL(calc.total)}</span>
          {passo === 1 && <button className="btn" onClick={continuarDoPasso1} disabled={!aceitando}>Continuar</button>}
          {passo === 2 && <button className="btn" onClick={() => { setPasso(3); window.scrollTo({ top: 0 }); }}>Continuar</button>}
          {passo === 3 && (
            <button className="btn ok" onClick={enviar} disabled={enviando || !aceitando}>
              {enviando ? 'Enviando...' : 'Enviar pedido'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
