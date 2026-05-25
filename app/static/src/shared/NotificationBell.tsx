import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FiBell, FiCheck, FiClock, FiPackage, FiAlertCircle } from 'react-icons/fi';
import './NotificationBell.css';

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

const POLL_MS = 30000;

const iconFor = (type: string) => {
  switch (type) {
    case 'RESERVATION_READY':    return <FiCheck />;
    case 'RESERVATION_REMINDER': 
    case 'PENDING_APPROVAL_RESERVATION': return <FiClock />;
    case 'RESERVATION_EXPIRED':  
    case 'RESERVATION_CLOSE_TO_EXPIRY':  return <FiAlertCircle />;
    case 'LOAN_CREATED':
    case 'LOAN_RETURNED':        return <FiPackage />;
    default:                     return <FiBell />;
  }
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
};

interface NotificationBellProps {
  onNavigate?: (section: string) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ onNavigate }) => {
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const authHeader = (): HeadersInit => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchUnread = useCallback(async () => {
    if (loading) return;
    try {
      const r = await fetch('/api/v1/notifications/unread-count', { headers: authHeader() });
      if (r.ok) {
        const data = await r.json();
        setUnread(data.count || 0);
      }
    } catch {/* swallow */}
  }, [loading]);

  useEffect(() => {
    fetchUnread();
    const id = setInterval(fetchUnread, POLL_MS);
    return () => clearInterval(id);
  }, [fetchUnread]);

  const handleClick = () => {
    if (onNavigate) onNavigate('notifications');
  };

  return (
    <div className="notif-bell">
      <button
        className="notif-bell-btn"
        onClick={handleClick}
        aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ''}`}
      >
        <FiBell size={20} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  );
};
