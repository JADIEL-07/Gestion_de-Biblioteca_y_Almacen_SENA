import React, { useEffect, useState, useCallback } from 'react';
import {
  FiBell, FiCheck, FiClock, FiPackage,
  FiAlertCircle, FiInbox, FiTrash2
} from 'react-icons/fi';
import './NotificationsPage.css';

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  related_type?: string;
  related_id?: number;
  is_read: boolean;
  date: string;
}

const PAGE_SIZE = 30;

const iconFor = (type: string) => {
  switch (type) {
    case 'RESERVATION_READY':              return <FiCheck />;
    case 'RESERVATION_REMINDER':
    case 'PENDING_APPROVAL_RESERVATION':   return <FiClock />;
    case 'RESERVATION_EXPIRED':
    case 'RESERVATION_CLOSE_TO_EXPIRY':    return <FiAlertCircle />;
    case 'LOAN_CREATED':
    case 'LOAN_RETURNED':                  return <FiPackage />;
    default:                               return <FiBell />;
  }
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Ahora';
  if (min < 60) return `Hace ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Hace ${hr}h`;
  if (hr < 48) return 'Ayer';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
};

const authHeader = (): HeadersInit => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const NotificationsPage: React.FC = () => {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchPage = useCallback(async (pageNum: number, unreadOnly: boolean, append: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageNum * PAGE_SIZE),
      });
      if (unreadOnly) params.set('unread_only', 'true');
      const r = await fetch(`/api/v1/notifications/?${params}`, { headers: authHeader() });
      if (r.ok) {
        const data: Notification[] = await r.json();
        setItems(prev => append ? [...prev, ...data] : data);
        setHasMore(data.length === PAGE_SIZE);
      }
    } catch { /* swallow */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    setPage(0);
    fetchPage(0, filter === 'unread', false);
  }, [filter, fetchPage]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchPage(next, filter === 'unread', true);
  };

  const markRead = async (id: number) => {
    await fetch(`/api/v1/notifications/${id}/read`, {
      method: 'POST', headers: authHeader(),
    });
    setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    await fetch('/api/v1/notifications/read-all', {
      method: 'POST', headers: authHeader(),
    });
    setItems(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const deleteOne = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('¿Eliminar esta notificación?')) return;
    await fetch(`/api/v1/notifications/${id}`, {
      method: 'DELETE', headers: authHeader(),
    });
    setItems(prev => prev.filter(n => n.id !== id));
  };

  const clearAll = async () => {
    if (!window.confirm('¿Eliminar todas las notificaciones?')) return;
    await fetch('/api/v1/notifications/clear-all', {
      method: 'DELETE', headers: authHeader(),
    });
    setItems([]);
  };

  const unreadCount = items.filter(n => !n.is_read).length;

  return (
    <div className="notifications-page fade-in">
      <div className="notif-page-header">
        <div className="notif-page-header-left">
          <FiBell size={24} />
          <h2>Centro de Notificaciones</h2>
          {unreadCount > 0 && (
            <span className="notif-page-unread-badge">{unreadCount} sin leer</span>
          )}
        </div>
        <div className="notif-page-header-right">
          <div className="notif-page-tabs">
            <button
              className={`notif-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              <FiInbox size={14} /> Todas
            </button>
            <button
              className={`notif-tab ${filter === 'unread' ? 'active' : ''}`}
              onClick={() => setFilter('unread')}
            >
              <FiBell size={14} /> No leídas
            </button>
          </div>
          {unreadCount > 0 && (
            <button className="notif-page-mark-all" onClick={markAllRead}>
              <FiCheck size={14} /> Marcar leídas
            </button>
          )}
          {items.length > 0 && (
            <button className="notif-page-clear-all" onClick={clearAll} title="Eliminar todas">
              <FiTrash2 size={14} /> Limpiar todo
            </button>
          )}
        </div>
      </div>

      <div className="notif-page-list">
        {!loading && items.length === 0 && (
          <div className="notif-page-empty">
            <FiBell size={48} />
            <p>No tienes notificaciones{filter === 'unread' ? ' sin leer' : ''}</p>
          </div>
        )}

        {items.map(n => (
          <div
            key={n.id}
            className={`notif-page-item ${n.is_read ? '' : 'unread'}`}
            onClick={() => !n.is_read && markRead(n.id)}
          >
            <span className="notif-page-icon">{iconFor(n.type)}</span>
            <span className="notif-page-body">
              {n.title && <strong className="notif-page-title">{n.title}</strong>}
              <span className="notif-page-msg">{n.message}</span>
              <span className="notif-page-time">{formatDateTime(n.date)}</span>
            </span>
            {!n.is_read && <span className="notif-page-dot" />}
            <button className="notif-page-delete" onClick={(e) => deleteOne(n.id, e)} title="Eliminar">
              <FiTrash2 size={14} />
            </button>
          </div>
        ))}

        {loading && (
          <div className="notif-page-loading">
            <div className="notif-spinner" />
            <span>Cargando notificaciones...</span>
          </div>
        )}

        {!loading && hasMore && (
          <button className="notif-page-load-more" onClick={loadMore}>
            Cargar más notificaciones
          </button>
        )}
      </div>
    </div>
  );
};
