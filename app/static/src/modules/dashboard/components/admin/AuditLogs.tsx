import React, { useState, useEffect } from 'react';
import {
  FiShield, FiRefreshCw, FiSearch, FiCalendar, FiUser,
  FiEye, FiFilter, FiActivity, FiGlobe, FiPlus, FiTrash2
} from 'react-icons/fi';
import { CustomSelect } from './CustomSelect';
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

type ActionCategory = 'login' | 'insert' | 'update' | 'delete' | 'security';

interface ActionMeta {
  label: string;
  category: ActionCategory;
  describe: (log: AuditLog) => string;
}

const who = (log: AuditLog) => log.user || 'Un usuario del sistema';
const named = (log: AuditLog) => log.entity_name ? `"${log.entity_name}"` : (log.entity_id ? `el registro #${log.entity_id}` : 'el registro');

// Cada acción que puede quedar en audit_logs tiene aquí su propia etiqueta
// (para el badge/pill) y su propia descripción narrativa (para el modal de
// detalle) — antes esa descripción se adivinaba con unos pocos `includes()`
// genéricos y la mayoría de acciones caían en un mensaje de relleno poco
// concreto. El backend (ver ACTION_BUCKETS en audit_routes.py) usa las
// MISMAS 5 categorías que `category` aquí — si se agrega una acción nueva
// hay que sumarla en los dos lugares.
const ACTION_META: Record<string, ActionMeta> = {
  // ── Inicios de sesión ──────────────────────────────────────────────
  LOGIN_SUCCESS: { label: 'Inicio de sesión', category: 'login',
    describe: log => `${who(log)} inició sesión correctamente desde la IP ${log.ip}.` },
  LOGIN_SUCCESS_2FA: { label: 'Inicio de sesión (2FA)', category: 'login',
    describe: log => `${who(log)} completó la verificación en dos pasos e inició sesión desde la IP ${log.ip}.` },
  LOGIN_SUCCESS_DEVICE: { label: 'Inicio de sesión (dispositivo nuevo)', category: 'login',
    describe: log => `${who(log)} autorizó un dispositivo nuevo desde el enlace del correo e inició sesión desde la IP ${log.ip}.` },
  LOGIN_FAILED: { label: 'Contraseña incorrecta', category: 'login',
    describe: log => `Se intentó iniciar sesión con la contraseña incorrecta en la cuenta de ${who(log)}, desde la IP ${log.ip}.` },
  LOGIN_FAILED_NO_USER: { label: 'Usuario inexistente', category: 'login',
    describe: log => `Se intentó iniciar sesión con un número de documento que no existe en el sistema, desde la IP ${log.ip}.` },
  LOGIN_ON_DELETED: { label: 'Intento sobre cuenta eliminada', category: 'login',
    describe: log => `Se intentó iniciar sesión en la cuenta de ${who(log)}, que ya fue eliminada, desde la IP ${log.ip}.` },
  LOGIN_BLOCKED_SHADOW_ACCOUNT: { label: 'Bloqueo: cuenta de prueba', category: 'login',
    describe: log => `Se intentó iniciar sesión directamente en una cuenta "sombra" (de prueba, solo para el modo "Ver como otro rol") — el sistema lo bloqueó, desde la IP ${log.ip}.` },
  LOGIN_INACTIVE: { label: 'Cuenta inactiva', category: 'login',
    describe: log => `${who(log)} intentó iniciar sesión pero su cuenta está desactivada, desde la IP ${log.ip}.` },
  LOGIN_BLOCKED_PERMANENT: { label: 'Cuenta bloqueada', category: 'login',
    describe: log => `${who(log)} intentó iniciar sesión pero su cuenta está bloqueada por seguridad, desde la IP ${log.ip}.` },
  LOGOUT: { label: 'Cierre de sesión', category: 'login',
    describe: log => `${who(log)} cerró sesión.` },

  // ── Creaciones ──────────────────────────────────────────────────────
  ACCOUNT_VERIFIED_AND_CREATED: { label: 'Cuenta verificada y creada', category: 'insert',
    describe: log => `${who(log)} verificó su correo y completó el registro de su cuenta.` },
  ACCOUNT_PROMOTED_FROM_PENDING: { label: 'Registro pendiente rescatado', category: 'insert',
    describe: log => `Se creó la cuenta de ${who(log)} a partir de un registro que había quedado pendiente, sin volver a pedir el código de verificación.` },
  USER_CREATED: { label: 'Usuario creado', category: 'insert',
    describe: log => `${who(log)} registró un nuevo usuario en el sistema.` },
  ITEM_CREATED: { label: 'Elemento agregado', category: 'insert',
    describe: log => `${who(log)} agregó ${named(log)} al inventario.` },
  CATEGORY_CREATED: { label: 'Categoría creada', category: 'insert',
    describe: log => `${who(log)} creó la categoría ${named(log)}.` },
  LOCATION_CREATED: { label: 'Ubicación creada', category: 'insert',
    describe: log => `${who(log)} creó la ubicación ${named(log)}.` },
  RESERVATION_CREATED: { label: 'Reserva creada', category: 'insert',
    describe: log => `${who(log)} reservó ${named(log)}.` },
  MAINTENANCE_CREATED: { label: 'Reporte de mantenimiento', category: 'insert',
    describe: log => `${who(log)} reportó una falla en ${named(log)} y lo envió a mantenimiento.` },
  SPARE_PART_CREATED: { label: 'Solicitud de repuesto', category: 'insert',
    describe: log => `${who(log)} solicitó un repuesto para ${named(log)}.` },
  SALIDA_CREATED: { label: 'Salida registrada', category: 'insert',
    describe: log => `${who(log)} registró una salida controlada de ${named(log)}.` },
  LOAN_CREATED: { label: 'Préstamo creado', category: 'insert',
    describe: log => `${who(log)} entregó en préstamo ${named(log)}.` },
  INSERT: { label: 'Registro creado', category: 'insert',
    describe: log => `Se creó un nuevo registro en "${log.entity}" (${named(log)}).` },

  // ── Ediciones ───────────────────────────────────────────────────────
  PROFILE_UPDATED: { label: 'Perfil actualizado', category: 'update',
    describe: log => `${who(log)} actualizó los datos de su perfil personal.` },
  PROFILE_IMAGE_UPDATED: { label: 'Foto de perfil actualizada', category: 'update',
    describe: log => `${who(log)} actualizó su foto de perfil.` },
  ROLE_CHANGED: { label: 'Rol cambiado', category: 'update',
    describe: log => `${who(log)} cambió el rol de un usuario.` },
  EMAIL_CHANGED: { label: 'Correo actualizado', category: 'update',
    describe: log => `${who(log)} cambió el correo vinculado a su cuenta.` },
  ITEM_UPDATED: { label: 'Elemento editado', category: 'update',
    describe: log => `${who(log)} editó los datos de ${named(log)}.` },
  CATEGORY_UPDATED: { label: 'Categoría editada', category: 'update',
    describe: log => `${who(log)} editó la categoría ${named(log)}.` },
  LOCATION_UPDATED: { label: 'Ubicación editada', category: 'update',
    describe: log => `${who(log)} editó la ubicación ${named(log)}.` },
  RESERVATION_APPROVED: { label: 'Reserva → Préstamo', category: 'update',
    describe: log => `${who(log)} aprobó la reserva de ${named(log)} y generó un préstamo.` },
  MAINTENANCE_STATUS_UPDATED: { label: 'Estado de mantenimiento', category: 'update',
    describe: log => `${who(log)} cambió el estado del mantenimiento de ${named(log)}.` },
  MAINTENANCE_COMPLETED: { label: 'Mantenimiento completado', category: 'update',
    describe: log => `${who(log)} marcó como completado el mantenimiento de ${named(log)}.` },
  SPARE_PART_RECEIVED: { label: 'Repuesto recibido', category: 'update',
    describe: log => `${who(log)} marcó como recibido el repuesto de ${named(log)}.` },
  USER_DEACTIVATED: { label: 'Usuario desactivado', category: 'update',
    describe: log => `${who(log)} desactivó la cuenta de un usuario.` },
  USER_REACTIVATED: { label: 'Usuario reactivado', category: 'update',
    describe: log => `${who(log)} reactivó la cuenta de un usuario.` },
  USER_UNBLOCKED: { label: 'Usuario desbloqueado', category: 'update',
    describe: log => `${who(log)} desbloqueó manualmente una cuenta.` },
  LOAN_RETURNED: { label: 'Préstamo devuelto', category: 'update',
    describe: log => `${who(log)} registró la devolución de ${named(log)}.` },
  LOAN_SANCTION_LIFTED: { label: 'Sanción levantada', category: 'update',
    describe: log => `${who(log)} levantó la sanción asociada a un préstamo.` },
  SALIDA_RETURNED: { label: 'Salida devuelta', category: 'update',
    describe: log => `${who(log)} registró el regreso de una salida controlada.` },
  SALIDA_CLOSED: { label: 'Salida cerrada', category: 'update',
    describe: log => `${who(log)} cerró una salida controlada.` },
  TOS_ACCEPTED: { label: 'Términos aceptados', category: 'update',
    describe: log => `${who(log)} aceptó los Términos y Condiciones actualizados.` },
  UPDATE: { label: 'Registro editado', category: 'update',
    describe: log => `Se editó un registro en "${log.entity}" (${named(log)}).` },

  // ── Eliminaciones ───────────────────────────────────────────────────
  USER_HARD_DELETED: { label: 'Usuario eliminado', category: 'delete',
    describe: log => `${who(log)} eliminó permanentemente la cuenta de un usuario y sus datos asociados.` },
  ACCOUNT_DELETED: { label: 'Cuenta eliminada', category: 'delete',
    describe: log => `${who(log)} eliminó su propia cuenta.` },
  ITEM_DELETED: { label: 'Elemento eliminado', category: 'delete',
    describe: log => `${who(log)} eliminó ${named(log)} del inventario (su historial de préstamos y reservas se conserva).` },
  CATEGORY_DELETED: { label: 'Categoría eliminada', category: 'delete',
    describe: log => `${who(log)} eliminó la categoría ${named(log)}.` },
  LOCATION_DELETED: { label: 'Ubicación eliminada', category: 'delete',
    describe: log => `${who(log)} eliminó la ubicación ${named(log)}.` },
  RESERVATION_CANCELLED: { label: 'Reserva cancelada', category: 'delete',
    describe: log => `${who(log)} canceló la reserva de ${named(log)}.` },
  DELETE: { label: 'Registro eliminado', category: 'delete',
    describe: log => `Se eliminó un registro de "${log.entity}" (${named(log)}).` },

  // ── Seguridad / Bloqueos ────────────────────────────────────────────
  USER_BLOCKED_AUTO: { label: 'Bloqueo automático', category: 'security',
    describe: log => `El sistema bloqueó automáticamente la cuenta de ${who(log)} tras varios intentos fallidos de inicio de sesión.` },
  CHANGE_PASSWORD_FAILED: { label: 'Cambio de contraseña fallido', category: 'security',
    describe: log => `${who(log)} intentó cambiar su contraseña, pero la contraseña actual ingresada era incorrecta.` },
  PASSWORD_RESET_REQUEST: { label: 'Recuperación solicitada', category: 'security',
    describe: log => `Se solicitó un enlace de recuperación de contraseña para la cuenta de ${who(log)}.` },
  PASSWORD_RESET_SUCCESS: { label: 'Contraseña recuperada', category: 'security',
    describe: log => `${who(log)} restableció su contraseña usando el enlace de recuperación enviado por correo.` },
  PASSWORD_CHANGED: { label: 'Contraseña cambiada', category: 'security',
    describe: log => `${who(log)} cambió su contraseña desde Configuración.` },
  PASSWORD_CHANGED_FORCED: { label: 'Cambio de contraseña forzado', category: 'security',
    describe: log => `${who(log)} cambió su contraseña porque el sistema se lo exigió, tras una recuperación.` },
  TRUSTED_DEVICE_FORGOTTEN: { label: 'Dispositivo olvidado', category: 'security',
    describe: log => `${who(log)} eliminó un dispositivo de su lista de dispositivos de confianza.` },
  TRUSTED_DEVICES_CLEARED: { label: 'Dispositivos borrados', category: 'security',
    describe: log => `${who(log)} eliminó todos sus dispositivos de confianza; el próximo inicio de sesión en cada uno volverá a pedir autorización.` },
  DEVICE_APPROVAL_SENT: { label: 'Correo de autorización enviado', category: 'security',
    describe: log => `Se envió un correo a ${who(log)} para autorizar el inicio de sesión desde un dispositivo nuevo.` },
  DEVICE_APPROVED: { label: 'Dispositivo autorizado', category: 'security',
    describe: log => `${who(log)} autorizó un dispositivo nuevo desde el enlace enviado por correo.` },
  '2FA_EMAIL_SENT': { label: 'Código 2FA enviado', category: 'security',
    describe: log => `Se envió un código de verificación en dos pasos al correo de ${who(log)}.` },
  '2FA_AUTHENTICATOR_GENERATED': { label: 'Authenticator generado', category: 'security',
    describe: log => `${who(log)} generó (o regeneró) el código para vincular una app autenticadora (Google Authenticator u otra).` },
  LOAN_NOT_RETURNED: { label: 'Préstamo no devuelto', category: 'security',
    describe: log => `${who(log)} marcó un préstamo como no devuelto y aplicó la sanción correspondiente.` },
};

