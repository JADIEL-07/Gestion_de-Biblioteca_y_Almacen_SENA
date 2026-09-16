import React, { useState, useEffect, useRef } from 'react';
import { alertDialog, confirmDialog } from '../../../../components/ui/ConfirmDialog';
import {
  FiCheckCircle, FiClock, FiPackage, FiUser, FiCamera,
  FiCalendar, FiRefreshCw, FiSearch, FiChevronDown,
  FiAlertTriangle, FiBox, FiGift, FiTrendingUp, FiShield, FiX
} from 'react-icons/fi';
import { MdQrCodeScanner } from 'react-icons/md';
import { CustomSelect } from '../admin/CustomSelect';
import './StaffLoans.css';

interface Reservation {
  id: number;
  item_id: number;
  item_name: string;
  user_name: string;
  user_id: string;
  document?: string;
  reservation_date: string;
  expiration_date: string | null;
  status: string;
}

interface LoanItem {
  id: number;
  name: string;
  category: string;
}

interface Loan {
  id: number;
  user_id: string;
  user_name: string;
  admin_name: string;
  loan_date: string;
  due_date: string;
  return_date: string | null;
  status: string;
  fine_amount: number;
  sanction_type: 'DAYS' | 'CUSTOM' | null;
  sanction_days: number | null;
  sanction_description: string | null;
  sanction_active: boolean;
  sanction_created_at: string | null;
  sanction_lifted_at: string | null;
  items: LoanItem[];
}

const loanStatusMap: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE:       { label: 'Activo',      color: '#3b82f6', bg: 'rgba(59,130,246,0.12)'  },
  RETURNED:     { label: 'Devuelto',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  OVERDUE:      { label: 'Vencido',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  NOT_RETURNED: { label: 'No devuelto', color: '#ef4444', bg: 'rgba(239,68,68,0.18)'   },
};

const LOAN_STATUS_FILTER_OPTIONS = [
  { id: 'ALL', name: 'Todos los estados' },
  { id: 'ACTIVE', name: 'Activo' },
  { id: 'OVERDUE', name: 'Vencido' },
  { id: 'RETURNED', name: 'Devuelto' },
  { id: 'NOT_RETURNED', name: 'No devuelto' },
];

const fmt = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CO');
};

