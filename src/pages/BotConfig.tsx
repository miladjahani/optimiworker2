import { useEffect, useState, useCallback } from 'react'
import { db } from '../lib/db'
import type { BotConfig } from '../lib/types'
import {
  Bot,
  Loader2,
  Save,
  Check,
  Send,
  Webhook,
  Power,
  AlertCircle,
  Sparkles,
  Copy,
} from 'lucide-react'

export default function BotConfigPage() {
  const [config, setConfig] = useState<BotConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [welcomeMessage, setWelcomeMessage] = useState('سلام! به ربات miliconfig خوش آمدید. برای شروع /start را بفرستید.')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [webhookCopied, setWebhookCopied] = useState(false)

  const load = useCallback(async () => {
    const { data } = await db.from('bot_config').select('*').maybeSingle()
    if (data) {
      setConfig(data as BotConfig)
      setBotToken(data.bot_token)
      setWelcomeMessage(data.welcome_message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      // Get bot info from Telegram
      const botInfoResp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
      const botInfo = await botInfoResp.json()

      if (!botInfo.ok) {
        setMessage({ type: 'error', text: 'توکن ربات نامعتبر است' })
        setSaving(false)
        return
      }

      const payload = {
        bot_token: botToken,
        bot_username: botInfo.result?.username ?? null,
        welcome_message: welcomeMessage,
        is_active: config?.is_active ?? true,
      }

      if (config) {
        await db.from('bot_config').update(payload).eq('id', config.id)
      } else {
        const { data } = await db.from('bot_config').insert(payload).select().single()
        setConfig(data as BotConfig)
      }

      await db.from('activity_logs').insert({ action: 'bot_configured', entity_type: 'bot', entity_name: botInfo.result?.username })

      setConfig(prev => prev ? { ...prev, bot_username: botInfo.result?.username } : null)
      setMessage({ type: 'success', text: 'تنظیمات ربات ذخیره شد' })
    } catch {
      setMessage({ type: 'error', text: 'خطا در ارتباط با سرور تلگرام' })
    }

    setSaving(false)
    setTimeout(() => setMessage(null), 3000)
  }

  const handleConnectWebhook = async () => {
    if (!config) return
    setConnecting(true)
    setMessage(null)

    try {
      const webhookUrl = `${window.location.origin}/telegram`

      const resp = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      })
      const result = await resp.json()

      if (result.ok) {
        await db.from('bot_config').update({ webhook_url: webhookUrl, is_active: true }).eq('id', config.id)
        setConfig({ ...config, webhook_url: webhookUrl, is_active: true })
        setMessage({ type: 'success', text: 'وب‌هوک با موفقیت متصل شد! ربات آماده کار است.' })
      } else {
        setMessage({ type: 'error', text: result.description ?? 'اتصال وب‌هوک ناموفق بود' })
      }
    } catch {
      setMessage({ type: 'error', text: 'خطا در ارتباط با سرور تلگرام' })
    }

    setConnecting(false)
    setTimeout(() => setMessage(null), 4000)
  }

  const handleToggleActive = async () => {
    if (!config) return
    const newActive = !config.is_active
    await db.from('bot_config').update({ is_active: newActive }).eq('id', config.id)
    setConfig({ ...config, is_active: newActive })
  }

  const copyWebhookUrl = () => {
    if (config?.webhook_url) {
      navigator.clipboard.writeText(config.webhook_url)
      setWebhookCopied(true)
      setTimeout(() => setWebhookCopied(false), 2000)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-brand-400" /></div>
  }

  const webhookUrl = `${window.location.origin}/telegram`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">ربات تلگرام</h1>
        <p className="text-slate-400 text-sm mt-1">پیکربندی ربات تلگرام برای مدیریت از طریق چت</p>
      </div>

      {/* Status banner */}
      {config && (
        <div className={`glass-card p-4 flex items-center justify-between ${config.is_active ? 'border-green-500/30' : 'border-slate-700/50'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${config.is_active ? 'bg-green-500/10' : 'bg-slate-700/30'}`}>
              <Power className={`w-5 h-5 ${config.is_active ? 'text-green-400' : 'text-slate-400'}`} />
            </div>
            <div>
              <p className="text-white font-medium">{config.is_active ? 'ربات فعال است' : 'ربات غیرفعال است'}</p>
              {config.bot_username && <p className="text-xs text-slate-400" dir="ltr">@{config.bot_username}</p>}
            </div>
          </div>
          <button onClick={handleToggleActive} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            config.is_active ? 'bg-error-500/10 text-error-400 hover:bg-error-500/20' : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
          }`}>
            {config.is_active ? 'غیرفعال' : 'فعال'}
          </button>
        </div>
      )}

      {/* Config form */}
      <form onSubmit={handleSave} className="glass-card p-6 space-y-5">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Bot className="w-5 h-5 text-brand-400" /> تنظیمات ربات
        </h2>

        <div>
          <label className="block text-sm text-slate-300 mb-2 font-medium">توکن ربات تلگرام</label>
          <input
            type="text"
            required
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456789:ABCdefGHIjklMNO..."
            className="input-field font-mono text-sm"
            dir="ltr"
          />
          <p className="text-xs text-slate-500 mt-2">توکن را از @BotFather دریافت کنید</p>
        </div>

        <div>
          <label className="block text-sm text-slate-300 mb-2 font-medium">پیام خوش‌آمدگویی</label>
          <textarea
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            rows={3}
            className="input-field"
          />
        </div>

        {message && (
          <div className={`px-4 py-3 rounded-xl text-sm animate-slide-in ${
            message.type === 'success' ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-error-500/10 border border-error-500/30 text-error-400'
          }`}>
            <div className="flex items-center gap-2">
              {message.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {message.text}
            </div>
          </div>
        )}

        <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          ذخیره تنظیمات
        </button>
      </form>

      {/* Webhook connection */}
      {config && (
        <div className="glass-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Webhook className="w-5 h-5 text-brand-400" /> اتصال وب‌هوک
          </h2>

          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50">
            <p className="text-xs text-slate-500 mb-2">آدرس وب‌هوک:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-slate-300 font-mono truncate" dir="ltr">{webhookUrl}</code>
              <button onClick={copyWebhookUrl} className="p-1.5 rounded-lg text-slate-500 hover:text-white transition-colors">
                {webhookCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {config.webhook_url ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/30">
              <Check className="w-5 h-5 text-green-400" />
              <p className="text-sm text-green-400">وب‌هوک متصل است و ربات آماده دریافت پیام‌هاست</p>
            </div>
          ) : (
            <button onClick={handleConnectWebhook} disabled={connecting} className="btn-primary flex items-center gap-2">
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {connecting ? 'در حال اتصال...' : 'اتصال وب‌هوک'}
            </button>
          )}
        </div>
      )}

      {/* Bot commands info */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-brand-400" /> دستورات ربات
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { cmd: '/start', desc: 'شروع کار با ربات' },
            { cmd: '/deploy <name>', desc: 'استقرار ورکر جدید' },
            { cmd: '/workers', desc: 'لیست ورکرهای مستقر شده' },
            { cmd: '/status', desc: 'وضعیت سرویس‌ها' },
            { cmd: '/tokens', desc: 'لیست توکن‌های کلودفلر' },
            { cmd: '/help', desc: 'راهنمای دستورات' },
          ].map((c) => (
            <div key={c.cmd} className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800/50">
              <code className="text-sm text-brand-300 font-mono shrink-0" dir="ltr">{c.cmd}</code>
              <span className="text-sm text-slate-400">{c.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
