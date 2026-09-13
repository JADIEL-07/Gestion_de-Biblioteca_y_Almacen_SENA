import React, { useState, useEffect } from 'react';
import { 
  FiShield, FiRefreshCw, FiSearch, FiCalendar, FiUser, 
  FiEye, FiFilter, FiActivity, FiGlobe, FiPlus
} from 'react-icons/fi';
import './AuditLogs.css';

interface AuditLog {
  id: number;
  user: string;
  user_id: string | null;
  user_email: string | null;
  user_phone: string | null;
  user_role: string | null;
  action: string;
  entity: string;
  entity_id: number;
  entity_name: string | null;
  ip: string;
  user_agent: string;
  details: string | null;
  created_at: string;
}

export const AuditLogs: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [actionType, setActionType] = useState('ALL');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (actionType && actionType !== 'ALL') params.append('action_type', actionType);

      const response = await fetch(`/api/v1/audit/?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (!response.ok) {
        if (response.status === 403) throw new Error("Acceso denegado: Se requieren permisos de administrador.");
        throw new Error(`Error ${response.status}: No se pudo cargar la auditoría.`);
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        setLogs(data);
      } else {
        setLogs([]);
      }
    } catch (error: any) {
      console.error('Error fetching audit:', error);
      setError(error.message || "Error al conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchLogs();
    }, 400); // 400ms de espera antes de buscar
    return () => clearTimeout(timeoutId);
  }, [searchTerm, startDate, endDate, actionType]);

  const getActionClass = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('LOGIN')) return 'login';
    if (act.includes('INSERT')) return 'insert';
    if (act.includes('UPDATE')) return 'update';
    if (act.includes('DELETE')) return 'delete';
    if (act.includes('SECURITY')) return 'security';
    return '';
  };

  // Ya no filtramos localmente porque el backend ya lo hace, 
  // pero mantenemos la variable para no romper el resto del componente
  // y agregamos seguridad ante valores nulos por si acaso.
  const filteredLogs = logs.filter(log => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    
    return (
      (log.user?.toLowerCase() || '').includes(s) || 
      (log.user_email?.toLowerCase() || '').includes(s) || 
      (log.user_id?.toLowerCase() || '').includes(s) || 
      (log.user_phone?.toLowerCase() || '').includes(s) || 
      (log.action?.toLowerCase() || '').includes(s) || 
      (log.entity?.toLowerCase() || '').includes(s) ||
      (log.ip?.toLowerCase() || '').includes(s) ||
      (log.details?.toLowerCase() || '').includes(s) ||
      log.id.toString().includes(searchTerm)
    );
  });

  return (
    <div className="audit-management fade-in">
      <div className="audit-header">
        <div className="header-title">
          <div className="header-icon-box"><FiShield /></div>
          <div>
            <h1>Auditoría del Sistema</h1>
          </div>
        </div>
      </div>

      {/* BARRA DE FILTROS COMPLEJA */}
      <div className="loan-filters-complex audit-filters">
        <div className="filter-row">
          <div className="filter-item search">
            <label>BÚSQUEDA GLOBAL</label>
            <div className="input-with-icon">
              <FiSearch />
              <input 
                type="text" 
                placeholder="Usuario, acción, ID..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="filter-item btn-refresh-col">
            <label>ACTUALIZAR</label>
            <button className="btn-refresh-audit" onClick={fetchLogs}>
              <FiRefreshCw className={loading ? 'spin' : ''} /> <span>Refrescar Log</span>
            </button>
          </div>
        </div>

        <div className="filter-row second-row">
          <div className="filter-item date-filter">
            <label>DESDE</label>
            <div className="input-with-icon">
              <FiCalendar />
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>
          <div className="filter-item date-filter">
            <label>HASTA</label>
            <div className="input-with-icon">
              <FiCalendar />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="filter-item type-filter">
            <label>TIPO DE ACCIÓN</label>
            <div className="input-with-icon">
              <FiActivity />
              <select 
                className="audit-type-select"
                value={actionType} 
                onChange={(e) => setActionType(e.target.value)}
              >
                <option value="ALL">Todas las acciones</option>
                <option value="LOGIN">Inicios de sesión</option>
                <option value="INSERT">Creaciones (Nuevos)</option>
                <option value="UPDATE">Ediciones (Cambios)</option>
                <option value="DELETE">Eliminaciones</option>
                <option value="SECURITY">Seguridad / Bloqueos</option>
              </select>
            </div>
          </div>
          <div className="filter-item-actions">
            <button className="btn-reset-audit" onClick={() => {
              setSearchTerm(''); setStartDate(''); setEndDate(''); setActionType('ALL');
            }}>Limpiar</button>
          </div>
        </div>
      </div>

      {/* TABLA DE AUDITORÍA */}
      <div className="audit-table-wrapper responsive-table">
        <table className="audit-table">
          <thead>
            <tr>
              <th className="col-id">ID</th>
              <th className="col-date">Fecha / Hora</th>
              <th>Usuario / Rol</th>
              <th>Acción</th>
              <th className="col-entity">Entidad / Recurso</th>
              <th className="col-ip">IP Origen</th>
              <th style={{ textAlign: 'center' }}>Detalles</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="loading-cell">Escaneando registros en tiempo real...</td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="no-data-cell" style={{ color: '#ef4444' }}>{error}</td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state-container" style={{ padding: '5rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', color: 'var(--admin-text-muted)' }}>
                    <FiActivity size={48} style={{ opacity: 0.2 }} />
                    <p>No se encontraron registros para los filtros seleccionados.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredLogs.map(log => (
                <tr key={log.id}>
                  <td className="col-id"><span className="id-badge">#{log.id}</span></td>
                  <td className="col-date">
                    <div className="date-cell">
                      <strong>{new Date(log.created_at).toLocaleDateString()}</strong>
                      <small>{new Date(log.created_at).toLocaleTimeString()}</small>
                    </div>
                  </td>
                  <td>
                    <div className="user-info-cell">
                      <span className="u-name">{log.user || 'SISTEMA'}</span>
                      <span className="u-role">{log.user_role || 'SISTEMA'}</span>
                      <span className="u-id-label">ID: {log.user_id || '—'}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`action-pill ${getActionClass(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="col-entity">
                    <div className="entity-info-cell">
                      {(!log.entity || log.entity === '—') ? (
                        <span className="entity-main-name">Null</span>
                      ) : (
                        <>
                          <span className="entity-main-name">{log.entity_name || log.entity}</span>
                          <div className="entity-sub-info">
                            <span className="entity-type-badge">{
                              log.entity === 'items' ? 'Inventario' :
                              log.entity === 'users' ? 'Usuario' :
                              log.entity === 'loans' ? 'Préstamo' :
                              log.entity === 'reservations' ? 'Reserva' :
                              log.entity === 'maintenance' ? 'Mantenimiento' :
                              log.entity.toUpperCase()
                            }</span>
                            <span className="entity-id-tag">ID: {log.entity_id || 'Null'}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="col-ip">
                    <div className="ip-badge"><FiGlobe /> {log.ip}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn-detail" onClick={() => setSelectedLog(log)} title="Ver Detalle">
                      <FiEye />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL DETALLE VISUAL (Human Readable) */}
      {selectedLog && (
        <div className="audit-modal-overlay" onClick={() => setSelectedLog(null)}>
          <div className="audit-modal-pro" onClick={e => e.stopPropagation()}>
            <div className="modal-header-pro">
              <div className="header-status">
                <span className={`status-icon-box ${getActionClass(selectedLog.action)}`}>
                  {selectedLog.action.includes('INSERT') && <FiPlus />}
                  {selectedLog.action.includes('UPDATE') && <FiRefreshCw />}
                  {selectedLog.action.includes('DELETE') && <FiActivity />}
                  {selectedLog.action.includes('LOGIN') && <FiUser />}
                </span>
                <div className="header-text">
                  <h3>Detalle de {selectedLog.action}</h3>
                  <p>ID Transacción: #{selectedLog.id} • {new Date(selectedLog.created_at).toLocaleString()}</p>
                </div>
              </div>
              <button className="btn-close-pro" onClick={() => setSelectedLog(null)}>&times;</button>
            </div>

            <div className="modal-body-pro">
              {/* Resumen del Actor (Ahora arriba) */}
              <div className="audit-summary-card">
                <div className="summary-item">
                  <FiUser className="item-icon" />
                  <div>
                    <label>Realizado por</label>
                    <span>{selectedLog.user || 'Sistema'}</span>
                  </div>
                </div>
                <div className="summary-item">
                  <FiGlobe className="item-icon" />
                  <div>
                    <label>Dirección IP</label>
                    <span>{selectedLog.ip}</span>
                  </div>
                </div>
              </div>

              {/* Detalle de los cambios */}
              <div className="audit-changes-container">
                <h4>Resumen Narrativo de la Operación</h4>

                {/* NARRATIVA NATURAL ESPECÍFICA (Ahora integrada en el detalle) */}
                <div className="audit-narrative-box">
                  <FiActivity className="narrative-icon" />
                  <p>{(() => {
                    const action = selectedLog.action.toUpperCase();
                    const entityMap: Record<string, string> = {
                      'items': 'un artículo del inventario',
                      'users': 'un perfil de usuario',
                      'loans': 'un registro de préstamo',
                      'reservations': 'una reserva de material',
                      'maintenance': 'un reporte de mantenimiento'
                    };
                    const entity = entityMap[selectedLog.entity] || `un registro en ${selectedLog.entity}`;
                    const name = selectedLog.entity_name || `ID #${selectedLog.entity_id}`;

                    if (action.includes('INSERT')) {
                      return `El administrador ${selectedLog.user} ha registrado un elemento nuevo: "${name}" con el Identificador ID: ${selectedLog.entity_id}.`;
                    }
                    if (action.includes('UPDATE')) {
                      return `Se realizó una actualización de datos en ${entity} ("${name}"). El administrador revisó y modificó atributos específicos para mantener la información al día.`;
                    }
                    if (action.includes('DELETE')) {
                      return `Se ha procedido con la eliminación definitiva de ${entity} ("${name}"). Esta acción es irreversible y el recurso ya no forma parte del inventario activo.`;
                    }
                    if (action === 'LOGIN_SUCCESS' || action === 'LOGIN') {
                      return `El usuario ${selectedLog.user} ha iniciado sesión en la plataforma de manera exitosa desde un dispositivo identificado.`;
                    }
                    if (action === 'LOGIN_FAILED') {
                      return `ALERTA DE SEGURIDAD: Se registró un intento de acceso fallido a la cuenta de "${selectedLog.user}". El sistema ha denegado el ingreso para proteger la integridad del perfil.`;
                    }
                    if (action === 'LOGOUT') {
                      return `El usuario ${selectedLog.user} ha finalizado su sesión de manera segura, cerrando el acceso activo al panel administrativo.`;
                    }
                    if (action.includes('SECURITY')) {
                      return `ACCIÓN DE PROTECCIÓN: Se ha ejecutado un protocolo de seguridad sobre ${entity} ("${name}"). Esto ocurre generalmente por bloqueos preventivos tras múltiples errores.`;
                    }
                    return `Se registró la acción "${selectedLog.action}" sobre el recurso "${name}" en el módulo de ${selectedLog.entity}.`;
                  })()}</p>
                </div>

                {/* EXPLICACIÓN DETALLADA DE CAMBIOS (Resumen Narrativo Inteligente) */}
                {selectedLog.details && !['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'LOGIN'].includes(selectedLog.action.toUpperCase()) && (
                  <div className="smart-changes-narrative">
                    {(() => {
                      // 1. Diccionario de traducciones
                      const fieldMap: Record<string, string> = {
                        'last_login': 'Último Acceso al Sistema',
                        'failed_attempts': 'Intentos de Inicio Fallidos',
                        'is_active': 'Estado de Activación',
                        'is_blocked': 'Estado de Bloqueo de Seguridad',
                        'role': 'Rol del Usuario',
                        'name': 'Nombre Completo',
                        'email': 'Correo Electrónico',
                        'phone': 'Teléfono',
                        'formation_ficha': 'Ficha de Formación'
                      };

                      // 2. Formateador ultra-seguro
                      const safeFormat = (val: any): string => {
                        if (val === null || val === undefined || val === '—' || val === 'None') return 'Sin registrar';
                        if (typeof val === 'boolean') return val ? 'Activado' : 'Desactivado';
                        if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
                          try { 
                            const d = new Date(val);
                            return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                          } catch { return val; }
                        }
                        if (val && typeof val === 'object' && val.from !== undefined) {
                          return `Cambió de [${safeFormat(val.from)}] a [${safeFormat(val.to)}]`;
                        }
                        return String(val);
                      };

                      try {
                        const rawData = JSON.parse(selectedLog.details);
                        const items: React.ReactNode[] = [];
                        
                        // A. SIEMPRE MOSTRAR IDENTIDAD AL INICIO
                        items.push(
                          <div className="smart-narrative-item identity" key="id-header">
                            • <strong>Identificador del Registro (ID):</strong> <span className="new-v">#{selectedLog.entity_id || 'Nuevo'}</span>
                          </div>
                        );
                        if (selectedLog.entity_name) {
                          items.push(
                            <div className="smart-narrative-item identity" key="name-header">
                              • <strong>Nombre del Recurso:</strong> <span className="new-v">"{selectedLog.entity_name}"</span>
                            </div>
                          );
                        }

                        // B. PROCESAR CAMBIOS (Diferenciando UPDATE de INSERT)
                        const isInsert = selectedLog.action.toUpperCase().includes('INSERT');

                        if (rawData.old || rawData.new) {
                          // Caso Estándar: Objeto con old/new (UPDATE)
                          const keys = Array.from(new Set([...Object.keys(rawData.old || {}), ...Object.keys(rawData.new || {})]))
                            .filter(k => !['updated_at', 'password', 'id', 'created_at'].includes(k));
                          
                          keys.forEach(k => {
                            const label = fieldMap[k] || k.replace(/_/g, ' ').toUpperCase();
                            items.push(
                              <div className="smart-narrative-item" key={k}>
                                • El campo <strong>{label}</strong> se actualizó de <span className="old-v">"{safeFormat(rawData.old?.[k])}"</span> a <span className="new-v">"{safeFormat(rawData.new?.[k])}"</span>.
                              </div>
                            );
                          });
                        } else if (typeof rawData === 'object' && rawData !== null) {
                          // Caso INSERT o Detalles Planos
                          Object.entries(rawData).forEach(([k, v]) => {
                            if (['updated_at', 'password', 'id', 'created_at'].includes(k)) return;
                            const label = fieldMap[k] || k.replace(/_/g, ' ').toUpperCase();
                            items.push(
                              <div className="smart-narrative-item" key={k}>
                                • Se registró el valor inicial para <strong>{label}</strong>: <span className="new-v">"{safeFormat(v)}"</span>.
                              </div>
                            );
                          });
                        }

                        return items;
                      } catch (err) {
                        return <div className="error-parse">El detalle contiene información en formato técnico básico: {selectedLog.details}</div>;
                      }
                    })()}
                  </div>
                )}
              </div>
            </div>
            
            <div className="modal-footer-pro">
              <button className="btn-close-modal" onClick={() => setSelectedLog(null)}>Cerrar Detalle</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
