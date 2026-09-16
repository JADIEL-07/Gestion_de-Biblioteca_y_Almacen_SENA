import React, { useState, useEffect, useMemo } from 'react';
import { alertDialog } from '../../../../components/ui/ConfirmDialog';
import { FiBox, FiPlus, FiCheckCircle, FiClock, FiFileText, FiImage, FiSearch } from 'react-icons/fi';
import './SoporteRepuestos.css';

interface SparePart {
  id: number;
  item_name: string;
  item_code: string;
  item_id: number;
  reason: string;
  cost: number;
  supplier: string;
  status: string;
  requested_by_name: string;
  created_at: string;
  received_at: string | null;
  invoice_image: string;
  received_image: string | null;
}

export const SoporteRepuestos: React.FC = () => {
  const [parts, setParts] = useState<SparePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pendientes' | 'recibidos'>('pendientes');

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas las categorías');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Add Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemId, setNewItemId] = useState('');
  const [newReason, setNewReason] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [newInvoiceImage, setNewInvoiceImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Receive Modal State
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receivePart, setReceivePart] = useState<SparePart | null>(null);
  const [receiveImage, setReceiveImage] = useState<string | null>(null);

  const fetchParts = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/spare_parts/', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setParts(await response.json());
      }
    } catch (error) {
      console.error("Error fetching spare parts:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParts();
  }, []);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string | null) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setter(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemId || !newReason || !newCost || !newSupplier || !newInvoiceImage) {
      alertDialog("Por favor, complete todos los campos requeridos, incluyendo la imagen de la factura.");
      return;
    }

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/spare_parts/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          item_id: parseInt(newItemId),
          reason: newReason,
          cost: parseFloat(newCost),
          supplier: newSupplier,
          invoice_image: newInvoiceImage
        })
      });

      if (response.ok) {
        alertDialog("Solicitud de repuesto registrada con éxito.");
        setShowAddModal(false);
        setNewItemId('');
        setNewReason('');
        setNewCost('');
        setNewSupplier('');
        setNewInvoiceImage(null);
        await fetchParts();
      } else {
        const err = await response.json();
        alertDialog(err.error || "Error al registrar la solicitud.");
      }
    } catch (error) {
      console.error("Error submitting spare part:", error);
      alertDialog("Error de conexión al registrar repuesto.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivePart || !receiveImage) {
      alertDialog("Se requiere la imagen del repuesto recibido para confirmar.");
      return;
    }

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/spare_parts/${receivePart.id}/receive`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ received_image: receiveImage })
      });

      if (response.ok) {
        alertDialog("Repuesto marcado como recibido correctamente.");
        setShowReceiveModal(false);
        setReceivePart(null);
        setReceiveImage(null);
        await fetchParts();
      } else {
        const err = await response.json();
        alertDialog(err.error || "Error al actualizar estado.");
      }
    } catch (error) {
      console.error("Error receiving spare part:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const pendingParts = parts.filter(p => p.status === 'PENDING');
  const receivedParts = parts.filter(p => p.status === 'RECEIVED');

  const currentList = useMemo(() => {
    let filtered = activeTab === 'pendientes' ? pendingParts : receivedParts;
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(p => 
        p.item_name.toLowerCase().includes(term) ||
        p.supplier.toLowerCase().includes(term) ||
        p.item_id.toString().includes(term)
      );
    }
    if (dateFrom) {
      filtered = filtered.filter(p => new Date(p.created_at) >= new Date(dateFrom));
    }
    if (dateTo) {
      filtered = filtered.filter(p => new Date(p.created_at) <= new Date(dateTo));
    }
    return filtered;
  }, [parts, activeTab, searchTerm, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('Todas las categorías');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="repuestos-container fade-in">
      <div className="repuestos-header-section">
        <h1>Gestión de Repuestos</h1>
        <p>Administra las solicitudes, costos y recepción de repuestos para los equipos.</p>

        <div className="admin-horizontal-stats">
          <div className="admin-stat-box">
            <div className="admin-stat-icon yellow">
              <FiClock size={22} />
            </div>
            <div className="admin-stat-info">
              <p className="admin-stat-title">PENDIENTES</p>
              <h3 className="admin-stat-value">{pendingParts.length}</h3>
            </div>
          </div>
          <div className="admin-stat-box">
            <div className="admin-stat-icon green">
              <FiCheckCircle size={22} />
            </div>
            <div className="admin-stat-info">
              <p className="admin-stat-title">RECIBIDOS</p>
              <h3 className="admin-stat-value">{receivedParts.length}</h3>
            </div>
          </div>
          <div className="admin-stat-box">
            <div className="admin-stat-icon blue">
              <FiBox size={22} />
            </div>
            <div className="admin-stat-info">
              <p className="admin-stat-title">TOTAL REPUESTOS</p>
              <h3 className="admin-stat-value">{parts.length}</h3>
            </div>
          </div>
        </div>

        {/* FILTERS */}
        <div className="admin-filter-section">
          <div className="admin-filter-row">
            <div className="admin-filter-group flex-2">
              <label>BÚSQUEDA RÁPIDA</label>
              <div className="admin-input-icon">
                <FiSearch className="icon" />
                <input 
                  type="text" 
                  placeholder="Elemento, proveedor o ID..." 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="admin-filter-group flex-1">
              <label>ESTADO DEL REPUESTO</label>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                <option>Todas las categorías</option>
              </select>
            </div>
          </div>
          <div className="admin-filter-row">
            <div className="admin-filter-group flex-1">
              <label>DESDE (FECHA)</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="admin-filter-group flex-1">
              <label>HASTA (FECHA)</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div className="admin-filter-group-btn">
              <button className="admin-btn-clear" onClick={clearFilters}>Limpiar Filtros</button>
            </div>
          </div>
        </div>

        <div className="repuestos-controls">
          <div className="repuestos-tabs">
            <button 
              className={`repuestos-tab-btn ${activeTab === 'pendientes' ? 'active' : ''}`}
              onClick={() => setActiveTab('pendientes')}
            >
              Pendientes
            </button>
            <button 
              className={`repuestos-tab-btn ${activeTab === 'recibidos' ? 'active' : ''}`}
              onClick={() => setActiveTab('recibidos')}
            >
              Recibidos
            </button>
          </div>
          <button className="btn-add-repuesto" onClick={() => setShowAddModal(true)}>
            <FiPlus /> Solicitar Repuesto
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-spinner-container">
          <div className="spinner"></div>
          <p>Cargando repuestos...</p>
        </div>
      ) : currentList.length === 0 ? (
        <div className="repuestos-empty-state">
          <FiBox size={48} />
          <p>No hay repuestos en esta categoría.</p>
        </div>
      ) : (
        <div className="repuestos-table-wrapper">
          <table className="repuestos-table">
            <thead>
              <tr>
                <th>ID Elemento</th>
                <th>Elemento Destino</th>
                <th>Proveedor</th>
                <th>Costo</th>
                <th>Fecha Solicitud</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {currentList.map(part => (
                <tr key={part.id}>
                  <td data-label="ID Elemento">#{part.item_id}</td>
                  <td data-label="Elemento Destino">
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong style={{ color: 'var(--admin-text-primary)' }}>{part.item_name}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-muted)' }}>{part.item_code}</span>
                    </div>
                  </td>
                  <td data-label="Proveedor">{part.supplier}</td>
                  <td data-label="Costo" className="cost-label">
                    ${part.cost.toLocaleString('es-CO')}
                  </td>
                  <td data-label="Fecha Solicitud">{formatDate(part.created_at)}</td>
                  <td data-label="Estado">
                    {part.status === 'PENDING' ? (
                      <span style={{ color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
                        Pendiente
                      </span>
                    ) : (
                      <span style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
                        Recibido
                      </span>
                    )}
                  </td>
                  <td data-label="Acciones">
                    {part.status === 'PENDING' ? (
                      <button 
                        style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => { setReceivePart(part); setShowReceiveModal(true); }}
                      >
                        Marcar Recibido
                      </button>
                    ) : (
                      <span style={{ color: 'var(--admin-text-muted)', fontSize: '0.85rem' }}>
                        Entregado {formatDate(part.received_at!)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ADD MODAL */}
      {showAddModal && (
        <div className="repuestos-modal-overlay" onClick={() => !isSubmitting && setShowAddModal(false)}>
          <div className="repuestos-modal" onClick={e => e.stopPropagation()}>
            <div className="repuestos-modal-header">
              <h3>Solicitar Nuevo Repuesto</h3>
              <button className="btn-close-modal" onClick={() => setShowAddModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleAddSubmit}>
              <div className="repuestos-modal-body">
                <div className="form-group">
                  <label>ID del Elemento a reparar</label>
                  <input type="number" className="form-control" placeholder="Ej: 15" value={newItemId} onChange={e => setNewItemId(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Motivo / Por qué se necesita</label>
                  <textarea className="form-control" rows={3} placeholder="Descripción de la falla y repuesto exacto..." value={newReason} onChange={e => setNewReason(e.target.value)} required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Costo Estimado</label>
                    <input type="number" step="0.01" className="form-control" placeholder="Ej: 50000" value={newCost} onChange={e => setNewCost(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label>Nombre del Proveedor</label>
                    <input type="text" className="form-control" placeholder="Ej: Electrónica SAS" value={newSupplier} onChange={e => setNewSupplier(e.target.value)} required />
                  </div>
                </div>
                <div className="form-group">
                  <label>Evidencia (Recibo, cotización o imagen de solicitud)</label>
                  {!newInvoiceImage ? (
                    <div className="file-upload-box">
                      <input type="file" accept="image/*" onChange={e => handleImageChange(e, setNewInvoiceImage)} required />
                      <FiImage size={28} color="var(--admin-text-muted)" style={{ marginBottom: '0.5rem' }} />
                      <span style={{ color: 'var(--admin-text-secondary)', fontSize: '0.85rem' }}>Haz clic o arrastra una imagen</span>
                    </div>
                  ) : (
                    <div className="photo-preview">
                      <img src={newInvoiceImage} alt="Evidencia" />
                      <button type="button" className="btn-remove-photo" onClick={() => setNewInvoiceImage(null)}>&times;</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="repuestos-modal-footer">
                <button type="button" className="btn-cancel" onClick={() => setShowAddModal(false)} disabled={isSubmitting}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : 'Registrar Repuesto'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECEIVE MODAL */}
      {showReceiveModal && receivePart && (
        <div className="repuestos-modal-overlay" onClick={() => !isSubmitting && setShowReceiveModal(false)}>
          <div className="repuestos-modal" onClick={e => e.stopPropagation()}>
            <div className="repuestos-modal-header">
              <h3>Verificación de Recepción</h3>
              <button className="btn-close-modal" onClick={() => setShowReceiveModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleReceiveSubmit}>
              <div className="repuestos-modal-body">
                <p style={{ color: 'var(--admin-text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Para marcar como recibido el repuesto del elemento <strong>{receivePart.item_name}</strong>, debes adjuntar obligatoriamente una foto del repuesto físico.
                </p>
                <div className="form-group">
                  <label>Fotografía del Repuesto Recibido</label>
                  {!receiveImage ? (
                    <div className="file-upload-box">
                      <input type="file" accept="image/*" onChange={e => handleImageChange(e, setReceiveImage)} required />
                      <FiImage size={28} color="var(--admin-text-muted)" style={{ marginBottom: '0.5rem' }} />
                      <span style={{ color: 'var(--admin-text-secondary)', fontSize: '0.85rem' }}>Subir imagen del repuesto</span>
                    </div>
                  ) : (
                    <div className="photo-preview">
                      <img src={receiveImage} alt="Repuesto Recibido" />
                      <button type="button" className="btn-remove-photo" onClick={() => setReceiveImage(null)}>&times;</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="repuestos-modal-footer">
                <button type="button" className="btn-cancel" onClick={() => setShowReceiveModal(false)} disabled={isSubmitting}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={isSubmitting || !receiveImage}>Confirmar Recepción</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
