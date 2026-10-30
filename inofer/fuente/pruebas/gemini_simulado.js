module.exports = function (body) {
  const c = body.contents || [];
  const last = ((c[c.length - 1] || {}).parts || [{}])[0].text || '';
  global.__ultimoPedido = last;
  require('fs').writeFileSync('/tmp/work/gemini_last.txt', JSON.stringify(body).slice(0, 200000));
  if (/Respondé solamente: OK/.test(last)) return 'OK';
  const ped = (last.split('PEDIDO:')[1] || last).trim();
  if (/aument.*?(\d{3,})\s*piezas.*?(\d{5})/i.test(ped)) {
    const m = ped.match(/(\d{3,})\s*piezas.*?(\d{5})/i);
    return JSON.stringify({ respuesta: `Listo, sumé ${m[1]} piezas a la ${m[2]}.`, ops: [{ op: 'aumentar', part: m[2], qty: Number(m[1]) }] });
  }
  if (/cuánt|cuant/i.test(ped)) return JSON.stringify({ respuesta: 'En la 200V tenés 2 piezas programadas.', ops: [] });
  if (/CONSULTA:/.test(last)) return '### Análisis de prueba\nTodo OK.';
  return JSON.stringify({ respuesta: 'No entendí.', ops: [] });
};
