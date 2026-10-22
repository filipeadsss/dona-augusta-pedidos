// Início de cada período de filtro (hora local do navegador).
// hoje: hoje às 00:00 | semana: a segunda-feira desta semana | 14dias: hoje e os 13 dias anteriores | mes: dia 1 do mês
export function inicioPeriodo(filtro, agora = new Date()) {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  if (filtro === 'hoje') return d;
  if (filtro === 'semana') {
    const voltaAteSegunda = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - voltaAteSegunda);
    return d;
  }
  if (filtro === '14dias') {
    d.setDate(d.getDate() - 13);
    return d;
  }
  if (filtro === 'mes') return new Date(agora.getFullYear(), agora.getMonth(), 1);
  return null;
}
