import { useEffect, useState, useRef, useCallback } from 'react'
import { db } from '../lib/db'
import { api } from '../lib/api'
import { useNavigate } from 'react-router-dom'
import {
  Rocket,
  Loader2,
  Check,
  ChevronLeft,
  Settings,
  Cloud,
  AlertCircle,
  Sparkles,
  Terminal,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import type { CFToken } from '../lib/types'

function genUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function genName() {
  return 'edge-relay-' + genUuid().slice(0, 4)
}

function validName(n: string) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(n ?? '')
}

function validPath(p: string) {
  return !p || /^\/?[A-Za-z0-9_-]+$/.test(p)
}

export default function DeployWizard() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [tokens, setTokens] = useState<CFToken[]>([])
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState(genName())
  const [uuid, setUuid] = useState(genUuid())
  const [customPath, setCustomPath] = useState('')
  const [selectedToken, setSelectedToken] = useState('')
  const [method, setMethod] = useState<'workers' | 'pages'>('workers')
  const [deploying, setDeploying] = useState(false)
  const [deployLogs, setDeployLogs] = useState<string[]>([])
  const [deployResult, setDeployResult] = useState<{ success: boolean; message: string; url?: string; panelUrl?: string } | null>(null)

  useEffect(() => {
    db.from('cf_tokens').select('*').eq('status', 'active').then(({ data }) => {
      setTokens(data as CFToken[] ?? [])
      if (data && data.length > 0) setSelectedToken((data[0] as CFToken).id)
      setLoading(false)
    })
  }, [])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const startPolling = useCallback((deploymentId: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      const { data } = await db
        .from('deployments')
        .select('status, logs, worker_url, panel_url, error_message')
        .eq('id', deploymentId)
        .maybeSingle()

      const dep = data as { status: string; logs: string | null; worker_url: string | null; panel_url: string | null; error_message: string | null } | null
      if (!dep) return

      if (dep.logs) {
        setDeployLogs(dep.logs.split('\n').filter(Boolean))
      }

      if (dep.status === 'deployed') {
        stopPolling()
        setDeploying(false)
        await db.from('activity_logs').insert({ action: 'deployment_deployed', entity_type: 'deployment', entity_name: name })
        await db.from('cf_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', selectedToken)
        setDeployResult({
          success: true,
          message: 'ورکر با موفقیت مستقر شد!',
          url: dep.worker_url ?? undefined,
          panelUrl: dep.panel_url ?? undefined,
        })
      } else if (dep.status === 'failed') {
        stopPolling()
        setDeploying(false)
        await db.from('activity_logs').insert({ action: 'deployment_failed', entity_type: 'deployment', entity_name: name })
        setDeployResult({ success: false, message: dep.error_message ?? 'استقرار ناموفق بود' })
      }
    }, 2000)
  }, [stopPolling, name, selectedToken])

  const handleDeploy = async () => {
    setDeploying(true)
    setDeployResult(null)
    setDeployLogs([])

    const token = tokens.find((t) => t.id === selectedToken)
    if (!token) {
      setDeployResult({ success: false, message: 'توکن معتبر پیدا نشد' })
      setDeploying(false)
      return
    }

    const { data: dep } = await db.from('deployments').insert({
      name,
      worker_code: '[auto-loaded from repo]',
      config: { method, custom_path: customPath, token_name: token.name },
      status: 'deploying',
      uuid,
      custom_path: customPath || null,
      method,
    }).select().single()

    await db.from('activity_logs').insert({ action: 'deployment_created', entity_type: 'deployment', entity_name: name })

    try {
      const result = await api.deploy({
        deployment_id: dep?.id,
        token_id: token.id,
        worker_name: name,
        uuid,
        custom_path: customPath || undefined,
        method,
      })
      if (result.success) startPolling(dep!.id)
      else {
        await db.from('deployments').update({ status: 'failed', error_message: 'استقرار ناموفق بود' }).eq('id', dep?.id)
        setDeployResult({ success: false, message: 'استقرار ناموفق بود' })
        setDeploying(false)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطای شبکه'
      await db.from('deployments').update({ status: 'failed', error_message: msg }).eq('id', dep?.id)
      setDeployResult({ success: false, message: msg })
      setDeploying(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-brand-400" /></div>
  }

  if (tokens.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <AlertCircle className="w-12 h-12 text-warning-400 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-white mb-2">ابتدا یک توکن اضافه کنید</h3>
        <p className="text-slate-400 text-sm mb-6">برای استقرار ورکرها به توکن API کلودفلر نیاز دارید</p>
        <button onClick={() => navigate('/tokens')} className="btn-primary">رفتن به مدیریت توکن</button>
      </div>
    )
  }

  const steps = [
    { num: 1, label: 'نام و کلید', icon: Terminal },
    { num: 2, label: 'تنظیمات', icon: Settings },
    { num: 3, label: 'استقرار', icon: Rocket },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">استقرار ورکر جدید</h1>
        <p className="text-slate-400 text-sm mt-1">ورکر به‌صورت خودکار از مخزن دانلود و روی کلودفلر مستقر می‌شود — نیازی به کدنویسی نیست</p>
      </div>

      {/* Info banner */}
      <div className="glass-card p-4 flex items-center gap-3 border-brand-500/20">
        <div className="p-2 rounded-lg bg-brand-500/10">
          <Sparkles className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <p className="text-sm text-white font-medium">استقرار کاملاً خودکار</p>
          <p className="text-xs text-slate-400">کد ورکر از مخزن GitHub بارگذاری می‌شود، KV ساخته می‌شود، bindings تنظیم می‌شود و ورکر روی edge مستقر می‌گردد.</p>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center justify-between max-w-2xl">
        {steps.map((s, i) => {
          const Icon = s.icon
          const isActive = step === s.num
          const isDone = step > s.num
          return (
            <div key={s.num} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-2">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
                  isDone ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                  isActive ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/30 animate-pulse-glow' :
                  'bg-slate-800/50 text-slate-500 border border-slate-700/50'
                }`}>
                  {isDone ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <span className={`text-xs font-medium ${isActive ? 'text-white' : 'text-slate-500'}`}>{s.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 rounded transition-all duration-300 ${isDone ? 'bg-green-500/50' : 'bg-slate-800'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <div className="glass-card p-6 lg:p-8 min-h-[300px]">
        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <label className="block text-sm text-slate-300 mb-2 font-medium">نام ورکر</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value.trim().toLowerCase())}
                  placeholder="my-awesome-worker"
                  className="input-field flex-1"
                  dir="ltr"
                />
                <button onClick={() => setName(genName())} type="button" className="btn-ghost flex items-center gap-1.5" title="نام تصادفی">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">حروف کوچک، عدد، خط‌تیره · می‌شود <code className="text-brand-300">{name}.workers.dev</code></p>
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2 font-medium">رمز دسترسی (UUID)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={uuid}
                  onChange={(e) => setUuid(e.target.value.trim())}
                  className="input-field flex-1 font-mono text-sm"
                  dir="ltr"
                />
                <button onClick={() => setUuid(genUuid())} type="button" className="btn-ghost flex items-center gap-1.5" title="تولید UUID جدید">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">این کلید خصوصی پنل شماست — هر کس آن را داشته باشد می‌تواند ورکر را مدیریت کند</p>
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2 font-medium">مسیر سفارشی — اختیاری</label>
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value.trim())}
                placeholder="مثلاً mypath"
                className="input-field"
                dir="ltr"
              />
              <p className="text-xs text-slate-500 mt-2">اگر تنظیم شود، پنل از <code className="text-brand-300">/{customPath || 'mypath'}</code> در دسترس است نه <code className="text-brand-300">/{uuid.slice(0, 8)}...</code></p>
            </div>

            <div className="flex justify-end">
              <button
                disabled={!name.trim() || !validName(name) || !uuid.trim()}
                onClick={() => setStep(2)}
                className="btn-primary flex items-center gap-2"
              >
                مرحله بعد <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <label className="block text-sm text-slate-300 mb-2 font-medium">توکن کلودفلر</label>
              <select value={selectedToken} onChange={(e) => setSelectedToken(e.target.value)} className="input-field">
                {tokens.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2 font-medium">محیط اجرا</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMethod('workers')}
                  className={`p-4 rounded-xl border text-right transition-all ${
                    method === 'workers' ? 'border-brand-500 bg-brand-500/10' : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                  }`}
                >
                  <Cloud className={`w-5 h-5 mb-2 ${method === 'workers' ? 'text-brand-400' : 'text-slate-500'}`} />
                  <p className="text-sm font-bold text-white">Cloudflare Workers</p>
                  <p className="text-xs text-slate-400 mt-1">اتصال بومی KV و متغیرها. پیشنهادی.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('pages')}
                  className={`p-4 rounded-xl border text-right transition-all ${
                    method === 'pages' ? 'border-brand-500 bg-brand-500/10' : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                  }`}
                >
                  <Cloud className={`w-5 h-5 mb-2 ${method === 'pages' ? 'text-brand-400' : 'text-slate-500'}`} />
                  <p className="text-sm font-bold text-white">Cloudflare Pages</p>
                  <p className="text-xs text-slate-400 mt-1">به‌عنوان تابع _worker.js مستقر می‌شود.</p>
                </button>
              </div>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="btn-ghost">قبلی</button>
              <button onClick={() => setStep(3)} className="btn-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> بررسی و استقرار
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 animate-fade-in">
            {/* Summary */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-300 mb-3">خلاصه استقرار</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                  <p className="text-xs text-slate-500 mb-1">نام ورکر</p>
                  <p className="text-white font-medium" dir="ltr">{name}</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                  <p className="text-xs text-slate-500 mb-1">محیط اجرا</p>
                  <p className="text-white font-medium">{method === 'workers' ? 'Cloudflare Workers' : 'Cloudflare Pages'}</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                  <p className="text-xs text-slate-500 mb-1">توکن</p>
                  <p className="text-white font-medium">{tokens.find(t => t.id === selectedToken)?.name}</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                  <p className="text-xs text-slate-500 mb-1">مسیر پنل</p>
                  <p className="text-white font-medium" dir="ltr">/{customPath || uuid.slice(0, 8) + '...'}</p>
                </div>
              </div>
            </div>

            {/* Deploy button */}
            {!deployResult && (
              <div className="flex flex-col items-center gap-4 py-6">
                <button
                  onClick={handleDeploy}
                  disabled={deploying}
                  className="btn-primary flex items-center gap-2 px-8 py-3 text-lg"
                >
                  {deploying ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
                  {deploying ? 'در حال استقرار...' : 'استقرار ورکر'}
                </button>

                {/* Live logs */}
                {deploying && deployLogs.length > 0 && (
                  <div className="w-full max-w-2xl mt-4">
                    <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-4 max-h-48 overflow-y-auto font-mono text-xs space-y-1" dir="ltr">
                      {deployLogs.map((log, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="text-slate-600 shrink-0">{i + 1}.</span>
                          <span className={log.includes('✓') || log.includes('verified') || log.includes('created') || log.includes('enabled') || log.includes('uploaded') ? 'text-green-400' : log.includes('warning') || log.includes('⚠') ? 'text-warning-400' : 'text-slate-300'}>
                            {log}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {deploying && (
                  <p className="text-sm text-slate-400 animate-pulse">ورکر از مخزن دانلود، KV ساخته و روی edge مستقر می‌شود...</p>
                )}
              </div>
            )}

            {/* Result */}
            {deployResult && (
              <div className="animate-slide-up">
                {deployResult.success ? (
                  <div className="text-center py-6">
                    <div className="inline-flex w-16 h-16 rounded-2xl bg-green-500/10 items-center justify-center mb-4 animate-pulse-glow">
                      <Check className="w-8 h-8 text-green-400" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">{deployResult.message}</h3>

                    {deployResult.panelUrl && (
                      <div className="mt-6 space-y-3 max-w-md mx-auto">
                        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                          <p className="text-xs text-slate-500 mb-2">لینک خصوصی پنل ورکر</p>
                          <a href={deployResult.panelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-brand-300 hover:text-brand-200 transition-colors break-all text-sm" dir="ltr">
                            <ExternalLink className="w-4 h-4 shrink-0" /> {deployResult.panelUrl}
                          </a>
                        </div>
                        {deployResult.url && (
                          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                            <p className="text-xs text-slate-500 mb-2">آدرس پایه ورکر</p>
                            <p className="text-slate-300 text-sm break-all" dir="ltr">{deployResult.url}</p>
                          </div>
                        )}
                        <p className="text-xs text-warning-400/80 px-4">لینک پنل را خصوصی نگه دارید — هر کس آن را داشته باشد می‌تواند ورکر را مدیریت کند.</p>
                      </div>
                    )}

                    <div className="flex gap-3 justify-center mt-6">
                      <button onClick={() => navigate('/deployments')} className="btn-primary">مشاهده ورکرها</button>
                      <button onClick={() => { setStep(1); setDeployResult(null); setName(genName()); setUuid(genUuid()); setCustomPath(''); setDeployLogs([]); }} className="btn-ghost">استقرار جدید</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="inline-flex w-16 h-16 rounded-2xl bg-error-500/10 items-center justify-center mb-4">
                      <AlertCircle className="w-8 h-8 text-error-400" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">استقرار ناموفق</h3>
                    <p className="text-slate-400 text-sm mb-6 max-w-md mx-auto">{deployResult.message}</p>

                    {deployLogs.length > 0 && (
                      <div className="max-w-2xl mx-auto mb-6">
                        <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-4 max-h-48 overflow-y-auto font-mono text-xs space-y-1 text-right" dir="ltr">
                          {deployLogs.map((log, i) => (
                            <div key={i} className="text-slate-300">{i + 1}. {log}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 justify-center">
                      <button onClick={() => setDeployResult(null)} className="btn-primary">تلاش مجدد</button>
                      <button onClick={() => setStep(2)} className="btn-ghost">بازگشت به تنظیمات</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!deployResult && (
              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="btn-ghost" disabled={deploying}>قبلی</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