export const StaffLoans: React.FC<{ user: any }> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<'scan' | 'history'>('scan');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [search, setSearch] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Filtros del Historial de Préstamos (mismo filtro que en la vista del Admin)
  const [loanSearch, setLoanSearch] = useState('');
  const [loanStatusFilter, setLoanStatusFilter] = useState('ALL');
  const [loanStartDate, setLoanStartDate] = useState('');
  const [loanEndDate, setLoanEndDate] = useState('');

  // Panel para marcar un préstamo como no devuelto + imponer la sanción
  const [notReturnedLoan, setNotReturnedLoan] = useState<Loan | null>(null);
  const [sanctionType, setSanctionType] = useState<'DAYS' | 'CUSTOM'>('DAYS');
  const [sanctionDays, setSanctionDays] = useState('7');
  const [sanctionDescription, setSanctionDescription] = useState('');
  const [submittingSanction, setSubmittingSanction] = useState(false);

  // Panel de detalle de una sanción (ver descripción / levantarla)
  const [sanctionPanelLoan, setSanctionPanelLoan] = useState<Loan | null>(null);
  const [liftingSanction, setLiftingSanction] = useState(false);

  const token = () => localStorage.getItem('token');
  const depId = user?.dependency_id;

  const [scannerStarted, setScannerStarted] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const scannerRef = useRef<any>(null);

  const [showLoanConfig, setShowLoanConfig] = useState(false);
  const [configMode, setConfigMode] = useState<'token' | 'id'>('token');
  const [configValue, setConfigValue] = useState('');
  const [configReservation, setConfigReservation] = useState<Reservation | null>(null);
  const [loanDays, setLoanDays] = useState(7);

  useEffect(() => {
    if (activeTab === 'scan' && scannerStarted) {
      import('html5-qrcode').then(({ Html5Qrcode }) => {
        setTimeout(() => {
          if (!scannerRef.current) {
            scannerRef.current = new Html5Qrcode("qr-reader");
          }
          // Robust config for mobile (iOS/Android)
          const config = { 
            fps: 10, 
            qrbox: (viewfinderWidth: number,維viewfinderHeight: number) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              const qrboxSize = Math.floor(minEdge * 0.7);
              return { width: qrboxSize, height: qrboxSize };
            },
            aspectRatio: 1.0
          };
          
          scannerRef.current.start(
            { facingMode: facingMode },
            config,
            (decodedText: string) => {
              setScanInput(decodedText);
              // Visual flash feedback (acts as the dynamic box highlight)
              const reader = document.getElementById('qr-reader');
              if (reader) {
                reader.style.boxShadow = 'inset 0 0 0 8px #39A900';
              }
              setTimeout(() => {
                scannerRef.current?.stop().then(() => {
                  setScannerStarted(false);
                  document.getElementById('scan-form-submit')?.click();
                }).catch(console.error);
              }, 400);
            },
            () => {} // Ignore errors
          ).catch((err: any) => {
            console.error(err);
          });
        }, 100);
      });
    }

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [activeTab, scannerStarted, facingMode]);

  const toggleCamera = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scannerRef.current && scannerRef.current.isScanning) {
      scannerRef.current.stop().then(() => {
        setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
      }).catch(console.error);
    } else {
      setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
    }
  };

  const fetchReservations = async () => {
    try {
      const res = await fetch(`/api/v1/reservations/?dependency_id=${depId || ''}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (res.ok) setReservations(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchLoans = async () => {
    try {
      const params = new URLSearchParams({
        dependency_id: depId || '',
        search: loanSearch,
        status: loanStatusFilter,
        startDate: loanStartDate,
        endDate: loanEndDate,
      });
      const res = await fetch(`/api/v1/loans/?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (res.ok) setLoans(await res.json());
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (activeTab === 'scan') fetchReservations();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'history') fetchLoans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loanSearch, loanStatusFilter, loanStartDate, loanEndDate]);

  const openNotReturnedModal = (loan: Loan) => {
    setNotReturnedLoan(loan);
    setSanctionType('DAYS');
    setSanctionDays('7');
    setSanctionDescription('');
  };

  const submitNotReturned = async () => {
    if (!notReturnedLoan) return;
    if (sanctionType === 'DAYS') {
      const n = parseInt(sanctionDays, 10);
      if (!n || n <= 0) {
        alertDialog('Ingresa un número de días válido.');
        return;
      }
    } else if (!sanctionDescription.trim()) {
      alertDialog('Escribe una descripción para la sanción.');
      return;
    }

    const ok = await confirmDialog({
      title: 'Marcar como no devuelto',
      message: `Se cerrará el préstamo #${notReturnedLoan.id} como NO DEVUELTO y ${notReturnedLoan.user_name} no podrá hacer nuevas reservas hasta que levantes la sanción. ¿Continuar?`,
      confirmText: 'Sí, aplicar sanción',
      danger: true,
    });
    if (!ok) return;

    setSubmittingSanction(true);
    try {
      const res = await fetch(`/api/v1/loans/${notReturnedLoan.id}/mark-not-returned`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({
          sanction_type: sanctionType,
          sanction_days: sanctionType === 'DAYS' ? parseInt(sanctionDays, 10) : undefined,
          sanction_description: sanctionDescription.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotReturnedLoan(null);
        fetchLoans();
      } else {
        alertDialog(data.error || 'No se pudo aplicar la sanción.');
      }
    } catch {
      alertDialog('Error de conexión al aplicar la sanción.');
    } finally {
      setSubmittingSanction(false);
    }
  };

  const handleLiftSanction = async (loan: Loan) => {
    const ok = await confirmDialog({
      message: `¿Levantar la sanción del préstamo #${loan.id}? ${loan.user_name} volverá a poder hacer reservas.`,
      confirmText: 'Sí, levantar sanción',
    });
    if (!ok) return;

    setLiftingSanction(true);
    try {
      const res = await fetch(`/api/v1/loans/${loan.id}/lift-sanction`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSanctionPanelLoan(null);
        fetchLoans();
      } else {
        alertDialog(data.error || 'No se pudo levantar la sanción.');
      }
    } catch {
      alertDialog('Error de conexión al levantar la sanción.');
    } finally {
      setLiftingSanction(false);
    }
  };

  const handleApprove = async (id: number) => {
    const res = pending.find(r => r.id === id);
    setConfigMode('id');
    setConfigValue(String(id));
    setConfigReservation(res || null);
    setLoanDays(7);
    setShowLoanConfig(true);
  };

  const processLoanFromToken = async (qrToken: string, days: number) => {
    try {
      const res = await fetch(`/api/v1/loans/from_reservation`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: qrToken, days })
      });
      if (res.ok) { 
        alertDialog('Préstamo creado y elemento entregado con éxito.'); 
        fetchReservations(); 
      } else { 
        const e = await res.json(); 
        alertDialog(`Error: ${e.error || 'No se pudo procesar el préstamo'}`); 
      }
    } catch { alertDialog('Error de red'); }
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = scanInput.trim();
    if (!val) return;
    
    const matchByToken = pending.find(r => (r as any).token === val);
    if (matchByToken) {
      setConfigMode('token');
      setConfigValue(val);
      setConfigReservation(matchByToken);
      setLoanDays(7);
      setShowLoanConfig(true);
      setScanInput('');
      return;
    }
    
    if (val.length > 20) {
      setConfigMode('token');
      setConfigValue(val);
      setConfigReservation(null);
      setLoanDays(7);
      setShowLoanConfig(true);
      setScanInput('');
      return;
    }

    const match = pending.find(r =>
      r.id.toString() === val || r.user_id === val
    );
    if (match) handleApprove(match.id);
    else alertDialog(`No se encontró reserva pendiente para: ${val}`);
    setScanInput('');
  };

  // Reservas activas: QUEUED (en cola) o READY (listas para entregar)
  const pending = reservations.filter(r => ['QUEUED', 'READY'].includes(r.status));
  const overdue  = pending.filter(r => r.expiration_date && new Date(r.expiration_date) < new Date());

  const filteredPending = pending.filter(r =>
    !search || [r.user_name, r.item_name, r.user_id, String(r.id)]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const kpis = [
    { label: 'Reservas pendientes', value: pending.length,          sub: 'Por entregar',       icon: <FiBox />,         color: '#3b82f6' },
    { label: 'Vencidas',            value: overdue.length,          sub: 'Requieren atención', icon: <FiAlertTriangle />,color: '#ef4444' },
    { label: 'Total reservas',      value: reservations.length,     sub: 'Todas las reservas', icon: <FiTrendingUp />,  color: '#a855f7' },
    { label: 'Préstamos activos',   value: loans.filter(l => l.status === 'ACTIVE').length, sub: 'En circulación', icon: <FiClock />, color: '#f59e0b' },
  ];

  const handleConfirmLoan = async () => {
    setShowLoanConfig(false);
    if (configMode === 'token') {
      await processLoanFromToken(configValue, loanDays);
    } else {
      try {
        const res = await fetch(`/api/v1/reservations/${configValue}/approve`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ days: loanDays })
        });
        if (res.ok) { alertDialog('Préstamo creado y elemento entregado con éxito.'); fetchReservations(); }
        else { const e = await res.json(); alertDialog(`Error: ${e.error || 'No se pudo aprobar'}`); }
      } catch { alertDialog('Error de red'); }
    }
  };

  return (
    <div className="staff-loans-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--admin-text-primary, #f8fafc)', fontSize: '1.5rem', fontWeight: 800 }}>
            {activeTab === 'scan' ? 'Entrega de Reservas' : 'Historial de Préstamos'}
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--admin-text-muted, #64748b)', fontSize: '0.875rem' }}>
            {activeTab === 'scan'
              ? 'Reservas pendientes de entrega en tu dependencia.'
              : 'Registro completo de préstamos procesados.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className={`tab-btn ${activeTab === 'scan' ? 'active' : ''}`} onClick={() => setActiveTab('scan')}>
            <FiGift size={15} /> Entregar Reservas
          </button>
          <button className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            <FiClock size={15} /> Historial de Préstamos
          </button>
        </div>
      </div>

      {/* ── ENTREGAR RESERVAS ── */}
      {activeTab === 'scan' && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {kpis.map((k, i) => (
              <div key={i} className="admin-kpi-card">
                <div className="kpi-icon-box" style={{ color: k.color, background: `${k.color}18` }}>{k.icon}</div>
                <div className="kpi-info">
                  <span className="kpi-title">{k.label}</span>
                  <span className="kpi-value" style={{ color: k.color }}>{k.value}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted, #64748b)' }}>{k.sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Escáner */}
          <div style={{ background: 'var(--admin-bg-card, #1e293b)', borderRadius: '12px', border: '1px solid var(--admin-border-color, #334155)', padding: '1.1rem 1.25rem' }}>
            <h2 style={{ margin: '0 0 0.2rem', color: 'var(--sena-green, #39A900)', fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FiCamera /> Escáner rápido
            </h2>
            <p style={{ margin: '0 0 0.9rem', color: 'var(--admin-text-muted, #64748b)', fontSize: '0.82rem' }}>
              Escanea el código QR de la reserva o ingresa el token manualmente.
            </p>
            <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setScannerStarted(true)}
                className="btn-scan-hero"
                title="Abrir cámara"
              >
                <span className="scan-emoji" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MdQrCodeScanner size={24} />
                </span>
              </button>

              <div style={{ flex: 1, minWidth: '280px' }}>
                <form onSubmit={handleScanSubmit} style={{ display: 'flex', flexDirection: 'row', gap: '0.6rem', height: '46px' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      ref={scanInputRef}
                      type="text"
                      placeholder="Ingresa código o token manualmente"
                      value={scanInput}
                      onChange={e => setScanInput(e.target.value)}
                      autoFocus
                      style={{
                        width: '100%', height: '100%', padding: '0 2.5rem 0 1rem',
                        borderRadius: '10px', border: '1px solid var(--admin-border-color, #334155)',
                        background: 'var(--admin-bg, #0f172a)', color: 'var(--admin-text-primary, #f8fafc)',
                        fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none'
                      }}
                    />
                    <FiSearch size={15} style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--admin-text-muted, #64748b)' }} />
                  </div>
                  <button id="scan-form-submit" type="submit" style={{
                    padding: '0 1.25rem',
                    background: 'var(--sena-green, #39A900)', color: 'white',
                    border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                    whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.4rem',
                    boxShadow: '0 4px 12px rgba(57, 169, 0, 0.2)'
                  }}>
                    <FiCheckCircle size={16} /> Procesar
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Tabla de reservas pendientes */}
          <div style={{ background: 'var(--admin-bg-card, #1e293b)', borderRadius: '12px', border: '1px solid var(--admin-border-color, #334155)', padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--admin-text-primary, #f8fafc)', fontSize: '0.95rem' }}>
                Reservas pendientes ({filteredPending.length})
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Buscar por aprendiz, elemento o código..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                      padding: '0.45rem 2.2rem 0.45rem 0.85rem', borderRadius: '8px',
                      border: '1px solid var(--admin-border-color, #334155)',
                      background: 'var(--admin-bg, #0f172a)', color: 'var(--admin-text-primary, #f8fafc)',
                      fontSize: '0.82rem', width: '240px',
                    }}
                  />
                  <FiSearch size={13} style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--admin-text-muted, #64748b)' }} />
                </div>
                <button onClick={fetchReservations} style={{
                  display: 'flex', alignItems: 'center', background: 'transparent',
                  border: '1px solid var(--admin-border-color, #334155)',
                  color: 'var(--admin-text-secondary, #94a3b8)', borderRadius: '8px',
                  padding: '0.45rem 0.7rem', cursor: 'pointer',
                }}>
                  <FiRefreshCw size={13} />
                </button>
              </div>
            </div>

            {/* Cabecera */}
            <div style={{
              display: 'grid', gridTemplateColumns: '130px 1fr 1fr 120px 120px 100px 110px',
              gap: '0.5rem', padding: '0 0.75rem 0.6rem',
              borderBottom: '1px solid var(--admin-border-color, #334155)',
            }}>
              {['Reserva', 'Aprendiz', 'Elemento', 'F. Reserva', 'F. Límite', 'Estado', 'Acción'].map(h => (
                <span key={h} style={{ fontSize: '0.71rem', fontWeight: 700, color: 'var(--admin-text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  {h} {h !== 'Acción' && <FiChevronDown size={10} style={{ opacity: 0.5 }} />}
                </span>
              ))}
            </div>

            {filteredPending.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--admin-text-muted, #64748b)' }}>
                No hay reservas pendientes.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                {filteredPending.map(r => {
                  const isOverdue = r.expiration_date ? new Date(r.expiration_date) < new Date() : false;
                  return (
                    <div key={r.id} style={{
                      display: 'grid', gridTemplateColumns: '130px 1fr 1fr 120px 120px 100px 110px',
                      gap: '0.5rem', alignItems: 'center',
                      padding: '0.7rem 0.75rem', borderRadius: '8px',
                      border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.2)' : 'var(--admin-border-color, #2a374f)'}`,
                      background: 'rgba(0,0,0,0.12)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'rgba(57,169,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <FiPackage size={13} style={{ color: 'var(--sena-green, #39A900)' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--admin-text-primary, #f8fafc)' }}>RES-{String(r.id).padStart(6, '0')}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted, #64748b)' }}>#{r.id}</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, background: '#39a900', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.68rem' }}>
                          {r.user_name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--admin-text-primary, #f8fafc)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.user_name}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted, #64748b)' }}>Doc: {r.user_id || '—'}</div>
                        </div>
                      </div>

                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--admin-text-primary, #f8fafc)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.item_name || '—'}
                      </span>

                      <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-muted, #64748b)' }}>{fmt(r.reservation_date)}</span>

                      <span style={{ fontSize: '0.8rem', color: isOverdue ? '#ef4444' : 'var(--admin-text-muted, #64748b)', fontWeight: isOverdue ? 700 : 400 }}>
                        {fmt(r.expiration_date || '')}
                        {isOverdue && <span style={{ display: 'block', fontSize: '0.68rem' }}>Vencida</span>}
                      </span>

                      <span style={{ padding: '0.25rem 0.65rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-block', textAlign: 'center', color: isOverdue ? '#ef4444' : '#f59e0b', background: isOverdue ? 'rgba(239,68,68,0.13)' : 'rgba(245,158,11,0.13)' }}>
                        {isOverdue ? 'Vencida' : 'Pendiente'}
                      </span>

                      <button onClick={() => handleApprove(r.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.75rem', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700, border: 'none', cursor: 'pointer', background: 'var(--sena-green, #39A900)', color: 'white' }}>
                        <FiCheckCircle size={13} /> Entregar
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── HISTORIAL DE PRÉSTAMOS ── */}
      {activeTab === 'history' && (
        <div style={{ background: 'var(--admin-bg-card, #1e293b)', borderRadius: '12px', border: '1px solid var(--admin-border-color, #334155)', padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: 0, color: 'var(--admin-text-primary, #f8fafc)', fontSize: '1.1rem', fontWeight: 700 }}>
              Historial de Préstamos
            </h3>
            <button onClick={fetchLoans} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'transparent', border: '1px solid var(--admin-border-color, #334155)', color: 'var(--admin-text-secondary, #94a3b8)', borderRadius: '8px', padding: '0.4rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
              <FiRefreshCw size={13} /> Actualizar
            </button>
          </div>

          {/* Filtros — mismo criterio que la vista de Préstamos del Admin */}
          <div className="staffloan-filters">
            <div className="staffloan-filter-item search">
              <label>Búsqueda rápida</label>
              <div className="input-with-icon">
                <FiSearch />
                <input
                  type="text"
                  placeholder="Nombre, ID o elemento..."
                  value={loanSearch}
                  onChange={(e) => setLoanSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="staffloan-filter-item">
              <CustomSelect
                label="Estado"
                options={LOAN_STATUS_FILTER_OPTIONS}
                value={loanStatusFilter}
                onChange={setLoanStatusFilter}
                icon={<FiAlertTriangle />}
              />
            </div>
            <div className="staffloan-filter-item">
              <label>Desde (fecha)</label>
              <div className="input-with-icon">
                <FiCalendar />
                <input type="date" value={loanStartDate} onChange={(e) => setLoanStartDate(e.target.value)} />
              </div>
            </div>
            <div className="staffloan-filter-item">
              <label>Hasta (fecha)</label>
              <div className="input-with-icon">
                <FiCalendar />
                <input type="date" value={loanEndDate} onChange={(e) => setLoanEndDate(e.target.value)} />
              </div>
            </div>
            <button className="btn-reset" onClick={() => {
              setLoanSearch('');
              setLoanStatusFilter('ALL');
              setLoanStartDate('');
              setLoanEndDate('');
            }}>Limpiar filtros</button>
          </div>

          <div className="staffloan-table-wrapper">
            <table className="staffloan-table">
              <thead>
                <tr>
                  <th className="col-center">#</th>
                  <th>Elemento(s)</th>
                  <th>Aprendiz</th>
                  <th>Procesado por</th>
                  <th className="col-center">F. Préstamo</th>
                  <th className="col-center">F. Vencimiento</th>
                  <th className="col-center">Estado</th>
                  <th className="col-center">Multa</th>
                  <th className="col-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loans.length === 0 ? (
                  <tr><td colSpan={9} className="staffloan-empty">No hay historial de préstamos registrado.</td></tr>
                ) : loans.map(l => {
                  const s = loanStatusMap[l.status] ?? { label: l.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
                  const isOverdue = l.status === 'ACTIVE' && new Date(l.due_date) < new Date();
                  const itemNames = l.items?.map(i => i.name).join(', ') || '—';
                  return (
                    <tr key={l.id}>
                      <td className="col-center"><span className="staffloan-id-badge">#{l.id}</span></td>
                      <td>
                        <FiPackage size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle', opacity: 0.6 }} />
                        {itemNames}
                      </td>
                      <td>
                        <FiUser size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle', opacity: 0.6 }} />
                        {l.user_name}
                      </td>
                      <td>
                        <FiShield size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle', opacity: 0.6 }} />
                        {l.admin_name || 'Sistema'}
                      </td>
                      <td className="col-center date-text">{fmt(l.loan_date)}</td>
                      <td className="col-center date-text" style={{ color: isOverdue ? '#ef4444' : undefined, fontWeight: isOverdue ? 700 : 400 }}>
                        {fmt(l.due_date)}{isOverdue && ' ⚠️'}
                      </td>
                      <td className="col-center">
                        <span style={{ padding: '0.25rem 0.65rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700, color: s.color, background: s.bg, whiteSpace: 'nowrap', textAlign: 'center', display: 'inline-block' }}>
                          {s.label}
                        </span>
                      </td>
                      <td className="col-center">
                        {l.status === 'NOT_RETURNED' ? (
                          <button
                            className={`staffloan-fine-btn ${l.sanction_active ? 'sanction-active' : 'sanction-lifted'}`}
                            onClick={() => setSanctionPanelLoan(l)}
                            title="Ver detalle de la sanción"
                          >
                            {l.sanction_active ? <FiAlertTriangle size={12} /> : <FiCheckCircle size={12} />}
                            {l.sanction_active ? 'Sí aplica' : 'Levantada'}
                          </button>
                        ) : (
                          <span className="staffloan-fine-badge">
                            {l.fine_amount > 0 ? `$${l.fine_amount.toLocaleString()}` : 'No aplica'}
                          </span>
                        )}
                      </td>
                      <td className="col-center">
                        {(l.status === 'ACTIVE' || l.status === 'OVERDUE') ? (
                          <button
                            className="staffloan-btn-not-returned"
                            onClick={() => openNotReturnedModal(l)}
                            title="El aprendiz nunca devolvió este elemento"
                          >
                            <FiAlertTriangle size={12} /> No devuelto
                          </button>
                        ) : (
                          <span style={{ color: 'var(--admin-text-muted, #64748b)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Modal for Camera */}
      {scannerStarted && (
        <div className="camera-modal-overlay" onClick={() => setScannerStarted(false)}>
          <div className="camera-modal-content" onClick={e => e.stopPropagation()}>
            <button className="close-camera-btn" onClick={() => setScannerStarted(false)}>✕</button>
            <h3 style={{ margin: '0 0 1rem', color: 'var(--admin-text-primary)' }}>Escaneando QR...</h3>
            <div className="scanner-container-animated">
              <div id="qr-reader" className={facingMode === 'user' ? 'mirrored-video' : ''} style={{ width: '100%', border: 'none' }}></div>
              <div className="scan-line"></div>
              <button className="flip-camera-btn" onClick={toggleCamera} title="Cambiar cámara">
                <FiRefreshCw />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Configurar tiempo de préstamo */}
      {showLoanConfig && (
        <div className="loan-config-overlay" onClick={() => setShowLoanConfig(false)}>
          <div className="loan-config-card" onClick={e => e.stopPropagation()}>
            <button className="close-camera-btn" onClick={() => setShowLoanConfig(false)}>✕</button>
            <div className="config-header">
              <div className="config-header-icon"><FiClock size={24} /></div>
              <h3>Configurar tiempo de préstamo</h3>
              <p>Define los días del préstamo antes de confirmar la entrega.</p>
            </div>

            {configReservation ? (
              <div className="config-details">
                <div className="config-detail-row">
                  <span className="config-detail-label">Aprendiz</span>
                  <span className="config-detail-value">{configReservation.user_name}</span>
                </div>
                <div className="config-detail-row">
                  <span className="config-detail-label">Elemento</span>
                  <span className="config-detail-value">{configReservation.item_name}</span>
                </div>
                <div className="config-detail-row">
                  <span className="config-detail-label">Reserva</span>
                  <span className="config-detail-value">RES-{String(configReservation.id).padStart(6, '0')}</span>
                </div>
              </div>
            ) : (
              <div className="config-details">
                <div className="config-detail-row">
                  <span className="config-detail-label">Token</span>
                  <span className="config-detail-value config-token">{configValue.slice(0, 24)}...</span>
                </div>
              </div>
            )}

            <div className="config-time-section">
              <label className="config-time-label">
                <FiCalendar size={16} />
                Duración del préstamo
              </label>
              <div className="config-time-input-group">
                <button
                  className="config-time-btn"
                  onClick={() => setLoanDays(Math.max(1, loanDays - 1))}
                  disabled={loanDays <= 1}
                >−</button>
                <div className="config-time-display">
                  <span className="config-time-value">{loanDays}</span>
                  <span className="config-time-unit">{loanDays === 1 ? 'día' : 'días'}</span>
                </div>
                <button
                  className="config-time-btn"
                  onClick={() => setLoanDays(Math.min(30, loanDays + 1))}
                  disabled={loanDays >= 30}
                >+</button>
              </div>
              <div className="config-time-range">
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={loanDays}
                  onChange={e => setLoanDays(parseInt(e.target.value))}
                />
                <div className="config-time-range-labels">
                  <span>1 día</span>
                  <span>30 días</span>
                </div>
              </div>
              <div className="config-due-preview">
                Vence el <strong>{new Date(Date.now() + loanDays * 86400000).toLocaleDateString('es-CO')}</strong>
              </div>
            </div>

            <div className="config-actions">
              <button className="config-btn-cancel" onClick={() => setShowLoanConfig(false)}>
                Cancelar
              </button>
              <button className="config-btn-confirm" onClick={handleConfirmLoan}>
                <FiCheckCircle size={18} /> Confirmar préstamo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PANEL: marcar como no devuelto + imponer sanción */}
      {notReturnedLoan && (
        <div className="staffloan-modal-overlay" onClick={() => setNotReturnedLoan(null)}>
          <div className="staffloan-modal-content" onClick={e => e.stopPropagation()}>
            <div className="staffloan-modal-header">
              <h3><FiAlertTriangle /> Marcar préstamo #{notReturnedLoan.id} como no devuelto</h3>
              <button className="btn-close-staffloan-modal" onClick={() => setNotReturnedLoan(null)}><FiX /></button>
            </div>
            <div className="staffloan-modal-body">
              <p className="staffloan-modal-hint">
                <strong>{notReturnedLoan.user_name}</strong> no devolvió {notReturnedLoan.items.length > 1 ? 'los elementos' : 'el elemento'} de este préstamo.
                Esto lo bloqueará para hacer nuevas reservas hasta que levantes la sanción.
              </p>

              <label className="staffloan-form-label">Tipo de sanción</label>
              <div className="staffloan-sanction-toggle">
                <button
                  type="button"
                  className={sanctionType === 'DAYS' ? 'active' : ''}
                  onClick={() => setSanctionType('DAYS')}
                >
                  Sanción por días
                </button>
                <button
                  type="button"
                  className={sanctionType === 'CUSTOM' ? 'active' : ''}
                  onClick={() => setSanctionType('CUSTOM')}
                >
                  Otra sanción
                </button>
              </div>

              {sanctionType === 'DAYS' ? (
                <>
                  <label className="staffloan-form-label">Días de suspensión de reservas</label>
                  <input
                    type="number"
                    min={1}
                    className="staffloan-form-input"
                    value={sanctionDays}
                    onChange={e => setSanctionDays(e.target.value)}
                  />
                  <label className="staffloan-form-label">Nota adicional (opcional)</label>
                  <textarea
                    className="staffloan-form-textarea"
                    rows={2}
                    placeholder="Ej: el aprendiz no respondió a los recordatorios..."
                    value={sanctionDescription}
                    onChange={e => setSanctionDescription(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <label className="staffloan-form-label">Describe la sanción</label>
                  <textarea
                    className="staffloan-form-textarea"
                    rows={4}
                    placeholder="Ej: se retiene el carné hasta que reponga el elemento..."
                    value={sanctionDescription}
                    onChange={e => setSanctionDescription(e.target.value)}
                  />
                </>
              )}
            </div>
            <div className="staffloan-modal-footer">
              <button className="btn-staffloan-secondary" onClick={() => setNotReturnedLoan(null)} disabled={submittingSanction}>
                Cancelar
              </button>
              <button className="btn-staffloan-danger" onClick={submitNotReturned} disabled={submittingSanction}>
                {submittingSanction ? 'Aplicando...' : 'Aplicar sanción'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PANEL: detalle de la sanción / levantarla */}
      {sanctionPanelLoan && (
        <div className="staffloan-modal-overlay" onClick={() => setSanctionPanelLoan(null)}>
          <div className="staffloan-modal-content mini" onClick={e => e.stopPropagation()}>
            <div className="staffloan-modal-header">
              <h3><FiAlertTriangle /> Sanción — Préstamo #{sanctionPanelLoan.id}</h3>
              <button className="btn-close-staffloan-modal" onClick={() => setSanctionPanelLoan(null)}><FiX /></button>
            </div>
            <div className="staffloan-modal-body">
              <div className="staffloan-sanction-detail-row">
                <label>Aprendiz</label>
                <span>{sanctionPanelLoan.user_name}</span>
              </div>
              <div className="staffloan-sanction-detail-row">
                <label>Tipo</label>
                <span>{sanctionPanelLoan.sanction_type === 'DAYS' ? `${sanctionPanelLoan.sanction_days} día(s) de suspensión` : 'Sanción personalizada'}</span>
              </div>
              <div className="staffloan-sanction-detail-row">
                <label>Descripción</label>
                <p>{sanctionPanelLoan.sanction_description || 'Sin descripción.'}</p>
              </div>
              <div className="staffloan-sanction-detail-row">
                <label>Impuesta</label>
                <span>{sanctionPanelLoan.sanction_created_at ? new Date(sanctionPanelLoan.sanction_created_at).toLocaleString() : '—'}</span>
              </div>
              {!sanctionPanelLoan.sanction_active && (
                <div className="staffloan-sanction-lifted-note">
                  <FiCheckCircle /> Sanción levantada{sanctionPanelLoan.sanction_lifted_at ? ` el ${new Date(sanctionPanelLoan.sanction_lifted_at).toLocaleString()}` : ''}. El aprendiz ya puede reservar.
                </div>
              )}
            </div>
            {sanctionPanelLoan.sanction_active && (
              <div className="staffloan-modal-footer">
                <button className="btn-staffloan-secondary" onClick={() => setSanctionPanelLoan(null)} disabled={liftingSanction}>
                  Cerrar
                </button>
                <button className="btn-staffloan-primary" onClick={() => handleLiftSanction(sanctionPanelLoan)} disabled={liftingSanction}>
                  {liftingSanction ? 'Levantando...' : 'Levantar sanción'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
