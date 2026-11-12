export function createApi(base, transport = fetch) {
  const url = base.replace(/\/$/, '');
  if (url && !url.startsWith('https://')) throw new Error('A API precisa usar HTTPS.');
  async function request(path, options = {}) {
    if (!url) throw new Error('O envio online ainda não foi ativado.');
    const response = await transport(url + '/api/' + path, {
      ...options, headers:{'Content-Type':'application/json',...options.headers},
      signal:AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(response.status === 409 ? 'Esse horário acabou de ser ocupado. Escolha outro.' : (response.status === 429 ? 'Muitas tentativas. Aguarde um pouco.' : 'Não foi possível concluir o pedido. Tente novamente.'));
    if (!data) throw new Error('A API retornou uma resposta inválida.');
    return data;
  }
  return {
    enabled: Boolean(url),
    catalog: () => request('catalog'),
    slots: (query) => request('slots?' + new URLSearchParams(query)),
    book: async (payload, key) => {
      const result = await request('booking-requests', {method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(payload)});
      if (typeof result.id !== 'string' || !['pending','confirmed'].includes(result.status)) throw new Error('Não foi possível validar a confirmação. Entre em contato antes de tentar novamente.');
      return result;
    }
  };
}
