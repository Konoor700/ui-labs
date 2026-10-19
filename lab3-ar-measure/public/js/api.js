// Звернення до REST API (збережені виміри).

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, data: { message: 'Сервер недоступний. Перевірте, чи запущено npm start.' } };
  }
  const data = await res.json().catch(() => ({ message: 'Некоректна відповідь сервера.' }));
  return { ok: res.ok, data };
}

export const api = {
  list: () => request('GET', '/api/measurements'),
  create: (measurement) => request('POST', '/api/measurements', measurement),
  remove: (id) => request('DELETE', `/api/measurements/${id}`),
};
