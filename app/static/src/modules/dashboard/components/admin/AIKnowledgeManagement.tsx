import React, { useState, useEffect, useCallback } from 'react';
import {
  FiCpu, FiSearch, FiPlus, FiEdit2, FiTrash2, FiThumbsUp, FiThumbsDown,
  FiAlertCircle, FiCheckCircle, FiClock, FiHelpCircle, FiX, FiMessageSquare,
} from 'react-icons/fi';
import './AIKnowledgeManagement.css';

interface LearnedItem {
  id: number;
  query_text: string;
  query_keywords: string;
  response_text: string;
  role: string | null;
  source: string;
  use_count: number;
  positive_feedback: number;
  negative_feedback: number;
  created_at: string | null;
  updated_at: string | null;
  expired: boolean;
}

interface UnansweredItem {
  id: number;
  query_text: string;
  role: string | null;
  created_at: string | null;
  resolved: boolean;
}

const ROLE_OPTIONS = ['ADMIN', 'APRENDIZ', 'USUARIO', 'BIBLIOTECARIO', 'ALMACENISTA', 'SOPORTE', 'INSTRUCTOR', 'INVITADO'];

const SOURCE_LABEL: Record<string, string> = {
  gemini: 'Gemini',
  manual: 'Manual',
  soporte: 'Soporte',
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/v1/assistant${path}`, { ...opts, headers: { ...authHeaders(), ...(opts?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const AIKnowledgeManagement: React.FC = () => {
  const [tab, setTab] = useState<'learned' | 'unanswered'>('learned');

  const [items, setItems] = useState<LearnedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [unanswered, setUnanswered] = useState<UnansweredItem[]>([]);
  const [loadingUnanswered, setLoadingUnanswered] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LearnedItem | null>(null);
  const [formQuery, setFormQuery] = useState('');
  const [formResponse, setFormResponse] = useState('');
  const [formRole, setFormRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadLearned = useCallback(async () => {
    setLoading(true);
    const { ok, data } = await api(`/learned?search=${encodeURIComponent(search)}&per_page=50`);
    if (ok) {
      setItems(data.items || []);
      setTotal(data.total || 0);
    }
    setLoading(false);
  }, [search]);

  const loadUnanswered = useCallback(async () => {
    setLoadingUnanswered(true);
    const { ok, data } = await api('/unanswered?pending=true');
    if (ok) setUnanswered(data || []);
    setLoadingUnanswered(false);
  }, []);

  useEffect(() => { loadLearned(); }, [loadLearned]);
  useEffect(() => { if (tab === 'unanswered') loadUnanswered(); }, [tab, loadUnanswered]);

  const openCreate = (prefillQuery = '') => {
    setEditing(null);
    setFormQuery(prefillQuery);
    setFormResponse('');
    setFormRole('');
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (item: LearnedItem) => {
    setEditing(item);
    setFormQuery(item.query_text);
    setFormResponse(item.response_text);
    setFormRole(item.role || '');
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formQuery.trim() || !formResponse.trim()) {
      setFormError('La pregunta y la respuesta son obligatorias.');
      return;
    }
    setSaving(true);
    setFormError('');
    if (editing) {
      const { ok, data } = await api(`/learned/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ query_text: formQuery, response_text: formResponse, role: formRole }),
      });
      if (!ok) { setFormError(data.error || 'No se pudo guardar.'); setSaving(false); return; }
    } else {
      const { ok, data } = await api('/learned', {
        method: 'POST',
        body: JSON.stringify({ query_text: formQuery, response_text: formResponse, role: formRole }),
      });
      if (!ok) { setFormError(data.error || 'No se pudo crear.'); setSaving(false); return; }
    }
    setSaving(false);
    setShowForm(false);
    loadLearned();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta respuesta aprendida? Esta acción no se puede deshacer.')) return;
    const { ok } = await api(`/learned/${id}`, { method: 'DELETE' });
    if (ok) setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleResolveUnanswered = async (id: number) => {
    const { ok } = await api(`/unanswered/${id}`, { method: 'PUT' });
    if (ok) setUnanswered(prev => prev.filter(i => i.id !== id));
  };

  const handleDeleteUnanswered = async (id: number) => {
    const { ok } = await api(`/unanswered/${id}`, { method: 'DELETE' });
    if (ok) setUnanswered(prev => prev.filter(i => i.id !== id));
  };

  const expiredCount = items.filter(i => i.expired).length;
  const totalPositive = items.reduce((sum, i) => sum + (i.positive_feedback || 0), 0);
  const totalNegative = items.reduce((sum, i) => sum + (i.negative_feedback || 0), 0);

  return (
    <div className="aiknow-container fade-in">
      <div className="aiknow-header">
        <div className="aiknow-header-icon"><FiCpu /></div>
        <div>
          <h1>Conocimiento del Asistente</h1>
          <p>Lo que la IA que aprende ha guardado, y las preguntas que aún no sabe responder.</p>
        </div>
      </div>

      <div className="aiknow-stats-grid">
        <div className="aiknow-stat-card">
          <span className="aiknow-stat-value">{total}</span>
          <span className="aiknow-stat-label">Respuestas aprendidas</span>
        </div>
        <div className="aiknow-stat-card">
          <span className="aiknow-stat-value warn">{expiredCount}</span>
          <span className="aiknow-stat-label">Vencidas (en esta página)</span>
        </div>
        <div className="aiknow-stat-card">
          <span className="aiknow-stat-value">{unanswered.length}</span>
          <span className="aiknow-stat-label">Preguntas sin responder</span>
        </div>
        <div className="aiknow-stat-card">
          <span className="aiknow-stat-value ok">{totalPositive}👍 / {totalNegative}👎</span>
          <span className="aiknow-stat-label">Retroalimentación (esta página)</span>
        </div>
      </div>

      <div className="aiknow-tabs">
        <button className={`aiknow-tab ${tab === 'learned' ? 'active' : ''}`} onClick={() => setTab('learned')}>
          <FiMessageSquare /> Respuestas aprendidas
        </button>
        <button className={`aiknow-tab ${tab === 'unanswered' ? 'active' : ''}`} onClick={() => setTab('unanswered')}>
          <FiHelpCircle /> Preguntas sin responder {unanswered.length > 0 && <span className="aiknow-tab-badge">{unanswered.length}</span>}
        </button>
      </div>

      {tab === 'learned' && (
        <>
          <div className="aiknow-toolbar">
            <div className="aiknow-search">
              <FiSearch />
              <input
                type="text"
                placeholder="Buscar por pregunta, respuesta o palabra clave..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button className="btn-add-user" onClick={() => openCreate()}>
              <FiPlus /> Enseñar respuesta
            </button>
          </div>

          <div className="aiknow-table-wrapper">
            <table className="aiknow-table responsive-table">
              <thead>
                <tr>
                  <th>Pregunta</th>
                  <th>Respuesta</th>
                  <th>Rol</th>
                  <th>Origen</th>
                  <th>Usos</th>
                  <th>Feedback</th>
                  <th>Actualizada</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="aiknow-empty">Cargando...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={8} className="aiknow-empty">Aún no hay nada aprendido{search ? ' con ese filtro' : ''}.</td></tr>
                ) : items.map(item => (
                  <tr key={item.id} className={item.expired ? 'is-expired' : ''}>
                    <td data-label="Pregunta"><span className="aiknow-clamp">{item.query_text}</span></td>
                    <td data-label="Respuesta"><span className="aiknow-clamp">{item.response_text}</span></td>
                    <td data-label="Rol">{item.role ? <span className="aiknow-role-badge">{item.role}</span> : <span className="aiknow-role-badge generic">Cualquiera</span>}</td>
                    <td data-label="Origen"><span className={`aiknow-source-badge ${item.source}`}>{SOURCE_LABEL[item.source] || item.source}</span></td>
                    <td data-label="Usos">{item.use_count}</td>
                    <td data-label="Feedback"><span className="fb-pos">👍{item.positive_feedback}</span> <span className="fb-neg">👎{item.negative_feedback}</span></td>
                    <td data-label="Actualizada">
                      {fmtDate(item.updated_at)}
                      {item.expired && <div className="aiknow-expired-tag"><FiAlertCircle size={12} /> Vencida</div>}
                    </td>
                    <td data-label="Acciones">
                      <div className="aiknow-row-actions">
                        <button className="btn-icon" title="Editar" onClick={() => openEdit(item)}><FiEdit2 /></button>
                        <button className="btn-icon danger" title="Eliminar" onClick={() => handleDelete(item.id)}><FiTrash2 /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'unanswered' && (
        <div className="aiknow-table-wrapper">
          <table className="aiknow-table responsive-table">
            <thead>
              <tr>
                <th>Pregunta</th>
                <th>Rol</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loadingUnanswered ? (
                <tr><td colSpan={4} className="aiknow-empty">Cargando...</td></tr>
              ) : unanswered.length === 0 ? (
                <tr><td colSpan={4} className="aiknow-empty"><FiCheckCircle /> No hay preguntas pendientes por revisar.</td></tr>
              ) : unanswered.map(u => (
                <tr key={u.id}>
                  <td data-label="Pregunta">{u.query_text}</td>
                  <td data-label="Rol">{u.role ? <span className="aiknow-role-badge">{u.role}</span> : '—'}</td>
                  <td data-label="Fecha">{fmtDate(u.created_at)}</td>
                  <td data-label="Acciones">
                    <div className="aiknow-row-actions">
                      <button className="btn-icon" title="Enseñar respuesta" onClick={() => openCreate(u.query_text)}><FiPlus /></button>
                      <button className="btn-icon" title="Marcar como resuelta" onClick={() => handleResolveUnanswered(u.id)}><FiCheckCircle /></button>
                      <button className="btn-icon danger" title="Eliminar" onClick={() => handleDeleteUnanswered(u.id)}><FiTrash2 /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="user-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="user-modal-content aiknow-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Editar respuesta aprendida' : 'Enseñar una respuesta nueva'}</h3>
              <button className="btn-close" onClick={() => setShowForm(false)}><FiX /></button>
            </div>
            <div className="modal-body">
              {formError && <div className="alert-error fade-in"><FiAlertCircle /> {formError}</div>}
              <div className="aiknow-field">
                <label className="aiknow-field-label">Pregunta (o algo parecido a lo que preguntaría el usuario)</label>
                <textarea className="clean-input" rows={2} value={formQuery} onChange={e => setFormQuery(e.target.value)} />
              </div>
              <div className="aiknow-field">
                <label className="aiknow-field-label">Respuesta que debe dar el asistente</label>
                <textarea className="clean-input" rows={5} value={formResponse} onChange={e => setFormResponse(e.target.value)} />
              </div>
              <div className="aiknow-field">
                <label className="aiknow-field-label">Rol al que aplica (opcional — vacío = para cualquiera)</label>
                <select className="clean-input" value={formRole} onChange={e => setFormRole(e.target.value)}>
                  <option value="">Cualquiera</option>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-actions-pro">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn-add-user" disabled={saving} onClick={handleSave}>
                {saving ? 'Guardando...' : (editing ? 'Guardar cambios' : 'Enseñar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
