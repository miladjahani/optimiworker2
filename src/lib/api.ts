export type ApiResult<T = any> = { data: T | null; error: { message: string } | null; count?: number | null }

async function request<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(body.error || body.message || `HTTP ${resp.status}`)
  return body
}

export const api = {
  async me() { return request<{ user: { id: string; email: string } | null }>('/api/auth/me') },
  async login(email: string, password: string) { return request<{ user: { id: string; email: string } }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }) },
  async signup(email: string, password: string) { return request<{ user: { id: string; email: string } }>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }) },
  async logout() { return request('/api/auth/logout', { method: 'POST' }) },
  async db<T = any>(body: any): Promise<ApiResult<T>> {
    try { return await request<ApiResult<T>>('/api/db', { method: 'POST', body: JSON.stringify(body) }) }
    catch (e) { return { data: null, error: { message: e instanceof Error ? e.message : String(e) } } }
  },
  async deploy(body: any) { return request<{ success: boolean; deployment_id: string }>('/api/deploy', { method: 'POST', body: JSON.stringify(body) }) },
}
