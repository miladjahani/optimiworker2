import { useEffect, useState, useCallback } from 'react'
import { db } from '../lib/db'
import type { CFToken } from '../lib/types'
import {
  KeyRound,
  Plus,
  Trash2,
  Loader2,
  Copy,
  Check,
  Eye,
  EyeOff,
  ShieldCheck,
  X,
} from 'lucide-react'

export default function Tokens() {
  const [tokens, setTokens] = useState<CFToken[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newToken, setNewToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const { data } = await db.from('cf_tokens').select('*').order('created_at', { ascending: false })
    setTokens(data as CFToken[] ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { data } = await db.from('cf_tokens').insert({ name: newName, token: newToken }).select().single()
    if (data) {
      await db.from('activity_logs').insert({ action: 'token_created', entity_type: 'token', entity_name: newName })
    }
    setNewName('')
    setNewToken('')
    setShowAdd(false)
    setSaving(false)
    load()
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`توکن «${name}» حذف شود؟`)) return
    await db.from('cf_tokens').delete().eq('id', id)
    await db.from('activity_logs').insert({ action: 'token_deleted', entity_type: 'token', entity_name: name })
    load()
  }

  const toggleVisible = (id: string) => {
    const next = new Set(visibleIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setVisibleIds(next)
  }

  const copyToken = (id: string, token: string) => {
    navigator.clipboard.writeText(token)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const maskToken = (t: string) => t.slice(0, 6) + '••••••••••••••••' + t.slice(-4)

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-brand-400" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">توکن‌های کلودفلر</h1>
          <p className="text-slate-400 text-sm mt-1">مدیریت توکن‌های API کلودفلر برای استقرار ورکرها</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> افزودن توکن
        </button>
      </div>

      {tokens.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-slate-800/50 items-center justify-center mb-4">
            <KeyRound className="w-8 h-8 text-slate-500" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">هنوز توکنی اضافه نشده</h3>
          <p className="text-slate-400 text-sm mb-6">برای شروع استقرار ورکرها، ابتدا یک توکن API کلودفلر اضافه کنید</p>
          <button onClick={() => setShowAdd(true)} className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> افزودن اولین توکن
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tokens.map((token, i) => (
            <div key={token.id} className="glass-card glass-card-hover p-5 animate-slide-up" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-brand-500/10">
                    <ShieldCheck className="w-5 h-5 text-brand-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">{token.name}</h3>
                    <span className={`badge ${token.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-slate-700/50 text-slate-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${token.status === 'active' ? 'bg-green-400' : 'bg-slate-500'}`} />
                      {token.status === 'active' ? 'فعال' : 'غیرفعال'}
                    </span>
                  </div>
                </div>
                <button onClick={() => handleDelete(token.id, token.name)} className="p-2 rounded-lg text-slate-500 hover:bg-error-500/10 hover:text-error-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2 bg-slate-900/50 rounded-xl p-3 border border-slate-800/50">
                <code className="flex-1 text-sm text-slate-300 font-mono truncate" dir="ltr">
                  {visibleIds.has(token.id) ? token.token : maskToken(token.token)}
                </code>
                <button onClick={() => toggleVisible(token.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-white transition-colors">
                  {visibleIds.has(token.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button onClick={() => copyToken(token.id, token.token)} className="p-1.5 rounded-lg text-slate-500 hover:text-white transition-colors">
                  {copiedId === token.id ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              <p className="text-xs text-slate-500 mt-3">
                {token.last_used_at ? `آخرین استفاده: ${new Date(token.last_used_at).toLocaleDateString('fa-IR')}` : 'هنوز استفاده نشده'}
                {' • '}
                ساخته شده در {new Date(token.created_at).toLocaleDateString('fa-IR')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowAdd(false)}>
          <div className="glass-card p-6 w-full max-w-md animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-brand-400" /> توکن جدید
              </h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2 font-medium">نام توکن</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثلاً: توکن اصلی"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2 font-medium">توکن API کلودفلر</label>
                <textarea
                  required
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder="توکن را اینجا paste کنید..."
                  rows={3}
                  className="input-field font-mono text-sm"
                  dir="ltr"
                />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  ذخیره توکن
                </button>
                <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">انصراف</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
