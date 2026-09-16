import React, { useState, useEffect, useCallback } from 'react';
import { 
  FiCalendar, FiClock, FiCheck, FiUsers, FiInfo, FiImage, FiPackage, 
  FiMaximize2, FiX, FiMapPin, FiEye 
} from 'react-icons/fi';
import { MdQrCodeScanner } from 'react-icons/md';
import { QRCodeSVG } from 'qrcode.react';
import { confirmDialog, alertDialog } from '../../../../components/ui/ConfirmDialog';
import './AprendizReservations.css';
import './AprendizCatalog.css';

interface Res {
  id: number;
  item_id: number;
  item_name: string;
  item_code: string;
  item_category: string;
  item_location: string;
  item_image_url: string | null;
  reservation_date: string;
  ready_at: string | null;
  expiration_date: string | null;
  status: 'QUEUED' | 'READY' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';
  queue_position: number | null;
  token?: string;
}

interface Item {
  id: number;
  name: string;
  code: string;
  category_name: string;
  status_name: string;
  location_name: string;
  brand: string | null;
  model: string | null;
  image_url: string | null;
  description: string;
  physical_condition?: string;
  stock: number;
}

const statusConfig = (s: string) => {
  switch(s) {
    case 'QUEUED': return { label: 'En espera', type: 'warning' };
    case 'READY': return { label: 'Lista para reclamar', type: 'primary' };
    case 'CLAIMED': return { label: 'Completada', type: 'success' };
    case 'EXPIRED': return { label: 'Expirada', type: 'danger' };
    case 'CANCELLED': return { label: 'Cancelada', type: 'danger' };
    default: return { label: s, type: 'default' };
  }
};

const parseUTCDate = (iso: string) => {
  if (!iso) return new Date();
  
  const cleaned = iso.replace(' ', 'T');
  
  // Use manual regex to parse standard ISO-8601 UTC date parts
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // 0-indexed month
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const second = parseInt(match[6], 10);
    
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
  
  // Fallback for non-standard dates
  let withZ = cleaned;
  if (!withZ.endsWith('Z') && !withZ.includes('+') && !withZ.includes('-')) {
    withZ += 'Z';
  }
  return new Date(withZ);
};

const formatTimeRemaining = (iso: string) => {
  const ms = parseUTCDate(iso).getTime() - Date.now();
  if (ms <= 0) return { text: 'Expirada', isWarning: true };
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const d = Math.floor(h / 24);
  
  if (d > 0) return { text: `${d} día${d > 1 ? 's' : ''}`, isWarning: false };
  if (h > 0) return { text: `${h}h ${m}m`, isWarning: h < 12 };
  return { text: `${m}m`, isWarning: true };
};

const formatDateObj = (iso: string) => {
  const d = parseUTCDate(iso);
  const dateStr = d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  return `${dateStr} - ${timeStr}`;
};

