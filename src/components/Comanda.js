import { formatBRL } from '@/lib/money';
import { TAMANHOS, PAGAMENTOS } from '@/lib/defaults';
import { calcularTroco } from '@/lib/pricing';

// Folha de impressão para impressora térmica (aparece só na hora de imprimir).
export default function Comanda({ pedido, restaurante, largura = 80, copia = false }) {
  const w = largura === 58 ? 58 : 80;
  const data = pedido.createdAt?.toDate ? pedido.createdAt.toDate() : null;
  const e = pedido.endereco || {};
  const troco = pedido.pagamento === 'dinheiro' && pedido.trocoPara ? calcularTroco(pedido.total, pedido.trocoPara) : null;

  return (
    <div className="comanda" style={{ width: `${w - 6}mm` }}>
      <style>{`@page { size: ${w}mm auto; margin: 2mm; }`}</style>
      <h1>{restaurante}</h1>
      {copia && <div className="copia">*** REIMPRESSÃO / CÓPIA ***</div>}
      <div className="center big">PEDIDO Nº {pedido.numero ?? '—'}</div>
      <div className="center">{data ? data.toLocaleString('pt-BR') : ''}</div>
      <div className="sep" />
      <div>Cliente: <b>{pedido.nome}</b></div>
      <div className="big">{pedido.tipo === 'entrega' ? 'ENTREGA' : 'RETIRADA NO BALCÃO'}</div>
      {pedido.tipo === 'entrega' && (
        <div>
          {e.rua}, {e.numero} - {e.bairro}
          {e.complemento ? <div>Compl.: {e.complemento}</div> : null}
          {e.referencia ? <div>Ref.: {e.referencia}</div> : null}
          {pedido.taxaAConfirmar ? <div><b>TAXA DE ENTREGA A CONFIRMAR</b></div> : null}
        </div>
      )}
      <div className="sep" />

      {pedido.marmitas.map((m, i) => (
        <div className="bloco" key={i}>
          <div className="big">MARMITA {i + 1} - {TAMANHOS[m.tamanho]}</div>
          <div>{m.acompanhamentos.length ? m.acompanhamentos.join(', ') : 'Sem acompanhamentos'}</div>
          <div><b>{m.proteina ? m.proteina.nome : 'SEM PROTEÍNA'}</b></div>
          <div className="linha"><span>valor</span><span>{formatBRL(m.preco)}</span></div>
        </div>
      ))}

      {pedido.bebidas.length > 0 && (
        <>
          <div className="sep" />
          <div className="big">BEBIDAS</div>
          {pedido.bebidas.map((b, i) => (
            <div className="linha" key={i}>
              <span>{b.qtd}x {b.nome}{b.volume ? ` ${b.volume}` : ''}</span>
              <span>{formatBRL(b.precoUnit * b.qtd)}</span>
            </div>
          ))}
        </>
      )}

      {pedido.observacoes ? (
        <>
          <div className="sep" />
          <div><b>OBS:</b> {pedido.observacoes}</div>
        </>
      ) : null}

      <div className="sep" />
      <div className="linha"><span>Subtotal</span><span>{formatBRL(pedido.subtotal)}</span></div>
      {pedido.tipo === 'entrega' && !pedido.taxaAConfirmar && (
        <div className="linha"><span>Entrega</span><span>{formatBRL(pedido.taxaEntrega)}</span></div>
      )}
      <div className="linha big"><span>TOTAL</span><span>{formatBRL(pedido.total)}</span></div>
      <div className="sep" />
      <div>Pagamento: <b>{PAGAMENTOS[pedido.pagamento]}</b></div>
      {pedido.pagamento === 'dinheiro' && (
        pedido.trocoPara ? (
          <div>
            <b>TROCO PARA {formatBRL(pedido.trocoPara)}</b>
            {troco?.ok ? <div className="big">Levar troco: {formatBRL(troco.troco)}</div> : null}
          </div>
        ) : (
          <div>Sem troco</div>
        )
      )}
      <div className="sep" />
    </div>
  );
}
