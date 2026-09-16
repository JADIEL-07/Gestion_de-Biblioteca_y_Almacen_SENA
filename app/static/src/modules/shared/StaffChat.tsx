import React, { useState, useEffect, useCallback } from 'react';
import { FiUsers, FiMessageSquare, FiSearch, FiArrowLeft } from 'react-icons/fi';
import { ChatWindow } from './ChatWindow';
import './StaffChat.css';

interface Contact {
  id: string;
  name: string;
  role: string | null;
  profile_image: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

interface StaffChatProps {
  user: any;
}

const roleLabel = (role: string | null) => {
  if (!role) return '';
  const r = role.toUpperCase();
  if (r === 'BIBLIOTECARIO') return 'Bibliotecario';
  if (r === 'ALMACENISTA') return 'Almacenista';
  if (r.includes('SOPORTE')) return 'Soporte Técnico';
  if (r === 'ADMIN') return 'Administrador';
  return role;
};

export const StaffChat: React.FC<StaffChatProps> = ({ user }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchContacts = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/chat/staff/contacts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(data);
      }
    } catch (err) {
      console.error('Error cargando contactos:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
    const interval = setInterval(fetchContacts, 8000);
    return () => clearInterval(interval);
  }, [fetchContacts]);

  const filteredContacts = contacts.filter((c) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return c.name.toLowerCase().includes(term) || roleLabel(c.role).toLowerCase().includes(term);
  });

  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    } catch {
      return '';
    }
  };

  return (
    <div className="staff-chat-container fade-in">
      <div className="staff-chat-header">
        <div className="header-icon-wrapper">
          <FiUsers size={26} />
        </div>
        <div>
          <h1>Chat Interno del Equipo</h1>
          <p>Comunícate con Bibliotecario, Almacenista y Soporte Técnico. Los aprendices no tienen acceso a este canal.</p>
        </div>
      </div>

      <div className={`staff-chat-body ${selectedContact ? 'has-selected' : ''}`}>
        {/* SIDEBAR DE CONTACTOS */}
        <aside className="staff-chat-sidebar">
          <div className="staff-chat-search">
            <div className="staff-chat-search-box">
              <FiSearch size={14} />
              <input
                type="text"
                placeholder="Buscar contacto..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="staff-chat-contacts">
            {loading ? (
              <div className="contacts-empty">Cargando...</div>
            ) : filteredContacts.length === 0 ? (
              <div className="contacts-empty">
                {contacts.length === 0 ? 'Aún no hay otros miembros del equipo registrados.' : 'Sin resultados.'}
              </div>
            ) : (
              filteredContacts.map((c) => {
                const initials = (c.name || '??').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
                const isActive = selectedContact?.id === c.id;
                return (
                  <button
                    key={c.id}
                    className={`contact-item ${isActive ? 'active' : ''} ${c.unread_count > 0 ? 'has-unread' : ''}`}
                    onClick={() => setSelectedContact(c)}
                  >
                    <div className="contact-avatar">
                      {c.profile_image ? (
                        <img src={c.profile_image} alt={c.name} />
                      ) : (
                        <span>{initials}</span>
                      )}
                    </div>
                    <div className="contact-info">
                      <div className="contact-top">
                        <span className="contact-name">{c.name}</span>
                        {c.last_message_at && <span className="contact-time">{formatDate(c.last_message_at)}</span>}
                      </div>
                      <div className="contact-bottom">
                        <span className="contact-preview">
                          {c.last_message || roleLabel(c.role)}
                        </span>
                        {c.unread_count > 0 && (
                          <span className="contact-unread-badge">{c.unread_count}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* PANEL DE CHAT */}
        <main className="staff-chat-main">
          {selectedContact ? (
            <>
              <button
                type="button"
                className="staff-chat-back-btn"
                onClick={() => setSelectedContact(null)}
              >
                <FiArrowLeft /> Volver a contactos
              </button>
              <ChatWindow
                endpoint={`/api/v1/chat/staff/messages/${selectedContact.id}`}
                title={selectedContact.name}
                subtitle={roleLabel(selectedContact.role)}
                emptyMessage="Aún no hay mensajes. Saluda para empezar."
                pollingMs={3000}
                onMessagesUpdate={() => fetchContacts()}
              />
            </>
          ) : (
            <div className="staff-chat-placeholder">
              <FiMessageSquare size={64} />
              <h3>Selecciona un contacto</h3>
              <p>Elige a alguien de la lista para empezar a conversar.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