export const AprendizReservations: React.FC = () => {
  const [reservations, setReservations] = useState<Res[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [selectedRes, setSelectedRes] = useState<Res | null>(null);
  const [showQRView, setShowQRView] = useState(false);
  const [isDark, setIsDark] = useState(!document.body.classList.contains('theme-light'));

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(!document.body.classList.contains('theme-light'));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const openDetailModal = async (res: Res, initiallyShowQR: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`/api/v1/items/${res.item_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const itemData = await r.json();
        setSelectedItem(itemData);
        setSelectedRes(res);
        setShowQRView(initiallyShowQR);
      } else {
        alertDialog('No se pudo cargar la información del elemento');
      }
    } catch (e) {
      console.error(e);
      alertDialog('Error de conexión al cargar el elemento');
    }
  };

  const handleCancelReservation = async (rid: number) => {
    if (!(await confirmDialog({ message: '¿Estás seguro de que deseas cancelar esta reserva?', danger: true }))) {
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`/api/v1/reservations/${rid}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        alertDialog('Reserva cancelada exitosamente');
        load(); // Refresh list
      } else {
        const errData = await r.json().catch(() => ({}));
        alertDialog(errData.error || 'No se pudo cancelar la reserva');
      }
    } catch (e) {
      console.error(e);
      alertDialog('Error de conexión al cancelar la reserva');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      // active=false para traer todas y filtrarlas en el frontend
      const r = await fetch('/api/v1/reservations/my?active=false', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setReservations(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeRes = reservations.filter(r => r.status === 'READY' || r.status === 'QUEUED');

  const getDisplayedReservations = () => {
    return activeRes;
  };

  const readyToClaimCount = activeRes.filter(r => r.status === 'READY').length;
  const firstReadyRes = activeRes.find(r => r.status === 'READY' && r.expiration_date);

  return (
    <div className="res-container fade-in">
      <div className="res-header-section">
        <h1>Mis reservas</h1>
        <p>Consulta y administra tus reservas activas.</p>
      </div>

      {loading ? (
        <div className="loading-spinner-container">
          <div className="spinner"></div>
          <p>Cargando reservas...</p>
        </div>
      ) : getDisplayedReservations().length === 0 ? (
        <div className="res-empty-state">
          <FiCalendar size={48} />
          <p>No tienes reservas en esta categoría.</p>
        </div>
      ) : (
        <div className="res-cards-list">
          {getDisplayedReservations().map(res => {
            const config = statusConfig(res.status);
            const remaining = res.expiration_date ? formatTimeRemaining(res.expiration_date) : null;
            
            return (
              <div key={res.id} className="res-item-card">
                <div className="res-item-image">
                  {res.item_image_url ? (
                    <img src={res.item_image_url} alt={res.item_name} />
                  ) : (
                    <div className="placeholder-img"><FiPackage size={32} /></div>
                  )}
                </div>
                
                <div className="res-item-details">
                  <span className={`res-status-badge ${config.type}`}>{config.label}</span>
                  <h3 className="res-item-title">{res.item_name}</h3>
                  <p className="res-item-meta">
                    Código: {res.item_code} • {res.item_location}
                  </p>
                  <p className="res-item-date">
                    Reservado el: {formatDateObj(res.reservation_date)}
                  </p>
                </div>
                
                <div className="res-item-actions">
                  {(res.status === 'READY' || res.status === 'QUEUED') && (
                    <div className="res-expiry-info">
                      <p className="expiry-label">
                        {res.status === 'READY' ? 'Expira en:' : 'Tiempo estimado:'}
                      </p>
                      {res.status === 'READY' && remaining && (
                        <>
                          <h4 className={`expiry-time ${remaining.isWarning ? 'warning-text' : 'safe-text'}`}>
                            {remaining.text}
                          </h4>
                          <p className="expiry-date">{formatDateObj(res.expiration_date!)}</p>
                        </>
                      )}
                      {res.status === 'QUEUED' && (
                        <>
                          <h4 className="expiry-time warning-text">
                            En espera
                          </h4>
                          <p className="expiry-date">Posición {res.queue_position} en la cola</p>
                        </>
                      )}
                    </div>
                  )}
                          <div style={{ display: 'flex', gap: '0.6rem', width: '100%', alignItems: 'center', marginTop: '0.5rem' }}>
                    {/* Cancel button (only for active READY or QUEUED) */}
                    {(res.status === 'READY' || res.status === 'QUEUED') && (
                      <button 
                        onClick={() => handleCancelReservation(res.id)}
                        style={{
                          flex: 1,
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#ef4444',
                          border: '1.5px solid rgba(239, 68, 68, 0.4)',
                          borderRadius: '12px',
                          padding: '0.6rem 1.2rem',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                          transition: 'all 0.2s ease',
                          height: '42px',
                          boxSizing: 'border-box'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                          e.currentTarget.style.borderColor = '#ef4444';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                          e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                        }}
                      >
                        Cancelar Reserva
                      </button>
                    )}
                    
                    {/* Info/Details button (icon-only square) */}
                    <button 
                      onClick={() => openDetailModal(res, false)}
                      title="Ver detalles"
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        width: '42px', 
                        height: '42px', 
                        borderRadius: '12px', 
                        border: '1.5px solid var(--border-color, #334155)', 
                        background: 'var(--bg-card-light, rgba(255,255,255,0.05))', 
                        color: 'var(--text-secondary, #94a3b8)', 
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        flexShrink: 0,
                        boxSizing: 'border-box'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--text-secondary, #94a3b8)';
                        e.currentTarget.style.color = '#ffffff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-color, #334155)';
                        e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)';
                      }}
                    >
                      <FiInfo size={20} />
                    </button>

                    {/* QR code button (icon-only square) */}
                    {(res.status === 'READY' || res.status === 'QUEUED') && res.token && (
                      <button 
                        onClick={() => openDetailModal(res, true)}
                        title="Ver Código QR"
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          width: '42px', 
                          height: '42px', 
                          borderRadius: '12px', 
                          border: '1.5px solid rgba(57,169,0,0.5)', 
                          background: 'rgba(57,169,0,0.12)', 
                          color: '#39A900', 
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          flexShrink: 0,
                          boxSizing: 'border-box'
                        }}
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7" rx="1.5" />
                          <rect x="14" y="3" width="7" height="7" rx="1.5" />
                          <rect x="3" y="14" width="7" height="7" rx="1.5" />
                          <path d="M14 14h2v2h-2z" fill="currentColor" stroke="none" />
                          <path d="M18 18h2v2h-2z" fill="currentColor" stroke="none" />
                          <path d="M18 14h2v2h-2z" fill="currentColor" stroke="none" />
                          <path d="M14 18h2v2h-2z" fill="currentColor" stroke="none" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Item Detail Modal with integrated QR Code */}
      {selectedItem && (
        <div className="catalog-modal-overlay" onClick={() => { setSelectedItem(null); setSelectedRes(null); setShowQRView(false); }}>
          <div className="catalog-modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-close-btn" onClick={() => { setSelectedItem(null); setSelectedRes(null); setShowQRView(false); }}>
              <FiX />
            </div>
            
            <div className="modal-grid">
              <div className="modal-left">
                <div className="modal-image-container" style={{ position: 'relative', width: '100%', height: '350px' }}>
                  {selectedRes && (selectedRes.status === 'READY' || selectedRes.status === 'QUEUED') && selectedRes.token && (
                    <button 
                      className={`btn-qr-toggle ${showQRView ? 'active' : ''}`}
                      onClick={() => setShowQRView(!showQRView)}
                      title={showQRView ? "Cerrar QR" : "Mostrar QR de la Reserva"}
                      style={{ top: '0.5rem', left: '0.5rem' }}
                    >
                      <MdQrCodeScanner />
                    </button>
                  )}
                  
                  {showQRView && selectedRes && selectedRes.token && (
                    <div className="qr-floating-panel" onClick={() => setShowQRView(false)} style={{ borderRadius: '14px' }}>
                      <div className="qr-floating-card" onClick={e => e.stopPropagation()}>
                        <QRCodeSVG 
                          value={selectedRes.token} 
                          size={180}
                          bgColor={isDark ? "#1e293b" : "#ffffff"}
                          fgColor={isDark ? "#ffffff" : "#0f172a"}
                        />
                        <div className="qr-floating-info">
                          <span className="qr-theme-hint" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>CÓDIGO DE RESERVA</span>
                          <span className="qr-id-text" style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
                            {selectedRes.token}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {selectedItem.image_url ? (
                    <img src={selectedItem.image_url} alt={selectedItem.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div className="modal-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '4rem', color: 'var(--text-muted, #64748b)' }}>
                      <FiPackage />
                    </div>
                  )}
                </div>
              </div>
              
              <div className="modal-right">
                <div className="modal-header-info">
                  <span className="modal-badge">{selectedItem.category_name}</span>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0.3rem 0' }}>{selectedItem.name}</h2>
                  <span className={`modal-status ${selectedItem.status_name.toUpperCase() === 'DISPONIBLE' ? 'status-available' : 'status-warning'}`} style={{
                    background: selectedItem.status_name.toUpperCase() === 'DISPONIBLE' ? 'var(--sena-green)' : '#f59e0b',
                    padding: '0.3rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: 'white',
                    display: 'inline-block'
                  }}>
                    {selectedItem.status_name}
                  </span>
                </div>

                <div className="modal-description" style={{ marginTop: '0.8rem' }}>
                  <h4 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 0.3rem 0' }}>Descripción</h4>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>{selectedItem.description || 'Sin descripción disponible.'}</p>
                </div>

                <div className="modal-specs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.8rem' }}>
                  <div className="spec-item">
                    <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Código</label>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{selectedItem.code}</span>
                  </div>
                  <div className="spec-item">
                    <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Marca / Modelo</label>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{selectedItem.brand || 'N/A'} {selectedItem.model ? `/ ${selectedItem.model}` : ''}</span>
                  </div>
                  <div className="spec-item">
                    <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Estado Físico</label>
                    <span className="condition-badge" style={{ display: 'inline-block', fontSize: '0.75rem' }}>{selectedItem.physical_condition || 'Bueno'}</span>
                  </div>
                  <div className="spec-item">
                    <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Ubicación</label>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{selectedItem.location_name}</span>
                  </div>
                  <div className="spec-item" style={{ gridColumn: 'span 2' }}>
                    <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Disponibilidad</label>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{selectedItem.stock > 0 ? `${selectedItem.stock} unidades` : 'No disponible'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
