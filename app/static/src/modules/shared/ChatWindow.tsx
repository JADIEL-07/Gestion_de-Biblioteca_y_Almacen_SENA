import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FiSend, FiUser, FiCheckCircle } from 'react-icons/fi';
import { confirmDialog, alertDialog } from '../../components/ui/ConfirmDialog';
import './ChatWindow.css';

export interface ChatMessage {
  id: number;
  body: string;
  sender_id: string;
  sender_name: string;
  sender_role?: string | null;
  is_mine: boolean;
  is_read: boolean;
  created_at: string;
  media_url?: string | null;
  media_type?: 'image' | 'audio' | null;
}

interface ChatWindowProps {
  endpoint: string;                 // Endpoint relativo: /api/v1/chat/tickets/<id>/messages
  title: string;                    // Título del header (ej. "Soporte Técnico - Juan")
  subtitle?: string;                // Subtítulo (ej. "Reporte #123 - En progreso")
  emptyMessage?: string;            // Texto cuando no hay mensajes
  pollingMs?: number;               // Default 3000ms
  showCloseButton?: boolean;        // Para Soporte: poder cerrar el ticket
  onClose?: () => void;             // Callback cuando se cierra el ticket
  closeEndpoint?: string;           // Endpoint para PUT al cerrar
  disabled?: boolean;               // No permitir escribir (ej. ticket cerrado)
  disabledReason?: string;          // Mensaje cuando el chat está deshabilitado
  headerExtras?: React.ReactNode;   // Botones adicionales en el header
  onMessagesUpdate?: (msgs: ChatMessage[]) => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  endpoint,
  title,
  subtitle,
  emptyMessage = 'Aún no hay mensajes. Inicia la conversación.',
  pollingMs = 3000,
  showCloseButton = false,
  onClose,
  closeEndpoint,
  disabled = false,
  disabledReason,
  headerExtras,
  onMessagesUpdate,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);

  const fetchMessages = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Error cargando mensajes');
      }
      const data = await res.json();
      const msgs: ChatMessage[] = data.messages || [];
      setMessages(msgs);
      onMessagesUpdate?.(msgs);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error de conexión.');
    } finally {
      setLoading(false);
    }
  }, [endpoint, onMessagesUpdate]);

  // Carga inicial + polling
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, pollingMs);
    return () => clearInterval(interval);
  }, [fetchMessages, pollingMs]);

  // Auto-scroll al fondo cuando llegan nuevos mensajes
  useEffect(() => {
    if (messages.length !== lastMessageCountRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      lastMessageCountRef.current = messages.length;
    }
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = inputText.trim();
    if (!body || sending || disabled) return;

    setSending(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Error enviando mensaje');
      }
      const newMsg: ChatMessage = await res.json();
      setMessages((prev) => [...prev, newMsg]);
      setInputText('');
    } catch (err: any) {
      alertDialog(err.message || 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  const handleClose = async () => {
    if (!closeEndpoint) return;
    if (!(await confirmDialog('¿Cerrar este ticket? Ya no se podrán enviar más mensajes.'))) return;

    setClosing(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(closeEndpoint, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Error cerrando ticket');
      }
      onClose?.();
    } catch (err: any) {
      alertDialog(err.message || 'No se pudo cerrar el ticket.');
    } finally {
      setClosing(false);
    }
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
      }
      return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return '';
    }
  };

  return (
    <div className="chat-window-container">
      <div className="chat-window-header">
        <div className="chat-window-header-left">
          <div className="chat-window-avatar">
            <FiUser />
          </div>
          <div>
            <h3 className="chat-window-title">{title}</h3>
            {subtitle && <p className="chat-window-subtitle">{subtitle}</p>}
          </div>
        </div>
        <div className="chat-window-header-right">
          {headerExtras}
          {showCloseButton && closeEndpoint && (
            <button
              type="button"
              className="chat-window-close-btn"
              onClick={handleClose}
              disabled={closing}
              title="Cerrar caso"
            >
              <FiCheckCircle size={14} /> {closing ? 'Cerrando...' : 'Cerrar caso'}
            </button>
          )}
        </div>
      </div>

      <div className="chat-window-messages" ref={scrollRef}>
        {loading ? (
          <div className="chat-window-loading">Cargando conversación...</div>
        ) : error ? (
          <div className="chat-window-error">{error}</div>
        ) : messages.length === 0 ? (
          <div className="chat-window-empty">{emptyMessage}</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`chat-msg-row ${m.is_mine ? 'mine' : 'theirs'}`}>
              <div className="chat-msg-bubble">
                {!m.is_mine && (
                  <span className="chat-msg-sender">{m.sender_name}</span>
                )}
                {m.media_url && (
                  m.media_type === 'audio' ? (
                    <audio src={m.media_url} controls className="chat-msg-audio" />
                  ) : (
                    <a href={m.media_url} target="_blank" rel="noopener noreferrer">
                      <img src={m.media_url} alt="Adjunto" className="chat-msg-image" />
                    </a>
                  )
                )}
                {m.body && <p className="chat-msg-body">{m.body}</p>}
                <span className="chat-msg-time">{formatTime(m.created_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {disabled ? (
        <div className="chat-window-disabled">{disabledReason || 'Chat deshabilitado.'}</div>
      ) : (
        <form className="chat-window-input" onSubmit={handleSend}>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Escribe un mensaje..."
            disabled={sending}
            maxLength={4000}
          />
          <button type="submit" disabled={!inputText.trim() || sending}>
            <FiSend size={16} />
            <span>{sending ? 'Enviando...' : 'Enviar'}</span>
          </button>
        </form>
      )}
    </div>
  );
};
