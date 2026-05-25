import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiUser, FiMail, FiLock, FiShield, FiMonitor,
  FiBell, FiClock, FiTrash2, FiUpload, FiDownload,
  FiCheck, FiAlertTriangle, FiEye, FiEyeOff, FiInfo, FiLogOut, FiRefreshCw
} from 'react-icons/fi';
import './UserConfig.css';

// ── Helpers ──────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Types ─────────────────────────────────────────────────────────────

interface UserData {
  id?: string | number;
  name?: string;
  nombre?: string;
  email?: string;
  correo?: string;
  role?: { name: string };
  rol?: { nombre: string };
}

interface UserConfigProps {
  user: UserData;
}

type TabId =
  | 'personal-info' | 'email'
  | 'password' | '2fa' | 'sessions'
  | 'notifications' | 'alerts'
  | 'privacy' | 'history' | 'delete-account';

// ── Root Component ────────────────────────────────────────────────────

export const UserConfig: React.FC<UserConfigProps> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<TabId>('personal-info');
  const contentRef = useRef<HTMLElement>(null);

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  const userName  = user.name  || user.nombre  || '';
  const userEmail = user.email || user.correo  || '';

  const navItems: { id: TabId; label: string; icon: JSX.Element; group?: string; danger?: boolean }[] = [
    { id: 'personal-info', label: 'Información personal',         icon: <FiUser /> },
    { id: 'email',         label: 'Correo electrónico',           icon: <FiMail /> },
    { id: 'password',      label: 'Cambiar contraseña',           icon: <FiLock />,    group: 'SEGURIDAD' },
    { id: '2fa',           label: 'Autenticación en dos pasos',   icon: <FiShield /> },
    { id: 'sessions',      label: 'Sesiones activas',             icon: <FiMonitor /> },
    { id: 'notifications', label: 'Preferencias de notificaciones', icon: <FiBell />,  group: 'NOTIFICACIONES' },
    { id: 'alerts',        label: 'Alertas y recordatorios',      icon: <FiClock /> },
    { id: 'privacy',       label: 'Privacidad y datos',           icon: <FiShield />,  group: 'PRIVACIDAD' },
    { id: 'history',       label: 'Historial de accesos',         icon: <FiClock />,   group: 'ACTIVIDAD' },
    { id: 'delete-account',label: 'Eliminar cuenta',              icon: <FiTrash2 />,  group: 'AVANZADO', danger: true },
  ];

  const handleTabClick = (tabId: TabId) => {
    setActiveTab(tabId);
    setTimeout(() => {
      contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  return (
    <div className="user-config-container">
      <aside className="config-sidebar">
        <nav className="config-nav">
          {navItems.map((item) => (
            <React.Fragment key={item.id}>
              {item.group && <div className="config-nav-group">{item.group}</div>}
              <button
                className={`config-nav-item ${activeTab === item.id ? 'active' : ''} ${item.danger ? 'danger' : ''}`}
                onClick={() => handleTabClick(item.id)}
              >
                <span className={`config-icon-wrap ${item.group ? `icon-group-${item.group.toLowerCase()}` : ''}`}>
                  <span className="config-icon">{item.icon}</span>
                </span>
                <span className="config-nav-label">{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
      </aside>

      <main className="config-main-content" ref={contentRef}>
        {activeTab === 'personal-info'  && <PersonalInfoPanel initialUserName={userName} getInitials={getInitials} />}
        {activeTab === 'email'          && <EmailPanel currentEmail={userEmail} />}
        {activeTab === 'password'       && <PasswordPanel />}
        {activeTab === '2fa'            && <TwoFAPanel />}
        {activeTab === 'sessions'       && <SessionsPanel />}
        {activeTab === 'notifications'  && <NotificationsPanel />}
        {activeTab === 'alerts'         && <AlertsPanel />}
        {activeTab === 'privacy'        && <PrivacyPanel />}
        {activeTab === 'history'        && <HistoryPanel />}
        {activeTab === 'delete-account' && <DeleteAccountPanel userName={userName} />}
      </main>
    </div>
  );
};

// ── Toast simple ───────────────────────────────────────────────────────

function useToast() {
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const show = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3500);
  };
  const Toast = msg ? (
    <div className={`toast-inline ${msg.type === 'err' ? 'toast-error' : 'toast-success'}`}>
      {msg.type === 'ok' ? <FiCheck /> : <FiAlertTriangle />} {msg.text}
    </div>
  ) : null;
  return { show, Toast };
}

/* ═══════════════════════════════  PANELES  ══════════════════════════════ */

// ── Información personal ───────────────────────────────────────────────

const PersonalInfoPanel: React.FC<{ initialUserName: string; getInitials: (n: string) => string }> = ({
  initialUserName, getInitials
}) => {
  const { show, Toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: initialUserName,
    phone: '',
    document_type: 'CC',
    formation_ficha: '',
    id: '',
    biography: '',
  });

  useEffect(() => {
    apiFetch('/users_mgmt/me').then(({ ok, data }) => {
      if (ok) {
        setForm({
          name:             data.name            || initialUserName,
          phone:            data.phone           || '',
          document_type:    data.document_type   || 'CC',
          formation_ficha:  data.formation_ficha || '',
          id:               data.id              || '',
          biography:        data.biography       || '',
        });
      }
      setLoading(false);
    });
  }, [initialUserName]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const save = async () => {
    setSaving(true);
    const { ok, data } = await apiFetch('/users_mgmt/me', {
      method: 'PATCH',
      body: JSON.stringify({
        name:            form.name,
        phone:           form.phone,
        document_type:   form.document_type,
        formation_ficha: form.formation_ficha,
        biography:       form.biography,
      }),
    });
    setSaving(false);
    show(ok ? 'Perfil actualizado correctamente.' : (data.error || 'Error al guardar.'), ok ? 'ok' : 'err');
  };

  if (loading) return <div className="config-section"><p className="card-hint">Cargando...</p></div>;

  return (
    <div className="config-section fade-in">
      {Toast}
      <div className="config-card">
        <h3>Datos personales</h3>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Nombre completo</label>
            <input type="text" name="name" value={form.name} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Tipo de documento</label>
            <select name="document_type" value={form.document_type} onChange={handleChange}>
              <option value="CC">Cédula de ciudadanía</option>
              <option value="TI">Tarjeta de identidad</option>
              <option value="PA">Pasaporte</option>
              <option value="CE">Cédula extranjería</option>
            </select>
          </div>
          <div className="form-group">
            <label>Número de documento</label>
            <input type="text" value={form.id} disabled />
          </div>
          <div className="form-group">
            <label>Teléfono</label>
            <input type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="+57 300 123 4567" />
          </div>
          <div className="form-group">
            <label>Ficha de formación</label>
            <input type="text" name="formation_ficha" value={form.formation_ficha} onChange={handleChange} placeholder="Ej: 2672153" />
          </div>
          <div className="form-group full-width">
            <label>Biografía</label>
            <textarea
              name="biography"
              value={form.biography}
              onChange={handleChange}
              placeholder="Cuéntanos un poco sobre ti..."
              rows={4}
              maxLength={500}
            />
            <span className="card-hint">Máx. 500 caracteres.</span>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-save" onClick={save} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Correo electrónico ─────────────────────────────────────────────────

const EmailPanel: React.FC<{ currentEmail: string }> = ({ currentEmail }) => {
  const { show, Toast } = useToast();
  const [newEmail, setNewEmail]   = useState('');
  const [password, setPassword]   = useState('');
  const [code, setCode]           = useState('');
  const [step, setStep]           = useState<'form' | 'verify'>('form');
  const [busy, setBusy]           = useState(false);

  const sendCode = async () => {
    if (!newEmail || !password) return;
    setBusy(true);
    const { ok, data } = await apiFetch('/auth/change-email', {
      method: 'POST',
      body: JSON.stringify({ new_email: newEmail, password }),
    });
    setBusy(false);
    if (ok) { setStep('verify'); show(data.message || 'Código enviado.'); }
    else      show(data.error || 'Error al enviar código.', 'err');
  };

  const verifyCode = async () => {
    if (!code) return;
    setBusy(true);
    const { ok, data } = await apiFetch('/auth/verify-email-change', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (ok) {
      show('Correo actualizado. Recarga la página para ver el cambio.');
      setStep('form'); setNewEmail(''); setPassword(''); setCode('');
    } else {
      show(data.error || 'Código incorrecto.', 'err');
    }
  };

  return (
    <div className="config-section fade-in">
      {Toast}
      <div className="config-card">
        <h3>Correo actual</h3>
        <div className="info-row">
          <FiMail className="info-icon" />
          <span className="info-value">{currentEmail || 'No registrado'}</span>
          <span className="badge badge-verified"><FiCheck /> Verificado</span>
        </div>
      </div>

      {step === 'form' ? (
        <div className="config-card">
          <h3>Cambiar correo</h3>
          <p className="card-hint">Recibirás un código de 6 dígitos en el nuevo correo.</p>
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Nuevo correo electrónico</label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="nuevo@correo.com" />
            </div>
            <div className="form-group full-width">
              <label>Contraseña actual (para confirmar)</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-save" disabled={!newEmail || !password || busy} onClick={sendCode}>
              {busy ? 'Enviando...' : 'Enviar código'}
            </button>
          </div>
        </div>
      ) : (
        <div className="config-card">
          <h3>Ingresa el código</h3>
          <p className="card-hint">Código de 6 dígitos enviado a <strong>{newEmail}</strong>.</p>
          <div className="form-group">
            <label>Código de verificación</label>
            <input type="text" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value)} placeholder="••••••" />
          </div>
          <div className="form-actions">
            <button className="btn-save" disabled={code.length !== 6 || busy} onClick={verifyCode}>
              {busy ? 'Verificando...' : 'Confirmar cambio'}
            </button>
            <button className="btn-secondary" onClick={() => setStep('form')}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Contraseña (flujo en 2 pasos con código por email) ────────────────

const PasswordPanel: React.FC = () => {
  const { show, Toast } = useToast();
  const [step, setStep]   = useState<'form' | 'verify'>('form');
  const [oldP, setOldP]   = useState('');
  const [newP, setNewP]   = useState('');
  const [confP, setConfP] = useState('');
  const [code, setCode]   = useState('');
  const [emailMasked, setEmailMasked] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy]   = useState(false);

  const strength = (() => {
    let s = 0;
    if (newP.length >= 8)            s++;
    if (/[A-Z]/.test(newP))          s++;
    if (/[0-9]/.test(newP))          s++;
    if (/[^A-Za-z0-9]/.test(newP))  s++;
    return s;
  })();
  const strengthLabel = ['Muy débil', 'Débil', 'Regular', 'Buena', 'Fuerte'][strength];

  const requestChange = async () => {
    if (newP !== confP)  { show('Las contraseñas no coinciden.', 'err'); return; }
    if (strength < 3)    { show('La contraseña debe ser al menos "Buena".', 'err'); return; }
    setBusy(true);
    const { ok, data } = await apiFetch('/auth/request-password-change', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldP, new_password: newP }),
    });
    setBusy(false);
    if (ok) {
      setEmailMasked(data.email_masked || '');
      setStep('verify');
      show(data.message || 'Código enviado a tu correo.');
    } else {
      show(data.error || 'No se pudo iniciar el cambio.', 'err');
    }
  };

  const confirmChange = async () => {
    if (code.length !== 6) { show('El código debe tener 6 dígitos.', 'err'); return; }
    setBusy(true);
    const { ok, data } = await apiFetch('/auth/confirm-password-change', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (ok) {
      show('Contraseña actualizada correctamente.');
      setStep('form');
      setOldP(''); setNewP(''); setConfP(''); setCode('');
    } else {
      show(data.error || 'Código incorrecto.', 'err');
    }
  };

  if (step === 'verify') {
    return (
      <div className="config-section fade-in">
        {Toast}
        <div className="config-card">
          <h3>Confirma el cambio</h3>
          <p className="card-hint">
            Te enviamos un código de 6 dígitos a <strong>{emailMasked || 'tu correo'}</strong>.
            Ingresalo aquí para aplicar el cambio. El código expira en 10 minutos.
          </p>
          <div className="form-group">
            <label>Código de verificación</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              style={{ letterSpacing: '0.5em', textAlign: 'center', fontSize: '1.2em' }}
            />
          </div>
          <div className="form-actions">
            <button className="btn-save" disabled={code.length !== 6 || busy} onClick={confirmChange}>
              {busy ? 'Confirmando...' : 'Confirmar cambio'}
            </button>
            <button className="btn-secondary" onClick={() => { setStep('form'); setCode(''); }}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="config-section fade-in">
      {Toast}
      <div className="config-card info-card">
        <FiInfo />
        <p>Por seguridad, cuando cambies tu contraseña te enviaremos un código de 6 dígitos a tu correo para confirmar el cambio.</p>
      </div>
      <div className="config-card">
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Contraseña actual</label>
            <div className="password-input">
              <input type={showOld ? 'text' : 'password'} value={oldP} onChange={e => setOldP(e.target.value)} />
              <button type="button" onClick={() => setShowOld(!showOld)}>{showOld ? <FiEyeOff /> : <FiEye />}</button>
            </div>
          </div>
          <div className="form-group full-width">
            <label>Nueva contraseña</label>
            <div className="password-input">
              <input type={showNew ? 'text' : 'password'} value={newP} onChange={e => setNewP(e.target.value)} />
              <button type="button" onClick={() => setShowNew(!showNew)}>{showNew ? <FiEyeOff /> : <FiEye />}</button>
            </div>
            {newP && (
              <div className="strength-meter">
                <div className={`strength-bar lvl-${strength}`} />
                <span className="strength-label">{strengthLabel}</span>
              </div>
            )}
            <ul className="password-rules">
              <li className={newP.length >= 8 ? 'ok' : ''}><FiCheck /> Mínimo 8 caracteres</li>
              <li className={/[A-Z]/.test(newP) ? 'ok' : ''}><FiCheck /> Al menos una mayúscula</li>
              <li className={/[0-9]/.test(newP) ? 'ok' : ''}><FiCheck /> Al menos un número</li>
              <li className={/[^A-Za-z0-9]/.test(newP) ? 'ok' : ''}><FiCheck /> Un carácter especial</li>
            </ul>
          </div>
          <div className="form-group full-width">
            <label>Confirmar nueva contraseña</label>
            <input type="password" value={confP} onChange={e => setConfP(e.target.value)} />
            {confP && confP !== newP && <span className="field-error">Las contraseñas no coinciden.</span>}
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-save" disabled={!oldP || !newP || !confP || busy} onClick={requestChange}>
            {busy ? 'Enviando código...' : 'Enviar código y continuar'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── 2FA ────────────────────────────────────────────────────────────────

const TwoFAPanel: React.FC = () => {
  return (
    <div className="config-section fade-in">
      <div className="config-card info-card">
        <FiShield size={28} style={{ flexShrink: 0 }} />
        <div>
          <strong>Autenticación en dos pasos</strong>
          <p className="card-hint" style={{ marginTop: 4 }}>
            Esta función estará disponible próximamente. Podrás usar Google Authenticator,
            Authy u otras apps compatibles con TOTP para proteger tu cuenta.
          </p>
        </div>
      </div>
    </div>
  );
};

// ── Sesiones activas ───────────────────────────────────────────────────

interface Session {
  id: number;
  created_at: string;
  expires_at: string;
}

const SessionsPanel: React.FC = () => {
  const { show, Toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { ok, data } = await apiFetch('/auth/sessions');
    if (ok) setSessions(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const revoke = async (id: number) => {
    setBusy(id);
    const { ok, data } = await apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' });
    setBusy(null);
    show(ok ? 'Sesión cerrada.' : (data.error || 'Error.'), ok ? 'ok' : 'err');
    if (ok) load();
  };

  const revokeAll = async () => {
    if (!confirm('¿Cerrar todas las sesiones?')) return;
    const { ok, data } = await apiFetch('/auth/sessions/all', { method: 'DELETE' });
    show(ok ? 'Todas las sesiones han sido cerradas.' : (data.error || 'Error.'), ok ? 'ok' : 'err');
    if (ok) load();
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium', timeStyle: 'short'
  });

  return (
    <div className="config-section fade-in">
      {Toast}
      <div className="config-card">
        <div className="toggle-row" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Sesiones abiertas</h3>
          <button className="btn-secondary" onClick={load} title="Actualizar"><FiRefreshCw /></button>
        </div>
        {loading ? (
          <p className="card-hint">Cargando sesiones...</p>
        ) : sessions.length === 0 ? (
          <p className="card-hint">No hay sesiones activas registradas.</p>
        ) : (
          sessions.map((s, idx) => (
            <div key={s.id} className="session-row">
              <div className="session-info">
                <span className="session-icon"><FiMonitor /></span>
                <div>
                  <strong>Sesión #{idx + 1} {idx === 0 ? <span className="badge badge-current">Más reciente</span> : ''}</strong>
                  <span className="card-hint">
                    <FiClock /> Iniciada: {fmt(s.created_at)} &nbsp;·&nbsp; Expira: {fmt(s.expires_at)}
                  </span>
                </div>
              </div>
              <button
                className="btn-danger-outline"
                onClick={() => revoke(s.id)}
                disabled={busy === s.id}
              >
                <FiLogOut /> {busy === s.id ? '...' : 'Cerrar'}
              </button>
            </div>
          ))
        )}
      </div>

      <div className="config-card">
        <div className="toggle-row">
          <div>
            <h3 style={{ marginBottom: 4 }}>Cerrar todas las sesiones</h3>
            <p className="card-hint">Invalida todos los tokens de refresco activos.</p>
          </div>
          <button className="btn-danger" onClick={revokeAll}>Cerrar todo</button>
        </div>
      </div>
    </div>
  );
};

// ── Notificaciones ─────────────────────────────────────────────────────

interface NotifPrefs {
  loanReminder: boolean; loanOverdue: boolean; reservationReady: boolean;
  newCatalogItems: boolean; weeklySummary: boolean; promotions: boolean;
}
interface ChannelPrefs { email: boolean; inapp: boolean; sms: boolean; }

const NotificationsPanel: React.FC = () => {
  const { show, Toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [prefs, setPrefs]     = useState<NotifPrefs>({
    loanReminder: true, loanOverdue: true, reservationReady: true,
    newCatalogItems: false, weeklySummary: true, promotions: false,
  });
  const [channels, setChannels] = useState<ChannelPrefs>({ email: true, inapp: true, sms: false });

  useEffect(() => {
    apiFetch('/users_mgmt/me/preferences').then(({ ok, data }) => {
      if (ok) {
        if (data.notifications) setPrefs(data.notifications);
        if (data.channels)      setChannels(data.channels);
      }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const { ok, data } = await apiFetch('/users_mgmt/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ notifications: prefs, channels }),
    });
    setSaving(false);
    show(ok ? 'Preferencias guardadas.' : (data.error || 'Error al guardar.'), ok ? 'ok' : 'err');
  };

  const toggleP = (k: keyof NotifPrefs)  => setPrefs(p   => ({ ...p,    [k]: !p[k] }));
  const toggleC = (k: keyof ChannelPrefs) => setChannels(c => ({ ...c, [k]: !c[k] }));

  const items: { k: keyof NotifPrefs; title: string; desc: string }[] = [
    { k: 'loanReminder',     title: 'Recordatorios de préstamos',  desc: 'Avísame antes de la fecha de devolución.' },
    { k: 'loanOverdue',      title: 'Préstamos vencidos',           desc: 'Notifícame si tengo elementos atrasados.' },
    { k: 'reservationReady', title: 'Reserva lista',                desc: 'Cuando un elemento reservado esté disponible.' },
    { k: 'newCatalogItems',  title: 'Nuevos elementos',             desc: 'Cuando se añadan recursos al catálogo.' },
    { k: 'weeklySummary',    title: 'Resumen semanal',              desc: 'Un correo con tu actividad cada semana.' },
    { k: 'promotions',       title: 'Promociones SENA',             desc: 'Eventos, talleres y novedades institucionales.' },
  ];

  if (loading) return <div className="config-section"><p className="card-hint">Cargando...</p></div>;

  return (
    <div className="config-section fade-in">
      {Toast}
      <div className="config-card">
        <h3>Tipos de notificación</h3>
        {items.map(it => (
          <div key={it.k} className="toggle-row">
            <div>
              <strong>{it.title}</strong>
              <span className="card-hint">{it.desc}</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={prefs[it.k]} onChange={() => toggleP(it.k)} />
              <span className="slider" />
            </label>
          </div>
        ))}
      </div>

      <div className="config-card">
        <h3>Canal de envío</h3>
        <div className="channel-grid">
          <label className="channel-option">
            <input type="checkbox" checked={channels.email} onChange={() => toggleC('email')} />
            <span>Correo electrónico</span>
          </label>
          <label className="channel-option">
            <input type="checkbox" checked={channels.inapp} onChange={() => toggleC('inapp')} />
            <span>Notificación en la app</span>
          </label>
          <label className="channel-option">
            <input type="checkbox" checked={channels.sms} onChange={() => toggleC('sms')} />
            <span>SMS</span>
          </label>
        </div>
        <div className="form-actions">
          <button className="btn-save" onClick={save} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar preferencias'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Alertas ────────────────────────────────────────────────────────────

const AlertsPanel: React.FC = () => {
  const { show, Toast } = useToast();
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [reminderDays, setReminderDays] = useState(2);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd]     = useState('07:00');

  useEffect(() => {
    apiFetch('/users_mgmt/me/preferences').then(({ ok, data }) => {
      if (ok && data.alerts) {
        setReminderDays(data.alerts.reminderDays ?? 2);
        setQuietStart(data.alerts.quietStart  ?? '22:00');
        setQuietEnd(data.alerts.quietEnd    ?? '07:00');
      }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const { ok, data } = await apiFetch('/users_mgmt/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ alerts: { reminderDays, quietStart, quietEnd } }),
    });
    setSaving(false);
    show(ok ? 'Alertas guardadas.' : (data.error || 'Error.'), ok ? 'ok' : 'err');
  };

  if (loading) return <div className="config-section"><p className="card-hint">Cargando...</p></div>;

  return (
    <div className="config-section fade-in">
      {Toast}
      <div className="config-card">
        <h3>Recordatorios de devolución</h3>
        <p className="card-hint">Te avisaremos antes del vencimiento de tus préstamos.</p>
        <div className="form-group">
          <label>Anticipación (días)</label>
          <input type="number" min={1} max={7} value={reminderDays} onChange={e => setReminderDays(Number(e.target.value))} />
        </div>
      </div>

      <div className="config-card">
        <h3>Modo silencio</h3>
        <p className="card-hint">No te molestaremos durante este horario.</p>
        <div className="form-grid">
          <div className="form-group">
            <label>Desde</label>
            <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Hasta</label>
            <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-save" onClick={save} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Privacidad ─────────────────────────────────────────────────────────

const PrivacyPanel: React.FC = () => {
  const { show, Toast }       = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const [profileVisible, setProfileVisible] = useState(true);
  const [showActivity, setShowActivity]     = useState(false);
  const [analytics, setAnalytics]           = useState(true);

  useEffect(() => {
    apiFetch('/users_mgmt/me/preferences').then(({ ok, data }) => {
      if (ok && data.privacy) {
        setProfileVisible(data.privacy.profileVisible ?? true);
        setShowActivity(data.privacy.showActivity    ?? false);
        setAnalytics(data.privacy.analytics          ?? true);
      }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const { ok, data } = await apiFetch('/users_mgmt/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ privacy: { profileVisible, showActivity, analytics } }),
    });
    setSaving(false);
    show(ok ? 'Ajustes de privacidad guardados.' : (data.error || 'Error.'), ok ? 'ok' : 'err');
  };

  const exportData = async () => {
    setExporting(true);
    const { ok, data } = await apiFetch('/users_mgmt/me/export-data');
    setExporting(false);
    if (!ok) { show('Error al exportar datos.', 'err'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'mis_datos_biblioteca.json'; a.click();
    URL.revokeObjectURL(url);
    show('Datos exportados correctamente.');
  };

  if (loading) return <div className="config-section"><p className="card-hint">Cargando...</p></div>;

  return (
    <div className="config-section fade-in">
      {Toast}
      <div className="config-card">
        <h3>Visibilidad</h3>
        <div className="toggle-row">
          <div>
            <strong>Perfil visible para otros aprendices</strong>
            <span className="card-hint">Tu nombre y programa serán visibles dentro de la plataforma.</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={profileVisible} onChange={() => setProfileVisible(!profileVisible)} />
            <span className="slider" />
          </label>
        </div>
        <div className="toggle-row">
          <div>
            <strong>Mostrar actividad reciente</strong>
            <span className="card-hint">Permite que se vea cuándo accediste por última vez.</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={showActivity} onChange={() => setShowActivity(!showActivity)} />
            <span className="slider" />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn-save" onClick={save} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar ajustes'}
          </button>
        </div>
      </div>

      <div className="config-card">
        <h3>Análisis de uso</h3>
        <div className="toggle-row">
          <div>
            <strong>Permitir analítica anónima</strong>
            <span className="card-hint">Nos ayuda a mejorar la plataforma. Sin datos personales identificables.</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={analytics} onChange={() => setAnalytics(!analytics)} />
            <span className="slider" />
          </label>
        </div>
      </div>

      <div className="config-card">
        <h3>Mis datos</h3>
        <p className="card-hint">Descarga una copia de toda la información asociada a tu cuenta (formato JSON).</p>
        <div className="form-actions">
          <button className="btn-secondary" onClick={exportData} disabled={exporting}>
            <FiDownload /> {exporting ? 'Generando...' : 'Descargar mis datos'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Historial de accesos ───────────────────────────────────────────────

interface AccessEvent {
  date: string; action: string; ip: string; device: string; ok: boolean;
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS:          'Inicio de sesión',
  LOGIN_FAILED:           'Intento fallido',
  LOGOUT:                 'Cierre de sesión',
  PASSWORD_CHANGED:       'Cambio de contraseña',
  PROFILE_UPDATED:        'Actualización de perfil',
  PROFILE_IMAGE_UPDATED:  'Foto de perfil actualizada',
  ACCOUNT_DELETED:        'Cuenta eliminada',
  EMAIL_CHANGED:          'Correo actualizado',
};

const HistoryPanel: React.FC = () => {
  const [events, setEvents]   = useState<AccessEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/auth/access-history').then(({ ok, data }) => {
      if (ok) setEvents(data);
      setLoading(false);
    });
  }, []);

  const fmt = (iso: string) => new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium', timeStyle: 'short'
  });

  return (
    <div className="config-section fade-in">
      <div className="config-card">
        {loading ? (
          <p className="card-hint">Cargando historial...</p>
        ) : events.length === 0 ? (
          <p className="card-hint">No hay eventos registrados aún.</p>
        ) : (
          <ul className="event-list">
            {events.map((e, i) => (
              <li key={i} className={`event-item ${e.ok ? '' : 'failed'}`}>
                <span className="event-icon">{e.ok ? <FiCheck /> : <FiAlertTriangle />}</span>
                <div className="event-body">
                  <strong>{ACTION_LABELS[e.action] || e.action}</strong>
                  <span className="card-hint">IP {e.ip}</span>
                </div>
                <span className="event-date">{fmt(e.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="config-card info-card">
        <FiInfo />
        <p>Si no reconoces alguno de estos accesos, cambia tu contraseña y revisa tus sesiones activas.</p>
      </div>
    </div>
  );
};

// ── Eliminar cuenta ────────────────────────────────────────────────────

const DeleteAccountPanel: React.FC<{ userName: string }> = ({ userName }) => {
  const { show, Toast } = useToast();
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword]       = useState('');
  const [reason, setReason]           = useState('');
  const [busy, setBusy]               = useState(false);
  const phrase = `ELIMINAR ${userName.split(' ')[0]?.toUpperCase() || 'CUENTA'}`;

  const handleDelete = async () => {
    if (!confirm('¿Estás 100% seguro? Esta acción es definitiva.')) return;
    setBusy(true);
    const { ok, data } = await apiFetch('/users_mgmt/me', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (ok) {
      show('Cuenta eliminada. Serás desconectado en unos segundos.');
      setTimeout(() => {
        localStorage.clear();
        window.location.href = '/';
      }, 3000);
    } else {
      show(data.error || 'No se pudo eliminar la cuenta.', 'err');
    }
  };

  return (
    <div className="config-section fade-in">
      {Toast}
      <div className="config-card warning-card">
        <FiAlertTriangle />
        <div>
          <strong>Lo que pasará:</strong>
          <ul>
            <li>Tu acceso al sistema será desactivado inmediatamente.</li>
            <li>Tu información personal será marcada como eliminada.</li>
            <li>El historial de préstamos se conserva por trazabilidad institucional.</li>
            <li>Si tienes préstamos activos, debes devolverlos antes.</li>
          </ul>
        </div>
      </div>

      <div className="config-card">
        <h3>¿Por qué te vas? <span className="card-hint" style={{ marginLeft: 8, fontWeight: 400 }}>(opcional)</span></h3>
        <select value={reason} onChange={e => setReason(e.target.value)}>
          <option value="">Selecciona un motivo</option>
          <option>Ya no uso la plataforma</option>
          <option>Encontré una herramienta mejor</option>
          <option>Problemas de privacidad</option>
          <option>La interfaz es difícil</option>
          <option>Otro</option>
        </select>
      </div>

      <div className="config-card">
        <h3>Confirmación</h3>
        <div className="form-group">
          <label>Contraseña actual</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <p className="card-hint" style={{ marginTop: 12 }}>Escribe exactamente: <strong>{phrase}</strong></p>
        <input
          type="text"
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder={phrase}
          style={{ marginTop: 8 }}
        />
        <div className="form-actions">
          <button
            className="btn-danger"
            disabled={confirmText !== phrase || !password || busy}
            onClick={handleDelete}
          >
            <FiTrash2 /> {busy ? 'Eliminando...' : 'Eliminar mi cuenta permanentemente'}
          </button>
        </div>
      </div>
    </div>
  );
};
