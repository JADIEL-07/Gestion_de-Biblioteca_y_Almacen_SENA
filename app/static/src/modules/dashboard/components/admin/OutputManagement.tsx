import React, { useState, useEffect } from 'react';
import { 
  FiSearch, FiPlus, FiRefreshCcw, FiExternalLink, 
  FiRotateCcw, FiCheckCircle, FiX, FiAlertTriangle, FiUser, FiCalendar
} from 'react-icons/fi';
import './OutputManagement.css';

interface Output {
  id: number;
  item_id: number;
  item_name: string;
  item_code: string;
  user_id: string;
  user_name: string;
  type: string;
  status: string;
  destination: string;
  description: string;
  reason_code: string;
  created_at: string;
  estimated_return_date: string | null;
  actual_return_date: string | null;
}

interface ItemSummary {
  id: number;
  name: string;
  code: string;
  status_name: string;
}

export const OutputManagement: React.FC = () => {
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Form State
  const [itemsSearch, setItemsSearch] = useState<ItemSummary[]>([]);
  const [searchingItems, setSearchingItems] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemSummary | null>(null);
  const [formData, setFormData] = useState({
    tipo_salida: 'MAINTENANCE',
    destino: '',
    descripcion: '',
    fecha_retorno_estimada: '',
    reason_code: 'TRASLADO'
  });

  const token = () => localStorage.getItem('token');

  const fetchOutputs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ search: searchTerm, status: filterStatus });
      const res = await fetch(`/api/v1/outputs/?${params}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (res.ok) {
        const data = await res.json();
        setOutputs(data);
      }
    } catch (err) {
      console.error("Error fetching outputs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutputs();
  }, [searchTerm, filterStatus]);

  const searchItems = async (term: string) => {
    if (term.length < 2) {
      setItemsSearch([]);
      return;
    }
    setSearchingItems(true);
    try {
      const res = await fetch(`/api/v1/items/?search=${term}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Solo mostrar items disponibles
        setItemsSearch(data.filter((i: any) => i.status_name === 'AVAILABLE'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearchingItems(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) {
      alert("Debes seleccionar un elemento");
      return;
    }
    
    try {
      const res = await fetch('/api/v1/outputs/', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}` 
        },
        body: JSON.stringify({
          item_id: selectedItem.id,
          ...formData
        })
      });
      
      if (res.ok) {
        alert("Salida registrada correctamente");
        setShowAddModal(false);
        setSelectedItem(null);
        fetchOutputs();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      alert("Error al conectar con el servidor");
    }
  };

  const handleReturn = async (id: number) => {
    if (!confirm("¿Registrar el retorno de este elemento?")) return;
    
    try {
      const res = await fetch(`/api/v1/outputs/${id}/return`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}` 
        },
        body: JSON.stringify({ condicion: 'BUENO' })
      });
      
      if (res.ok) {
        fetchOutputs();
      }
    } catch (err) {
      alert("Error al procesar retorno");
    }
  };

  const handleClose = async (id: number) => {
    if (!confirm("¿Cerrar esta salida de forma permanente? Esto cambiará el estado final del elemento.")) return;
    
    try {
      const res = await fetch(`/api/v1/outputs/${id}/close`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}` }
      });
      
      if (res.ok) {
        fetchOutputs();
      }
    } catch (err) {
      alert("Error al cerrar salida");
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: any = {
      'MAINTENANCE': 'Mantenimiento',
      'TRANSFER': 'Traslado',
      'DISPOSAL': 'Disposición Final',
      'INTERNAL_USE': 'Uso Interno'
    };
    return labels[type] || type;
  };

  const getStatusLabel = (status: string) => {
    const labels: any = {
      'ACTIVE': 'Activa',
      'RETURNED': 'Retornada',
      'CLOSED': 'Cerrada'
    };
    return labels[status] || status;
  };

  const isDelayed = (output: Output) => {
    if (output.status !== 'ACTIVE' || !output.estimated_return_date) return false;
    return new Date(output.estimated_return_date) < new Date();
  };

  return (
    <div className="output-management">
      <div className="output-toolbar">
        <div className="toolbar-left">
          <button className="btn-action" onClick={fetchOutputs} title="Actualizar"><FiRefreshCcw /></button>
          <div className="search-container-pro">
            <FiSearch className="search-icon" />
            <input 
              type="text" 
              placeholder="Buscar por elemento, código o destino..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select 
            className="filter-select-pro"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="ALL">Todos los Estados</option>
            <option value="ACTIVE">Activas</option>
            <option value="RETURNED">Retornadas</option>
            <option value="CLOSED">Cerradas</option>
          </select>
        </div>
        <button className="btn-add-pro" onClick={() => setShowAddModal(true)}>
          <FiPlus /> Registrar Salida
        </button>
      </div>

      <div className="output-table-container">
        <table className="output-table">
          <thead>
            <tr>
              <th>Elemento</th>
              <th>Tipo</th>
              <th>Destino / Motivo</th>
              <th>Responsable</th>
              <th>Fechas</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '4rem' }}>⏳ Cargando salidas...</td></tr>
            ) : outputs.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '4rem' }}>No se encontraron registros de salida.</td></tr>
            ) : outputs.map(output => (
              <tr key={output.id}>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ color: '#39a900' }}>{output.item_name}</strong>
                    <small style={{ color: '#64748b' }}>{output.item_code}</small>
                  </div>
                </td>
                <td>
                  <span className={`type-badge type-${output.type.toLowerCase()}`}>
                    {getTypeLabel(output.type)}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>{output.destination || '—'}</span>
                    <small style={{ color: '#64748b' }}>{output.reason_code}</small>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <FiUser size={14} />
                    <span>{output.user_name}</span>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                    <span>Salida: {new Date(output.created_at).toLocaleDateString()}</span>
                    {output.estimated_return_date && (
                      <span style={{ color: isDelayed(output) ? '#ef4444' : '#94a3b8' }}>
                        Retorno: {new Date(output.estimated_return_date).toLocaleDateString()}
                        {isDelayed(output) && <span className="delay-alert"><FiAlertTriangle /> Retrasado</span>}
                      </span>
                    )}
                    {output.actual_return_date && (
                       <span style={{ color: '#39a900' }}>Retornado: {new Date(output.actual_return_date).toLocaleDateString()}</span>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`status-pill status-${output.status.toLowerCase()}`}>
                    {getStatusLabel(output.status)}
                  </span>
                </td>
                <td>
                  <div className="actions-cell">
                    {output.status === 'ACTIVE' && output.type !== 'DISPOSAL' && (
                      <button 
                        className="btn-action return" 
                        title="Marcar Retorno"
                        onClick={() => handleReturn(output.id)}
                      >
                        <FiRotateCcw />
                      </button>
                    )}
                    {output.status === 'ACTIVE' && (
                      <button 
                        className="btn-action close" 
                        title="Cerrar Salida Permanentemente"
                        onClick={() => handleClose(output.id)}
                      >
                        <FiCheckCircle />
                      </button>
                    )}
                    <button className="btn-action" title="Ver Detalle"><FiExternalLink /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL AGREGAR */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><FiPlus /> Nueva Salida Controlada</h3>
              <button className="btn-close" onClick={() => setShowAddModal(false)}><FiX /></button>
            </div>
            <form className="modal-form" onSubmit={handleCreate}>
              <div className="form-grid">
                
                {/* Selector de Item */}
                <div className="form-group full" style={{ position: 'relative' }}>
                  <label>Buscar Elemento (Solo Disponibles)</label>
                  <div className="search-container-pro" style={{ maxWidth: '100%' }}>
                    <FiSearch className="search-icon" />
                    <input 
                      type="text" 
                      placeholder="Escribe nombre o código del ítem..."
                      onChange={(e) => searchItems(e.target.value)}
                    />
                  </div>
                  
                  {searchingItems && <div style={{ position: 'absolute', right: '1rem', top: '2.5rem', color: '#39a900' }}>⏳</div>}
                  
                  {itemsSearch.length > 0 && (
                    <div style={{ 
                      position: 'absolute', top: '100%', left: 0, right: 0, 
                      background: 'var(--admin-bg-card)', border: '1px solid var(--admin-border-color)', borderRadius: '12px',
                      zIndex: 10, marginTop: '5px', maxHeight: '200px', overflowY: 'auto'
                    }}>
                      {itemsSearch.map(item => (
                        <div 
                          key={item.id}
                          style={{ padding: '0.8rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--admin-border-color)' }}
                          onClick={() => { setSelectedItem(item); setItemsSearch([]); }}
                        >
                          <strong>{item.name}</strong> - <small>{item.code}</small>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedItem && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', background: '#39a90022', border: '1px solid #39a90044', borderRadius: '8px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Seleccionado: <strong>{selectedItem.name} ({selectedItem.code})</strong></span>
                      <FiCheckCircle color="#39a900" />
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Tipo de Salida</label>
                  <select 
                    value={formData.tipo_salida}
                    onChange={(e) => setFormData({...formData, tipo_salida: e.target.value})}
                  >
                    <option value="MAINTENANCE">Mantenimiento</option>
                    <option value="TRANSFER">Traslado</option>
                    <option value="INTERNAL_USE">Uso Interno</option>
                    <option value="DISPOSAL">Disposición Final (Baja)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Motivo / Código</label>
                  <select 
                    value={formData.reason_code}
                    onChange={(e) => setFormData({...formData, reason_code: e.target.value})}
                  >
                    <option value="DAÑO">Daño / Falla</option>
                    <option value="TRASLADO">Traslado de Sede</option>
                    <option value="EVENTO">Evento Externo</option>
                    <option value="OBSOLETO">Obsolescencia</option>
                    <option value="PERDIDA">Pérdida / Robo</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Destino / Entidad</label>
                  <input 
                    type="text" 
                    placeholder="Ej: Servicio técnico, Sede Norte..."
                    value={formData.destino}
                    onChange={(e) => setFormData({...formData, destino: e.target.value})}
                  />
                </div>

                <div className="form-group">
                  <label>Fecha Retorno Estimada</label>
                  <input 
                    type="date" 
                    value={formData.fecha_retorno_estimada}
                    onChange={(e) => setFormData({...formData, fecha_retorno_estimada: e.target.value})}
                  />
                </div>

                <div className="form-group full">
                  <label>Descripción Detallada</label>
                  <textarea 
                    rows={3}
                    placeholder="Detalles adicionales sobre la salida..."
                    value={formData.descripcion}
                    onChange={(e) => setFormData({...formData, descripcion: e.target.value})}
                  />
                </div>

                <div className="form-actions">
                  <button type="button" className="btn-cancel" onClick={() => setShowAddModal(false)}>Cancelar</button>
                  <button type="submit" className="btn-submit">Registrar Salida</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
