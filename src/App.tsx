import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent, ReactNode } from 'react'
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowRight, Bell, CalendarDays,
  Check, CheckCircle2, ChevronDown, CircleHelp, Clapperboard, Clock3, CloudUpload,
  Image as ImageIcon, LayoutDashboard, LogOut, Monitor, MonitorPlay, MoreHorizontal,
  Pause,   Play, Plus, Radio, RefreshCw, ShieldCheck, Sparkles, Square,
  Tv, Upload, Video, X,
} from 'lucide-react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog'
import './App.css'

type Screen = {
  id: string
  label: string
  auth_user_id: string | null
  last_seen_at: string | null
}

type MediaAsset = {
  id: string
  file_name: string
  storage_path: string
  mime_type: string
  size_bytes: number
  created_at: string
}

type Assignment = {
  screen_id: string
  content: Record<string, unknown>
  updated_at: string
}

type ActivityItem = {
  id: string
  action: string
  created_at: string
  metadata: Record<string, unknown>
}

type Profile = {
  role: 'administrator' | 'operator' | 'viewer'
  full_name: string | null
}

type ProgrammeItem = {
  id: string
  activity: string
  presenter: string | null
  starts_at: string
  ends_at: string
}

type Notice = { tone: 'success' | 'error' | 'info'; text: string }
type DisplayCache = {
  screenLabel: string
  assignment: Assignment | null
  media: Array<MediaAsset & { url: string }>
  programme: ProgrammeItem[]
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase: SupabaseClient | null = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null
const BUCKET = 'screen-media'
const MAX_FILE_BYTES = 100 * 1024 * 1024

function isOnline(lastSeen: string | null): boolean {
  return Boolean(lastSeen && Date.now() - new Date(lastSeen).getTime() < 60_000)
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'An unexpected error occurred. Please try again.'
}

function readDisplayCache(screenId: string): DisplayCache | null {
  try {
    const raw = localStorage.getItem(`screencontrol-display:${screenId}`)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const cache = value as Partial<DisplayCache>
    if (typeof cache.screenLabel !== 'string' || !Array.isArray(cache.media) || !Array.isArray(cache.programme)) return null
    return {
      screenLabel: cache.screenLabel,
      assignment: cache.assignment ?? null,
      media: cache.media,
      programme: cache.programme,
    }
  } catch (error) {
    console.error('Unable to restore the saved display content:', error)
    return null
  }
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const displayId = useMemo(() => {
    const match = window.location.pathname.match(/^\/display\/([0-9a-f-]+)\/?$/i)
    return match?.[1] ?? new URLSearchParams(window.location.search).get('screen')
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Unable to restore the current session:', error.message)
      if (active) {
        setSession(data.session)
        setAuthReady(true)
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  if (!supabase) return <SetupScreen onRetry={() => window.location.reload()} />
  if (!authReady) return <div className="boot-screen"><div className="spinner" /><span>Getting things ready…</span></div>
  if (displayId) return <DisplayApp client={supabase} screenId={displayId} />
  if (!session) return <SignIn client={supabase} />
  return <ControlApp client={supabase} session={session} />
}

function SetupScreen({ onRetry }: { onRetry: () => void }) {
  const [guideOpen, setGuideOpen] = useState(false)
  return (
    <main className="setup-shell">
      <div className="setup-card">
        <div className="brand-mark"><Tv size={21} /></div>
        <span className="eyebrow">SCREENCONTROL SETUP</span>
        <h1>One quick setup step.</h1>
        <p>Connect this app to your Supabase project to turn on secure sign-in, screen pairing, and live playback.</p>
        <div className="setup-instructions">
          <strong>Add your project keys</strong>
          <code>VITE_SUPABASE_URL=…</code>
          <code>VITE_SUPABASE_ANON_KEY=…</code>
          <span>Copy <code>.env.example</code> to <code>.env.local</code>, fill in the values, then restart the app.</span>
        </div>
        <button className="button button-primary" onClick={onRetry}><RefreshCw size={16} /> Check setup</button>
        <button className="auth-switch" onClick={() => setGuideOpen(true)}>Read the system guide</button>
        <small>Your private service-role key is never needed in this app.</small>
      </div>
      <SystemGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </main>
  )
}

function SignIn({ client }: { client: SupabaseClient }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const [email, setEmail] = useState('kfrancis0586@gmail.com')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const { data, error: authError } = isSignUp
      ? await client.auth.signUp({ email: email.trim(), password })
      : await client.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (authError) {
      setError(authError.message)
      return
    }
    if (isSignUp && !data.session) {
      setMessage('Account created. Check your email to confirm your address, then sign in.')
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-brand"><div className="brand-mark"><Tv size={21} /></div><strong>SCREEN<span>CONTROL</span></strong></div>
      <section className="auth-card">
        <span className="eyebrow">YOUR EVENT, IN SYNC</span>
        <h1>{isSignUp ? 'Create your account.' : 'Welcome back.'}</h1>
        <p>{isSignUp ? 'Create an account to access ScreenControl.' : 'Sign in to manage your event screens.'}</p>
        <form onSubmit={submit} className="form-stack">
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organisation.com" /></label>
          <label>Password<input type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isSignUp ? 'Create a password' : 'Enter your password'} /></label>
          {error && <div className="inline-error" role="alert"><AlertCircle size={16} />{error}</div>}
          {message && <div className="auth-success" role="status">{message}</div>}
          <button className="button button-primary button-wide" disabled={busy}>{busy ? <span className="spinner small" /> : null}{busy ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create account' : 'Sign in')}<ArrowRight size={17} /></button>
        </form>
        <button
          className="auth-switch"
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp)
            setError('')
            setMessage('')
          }}
        >
          {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
        <button className="auth-switch" type="button" onClick={() => setGuideOpen(true)}>Read the system guide</button>
        <div className="auth-note"><ShieldCheck size={16} /> New accounts start as viewers; administrators manage access levels.</div>
      </section>
      <span className="auth-footer">Simple, reliable control for every screen.</span>
      <SystemGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </main>
  )
}

function ControlApp({ client, session }: { client: SupabaseClient; session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [screens, setScreens] = useState<Screen[]>([])
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [programme, setProgramme] = useState<ProgrammeItem[]>([])
  const [screensLoadError, setScreensLoadError] = useState<string | null>(null)
  const [page, setPage] = useState<'home' | 'screens' | 'media' | 'programme'>('home')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [liveUpdates, setLiveUpdates] = useState(false)
  const [draggedAsset, setDraggedAsset] = useState<string | null>(null)
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [selectedScreens, setSelectedScreens] = useState<string[]>([])
  const [imageDuration, setImageDuration] = useState('12')
  const [repeatPlaylist, setRepeatPlaylist] = useState(true)
  const [modal, setModal] = useState<'timer' | 'announcement' | 'pair' | 'programme' | null>(null)
  const [activeScreen, setActiveScreen] = useState<Screen | null>(null)
  const [pairingCode, setPairingCode] = useState('')
  const [timerTitle, setTimerTitle] = useState('Starting soon')
  const [timerMinutes, setTimerMinutes] = useState('10')
  const [announcementTitle, setAnnouncementTitle] = useState('')
  const [announcementMessage, setAnnouncementMessage] = useState('')
  const [programmeActivity, setProgrammeActivity] = useState('')
  const [programmePresenter, setProgrammePresenter] = useState('')
  const [programmeStart, setProgrammeStart] = useState('')
  const [programmeEnd, setProgrammeEnd] = useState('')
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const initializedTargets = useRef(false)
  const canControl = profile?.role === 'administrator' || profile?.role === 'operator'

  const notify = useCallback((tone: Notice['tone'], text: string) => {
    setNotice({ tone, text })
    window.setTimeout(() => setNotice(null), 4200)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [profileResult, screenResult, assetResult, assignmentResult, activityResult, programmeResult] = await Promise.all([
        client.from('user_profiles').select('role,full_name').eq('id', session.user.id).maybeSingle(),
        client.from('screens').select('id,label,auth_user_id,last_seen_at').order('label'),
        client.from('media_assets').select('id,file_name,storage_path,mime_type,size_bytes,created_at').order('created_at', { ascending: false }),
        client.from('screen_assignments').select('screen_id,content,updated_at'),
        client.from('activity_log').select('id,action,created_at,metadata').order('created_at', { ascending: false }).limit(24),
        client.from('programme_items').select('id,activity,presenter,starts_at,ends_at').order('starts_at'),
      ])
      const failures = [
        { resource: 'profile', error: profileResult.error },
        { resource: 'screens', error: screenResult.error },
        { resource: 'media library', error: assetResult.error },
        { resource: 'screen assignments', error: assignmentResult.error },
        { resource: 'activity', error: activityResult.error },
        { resource: 'programme', error: programmeResult.error },
      ].filter(({ error }) => error)
      const missingProfileMessage = !profileResult.error && !profileResult.data
        ? 'Your account profile is missing. Run supabase/migrations/202611260001_backfill_user_profiles.sql in the Supabase SQL Editor, then refresh.'
        : null
      if (failures.length) {
        notify('error', failures.map(({ resource, error }) => `Couldn't load ${resource}: ${friendlyError(error)}`).join(' · '))
      } else if (missingProfileMessage) {
        notify('error', missingProfileMessage)
      }
      setScreensLoadError(screenResult.error ? friendlyError(screenResult.error) : missingProfileMessage)
      if (profileResult.data) setProfile(profileResult.data as Profile)
      if (screenResult.data) {
        const loadedScreens = screenResult.data as Screen[]
        setScreens(loadedScreens)
        if (!initializedTargets.current && loadedScreens.length) {
          setSelectedScreens(loadedScreens.map((screen) => screen.id))
          initializedTargets.current = true
        }
      }
      if (assetResult.data) setAssets(assetResult.data as MediaAsset[])
      if (assignmentResult.data) setAssignments(assignmentResult.data as Assignment[])
      if (activityResult.data) setActivity(activityResult.data as ActivityItem[])
      if (programmeResult.data) setProgramme(programmeResult.data as ProgrammeItem[])
    } catch (error) {
      const message = friendlyError(error)
      setScreensLoadError(message)
      notify('error', `Couldn't load dashboard data: ${message}`)
    } finally {
      setLoading(false)
    }
  }, [client, notify, session.user.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload() }, 0)
    return () => window.clearTimeout(timer)
  }, [reload])

  useEffect(() => {
    const channel = client.channel('screencontrol-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screens' }, () => {
        void client.from('screens').select('id,label,auth_user_id,last_seen_at').order('label').then(({ data }) => { if (data) setScreens(data as Screen[]) })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screen_assignments' }, () => {
        void client.from('screen_assignments').select('screen_id,content,updated_at').then(({ data }) => { if (data) setAssignments(data as Assignment[]) })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media_assets' }, () => { void reload() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'programme_items' }, () => { void reload() })
      .subscribe((status) => {
        setLiveUpdates(status === 'SUBSCRIBED')
        if (status === 'CHANNEL_ERROR') notify('error', 'Live updates are temporarily unavailable. Check your connection.')
      })
    return () => { void client.removeChannel(channel) }
  }, [client, notify, reload])

  const currentAssignment = useCallback((screenId: string) => assignments.find((item) => item.screen_id === screenId), [assignments])

  async function signOut() {
    const { error } = await client.auth.signOut()
    if (error) notify('error', error.message)
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!canControl) return notify('error', 'You need operator access to upload media.')
    const accepted = Array.from(files)
    if (!accepted.length) return
    const valid = accepted.filter((file) => {
      const okayType = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(file.type)
      const okaySize = file.size > 0 && file.size <= MAX_FILE_BYTES
      if (!okayType) notify('error', `${file.name}: choose a JPG, PNG, WebP, or MP4 file.`)
      else if (!okaySize) notify('error', `${file.name}: files must be smaller than 100 MB.`)
      return okayType && okaySize
    })
    if (!valid.length) return
    setBusy(true)
    let uploaded = 0
    for (const file of valid) {
      const safeName = file.name.replace(/[^\w.-]+/g, '-')
      const path = `${session.user.id}/${crypto.randomUUID()}-${safeName}`
      const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) {
        notify('error', `Couldn't upload ${file.name}: ${uploadError.message}`)
        continue
      }
      const { error: rowError } = await client.from('media_assets').insert({
        file_name: file.name,
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
      })
      if (rowError) {
        const { error: cleanupError } = await client.storage.from(BUCKET).remove([path])
        if (cleanupError) console.error('Could not remove unreferenced upload:', cleanupError.message)
        notify('error', `Couldn't save ${file.name}: ${rowError.message}`)
        continue
      }
      uploaded++
    }
    await reload()
    setBusy(false)
    if (uploaded) notify('success', `${uploaded} ${uploaded === 1 ? 'file' : 'files'} added to your library.`)
  }

  async function publish(screenIds: string[], content: Record<string, unknown>) {
    if (!canControl) return notify('error', 'Your account can view screens but cannot change them.')
    if (!screenIds.length) return notify('error', 'Choose at least one screen first.')
    setBusy(true)
    const { error } = await client.rpc('publish_screen_content', { p_screen_ids: screenIds, p_content: content })
    setBusy(false)
    if (error) return notify('error', error.message)
    setSelectedAssets([])
    notify('success', `Updated ${screenIds.length === 1 ? '1 screen' : `${screenIds.length} screens`}.`)
    setModal(null)
    await reload()
  }

  async function stopScreen(screenId: string) {
    await publish([screenId], { type: 'standby' })
  }

  async function toggleTimer(screenId: string, paused: boolean) {
    setBusy(true)
    const { error } = await client.rpc('control_screen_timer', { p_screen_id: screenId, p_action: paused ? 'resume' : 'pause' })
    setBusy(false)
    if (error) return notify('error', error.message)
    notify('success', paused ? 'Countdown resumed.' : 'Countdown paused.')
    await reload()
  }

  async function togglePlayback(screenId: string, paused: boolean, type: unknown) {
    if (type === 'timer') return toggleTimer(screenId, paused)
    setBusy(true)
    const { error } = await client.rpc('control_screen_playback', { p_screen_id: screenId, p_action: paused ? 'resume' : 'pause' })
    setBusy(false)
    if (error) return notify('error', error.message)
    notify('success', paused ? 'Playback resumed.' : 'Playback paused.')
    await reload()
  }

  async function playSelected(targetIds = selectedScreens) {
    const chosen = selectedAssets.flatMap((id) => {
      const asset = assets.find((item) => item.id === id)
      return asset ? [asset] : []
    })
    if (!chosen.length) return notify('error', 'Choose a picture or video to play.')
    if (!targetIds.length) return notify('error', 'Choose at least one screen first.')
    const seconds = Number(imageDuration)
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 600) return notify('error', 'Set image duration between 3 and 600 seconds.')
    const content = {
      type: chosen.length > 1 ? 'playlist' : chosen[0].mime_type.startsWith('video/') ? 'video' : 'image',
      media_ids: chosen.map((asset) => asset.id),
      image_duration_seconds: seconds,
      repeat: chosen.length > 1 && repeatPlaylist,
    }
    await publish(targetIds, content)
  }

  function dragOver(event: DragEvent<HTMLElement>) { event.preventDefault() }
  async function dropOnScreen(event: DragEvent<HTMLElement>, screenId: string) {
    event.preventDefault()
    const assetId = event.dataTransfer.getData('text/plain') || draggedAsset
    if (!assetId) return
    const asset = assets.find((item) => item.id === assetId)
    if (!asset) return notify('error', 'That media item is no longer available. Refresh the library.')
    await publish([screenId], {
      type: asset.mime_type.startsWith('video/') ? 'video' : 'image',
      media_ids: [asset.id],
      image_duration_seconds: Number(imageDuration) || 12,
      repeat: false,
    })
  }

  async function createPairingCode(screen: Screen) {
    setActiveScreen(screen)
    setPairingCode('')
    setModal('pair')
    const { data, error } = await client.rpc('create_screen_pairing_code', { p_screen_id: screen.id })
    if (error) return notify('error', error.message)
    setPairingCode(data as string)
  }

  async function saveProgramme(event: FormEvent) {
    event.preventDefault()
    const startsAt = new Date(programmeStart)
    const endsAt = new Date(programmeEnd)
    if (endsAt <= startsAt) return notify('error', 'The end time must be after the start time.')
    const { error } = await client.from('programme_items').insert({
      activity: programmeActivity,
      presenter: programmePresenter || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    if (error) return notify('error', error.message)
    setProgrammeActivity('')
    setProgrammePresenter('')
    setProgrammeStart('')
    setProgrammeEnd('')
    setModal(null)
    notify('success', 'Programme item added.')
    await reload()
  }

  const onlineCount = screens.filter((screen) => isOnline(screen.last_seen_at)).length
  const activeCount = screens.filter((screen) => Boolean(currentAssignment(screen.id))).length
  const nav = [
    { key: 'home', title: 'Overview', icon: LayoutDashboard },
    { key: 'screens', title: 'My screens', icon: Monitor },
    { key: 'media', title: 'Media library', icon: Clapperboard },
    { key: 'programme', title: 'Programme', icon: CalendarDays },
  ] as const

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Tv size={20} /></div><span>SCREEN<strong>CONTROL</strong></span></div>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <div className="workspace-select"><div className="workspace-avatar">S</div><span><strong>Your event</strong><small>Event workspace</small></span><ChevronDown size={15} /></div>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map(({ key, title, icon: Icon }) => (
            <button key={key} className={`nav-item ${page === key ? 'selected' : ''}`} onClick={() => setPage(key)}>
              <Icon size={18} strokeWidth={1.8} />{title}{key === 'screens' && <span className="nav-count">{screens.length || 4}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={17} /></div><strong>Need a hand?</strong><span>Get a screen ready in a few simple steps.</span><button onClick={() => setGuideOpen(true)}>System guide <ArrowRight size={13} /></button></div>
          <div className="user-menu"><div className="user-avatar">{(profile?.full_name || session.user.email || 'S').slice(0, 1).toUpperCase()}</div><span><strong>{profile?.full_name || session.user.email?.split('@')[0]}</strong><small>{profile?.role || 'Loading role…'}</small></span><button aria-label="Sign out" onClick={signOut}><LogOut size={17} /></button></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{nav.find((item) => item.key === page)?.title}</strong></div>
          <div className="topbar-actions"><div className={`live-pill ${liveUpdates ? 'is-live' : ''}`}><span />{liveUpdates ? 'Live updates' : 'Connecting…'}</div><button className="icon-button" aria-label="Open system guide" title="System guide" onClick={() => setGuideOpen(true)}><CircleHelp size={17} /></button><button className="icon-button" aria-label="Refresh" onClick={() => void reload()}><RefreshCw size={17} /></button><div className="topbar-avatar">{(profile?.full_name || session.user.email || 'S').slice(0, 1).toUpperCase()}</div></div>
        </header>

        <div className="page-content">
          {page === 'home' && (
            <>
              <div className="welcome-row">
                <div><span className="eyebrow">EVENT CONTROL</span><h1>Good to see you, {profile?.full_name?.split(' ')[0] || 'there'} <span className="wave">✦</span></h1><p>Here’s what’s happening across your screens.</p></div>
                <button className="button button-outline" onClick={() => setPage('screens')}><Monitor size={16} /> Manage screens <ArrowRight size={15} /></button>
              </div>
              <section className="stats-grid">
                <StatCard label="Screens online" value={`${onlineCount} / 4`} note={onlineCount === 4 ? 'All screens connected' : 'Waiting for a connection'} icon={<Radio size={18} />} tone="green" />
                <StatCard label="Showing content" value={`${activeCount} / 4`} note="Screens with an active assignment" icon={<MonitorPlay size={18} />} tone="blue" />
                <StatCard label="Media library" value={String(assets.length)} note="Pictures and videos ready to play" icon={<ImageIcon size={18} />} tone="orange" />
              </section>
              <section className="control-banner">
                <div className="banner-text"><div className="banner-kicker"><Sparkles size={14} /> YOUR EVENT, IN SYNC</div><h2>Make every screen<br />part of the moment.</h2><p>Pick something to show, choose your screens, and you’re live.</p><button className="button button-light" onClick={() => { setPage('media'); fileInput.current?.click() }}><Upload size={16} /> Add picture or video <ArrowRight size={15} /></button></div>
                <div className="banner-art" aria-hidden="true"><div className="art-glow" /><div className="art-screen art-back"><div className="art-lines"><i /><i /><i /></div></div><div className="art-screen art-front"><div className="art-play"><Play size={21} fill="currentColor" /></div><div className="art-label">YOUR EVENT<br /><b>ON EVERY SCREEN</b></div></div><div className="art-spark spark-one">✦</div><div className="art-spark spark-two">✳</div><div className="art-orbit" /></div>
              </section>
              <section className="quick-actions" aria-label="Quick actions">
                <button className="quick-action" onClick={() => { setPage('media'); window.setTimeout(() => fileInput.current?.click(), 0) }}><span className="quick-icon purple"><ImageIcon size={20} /></span><span><strong>Show a picture</strong><small>Flyers, photos & more</small></span><ArrowRight size={16} /></button>
                <button className="quick-action" onClick={() => { setPage('media'); window.setTimeout(() => fileInput.current?.click(), 0) }}><span className="quick-icon blue"><Video size={20} /></span><span><strong>Play a video</strong><small>Share a moment</small></span><ArrowRight size={16} /></button>
                <button className="quick-action" disabled={!canControl} onClick={() => { if (!selectedScreens.length) setSelectedScreens(screens.map((screen) => screen.id)); setModal('timer') }}><span className="quick-icon orange"><Clock3 size={20} /></span><span><strong>Start a timer</strong><small>Keep everyone in sync</small></span><ArrowRight size={16} /></button>
                <button className="quick-action" disabled={!canControl} onClick={() => { if (!selectedScreens.length) setSelectedScreens(screens.map((screen) => screen.id)); setModal('announcement') }}><span className="quick-icon green"><Bell size={20} /></span><span><strong>Show an announcement</strong><small>A message for your audience</small></span><ArrowRight size={16} /></button>
              </section>
              <div className="section-heading"><div><h2>Your screens</h2><p>Drop media onto a screen, or open it to make a change.</p></div><button className="text-button" onClick={() => setPage('screens')}>See all screens <ArrowRight size={15} /></button></div>
              <div className="screen-grid">
                {(screens.length ? screens : []).map((screen, index) => (
                  <ScreenCard key={screen.id} screen={screen} assignment={currentAssignment(screen.id)} index={index} canControl={canControl} onDrop={dropOnScreen} onDragOver={dragOver} onOpen={() => { setActiveScreen(screen); setSelectedScreens([screen.id]); setPage('media') }} onPair={() => void createPairingCode(screen)} onStop={() => void stopScreen(screen.id)} onPause={(paused) => void togglePlayback(screen.id, paused, currentAssignment(screen.id)?.content.type)} busy={busy} />
                ))}
                {!screens.length && !loading && <EmptyPanel text={screensLoadError ? `Couldn't load screens: ${screensLoadError}` : 'No screens are set up yet. Refresh once your database migration has been applied.'} />}
              </div>
              <div className="lower-grid">
                <section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Changes made by your team.</p></div><button className="icon-button" aria-label="More activity" onClick={() => setShowAllActivity((value) => !value)}><MoreHorizontal size={19} /></button></div><ActivityList items={showAllActivity ? activity : activity.slice(0, 4)} /></section>
                <section className="panel next-panel"><div className="panel-heading"><div><h2>Up next</h2><p>Your event programme.</p></div><button className="icon-button" aria-label="Open programme" onClick={() => setPage('programme')}><ArrowRight size={17} /></button></div>{programme.length ? <ProgrammeList items={programme.slice(0, 3)} /> : <div className="empty-compact"><CalendarDays size={21} /><span>No activities added yet.</span><button className="text-button" onClick={() => { setPage('programme'); setModal('programme') }}>Add programme item <Plus size={14} /></button></div>}</section>
              </div>
            </>
          )}

          {page === 'screens' && <section className="subpage">
            <div className="welcome-row"><div><span className="eyebrow">DISPLAY CONTROL</span><h1>Your screens</h1><p>Pair each TV once, then show content from anywhere.</p></div><div className="screen-summary"><span className="status-dot" />{onlineCount} online <span className="summary-divider" /> {screens.length} registered</div></div>
            <div className="screen-grid screen-grid-large">{screens.map((screen, index) => <ScreenCard key={screen.id} screen={screen} assignment={currentAssignment(screen.id)} index={index} canControl={canControl} onDrop={dropOnScreen} onDragOver={dragOver} onOpen={() => { setActiveScreen(screen); setSelectedScreens([screen.id]); setPage('media') }} onPair={() => void createPairingCode(screen)} onStop={() => void stopScreen(screen.id)} onPause={(paused) => void togglePlayback(screen.id, paused, currentAssignment(screen.id)?.content.type)} busy={busy} />)}{!screens.length && !loading && <EmptyPanel text={screensLoadError ? `Couldn't load screens: ${screensLoadError}` : 'No screens are set up yet. Refresh once your database migration has been applied.'} />}</div>
            <div className="note-banner"><ShieldCheck size={18} /><span><strong>Pairing is private.</strong> Each TV gets its own one-time code. Codes expire in 10 minutes and can only be used once.</span></div>
          </section>}

          {page === 'media' && <section className="subpage">
            <div className="welcome-row"><div><span className="eyebrow">CONTENT LIBRARY</span><h1>Pictures & videos</h1><p>Upload event media, select screens, and play it instantly.</p></div><button disabled={!canControl || busy} className="button button-primary" onClick={() => fileInput.current?.click()}><CloudUpload size={17} /> Add picture or video</button></div>
            <div className="media-toolbar"><div className="library-count">{assets.length} {assets.length === 1 ? 'item' : 'items'} <span>·</span> JPG, PNG, WebP, MP4</div><div className="media-selection">{selectedAssets.length > 0 && <span>{selectedAssets.length} selected</span>}{(selectedAssets.length > 0) && <label className="duration-control">Image duration <input aria-label="Image duration in seconds" type="number" min="3" max="600" value={imageDuration} onChange={(event) => setImageDuration(event.target.value)} /> sec</label>}{selectedAssets.length > 1 && <label className="repeat-control"><input type="checkbox" checked={repeatPlaylist} onChange={(event) => setRepeatPlaylist(event.target.checked)} /> Repeat playlist</label>}<button className="button button-outline button-small" disabled={!canControl || selectedAssets.length === 0 || !selectedScreens.length} onClick={() => void playSelected()}><Play size={14} /> Play on {selectedScreens.length === screens.length ? 'all screens' : selectedScreens.length ? `${selectedScreens.length} screens` : 'choose screens'}</button></div></div>
            <ScreenTargetChooser label="PLAY ON" screens={screens} selected={selectedScreens} onChange={setSelectedScreens} />
            {assets.length ? <div className="media-grid">{assets.map((asset) => <MediaCard key={asset.id} asset={asset} selected={selectedAssets.includes(asset.id)} client={client} onSelect={() => setSelectedAssets((selected) => selected.includes(asset.id) ? selected.filter((id) => id !== asset.id) : [...selected, asset.id])} onDragStart={(event) => { setDraggedAsset(asset.id); event.dataTransfer.setData('text/plain', asset.id) }} />)}</div> : <div className="upload-empty" onDragOver={dragOver} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files) }}><div className="upload-empty-icon"><CloudUpload size={26} /></div><h2>Your media library is ready.</h2><p>Drop pictures or MP4 videos here, or choose files from your device.</p><button disabled={!canControl} className="button button-primary" onClick={() => fileInput.current?.click()}><Plus size={16} /> Choose files</button><small>JPG, PNG, WebP, or MP4 · Up to 100 MB per file</small></div>}
            {!canControl && <div className="note-banner"><ShieldCheck size={18} /><span>Your role is <strong>{profile?.role}</strong>. Ask an administrator or operator to upload or play media.</span></div>}
          </section>}

          {page === 'programme' && <section className="subpage">
            <div className="welcome-row"><div><span className="eyebrow">EVENT TIMELINE</span><h1>Programme</h1><p>Give your team a clear view of what’s happening next.</p></div><button disabled={!canControl} className="button button-primary" onClick={() => setModal('programme')}><Plus size={17} /> Add activity</button></div>
            <div className="programme-display-bar"><ScreenTargetChooser label="SHOW ON" screens={screens} selected={selectedScreens} onChange={setSelectedScreens} /><button disabled={!canControl || !programme.length || !selectedScreens.length} className="button button-outline button-small" onClick={() => void publish(selectedScreens, { type: 'programme' })}><MonitorPlay size={15} /> Show programme</button></div>
            <div className="programme-page panel">{programme.length ? <ProgrammeList items={programme} expanded /> : <div className="empty-compact"><CalendarDays size={24} /><span>Your programme is empty.</span><button className="text-button" disabled={!canControl} onClick={() => setModal('programme')}>Add the first activity <ArrowRight size={14} /></button></div>}</div>
          </section>}

          <footer className="page-footer"><span>SCREENCONTROL <i>·</i> Simple control for the moments that matter.</span><span><span className={`footer-dot ${onlineCount === screens.length && screens.length ? 'online' : ''}`} /> {onlineCount} of {screens.length} screens online</span></footer>
        </div>
      </main>

      <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" multiple onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.currentTarget.value = '' }} />
      {modal === 'timer' && <Modal title="Start a countdown" subtitle="Keep every selected screen in sync." onClose={() => setModal(null)}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const minutes = Number(timerMinutes); if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) return notify('error', 'Enter a time between 1 and 240 minutes.'); void publish(selectedScreens.length ? selectedScreens : screens.map((screen) => screen.id), { type: 'timer', title: timerTitle || 'Starting soon', duration_seconds: Math.round(minutes * 60) }) }}><label>Countdown title<input value={timerTitle} onChange={(event) => setTimerTitle(event.target.value)} maxLength={70} /></label><label>Time in minutes<input type="number" min="1" max="240" required value={timerMinutes} onChange={(event) => setTimerMinutes(event.target.value)} /></label><ScreenTargetChooser label="SHOW ON" screens={screens} selected={selectedScreens} onChange={setSelectedScreens} /><div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy || !selectedScreens.length}><Play size={15} /> Start countdown</button></div></form></Modal>}
      {modal === 'announcement' && <Modal title="Show an announcement" subtitle="Send a clear message to your screens." onClose={() => setModal(null)}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void publish(selectedScreens, { type: 'announcement', title: announcementTitle, message: announcementMessage }) }}><label>Heading<input required maxLength={80} value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} placeholder="A quick announcement" /></label><label>Message<textarea required maxLength={500} rows={4} value={announcementMessage} onChange={(event) => setAnnouncementMessage(event.target.value)} placeholder="Type your message…" /></label><ScreenTargetChooser label="SHOW ON" screens={screens} selected={selectedScreens} onChange={setSelectedScreens} /><div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy || !selectedScreens.length}><Bell size={15} /> Display announcement</button></div></form></Modal>}
      {modal === 'programme' && <Modal title="Add programme activity" subtitle="Keep your team up to date with the schedule." onClose={() => setModal(null)}><form className="form-stack" onSubmit={(event) => void saveProgramme(event)}><label>Activity<input required maxLength={120} value={programmeActivity} onChange={(event) => setProgrammeActivity(event.target.value)} placeholder="Welcome and opening" /></label><label>Presenter <span className="optional">(optional)</span><input value={programmePresenter} onChange={(event) => setProgrammePresenter(event.target.value)} placeholder="Name" /></label><div className="form-columns"><label>Starts<input required type="datetime-local" value={programmeStart} onChange={(event) => setProgrammeStart(event.target.value)} /></label><label>Ends<input required type="datetime-local" value={programmeEnd} onChange={(event) => setProgrammeEnd(event.target.value)} /></label></div><div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary"><Plus size={15} /> Add to programme</button></div></form></Modal>}
      {modal === 'pair' && activeScreen && <Modal title={`Pair ${activeScreen.label}`} subtitle="Open this address on the TV and enter its one-time code." onClose={() => setModal(null)}><div className="pairing-instructions"><div className="pair-step"><span>1</span><div><strong>Open the TV's pairing page</strong><code>{`${window.location.origin}/display/${activeScreen.id}`}</code></div></div><div className="pair-step"><span>2</span><div><strong>Enter this code on the TV</strong><div className="pair-code">{pairingCode || <span className="spinner small" />}</div></div></div><small>The code works once and expires in 10 minutes. Keep this window open while pairing.</small></div><div className="modal-actions"><button className="button button-outline" onClick={() => setModal(null)}>Done</button><button className="button button-primary" onClick={() => void createPairingCode(activeScreen)}><RefreshCw size={15} /> New code</button></div></Modal>}
      <SystemGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
      {notice && <div role="status" className={`toast toast-${notice.tone}`}><span className="toast-icon">{notice.tone === 'success' ? <CheckCircle2 size={17} /> : notice.tone === 'error' ? <AlertCircle size={17} /> : <CircleHelp size={17} />}</span>{notice.text}<button aria-label="Dismiss" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    </div>
  )
}

function StatCard({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: ReactNode; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-note">{note}</span></div>
}

function ScreenCard({ screen, assignment, index, canControl, onDrop, onDragOver, onOpen, onPair, onStop, onPause, busy }: {
  screen: Screen; assignment?: Assignment; index: number; canControl: boolean
  onDrop: (event: DragEvent<HTMLElement>, screenId: string) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onOpen: () => void; onPair: () => void; onStop: () => void; onPause: (paused: boolean) => void; busy: boolean
}) {
  const online = isOnline(screen.last_seen_at)
  const content = assignment?.content
  const hasContent = Boolean(content?.type)
  const canPause = ['timer', 'image', 'video', 'playlist'].includes(String(content?.type))
  const paused = Boolean(content?.paused_at)
  const contentLabel = content?.type === 'timer' ? `${content.title || 'Countdown'} timer` :
    content?.type === 'announcement' ? String(content.title || 'Announcement') :
      content?.type === 'programme' ? 'Programme display' :
      content?.type === 'playlist' ? 'Playlist playing' :
        content?.type === 'video' ? 'Video playing' : content?.type === 'image' ? 'Picture showing' : 'Nothing playing'
  return (
    <article className={`screen-card ${online ? 'screen-ready' : ''}`} onDragOver={onDragOver} onDrop={(event) => void onDrop(event, screen.id)}>
      <div className={`screen-preview screen-preview-${index % 4}`}>
        <div className="preview-top"><span className={`screen-status ${online ? 'is-online' : ''}`}><i />{online ? 'Online' : screen.auth_user_id ? 'Offline' : 'Not paired'}</span><button disabled={!canControl} className="preview-menu" aria-label={`Pair ${screen.label}`} onClick={onPair}><MoreHorizontal size={17} /></button></div>
        <div className="tv-illustration"><div className="tv-frame"><div className={`tv-content ${hasContent ? 'has-content' : ''}`}>{hasContent ? <><div className="tv-content-icon">{content?.type === 'timer' ? <Clock3 size={21} /> : content?.type === 'announcement' ? <Bell size={20} /> : content?.type === 'video' || content?.type === 'playlist' ? <Play size={20} fill="currentColor" /> : <ImageIcon size={20} />}</div><span>{contentLabel}</span></> : <><div className="tv-welcome-icon"><Tv size={23} /></div><span>Ready for your event</span></>}</div></div><div className="tv-foot" /></div>
        {!online && <div className="preview-fade" />}
      </div>
      <div className="screen-details"><div className="screen-title-row"><div><h3>{screen.label}</h3><span>{hasContent ? contentLabel : 'No content assigned'}</span></div><span className="screen-number">{String(index + 1).padStart(2, '0')}</span></div><div className="screen-card-actions"><button disabled={!canControl} className="button button-primary button-card" onClick={onOpen}><Play size={14} fill="currentColor" /> Change content</button>{canPause && <button disabled={!canControl || busy} className="icon-button card-options" title={paused ? 'Resume playback' : 'Pause playback'} aria-label={paused ? 'Resume playback' : 'Pause playback'} onClick={() => onPause(paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}{hasContent && <button disabled={!canControl || busy} className="icon-button card-options stop-button" title="Stop display" aria-label={`Stop ${screen.label}`} onClick={onStop}><Square size={13} /></button>}<button disabled={!canControl} className="icon-button card-options" aria-label={`Pair ${screen.label}`} onClick={onPair}><MoreHorizontal size={17} /></button></div></div>
    </article>
  )
}

function MediaCard({ asset, selected, client, onSelect, onDragStart }: {
  asset: MediaAsset; selected: boolean; client: SupabaseClient; onSelect: () => void; onDragStart: (event: DragEvent<HTMLElement>) => void
}) {
  const [previewUrl, setPreviewUrl] = useState('')
  const isVideo = asset.mime_type.startsWith('video/')
  useEffect(() => {
    let active = true
    client.storage.from(BUCKET).createSignedUrl(asset.storage_path, 60 * 60).then(({ data, error }) => {
      if (error) console.error(`Could not create preview for ${asset.file_name}:`, error.message)
      if (active && data?.signedUrl) setPreviewUrl(data.signedUrl)
    })
    return () => { active = false }
  }, [asset, client])
  return <article className={`media-card ${selected ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-pressed={selected} draggable onDragStart={onDragStart} onClick={onSelect} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}>
    <div className="media-thumbnail">{previewUrl ? isVideo ? <video src={previewUrl} muted preload="metadata" /> : <img src={previewUrl} alt={asset.file_name} /> : <div className="thumbnail-fallback">{isVideo ? <Video size={25} /> : <ImageIcon size={25} />}</div>}<span className="media-type">{isVideo ? <><Video size={12} /> VIDEO</> : <><ImageIcon size={12} /> IMAGE</>}</span><span className={`media-check ${selected ? 'checked' : ''}`}>{selected && <Check size={13} />}</span></div>
    <div className="media-info"><strong title={asset.file_name}>{asset.file_name}</strong><span>{formatBytes(asset.size_bytes)} <i>·</i> {new Date(asset.created_at).toLocaleDateString()}</span></div>
  </article>
}

function ActivityList({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <div className="empty-activity"><Activity size={19} />No activity yet. Screen changes will appear here.</div>
  return <div className="activity-list">{items.map((item) => <div className="activity-row" key={item.id}><div className="activity-dot"><Activity size={14} /></div><div className="activity-copy"><strong>{activityText(item)}</strong><span>{timeAgo(item.created_at)}</span></div></div>)}</div>
}

function activityText(item: ActivityItem) {
  const action = item.action.replaceAll('_', ' ')
  const screens = item.metadata?.screen_labels
  const count = Array.isArray(screens) ? screens.length : 0
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}${count ? ` · ${count} ${count === 1 ? 'screen' : 'screens'}` : ''}`
}

function ProgrammeList({ items, expanded = false }: { items: ProgrammeItem[]; expanded?: boolean }) {
  return <div className={`programme-list ${expanded ? 'expanded' : ''}`}>{items.map((item, index) => <div className="programme-row" key={item.id}><div className="programme-time"><strong>{new Date(item.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong><span>{new Date(item.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div><div className={`programme-marker ${index === 0 ? 'current' : ''}`}><i /></div><div className="programme-details"><strong>{item.activity}</strong><span>{item.presenter || 'Presenter to be announced'}</span></div><Clock3 className="programme-clock" size={15} /></div>)}</div>
}

function EmptyPanel({ text }: { text: string }) { return <div className="empty-panel"><Monitor size={22} /><span>{text}</span></div> }

function ScreenTargetChooser({ label, screens, selected, onChange }: {
  label: string; screens: Screen[]; selected: string[]; onChange: (screenIds: string[]) => void
}) {
  const allSelected = screens.length > 0 && selected.length === screens.length
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((screenId) => screenId !== id) : [...selected, id])
  return <div className="target-picker"><span>{label}</span><button type="button" className={`target-chip ${allSelected ? 'active' : ''}`} onClick={() => onChange(screens.map((screen) => screen.id))}><Tv size={14} /> All screens</button>{screens.map((screen) => <button type="button" key={screen.id} className={`target-chip ${selected.includes(screen.id) && !allSelected ? 'active' : ''}`} onClick={() => toggle(screen.id)}>{screen.label.replace('SAMSUNG ', '')}</button>)}</div>
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className="modal-card"><DialogHeader className="modal-heading"><div><DialogTitle>{title}</DialogTitle><DialogDescription>{subtitle}</DialogDescription></div><DialogClose className="icon-button" aria-label="Close dialog"><X size={19} /></DialogClose></DialogHeader>{children}</DialogContent></Dialog>
}

function SystemGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="modal-card guide-modal">
        <DialogHeader className="modal-heading">
          <div>
            <DialogTitle>ScreenControl system guide</DialogTitle>
            <DialogDescription>Connect your TVs and manage event content step by step.</DialogDescription>
          </div>
          <DialogClose className="icon-button" aria-label="Close system guide"><X size={19} /></DialogClose>
        </DialogHeader>
        <div className="guide-content">
          <section>
            <h3>Before you begin</h3>
            <p>ScreenControl has an operator dashboard and a separate display page for each TV. The dashboard does not stream content itself: each TV needs internet access and its display page open.</p>
            <div className="guide-callout"><strong>You will need</strong><span>An administrator or operator account, TVs with a browser, and your event media. Supported uploads are JPG, PNG, WebP, or MP4 files up to 100 MB each. If you cannot sign in or the screens are unavailable, ask your system administrator to check the app setup.</span></div>
          </section>

          <section>
            <h3>1. Sign in and understand the dashboard</h3>
            <ul>
              <li><strong>Overview</strong> summarizes screen heartbeats, assignments, media, activity, and upcoming programme entries.</li>
              <li><strong>My screens</strong> is where you pair TVs, check online status, change content, pause/resume, or stop a display.</li>
              <li><strong>Media library</strong> is where operators upload files and choose what to publish.</li>
              <li><strong>Programme</strong> is where operators add event activities and show the schedule on TVs.</li>
            </ul>
            <p>Administrators and operators can control screens. Viewers can monitor but cannot pair TVs, upload media, or publish content. “Online” means the TV has sent a recent heartbeat; it does not confirm that a particular video rendered successfully.</p>
          </section>

          <section>
            <h3>2. Pair a TV</h3>
            <ol>
              <li>On the operator dashboard, open <strong>My screens</strong> and choose the pairing menu on the TV’s card.</li>
              <li>Open the displayed <code>/display/&lt;screen-uuid&gt;</code> address in that TV’s built-in browser.</li>
              <li>Keep the pairing dialog open. Wait for its six-digit code, then enter the code on the TV and select <strong>Connect this TV</strong>.</li>
              <li>Wait for the TV to show Connected and for the dashboard card to report Online. Repeat with a separate URL and code for every TV.</li>
            </ol>
            <div className="guide-callout"><strong>Pairing code reminder</strong><span>Each code works once and expires after 10 minutes. If it expires or is rejected, generate a new one. Leave the TV display page open during the event so it can receive updates and send heartbeats.</span></div>
          </section>

          <section>
            <h3>3. Upload and play media</h3>
            <ol>
              <li>Open <strong>Media library</strong> and choose <strong>Add picture or video</strong>.</li>
              <li>Select JPG, PNG, WebP, or MP4 files up to 100 MB each. Wait for them to appear in the library.</li>
              <li>Click a media card to select it. Under <strong>PLAY ON</strong>, choose <strong>All screens</strong> or select individual TVs.</li>
              <li>For images, set the display duration from 3 to 600 seconds (12 seconds by default). Select multiple items to create a playlist; choose <strong>Repeat playlist</strong> if it should loop.</li>
              <li>Choose <strong>Play on ... screens</strong>. You can also drag a media card directly onto a screen card to send one item to that TV.</li>
            </ol>
            <p>To change an existing display, use <strong>Change content</strong> on its screen card. Use the pause/resume control to pause supported media or countdowns, and <strong>Stop display</strong> to return a TV to standby. Stopping a display does not delete its media.</p>
            <p>Media is kept private and supplied to assigned screens. TV firmware determines which MP4 codecs can play. Muted autoplay is attempted; if blocked, interact with the TV and select <strong>Tap to play video</strong>.</p>
          </section>

          <section>
            <h3>4. Show an announcement or countdown</h3>
            <ul>
              <li><strong>Announcement:</strong> from Overview, select <strong>Show an announcement</strong>, enter a heading and message, choose target screens, then select <strong>Display announcement</strong>. Announcements replace the current assignment on those screens.</li>
              <li><strong>Countdown:</strong> from Overview, select <strong>Start a timer</strong>, enter a title and a duration between 1 minute and 4 hours, choose target screens, and select <strong>Start countdown</strong>. Pause or resume it from the screen card; stop it to return to standby.</li>
            </ul>
            <p>Countdowns use server timestamps to stay synchronized. When one reaches zero, publish the next content yourself; the timer does not automatically advance the event.</p>
          </section>

          <section>
            <h3>5. Build and show the programme</h3>
            <ol>
              <li>Open <strong>Programme</strong> and choose <strong>Add activity</strong>.</li>
              <li>Enter the activity, optional presenter, start time, and end time. The end time must be after the start.</li>
              <li>Select <strong>Add to programme</strong> and repeat for each activity.</li>
              <li>Choose the target TVs under <strong>SHOW ON</strong>, then select <strong>Show programme</strong>.</li>
            </ol>
            <p>The TV programme view shows the activity happening now and upcoming entries. Programme items are shared across the workspace.</p>
          </section>

          <section>
            <h3>6. Check connections and fix common issues</h3>
            <ul>
              <li><strong>No screens listed:</strong> refresh the dashboard. If screens are still missing, ask your administrator to check the app setup.</li>
              <li><strong>TV stays offline:</strong> check internet access, the display URL, and whether the TV page remains open. A paired TV is online only after a recent heartbeat.</li>
              <li><strong>Pairing fails:</strong> generate a fresh code and enter it before the 10-minute expiry.</li>
              <li><strong>Upload fails:</strong> check that the file is a supported type and within the 100 MB limit. If it still fails, ask your administrator to check the media library configuration.</li>
              <li><strong>Video will not start:</strong> test the codec on the target TV and try its on-screen play prompt. MP4 files are not guaranteed to use TV-supported codecs.</li>
              <li><strong>Live updates stop:</strong> check the Live updates indicator and network, then refresh the dashboard or reload the TV page after reconnecting.</li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DisplayApp({ client, screenId }: { client: SupabaseClient; screenId: string }) {
  const [initialCache] = useState(() => readDisplayCache(screenId))
  const [authReady, setAuthReady] = useState(false)
  const [paired, setPaired] = useState<boolean | null>(initialCache ? true : null)
  const [pairCode, setPairCode] = useState('')
  const [pairError, setPairError] = useState('')
  const [screenLabel, setScreenLabel] = useState(initialCache?.screenLabel ?? 'Event screen')
  const [assignment, setAssignment] = useState<Assignment | null>(initialCache?.assignment ?? null)
  const [media, setMedia] = useState<Array<MediaAsset & { url: string }>>(initialCache?.media ?? [])
  const [displayProgramme, setDisplayProgramme] = useState<ProgrammeItem[]>(initialCache?.programme ?? [])
  const [serverOffset, setServerOffset] = useState(0)
  const [clock, setClock] = useState(0)
  const [currentMedia, setCurrentMedia] = useState(0)
  const [videoNeedsTap, setVideoNeedsTap] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [requestBusy, setRequestBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let active = true
    async function start() {
      const { data: sessionData } = await client.auth.getSession()
      if (sessionData.session && !sessionData.session.user.is_anonymous) {
        const { error } = await client.auth.signOut()
        if (error && active) setPairError(`Couldn't prepare a private screen session: ${error.message}`)
      }
      const { data: currentSession } = await client.auth.getSession()
      if (!currentSession.session) {
        const { error } = await client.auth.signInAnonymously()
        if (error && active) setPairError(`Couldn't start screen setup: ${error.message}`)
      }
      if (active) setAuthReady(true)
    }
    void start()
    return () => { active = false }
  }, [client])

  const loadScreen = useCallback(async () => {
    const [{ data: screen, error: screenError }, { data: timestamp }] = await Promise.all([
      client.from('screens').select('id,label,auth_user_id,last_seen_at').eq('id', screenId).maybeSingle(),
      client.rpc('screen_server_time'),
    ])
    if (timestamp) setServerOffset(new Date(timestamp as string).getTime() - Date.now())
    if (screenError) {
      if (initialCache) {
        setOnline(false)
        setPaired(true)
        return
      }
      setPairError(screenError.message)
      setPaired(false)
      return
    }
    if (!screen?.auth_user_id) {
      setPaired(false)
      return
    }
    setScreenLabel(screen.label)
    setPaired(true)
    const { data: current, error } = await client.from('screen_assignments').select('screen_id,content,updated_at').eq('screen_id', screenId).maybeSingle()
    if (error) {
      setPairError(error.message)
      return
    }
    setAssignment(current as Assignment | null)
  }, [client, initialCache, screenId])

  useEffect(() => {
    if (!authReady) return
    const timer = window.setTimeout(() => { void loadScreen() }, 0)
    return () => window.clearTimeout(timer)
  }, [authReady, loadScreen])

  useEffect(() => {
    if (!paired) return
    const channel = client.channel(`display-${screenId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screen_assignments', filter: `screen_id=eq.${screenId}` }, (payload) => {
        if (payload.eventType === 'DELETE') setAssignment(null)
        else setAssignment(payload.new as Assignment)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setOnline(true)
          void loadScreen()
        } else if (status === 'CHANNEL_ERROR') setOnline(false)
      })
    const pulse = window.setInterval(async () => {
      const [{ error }, { data: timestamp }] = await Promise.all([client.rpc('screen_heartbeat', { p_screen_id: screenId }), client.rpc('screen_server_time')])
      setOnline(!error)
      if (!error && timestamp) setServerOffset(new Date(timestamp as string).getTime() - Date.now())
    }, 20_000)
    return () => { window.clearInterval(pulse); void client.removeChannel(channel) }
  }, [client, loadScreen, paired, screenId])

  useEffect(() => {
    if (!paired || assignment?.content.type !== 'programme') return
    let active = true
    const loadProgramme = async () => {
      const { data, error } = await client.from('programme_items').select('id,activity,presenter,starts_at,ends_at').order('starts_at')
      if (error) {
        console.error('Unable to load event programme:', error.message)
        return
      }
      if (active && data) setDisplayProgramme(data as ProgrammeItem[])
    }
    void loadProgramme()
    const channel = client.channel(`programme-${screenId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'programme_items' }, () => { void loadProgramme() })
      .subscribe()
    return () => { active = false; void client.removeChannel(channel) }
  }, [assignment?.content.type, client, paired, screenId])

  useEffect(() => {
    const handleOnline = () => { setOnline(true); void loadScreen() }
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline) }
  }, [loadScreen])

  useEffect(() => {
    if (paired !== true) return
    try {
      localStorage.setItem(`screencontrol-display:${screenId}`, JSON.stringify({ screenLabel, assignment, media, programme: displayProgramme }))
    } catch (error) {
      console.error('Unable to save display content for recovery:', error)
    }
  }, [assignment, displayProgramme, media, paired, screenId, screenLabel])

  const mediaIds = useMemo(() => {
    const ids = assignment?.content.media_ids
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  }, [assignment])

  useEffect(() => {
    let active = true
    async function loadAssignedMedia() {
      if (!mediaIds.length) { setMedia([]); setCurrentMedia(0); return }
      const { data: items, error } = await client.from('media_assets').select('id,file_name,storage_path,mime_type,size_bytes,created_at').in('id', mediaIds)
      if (error) {
        console.error('Unable to load assigned media:', error.message)
        return
      }
      const ordered = mediaIds.map((id) => items?.find((item) => item.id === id)).filter((item): item is MediaAsset => Boolean(item))
      const signed = await Promise.all(ordered.map(async (asset) => {
        const { data, error: urlError } = await client.storage.from(BUCKET).createSignedUrl(asset.storage_path, 7 * 24 * 60 * 60)
        if (urlError) {
          console.error(`Unable to open ${asset.file_name}:`, urlError.message)
          return null
        }
        return { ...asset, url: data.signedUrl }
      }))
      if (active) { setMedia(signed.filter((item): item is MediaAsset & { url: string } => Boolean(item))); setCurrentMedia(0) }
    }
    void loadAssignedMedia()
    return () => { active = false }
  }, [client, mediaIds])

  useEffect(() => {
    if (!media.length) return
    let active = true
    const refreshUrls = async () => {
      const refreshed = await Promise.all(media.map(async (asset) => {
        const { data, error } = await client.storage.from(BUCKET).createSignedUrl(asset.storage_path, 7 * 24 * 60 * 60)
        if (error) {
          console.error(`Unable to refresh ${asset.file_name}:`, error.message)
          return asset
        }
        return { ...asset, url: data.signedUrl }
      }))
      if (active) setMedia(refreshed)
    }
    const refreshInterval = window.setInterval(() => { void refreshUrls() }, 6 * 24 * 60 * 60 * 1000)
    window.addEventListener('online', refreshUrls)
    return () => {
      active = false
      window.clearInterval(refreshInterval)
      window.removeEventListener('online', refreshUrls)
    }
  }, [client, media])

  useEffect(() => {
    const beat = window.setInterval(() => setClock(Date.now()), 250)
    return () => window.clearInterval(beat)
  }, [])

  useEffect(() => {
    const content = assignment?.content
    const duration = Number(content?.image_duration_seconds || 12)
    const repeat = content?.repeat === true
    if (content?.type !== 'playlist' || content.paused_at || media.length < 2) return
    const current = media[currentMedia]
    if (current?.mime_type.startsWith('video/')) return
    const timeout = window.setTimeout(() => {
      if (currentMedia < media.length - 1) setCurrentMedia((index) => index + 1)
      else if (repeat) setCurrentMedia(0)
    }, Math.max(3, duration) * 1000)
    return () => window.clearTimeout(timeout)
  }, [assignment, currentMedia, media])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    if (assignment?.content.paused_at) {
      element.pause()
      return
    }
    element.play().then(() => setVideoNeedsTap(false)).catch(() => setVideoNeedsTap(true))
  }, [assignment, currentMedia, media])

  async function pairScreen(event: FormEvent) {
    event.preventDefault()
    setRequestBusy(true)
    setPairError('')
    const { data, error } = await client.rpc('pair_screen', { p_screen_id: screenId, p_pairing_code: pairCode.trim() })
    setRequestBusy(false)
    if (error) return setPairError(error.message)
    if (!data) return setPairError('That code is incorrect or has expired. Ask your organiser for a new one.')
    setPairCode('')
    setPaired(true)
    await loadScreen()
  }

  async function playVideo() {
    const element = videoRef.current
    if (!element) return
    try { await element.play(); setVideoNeedsTap(false) }
    catch { setVideoNeedsTap(true) }
  }

  async function enterFullscreen() {
    try { await document.documentElement.requestFullscreen() }
    catch { /* Full-screen can require a user gesture or may not be supported by this browser. */ }
  }

  if (!authReady) return <div className="display-standby"><div className="spinner" /><span>Preparing this screen…</span></div>
  if (paired !== true) return <main className="pair-shell"><div className="pair-brand"><div className="brand-mark"><Tv size={20} /></div><span>SCREEN<strong>CONTROL</strong></span></div><section className="pair-card"><div className="pair-tv-icon"><Monitor size={25} /></div><span className="eyebrow">SCREEN PAIRING</span><h1>Connect this TV.</h1><p>Enter the one-time code from your screen manager to connect this display.</p><form className="form-stack" onSubmit={(event) => void pairScreen(event)}><label>6-digit pairing code<input className="pair-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={pairCode} onChange={(event) => setPairCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></label>{pairError && <div className="inline-error"><AlertCircle size={16} />{pairError}</div>}<button className="button button-primary button-wide" disabled={requestBusy || pairCode.length !== 6}>{requestBusy ? <span className="spinner small" /> : null}{requestBusy ? 'Connecting…' : 'Connect this TV'}<ArrowRight size={16} /></button></form><small>Ask your event organiser for a fresh pairing code if yours has expired.</small></section></main>

  const content = assignment?.content
  const type = content?.type
  const duration = Number(content?.duration_seconds || 0)
  const timerStartedAt = content?.started_at || assignment?.updated_at
  const elapsed = timerStartedAt ? Math.max(0, Math.floor((clock + serverOffset - new Date(String(timerStartedAt)).getTime()) / 1000)) : 0
  const remaining = content?.paused_at ? duration : Math.max(0, duration - elapsed)
  const video = media[currentMedia]?.mime_type.startsWith('video/')
  const currentProgrammeTime = clock + serverOffset
  return <main className="display-shell">
    <div className="display-top"><div className="display-brand"><div className="brand-mark"><Tv size={18} /></div><span>SCREEN<strong>CONTROL</strong></span><span className="display-screen-name">{screenLabel}</span></div><div className="display-actions"><span className={`display-connection ${online ? 'online' : ''}`}><i />{online ? 'Connected' : 'Reconnecting…'}</span><button onClick={() => void enterFullscreen()} aria-label="Enter full screen"><ArrowDownToLine size={17} /></button></div></div>
    {!online && <div className="offline-banner"><AlertCircle size={16} />Connection interrupted. This screen will reconnect automatically.</div>}
    <section className={`display-content ${type === 'image' || type === 'video' || type === 'playlist' ? 'display-media-content' : ''}`}>
      {type === 'timer' ? (
        <div className="display-timer"><span className="eyebrow">UP NEXT</span><h1>{String(content?.title || 'Starting soon')}</h1><div className="timer-digits"><span>{String(Math.floor(remaining / 60)).padStart(2, '0')}</span><i>:</i><span>{String(remaining % 60).padStart(2, '0')}</span></div><p>We’ll begin in just a moment.</p></div>
      ) : type === 'announcement' ? (
        <div className="display-announcement"><div className="announcement-symbol"><Bell size={27} /></div><span className="eyebrow">A MESSAGE FOR YOU</span><h1>{String(content?.title || '')}</h1><p>{String(content?.message || '')}</p></div>
      ) : type === 'image' || type === 'video' || type === 'playlist' ? (
        media.length ? (
          <div className="display-media">
            {video ? <>
              <video ref={videoRef} key={media[currentMedia].id} className="display-video" src={media[currentMedia].url} autoPlay={!content?.paused_at} muted playsInline onEnded={() => { if (type === 'playlist' && currentMedia < media.length - 1) setCurrentMedia((index) => index + 1); else if (content?.repeat === true) setCurrentMedia(0) }} onCanPlay={() => setVideoNeedsTap(false)} onError={() => setVideoNeedsTap(true)} />
              {content?.paused_at ? <div className="video-paused"><Pause size={17} /> Playback paused</div> : <button className={`video-play-hint ${videoNeedsTap ? 'visible' : ''}`} onClick={() => void playVideo()}><Play size={20} fill="currentColor" /> Tap to play video</button>}
            </> : <img src={media[currentMedia].url} alt={media[currentMedia].file_name} />}
          </div>
        ) : <div className="display-loading"><span className="spinner" /><p>Getting your content ready…</p></div>
      ) : type === 'programme' ? (
        <DisplayProgramme items={displayProgramme} now={currentProgrammeTime} />
      ) : (
        <div className="display-welcome"><div className="welcome-mark"><Tv size={33} /></div><span className="eyebrow">WELCOME</span><h1>Your event begins here.</h1><p>When your organiser shares something, it will appear on this screen.</p></div>
      )}
    </section>
    {type === 'playlist' && media.length > 0 && <div className="playlist-indicator">{currentMedia + 1} <span>/</span> {media.length} <i /> {media[currentMedia]?.file_name}</div>}
    <footer className="display-footer"><span>SCREENCONTROL</span><span>{online ? 'Ready for your event' : 'Trying to reconnect'}</span></footer>
  </main>
}

function DisplayProgramme({ items, now }: { items: ProgrammeItem[]; now: number }) {
  const remaining = items.filter((item) => new Date(item.ends_at).getTime() > now)
  const current = remaining.find((item) => new Date(item.starts_at).getTime() <= now)
  const next = remaining.filter((item) => item !== current).slice(0, 4)
  return <div className="display-programme">
    <span className="eyebrow">TODAY’S PROGRAMME</span>
    <h1>{current ? 'Happening now' : 'Coming up'}</h1>
    {current && <section className="programme-current"><span className="current-label"><i /> HAPPENING NOW</span><h2>{current.activity}</h2><p>{current.presenter || 'On stage now'} <span>·</span> Until {new Date(current.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p></section>}
    <div className="display-programme-list">{next.map((item) => <div className="display-programme-item" key={item.id}><time>{new Date(item.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><div><strong>{item.activity}</strong><span>{item.presenter || 'Presenter to be announced'}</span></div></div>)}
      {!current && !next.length && <p className="programme-finished">The programme will appear here when activities are added.</p>}
    </div>
  </div>
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} hr ago` : new Date(value).toLocaleDateString()
}

export default App