const IMPERSONATE_PREFIX = 'IMPERSONATE_START:';

function actionMeta(action: string): ActionMeta {
  if (action.startsWith(IMPERSONATE_PREFIX)) {
    const role = action.slice(IMPERSONATE_PREFIX.length) || 'otro rol';
    return {
      label: 'Simulación de rol',
      category: 'security',
      describe: log => `${who(log)} entró en modo "Ver como" para probar el sistema como ${role}.`,
    };
  }
  return ACTION_META[action] || {
    label: action.replace(/_/g, ' '),
    category: 'update',
    describe: log => `Se registró la acción "${log.action}" sobre ${named(log)} en el módulo de ${log.entity}.`,
  };
}

const ACTION_TYPE_OPTIONS = [
  { id: 'ALL', name: 'Todas las acciones' },
  { id: 'LOGIN', name: 'Inicios de sesión' },
  { id: 'INSERT', name: 'Creaciones (Nuevos)' },
  { id: 'UPDATE', name: 'Ediciones (Cambios)' },
  { id: 'DELETE', name: 'Eliminaciones' },
  { id: 'SECURITY', name: 'Seguridad / Bloqueos' },
];

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

  const getActionClass = (action: string) => actionMeta(action).category;
  const getActionLabel = (action: string) => actionMeta(action).label;

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
            <CustomSelect
              label="TIPO DE ACCIÓN"
              icon={<FiActivity />}
              options={ACTION_TYPE_OPTIONS}
              value={actionType}
              onChange={(v) => setActionType(String(v))}
            />
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
              <th className="col-id col-center">ID</th>
              <th className="col-date col-center">Fecha / Hora</th>
              <th>Usuario / Rol</th>
              <th className="col-center">Acción</th>
              <th className="col-entity">Entidad / Recurso</th>
              <th className="col-ip col-center">IP Origen</th>
              <th className="col-center">Detalles</th>
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
                  <td className="col-id col-center"><span className="id-badge">#{log.id}</span></td>
                  <td className="col-date col-center">
                    <div className="audit-date-cell">
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
                  <td className="col-center">
                    <span className={`action-pill ${getActionClass(log.action)}`} title={log.action}>
                      {getActionLabel(log.action)}
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
                              log.entity === 'categories' ? 'Categoría' :
                              log.entity === 'locations' ? 'Ubicación' :
                              log.entity === 'spare_parts' ? 'Repuesto' :
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
                  {getActionClass(selectedLog.action) === 'insert' && <FiPlus />}
                  {getActionClass(selectedLog.action) === 'update' && <FiRefreshCw />}
                  {getActionClass(selectedLog.action) === 'delete' && <FiTrash2 />}
                  {getActionClass(selectedLog.action) === 'login' && <FiUser />}
                  {getActionClass(selectedLog.action) === 'security' && <FiShield />}
                </span>
                <div className="header-text">
                  <h3>Detalle de {getActionLabel(selectedLog.action)}</h3>
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
                  <p>{actionMeta(selectedLog.action).describe(selectedLog)}</p>
                </div>

                {/* EXPLICACIÓN DETALLADA DE CAMBIOS (Resumen Narrativo Inteligente) */}
                {selectedLog.details && getActionClass(selectedLog.action) !== 'login' && (
                  <div className="smart-changes-narrative">
                    {(() => {
                      // 1. Diccionario de traducciones
                      const fieldMap: Record<string, string> = {
                        'last_login': 'Último Acceso al Sistema',
                        'failed_attempts': 'Intentos de Inicio Fallidos',
                        'is_active': 'Estado de Activación',
                        'is_blocked': 'Estado de Bloqueo de Seguridad',
                        'role': 'Rol del Usuario',
                        'name': 'Nombre',
                        'email': 'Correo Electrónico',
                        'phone': 'Teléfono',
                        'formation_ficha': 'Ficha de Formación',
                        'code': 'Código (QR/Barras)',
                        'description': 'Descripción',
                        'brand': 'Marca',
                        'model': 'Modelo',
                        'serial_number': 'Número de Serie',
                        'stock': 'Stock',
                        'physical_condition': 'Estado Físico',
                        'status_id': 'Estado (ID)',
                        'location_id': 'Ubicación (ID)',
                        'category_id': 'Categoría (ID)',
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
