import React, { useState, useEffect } from 'react';
import {
  FiUsers, FiUserCheck, FiUserX, FiLock, FiSearch, FiFilter,
  FiEdit2, FiShield, FiPower, FiUnlock, FiEye, FiMoreVertical, FiPlus,
  FiCamera, FiX, FiDownload, FiMaximize, FiTrash2
} from 'react-icons/fi';
import { QRCodeCanvas } from 'qrcode.react';
import { CustomSelect } from './CustomSelect';
import './UserManagement.css';

interface UserStats {
  total: number;
  active: number;
  inactive: number;
  blocked: number;
  by_role: Record<string, number>;
}

interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  is_blocked: boolean;
  last_login: string | null;
  failed_attempts: number;
  created_at: string;
  profile_image?: string;
}

export const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [showRolePanel, setShowRolePanel] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [dependencies, setDependencies] = useState<{id: number, name: string}[]>([]);
  const [showQRModal, setShowQRModal] = useState(false);
  const [userForQR, setUserForQR] = useState<User | null>(null);
  
  // Camera support
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const [newUser, setNewUser] = useState({
    id: '',
    document_type: 'CC',
    name: '',
    email: '',
    phone: '',
    role: 'APRENDIZ',
    dependency_id: '', // Nuevo campo
    password: '',
    formation_ficha: '',
    image_url: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const [uRes, sRes] = await Promise.all([
        fetch(`/api/v1/users_mgmt/?search=${searchTerm}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/v1/users_mgmt/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (uRes.status === 401 || sRes.status === 401) return;

      const uData = await uRes.json();
      const sData = await sRes.json();

      setUsers(Array.isArray(uData) ? uData : []);
      setStats(sData);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (id: string) => {
    try {
      const response = await fetch(`/api/v1/users_mgmt/${id}/toggle-active`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (response.ok) fetchData();
    } catch (error) { console.error(error); }
  };

  const handleUnblock = async (id: string) => {
    try {
      const response = await fetch(`/api/v1/users_mgmt/${id}/unblock`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (response.ok) fetchData();
    } catch (error) { console.error(error); }
  };

  // [TEMPORAL · PRUEBAS] Borrado DEFINITIVO del usuario (y sus registros) de la BD.
  // Para revertir: quitar esta función y el botón de la papelera de la tabla.
  const handleDeleteUser = async (user: User) => {
    const ok = window.confirm(
      `BORRADO DEFINITIVO\n\n` +
      `Vas a eliminar a "${user.name}" (#${user.id}) de la base de datos.\n` +
      `Se borrarán también sus préstamos, reservas, notificaciones e historial.\n` +
      `Esta acción NO se puede deshacer.\n\n¿Continuar?`
    );
    if (!ok) return;
    if (!window.confirm('Confírmalo una vez más: ¿borrar este usuario definitivamente?')) return;
    try {
      const response = await fetch(`/api/v1/users_mgmt/${user.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        alert(data.message || 'Usuario eliminado definitivamente.');
        fetchData();
      } else {
        alert(data.error || 'No se pudo eliminar el usuario.');
      }
    } catch (error) {
      console.error(error);
      alert('Error de conexión.');
    }
  };

  const fetchRolesAndDeps = async () => {
    try {
      const token = localStorage.getItem('token');
      const [rRes, fRes] = await Promise.all([
        fetch('/api/v1/users_mgmt/roles', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/v1/items/filters', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (rRes.ok) setRoles(await rRes.json());
      if (fRes.ok) {
        const fData = await fRes.json();
        setDependencies(fData.dependencies || []);
      }
    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    fetchData();
    fetchRolesAndDeps();
  }, [searchTerm]);

  // Camera Functions
  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { 
      alert('No se pudo acceder a la cámara.'); 
      setShowCamera(false); 
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')!;
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      // Mirror effect
      ctx.translate(canvasRef.current.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoRef.current, 0, 0);
      const photo = canvasRef.current.toDataURL('image/jpeg', 0.7);
      setNewUser(p => ({ ...p, image_url: photo }));
      stopCamera();
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/v1/users_mgmt/', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}` 
        },
        body: JSON.stringify(newUser)
      });
      
      const result = await response.json();
      if (response.ok) {
        setShowCreateModal(false);
        setNewUser({
          id: '', document_type: 'CC', name: '', email: '',
          phone: '', role: 'APRENDIZ', dependency_id: '', password: '', formation_ficha: '', image_url: ''
        });
        fetchData();
        alert('Usuario creado exitosamente');
      } else {
        alert(result.error || 'Error al crear usuario');
      }
    } catch (error) {
      console.error(error);
      alert('Error de conexión');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeRole = async () => {
    if (!selectedUser || !newRole) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/v1/users_mgmt/${selectedUser.id}/change-role`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}` 
        },
        body: JSON.stringify({ role: newRole })
      });
      
      if (response.ok) {
        alert('Rol actualizado correctamente');
        setShowRolePanel(false);
        setShowDetail(false);
        fetchData();
      } else {
        alert('Error al cambiar el rol');
      }
    } catch (error) {
      console.error(error);
      alert('Error de conexión');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const s = searchTerm.toLowerCase();
    const matchesSearch = 
      u.name.toLowerCase().includes(s) || 
      u.email.toLowerCase().includes(s) || 
      (u.phone?.toLowerCase() || '').includes(s) ||
      u.role.toLowerCase().includes(s) ||
      u.id.includes(searchTerm);
    const matchesRole = filterRole === 'ALL' || u.role === filterRole;
    const matchesStatus = 
      filterStatus === 'ALL' || 
      (filterStatus === 'ACTIVE' && u.is_active && !u.is_blocked) ||
      (filterStatus === 'INACTIVE' && !u.is_active) ||
      (filterStatus === 'BLOCKED' && u.is_blocked);
    
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="users-mgmt-container fade-in">
      {/* 1. MÉTRICAS */}
      <div className="users-stats-grid">
        <div className="stat-card">
          <div className="stat-icon total"><FiUsers /></div>
          <div className="stat-info">
            <span className="label">Total Usuarios</span>
            <span className="value">{stats?.total || 0}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon active"><FiUserCheck /></div>
          <div className="stat-info">
            <span className="label">Activos</span>
            <span className="value">{stats?.active || 0}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon inactive"><FiUserX /></div>
          <div className="stat-info">
            <span className="label">Inactivos</span>
            <span className="value">{stats?.inactive || 0}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blocked"><FiLock /></div>
          <div className="stat-info">
            <span className="label">Bloqueados</span>
            <span className="value">{stats?.blocked || 0}</span>
          </div>
        </div>
      </div>

      {/* 2. FILTROS */}
      <div className="users-filters-bar">
        <div className="search-box">
          <FiSearch />
          <input 
            type="text" 
            placeholder="Buscar por nombre, email o ID..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-group-pro">
          <CustomSelect 
            options={[{ id: 'ALL', name: 'Todos los Roles' }, ...(roles || []).map(r => ({ id: r, name: r }))]}
            value={filterRole}
            onChange={setFilterRole}
            icon={<FiShield />}
          />
          <CustomSelect 
            options={[
              { id: 'ALL', name: 'Todos los Estados' },
              { id: 'ACTIVE', name: 'Activos' },
              { id: 'INACTIVE', name: 'Inactivos' },
              { id: 'BLOCKED', name: 'Bloqueados' }
            ]}
            value={filterStatus}
            onChange={setFilterStatus}
            icon={<FiFilter />}
          />
        </div>
        <button className="btn-add-user" onClick={() => setShowCreateModal(true)}>
          <FiPlus /> Nuevo Usuario
        </button>
      </div>

      {/* 3. TABLA PRINCIPAL */}
      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Último Acceso</th>
              <th>Intentos Fallidos</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="td-center">Cargando cuentas...</td></tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state-container" style={{ padding: '4rem 2rem' }}>
                    <FiUsers size={48} style={{ opacity: 0.2 }} />
                    <p>No se encontraron usuarios con los filtros aplicados.</p>
                  </div>
                </td>
              </tr>
            ) : filteredUsers.map(user => (
              <tr key={user.id}>
                <td>
                  <div className="user-profile-cell">
                    <div className="avatar-mini" style={{ overflow: 'hidden' }}>
                      {user.profile_image ? (
                        <img src={user.profile_image} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        user.name ? user.name[0].toUpperCase() : '?'
                      )}
                    </div>
                    <div className="user-info">
                      <span className="name">{user.name}</span>
                      <span className="email">{user.email} <small>(#{user.id})</small></span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span>
                </td>
                <td>
                  {user.is_blocked ? (
                    <span className="status-pill blocked">Bloqueado</span>
                  ) : user.is_active ? (
                    <span className="status-pill active">Activo</span>
                  ) : (
                    <span className="status-pill inactive">Inactivo</span>
                  )}
                </td>
                <td className="user-date-cell">
                  {user.last_login ? new Date(user.last_login).toLocaleString() : 'Nunca'}
                </td>
                <td>
                  <span className={`attempts-badge ${user.failed_attempts > 0 ? 'warning' : ''}`}>
                    {user.failed_attempts}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button className="btn-icon" onClick={() => handleToggleActive(user.id)} title={user.is_active ? "Desactivar" : "Activar"}>
                      <FiPower style={{ color: user.is_active ? '#ef4444' : '#39A900' }} />
                    </button>
                    {user.is_blocked && (
                      <button className="btn-icon" onClick={() => handleUnblock(user.id)} title="Desbloquear">
                        <FiUnlock style={{ color: '#39A900' }} />
                      </button>
                    )}
                    <button className="btn-icon" onClick={() => { setSelectedUser(user); setShowDetail(true); }} title="Ver Detalle">
                      <FiEye />
                    </button>
                    <button className="btn-icon" onClick={() => { setUserForQR(user); setShowQRModal(true); }} title="Generar QR">
                      <FiMaximize />
                    </button>
                    {/* [TEMPORAL · PRUEBAS] Borrado definitivo de la BD */}
                    <button className="btn-icon" onClick={() => handleDeleteUser(user)} title="Borrar definitivamente (pruebas)">
                      <FiTrash2 style={{ color: '#ef4444' }} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 4. MODAL DETALLE (Simplificado) */}
      {showDetail && selectedUser && (
        <div className="user-modal-overlay" onClick={() => setShowDetail(false)}>
          <div className="user-modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Detalle del Usuario</h3>
              <button className="btn-close" onClick={() => setShowDetail(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="profile-header">
                <div className="avatar-large" style={{ overflow: 'hidden' }}>
                  {selectedUser.profile_image ? (
                    <img src={selectedUser.profile_image} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    selectedUser.name ? selectedUser.name[0].toUpperCase() : '?'
                  )}
                </div>
                <h4>{selectedUser.name || 'Sin Nombre'}</h4>
                <span className="role-tag">{selectedUser.role}</span>
              </div>
              <div className="info-grid">
                <div className="info-item"><label>ID Documento</label><span>{selectedUser.id}</span></div>
                <div className="info-item"><label>Email</label><span>{selectedUser.email}</span></div>
                <div className="info-item"><label>Estado Cuenta</label><span>{selectedUser.is_active ? 'Habilitada' : 'Deshabilitada'}</span></div>
                <div className="info-item"><label>Registro</label><span>{new Date(selectedUser.created_at).toLocaleDateString()}</span></div>
              </div>
              <div className="modal-actions-pro">
                {!showRolePanel ? (
                  <button className="btn-pro shield" style={{ width: '100%' }} onClick={() => { setShowRolePanel(true); setNewRole(selectedUser.role); }}>
                    <FiShield /> Gestionar Rol del Usuario
                  </button>
                ) : (
                  <div className="role-change-panel" style={{ width: '100%', animation: 'fadeIn 0.3s ease' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--admin-text-muted)', marginBottom: '0.5rem', display: 'block' }}>Seleccionar Nuevo Rol:</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <CustomSelect 
                        options={(roles || []).map(r => ({ id: r, name: r }))}
                        value={newRole}
                        onChange={setNewRole}
                      />
                      <button className="btn-pro shield" style={{ padding: '0 1.5rem' }} onClick={handleChangeRole} disabled={isSubmitting}>
                        {isSubmitting ? '...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4.5 MODAL QR (Premium) */}
      {showQRModal && userForQR && (
        <div className="user-modal-overlay" onClick={() => setShowQRModal(false)}>
          <div className="user-modal-content qr-modal-pro" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Identificación Digital QR</h3>
              <button className="btn-close" onClick={() => setShowQRModal(false)}>&times;</button>
            </div>
            <div className="modal-body qr-body">
              <div className="qr-container-pro">
                <div className="qr-bg-decoration"></div>
                <QRCodeCanvas 
                  value={JSON.stringify({
                    id: userForQR.id,
                    name: userForQR.name,
                    role: userForQR.role,
                    email: userForQR.email,
                    sys: "BIBLIOTECA_SENA"
                  })}
                  size={200}
                  level="H"
                  includeMargin={true}
                  imageSettings={{
                    src: "https://upload.wikimedia.org/wikipedia/commons/f/f6/Logo_SENA.svg",
                    x: undefined,
                    y: undefined,
                    height: 40,
                    width: 40,
                    excavate: true,
                  }}
                />
              </div>
              
              <div className="qr-user-info">
                <h4>{userForQR.name}</h4>
                <span className="qr-badge">{userForQR.role}</span>
                <p className="qr-id-text">Documento: <strong>{userForQR.id}</strong></p>
              </div>

              <div className="qr-actions-pro">
                <button className="btn-pro shield" onClick={() => window.print()}>
                  <FiDownload /> Imprimir Carnet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showCreateModal && (
        <div className="user-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="user-modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Registrar Nuevo Usuario</h3>
              <button className="btn-close" onClick={() => setShowCreateModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <form className="user-form" onSubmit={handleCreateUser}>
                <div className="form-row">
                  <div className="form-group">
                    <CustomSelect 
                      label="Tipo Documento"
                      options={[
                        { id: 'CC', name: 'Cédula de Ciudadanía' },
                        { id: 'TI', name: 'Tarjeta de Identidad' },
                        { id: 'CE', name: 'Cédula de Extranjería' },
                        { id: 'PEP', name: 'PEP' }
                      ]}
                      value={newUser.document_type}
                      onChange={val => setNewUser({...newUser, document_type: val})}
                    />
                  </div>
                  <div className="form-group">
                    <label>N° Documento</label>
                    <input 
                      type="text" required placeholder="Ej: 1098..."
                      value={newUser.id}
                      onChange={e => setNewUser({...newUser, id: e.target.value})}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Nombre Completo</label>
                  <input 
                    type="text" required placeholder="Nombre y Apellidos"
                    value={newUser.name}
                    onChange={e => setNewUser({...newUser, name: e.target.value})}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Email SENA</label>
                    <input 
                      type="email" required placeholder="correo@soy.sena.edu.co"
                      value={newUser.email}
                      onChange={e => setNewUser({...newUser, email: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label>Teléfono</label>
                    <input 
                      type="text" placeholder="Ej: 310..."
                      value={newUser.phone}
                      onChange={e => setNewUser({...newUser, phone: e.target.value})}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <CustomSelect 
                      label="Rol de Sistema"
                      options={(roles || []).map(r => ({ id: r, name: r }))}
                      value={newUser.role}
                      onChange={val => setNewUser({...newUser, role: val})}
                    />
                  </div>
                  <div className="form-group">
                    <label>Contraseña (Opcional)</label>
                    <input 
                      type="password" placeholder="Por defecto es el Documento"
                      value={newUser.password}
                      onChange={e => setNewUser({...newUser, password: e.target.value})}
                    />
                  </div>
                </div>
                
                {(newUser.role === 'BIBLIOTECARIO' || newUser.role === 'ALMACENISTA') && (
                  <div className="form-group" style={{ animation: 'fadeIn 0.3s ease' }}>
                    <CustomSelect 
                      label="Asignar Dependencia"
                      options={[
                        { id: '', name: 'Seleccionar Dependencia...' },
                        ...dependencies.map(d => ({ id: String(d.id), name: d.name }))
                      ]}
                      value={newUser.dependency_id}
                      onChange={val => setNewUser({...newUser, dependency_id: val})}
                    />
                  </div>
                )}

                {newUser.role === 'APRENDIZ' && (
                  <div className="form-group">
                    <label>Número de Ficha</label>
                    <input 
                      type="text" placeholder="Ej: 2670..."
                      value={newUser.formation_ficha}
                      onChange={e => setNewUser({...newUser, formation_ficha: e.target.value})}
                    />
                  </div>
                )}

                <div className="form-group full-width camera-section-pro">
                  <label>Foto de Perfil</label>
                  <div className="photo-manager-pro">
                    {showCamera ? (
                      <div className="camera-view-pro">
                        <video ref={videoRef} autoPlay playsInline />
                        <div className="camera-controls-pro">
                          <button type="button" onClick={capturePhoto} className="btn-capture-pro"><FiCamera /> Tomar Foto</button>
                          <button type="button" onClick={stopCamera} className="btn-cancel-cam-pro">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="photo-preview-area-pro">
                        <div className="avatar-preview">
                          {newUser.image_url ? (
                            <img src={newUser.image_url} alt="Preview" />
                          ) : (
                            <div className="avatar-placeholder">{newUser.name ? newUser.name[0].toUpperCase() : '?'}</div>
                          )}
                        </div>
                        <div className="photo-actions-pro">
                          <button type="button" onClick={startCamera} className="btn-action-cam-pro"><FiCamera /> Usar Cámara</button>
                          <input 
                            type="text" 
                            placeholder="O pega URL de imagen..." 
                            value={newUser.image_url.startsWith('data:') ? 'Imagen capturada' : newUser.image_url} 
                            onChange={e => setNewUser({ ...newUser, image_url: e.target.value })} 
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>

                <button type="submit" className="btn-submit-pro" disabled={isSubmitting}>
                  {isSubmitting ? 'Registrando...' : 'Crear Usuario'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
