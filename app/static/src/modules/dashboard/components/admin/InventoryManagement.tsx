import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  FiSearch, FiPlus, FiDownload, FiEye, FiEdit2, 
  FiMoreVertical, FiX, FiSave, FiCamera, FiRefreshCcw,
  FiTrash2, FiPackage, FiMapPin, FiLayers, FiFilter, FiUpload
} from 'react-icons/fi';
import { CustomSelect } from './CustomSelect';
import { IMAGE_PLACEHOLDER } from '../../../../shared/constants';
import './InventoryManagement.css';

interface Item {
  id: number; name: string; code: string;
  category_id: number; category_name: string;
  status_id: number; status_name: string;
  location_id: number; location_name: string;
  brand: string | null; model: string | null;
  serial_number: string | null; image_url: string | null;
  stock: number; description: string;
  physical_condition?: string;
}
interface FilterData {
  categories: { id: number, name: string }[];
  statuses: { id: number, name: string }[];
  locations: { id: number, name: string }[];
}

const CONDITION_OPTIONS = [
  { id: 'EXCELENTE', name: 'Excelente' },
  { id: 'BUENO', name: 'Bueno' },
  { id: 'REGULAR', name: 'Regular' },
  { id: 'MALO', name: 'Malo' },
];

const emptyForm = {
  name: '', code: '', category_id: '', location_id: '',
  status_id: '', brand: '', model: '', serial_number: '',
  stock: 1, image_url: '', description: '',
  acquisition_date: '', value: '', nit: '',
  physical_condition: 'EXCELENTE'
};

interface InventoryProps {
  activeTab?: 'table' | 'locations' | 'categories';
  user?: any;
}

export const InventoryManagement: React.FC<InventoryProps> = ({ activeTab = 'table', user }) => {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterLocation, setFilterLocation] = useState('ALL');
  const [filters, setFilters] = useState<FilterData>({ categories: [], statuses: [], locations: [] });

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewItem, setViewItem] = useState<Item | null>(null);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  // New Modals for Locations/Categories
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [editLoc, setEditLoc] = useState<{id:number, name:string} | null>(null);
  const [showAddCat, setShowAddCat] = useState(false);
  const [editCat, setEditCat] = useState<{id:number, name:string} | null>(null);
  const [nameInput, setNameInput] = useState('');

  // Camera
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [newItem, setNewItem] = useState({ ...emptyForm });
  const [editForm, setEditForm] = useState({ ...emptyForm });

  const translateStatus = (status: string) => {
    const s = status.toUpperCase();
    const translations: { [key: string]: string } = {
      'AVAILABLE': 'Disponible',
      'DISPONIBLE': 'Disponible',
      'LOANED': 'Prestado',
      'PRESTADO': 'Prestado',
      'MAINTENANCE': 'En Mantenimiento',
      'EN MANTENIMIENTO': 'En Mantenimiento',
      'DAMAGED': 'Dañado',
      'DAÑADO': 'Dañado',
      'IN REPAIR': 'En Reparación',
      'EN REPARACION': 'En Reparación'
    };
    return translations[s] || status;
  };

  const token = () => localStorage.getItem('token');
  const depId = user?.dependency_id;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, target: 'new' | 'edit') => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('La imagen es demasiado grande. Máximo 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        if (target === 'new') setNewItem(p => ({ ...p, image_url: base64String }));
        else setEditForm(p => ({ ...p, image_url: base64String }));
      };
      reader.readAsDataURL(file);
    }
  };

  const fetchData = async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ search: searchTerm, category_id: filterCategory, status_id: filterStatus, location_id: filterLocation });
      if (depId) params.append('dependency_id', String(depId));
      
      const filterParams = new URLSearchParams();
      if (depId) filterParams.append('dependency_id', String(depId));

      const [iRes, fRes] = await Promise.all([
        fetch(`/api/v1/items/?${params}`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`/api/v1/items/filters?${filterParams}`,   { headers: { Authorization: `Bearer ${token()}` } })
      ]);
      if (iRes.ok) { const d = await iRes.json(); setItems(Array.isArray(d) ? d : []); }
      else { setError(`Error ${iRes.status}: No se pudieron cargar los elementos`); setItems([]); }
      if (fRes.ok) {
        const fd = await fRes.json(); 
        setFilters(fd);
        // Inicializar newItem con valores seguros si existen
        if (fd.categories?.length && !newItem.category_id) {
          setNewItem(p => ({ ...p, category_id: String(fd.categories[0].id) }));
        }
        if (fd.locations?.length && !newItem.location_id) {
          setNewItem(p => ({ ...p, location_id: String(fd.locations[0].id) }));
        }
      }
    } catch { setError('Error de conexión.'); setItems([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [searchTerm, filterCategory, filterStatus, filterLocation]);

  // Camera
  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { alert('No se pudo acceder a la cámara.'); setShowCamera(false); }
  };
  const capturePhoto = (target: 'new' | 'edit') => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')!;
      canvasRef.current.width  = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.translate(canvasRef.current.width, 0); ctx.scale(-1, 1);
      ctx.drawImage(videoRef.current, 0, 0);
      const photo = canvasRef.current.toDataURL('image/jpeg', 0.7);
      if (target === 'new') setNewItem(p => ({ ...p, image_url: photo }));
      else setEditForm(p => ({ ...p, image_url: photo }));
      stopCamera();
    }
  };
  const stopCamera = () => {
    if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    setShowCamera(false);
  };

  // Create
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    try {
      const payload = {
        name: newItem.name,
        code: newItem.code,
        category_id: newItem.category_id ? parseInt(newItem.category_id) : undefined,
        location_id: newItem.location_id ? parseInt(newItem.location_id) : undefined,
        // status_id omitted, backend will set default
        stock: newItem.stock ? parseInt(String(newItem.stock)) : 1,
        physical_condition: newItem.physical_condition,
        acquisition_date: newItem.acquisition_date,
        image_url: newItem.image_url,
      };

      const res = await fetch('/api/v1/items/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) { 
        alert('Elemento guardado exitosamente'); 
        setShowAddModal(false); 
        setNewItem({ ...emptyForm, category_id: filters.categories[0]?.id.toString() || '', status_id: filters.statuses[0]?.id.toString() || '', location_id: filters.locations[0]?.id.toString() || '' }); 
        fetchData(); 
      }
      else { 
        const err = await res.json().catch(() => ({ error: 'Error desconocido en el servidor' }));
        alert(`Error: ${err.error || err.detail || 'No se pudo completar el registro'}`); 
      }
    } catch (err) { 
      alert('Error de conexión al servidor: Verifique que la imagen no sea demasiado pesada'); 
    }
    finally { setLoading(false); }
  };

  // Edit
  const openEdit = (item: Item) => {
    setEditItem(item);
    setEditForm({ 
      name: item.name, 
      code: item.code, 
      category_id: String(item.category_id), 
      location_id: String(item.location_id), 
      status_id: String(item.status_id), 
      brand: item.brand || '', 
      model: item.model || '', 
      serial_number: item.serial_number || '', 
      stock: item.stock, 
      image_url: item.image_url || '', 
      description: item.description || '',
      acquisition_date: item.acquisition_date ? new Date(item.acquisition_date).toISOString().split('T')[0] : '',
      value: item.value ? String(item.value) : '',
      nit: item.nit || '',
      physical_condition: item.physical_condition || 'EXCELENTE'
    });
    setMenuOpenId(null);
  };
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editItem) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/items/${editItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ 
          ...editForm, 
          category_id: parseInt(editForm.category_id), 
          location_id: parseInt(editForm.location_id), 
          status_id: parseInt(editForm.status_id), 
          stock: parseInt(String(editForm.stock)) || 0,
          value: editForm.value ? parseFloat(editForm.value) : 0,
          physical_condition: editForm.physical_condition
        })
      });
      if (res.ok) { 
        alert('Elemento actualizado exitosamente'); 
        setEditItem(null); 
        fetchData(); 
      }
      else { 
        const err = await res.json().catch(() => ({ error: 'Error al procesar la respuesta del servidor' }));
        alert(`Error: ${err.error || err.detail || 'Fallo en la actualización'}`); 
      }
    } catch (err) { 
      alert('Error de conexión: Es posible que la imagen sea demasiado pesada o el servidor no responda'); 
    }
    finally { setLoading(false); }
  };

  // Delete
  const handleDelete = async (item: Item) => {
    if (!confirm(`¿Eliminar "${item.name}"? Esta acción no se puede deshacer.`)) return;
    setMenuOpenId(null);
    try {
      const res = await fetch(`/api/v1/items/${item.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
      if (res.ok) { alert('Elemento eliminado'); fetchData(); }
      else { const err = await res.json(); alert(`Error: ${err.error}`); }
    } catch { alert('Error de conexión'); }
  };

  const getStatusClass = (s: string) => { const u = s.toUpperCase(); if (u.includes('DISPONIBLE') || u === 'EXCELENTE' || u === 'BUENO') return 'disponible'; if (u.includes('PRESTADO')) return 'prestado'; if (u.includes('MANTENIMIENTO') || u === 'REGULAR') return 'mantenimiento'; if (u.includes('DAÑADO') || u === 'MALO') return 'dañado'; return ''; };
  const getCatClass   = (c: string) => { const l = c.toLowerCase(); if (l.includes('libro')) return 'libro'; if (l.includes('equipo')) return 'equipo'; if (l.includes('herramienta')) return 'herramienta'; return ''; };

  const buildQRData = (item: Item) =>
    `SENA INVENTARIO\nID: ${item.id}\nNombre: ${item.name}\nCódigo: ${item.code}\nCategoría: ${item.category_name}\nEstado: ${item.status_name}\nUbicación: ${item.location_name}\nStock: ${item.stock}\nMarca: ${item.brand || 'N/A'}\nModelo: ${item.model || 'N/A'}\nSerial: ${item.serial_number || 'N/A'}`;

  // CRUD for Locations
  const handleSaveLoc = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editLoc ? `/api/v1/items/locations/${editLoc.id}` : '/api/v1/items/locations';
    const method = editLoc ? 'PUT' : 'POST';
    const bodyPayload: any = { name: nameInput };
    if (!editLoc && depId) bodyPayload.dependency_id = depId;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(bodyPayload)
      });
      if (res.ok) { fetchData(); setShowAddLoc(false); setEditLoc(null); setNameInput(''); }
      else { 
        const errData = await res.json();
        const msg = errData.error || errData.msg || errData.message || 'Detalle no disponible';
        alert(`Error ${res.status}: ${msg}`); 
      }
    } catch (err) { alert('Error de conexión o formato al guardar ubicación'); }
  };

  const handleDeleteLoc = async (id: number) => {
    if (!confirm('¿Eliminar esta ubicación?')) return;
    try {
      const res = await fetch(`/api/v1/items/locations/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
      if (res.ok) fetchData();
      else alert('No se puede eliminar: tiene elementos asociados');
    } catch { alert('Error de conexión'); }
  };

  // CRUD for Categories
  const handleSaveCat = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editCat ? `/api/v1/items/categories/${editCat.id}` : '/api/v1/items/categories';
    const method = editCat ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ name: nameInput })
      });
      if (res.ok) { fetchData(); setShowAddCat(false); setEditCat(null); setNameInput(''); }
      else { 
        const errData = await res.json();
        const msg = errData.error || errData.msg || errData.message || 'Detalle no disponible';
        alert(`Error ${res.status}: ${msg}`); 
      }
    } catch (err) { alert('Error de conexión o formato al guardar categoría'); }
  };

  const handleDeleteCat = async (id: number) => {
    if (!confirm('¿Eliminar esta categoría?')) return;
    try {
      const res = await fetch(`/api/v1/items/categories/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
      if (res.ok) fetchData();
      else alert('No se puede eliminar: tiene elementos asociados');
    } catch { alert('Error de conexión'); }
  };

  if (activeTab === 'locations') {
    const filteredLocs = filters.locations.filter(l => l.name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return (
      <div className="inventory-management">
        <div className="inventory-toolbar">
          <div className="toolbar-left">
            <div className="search-container-pro">
              <FiSearch className="search-icon" />
              <input type="text" placeholder="Buscar ubicación..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
          </div>
          <div className="toolbar-right">
            <button className="btn-add-pro" onClick={() => { setNameInput(''); setEditLoc(null); setShowAddLoc(true); }}><FiPlus /> Nueva Ubicación</button>
          </div>
        </div>
        
        <div className="inventory-table-container">
          {filteredLocs.length === 0 ? (
            <div className="empty-state-container">
              <FiMapPin className="empty-state-icon" />
              <div className="empty-state-text">
                <h3>No se encontraron ubicaciones</h3>
                <p>Intenta con otro término o crea una nueva ubicación.</p>
              </div>
            </div>
          ) : (
            <table className="inventory-table">
              <thead><tr><th>ID</th><th>Nombre</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Acciones</th></tr></thead>
              <tbody>
                {filteredLocs.map(loc => (
                  <tr key={loc.id}>
                    <td>{loc.id}</td>
                    <td><strong>{loc.name}</strong></td>
                    <td><span className="cat-badge equipo">INTERNO</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="actions-cell" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn-action-inv" title="Editar" onClick={() => { setEditLoc(loc); setNameInput(loc.name); setShowAddLoc(true); }}><FiEdit2 /></button>
                        <button className="btn-action-inv danger" title="Eliminar" onClick={() => handleDeleteLoc(loc.id)}><FiTrash2 /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {/* ... modal ... */}
        
        {(showAddLoc || editLoc) && (
          <div className="inv-modal-overlay">
            <div className="inv-modal mini-modal">
              <div className="inv-modal-header">
                <h3>{editLoc ? 'Editar' : 'Nueva'} Ubicación</h3>
                <button className="btn-close" onClick={() => { setShowAddLoc(false); setEditLoc(null); }}><FiX /></button>
              </div>
              <form onSubmit={handleSaveLoc} className="inv-form">
                <div className="form-group">
                  <label>Nombre de la Ubicación</label>
                  <input required type="text" value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="Ej: Pasillo A, Estante 3..." />
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn-submit">Guardar</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'categories') {
    const filteredCats = filters.categories.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
      <div className="inventory-management">
        <div className="inventory-toolbar">
          <div className="toolbar-left">
            <div className="search-container-pro">
              <FiSearch className="search-icon" />
              <input type="text" placeholder="Buscar categoría..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
          </div>
          <div className="toolbar-right">
            <button className="btn-add-pro" onClick={() => { setNameInput(''); setEditCat(null); setShowAddCat(true); }}><FiPlus /> Nueva Categoría</button>
          </div>
        </div>
        
        <div className="inventory-table-container">
          {filteredCats.length === 0 ? (
            <div className="empty-state-container">
              <FiLayers className="empty-state-icon" />
              <div className="empty-state-text">
                <h3>No se encontraron categorías</h3>
                <p>Intenta con otro término o crea una nueva categoría.</p>
              </div>
            </div>
          ) : (
            <table className="inventory-table">
              <thead><tr><th>ID</th><th>Nombre de Categoría</th><th style={{ textAlign: 'right' }}>Acciones</th></tr></thead>
              <tbody>
                {filteredCats.map(cat => (
                  <tr key={cat.id}>
                    <td>{cat.id}</td>
                    <td><strong>{cat.name}</strong></td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="actions-cell" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn-action-inv" title="Editar" onClick={() => { setEditCat(cat); setNameInput(cat.name); setShowAddCat(true); }}><FiEdit2 /></button>
                        <button className="btn-action-inv danger" title="Eliminar" onClick={() => handleDeleteCat(cat.id)}><FiTrash2 /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {/* ... modal ... */}

        {(showAddCat || editCat) && (
          <div className="inv-modal-overlay">
            <div className="inv-modal mini-modal">
              <div className="inv-modal-header">
                <h3>{editCat ? 'Editar' : 'Nueva'} Categoría</h3>
                <button className="btn-close" onClick={() => { setShowAddCat(false); setEditCat(null); }}><FiX /></button>
              </div>
              <form onSubmit={handleSaveCat} className="inv-form">
                <div className="form-group">
                  <label>Nombre de la Categoría</label>
                  <input required type="text" value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="Ej: Libros, Equipos, Consumibles..." />
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn-submit">Guardar</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="inventory-management" onClick={() => menuOpenId && setMenuOpenId(null)}>
      {/* TOOLBAR */}
      <div className="inventory-toolbar">
        <div className="toolbar-left">
          <button className="btn-refresh-pro" onClick={fetchData} title="Recargar"><FiRefreshCcw /></button>
          <div className="search-container-pro">
            <FiSearch className="search-icon" />
            <input type="text" placeholder="Buscar por nombre, código..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <CustomSelect 
            options={[{ id: 'ALL', name: 'Categoría: Todas' }, ...(filters.categories || [])]}
            value={filterCategory}
            onChange={setFilterCategory}
            icon={<FiLayers />}
          />
          <CustomSelect 
            options={[{ id: 'ALL', name: 'Estado: Todos' }, ...(filters.statuses || [])]}
            value={filterStatus}
            onChange={setFilterStatus}
            icon={<FiFilter />}
          />
        </div>
        <div className="toolbar-right">
          <button className="btn-icon-pro"><FiDownload /> <span>Exportar</span></button>
          <button className="btn-add-pro" onClick={() => setShowAddModal(true)}><FiPlus /> Nuevo Elemento</button>
        </div>
      </div>

      {/* TABLE */}
      <div className="inventory-table-container">
        <table className="inventory-table">
          <thead><tr>
            <th className="col-id">ID</th>
            <th className="col-code">Código</th>
            <th>Nombre del Elemento</th>
            <th className="col-cat">Categoría</th>
            <th className="col-brand">Marca / Modelo</th>
            <th className="col-loc">Ubicación</th>
            <th className="col-stock">Stock</th>
            <th>Estado</th>
            <th style={{ textAlign: 'right' }}>Acciones</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>⏳ Cargando inventario...</td></tr>
            ) : error ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: '#ef4444' }}>⚠️ {error}</td></tr>
            ) : items.length === 0 ? null : items.map(item => (
              <tr key={item.id}>
                <td className="col-id">{item.id}</td>
                <td className="col-code">
                  <div className="item-profile-cell">
                    <img src={item.image_url || IMAGE_PLACEHOLDER} alt={item.name} className="item-thumb" onError={e => { e.currentTarget.src = IMAGE_PLACEHOLDER; }} />
                    <div className="item-main-info">
                      <strong>{item.code}</strong>
                      <small>{item.serial_number || 'S/N'}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="item-name-cell">
                    <strong>{item.name}</strong>
                    <small className="mobile-only">{item.category_name} | {item.code}</small>
                  </div>
                </td>
                <td className="col-cat"><span className={`cat-badge ${getCatClass(item.category_name)}`}>{item.category_name}</span></td>
                <td className="col-brand"><div className="item-main-info"><strong>{item.brand || 'Genérico'}</strong><small>{item.model || 'N/A'}</small></div></td>
                <td className="col-loc">{item.location_name}</td>
                <td className="col-stock"><strong>{item.stock}</strong></td>
                <td><span className={`status-pill-inv ${getStatusClass(item.status_name)}`}>{translateStatus(item.status_name)}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div className="actions-cell" style={{ justifyContent: 'flex-end' }}>
                    <div className="dropdown-wrapper" onClick={e => e.stopPropagation()}>
                      <button className="btn-action-inv" title="Más opciones" onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}><FiMoreVertical /></button>
                      {menuOpenId === item.id && (
                        <div className="dropdown-menu">
                          <button onClick={() => { setViewItem(item); setMenuOpenId(null); }}><FiEye /> Ver / QR</button>
                          <button onClick={() => openEdit(item)}><FiEdit2 /> Editar</button>
                          <button className="danger" onClick={() => handleDelete(item)}><FiTrash2 /> Eliminar</button>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL VER / QR */}
      {viewItem && (
        <div className="inv-modal-overlay" onClick={() => setViewItem(null)}>
          <div className="inv-modal inv-modal-view" onClick={e => e.stopPropagation()}>
            <div className="inv-modal-header">
              <h3><FiPackage /> Detalle del Elemento</h3>
              <button className="btn-close" onClick={() => setViewItem(null)}><FiX /></button>
            </div>
            <div className="inv-view-body">
              <div className="inv-view-left">
                <img src={viewItem.image_url || IMAGE_PLACEHOLDER} alt={viewItem.name} className="inv-view-img" onError={e => { e.currentTarget.src = IMAGE_PLACEHOLDER; }} />
                <div className="qr-container">
                  <QRCodeSVG value={buildQRData(viewItem)} size={160} bgColor="transparent" fgColor="#39a900" level="M" />
                  <small>Escanear para ver info</small>
                </div>
              </div>
              <div className="inv-view-right">
                <h2>{viewItem.name}</h2>
                <table className="detail-table">
                  <tbody>
                    <tr><td>ID</td><td><strong>#{viewItem.id}</strong></td></tr>
                    <tr><td>Código</td><td><strong>{viewItem.code}</strong></td></tr>
                    <tr><td>Categoría</td><td><span className={`cat-badge ${getCatClass(viewItem.category_name)}`}>{viewItem.category_name}</span></td></tr>
                    <tr><td>Estado</td><td><span className={`status-pill-inv ${getStatusClass(viewItem.status_name)}`}>{translateStatus(viewItem.status_name)}</span></td></tr>
                    <tr><td>Ubicación</td><td>{viewItem.location_name}</td></tr>
                    <tr><td>Stock</td><td><strong>{viewItem.stock}</strong></td></tr>
                    <tr><td>Marca</td><td>{viewItem.brand || '—'}</td></tr>
                    <tr><td>Modelo</td><td>{viewItem.model || '—'}</td></tr>
                    <tr><td>N° Serie / ISBN</td><td>{viewItem.serial_number || '—'}</td></tr>
                    {viewItem.description && <tr><td>Descripción</td><td>{viewItem.description}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR */}
      {editItem && (
        <div className="inv-modal-overlay">
          <div className="inv-modal" onClick={e => e.stopPropagation()}>
            <div className="inv-modal-header">
              <h3><FiEdit2 /> Editar Elemento — {editItem.name}</h3>
              <button className="btn-close" onClick={() => { stopCamera(); setEditItem(null); }}><FiX /></button>
            </div>
            <form onSubmit={handleEdit} className="inv-form">
              <div className="form-grid">
                <div className="form-group"><label>Nombre</label><input required type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></div>
                <div className="form-group"><label>Código / Referencia</label><input type="text" value={editForm.code} onChange={e => setEditForm({ ...editForm, code: e.target.value })} placeholder="Auto-generado si se deja vacío" /></div>
                <div className="form-group">
                  <CustomSelect 
                    label="Categoría"
                    options={filters.categories || []}
                    value={editForm.category_id}
                    onChange={val => setEditForm({ ...editForm, category_id: String(val) })}
                  />
                </div>
                <div className="form-group">
                  <CustomSelect 
                    label="Estado"
                    options={filters.statuses || []}
                    value={editForm.status_id}
                    onChange={val => setEditForm({ ...editForm, status_id: String(val) })}
                  />
                </div>
                <div className="form-group">
                  <CustomSelect 
                    label="Condición Física"
                    options={CONDITION_OPTIONS}
                    value={editForm.physical_condition}
                    onChange={val => setEditForm({ ...editForm, physical_condition: String(val) })}
                  />
                </div>
                <div className="form-group">
                  <CustomSelect 
                    label="Ubicación"
                    options={filters.locations || []}
                    value={editForm.location_id}
                    onChange={val => setEditForm({ ...editForm, location_id: String(val) })}
                  />
                </div>
                <div className="form-group"><label>Stock</label><input type="number" min="0" value={editForm.stock} onChange={e => setEditForm({ ...editForm, stock: e.target.value })} /></div>
                <div className="form-group"><label>Marca</label><input type="text" value={editForm.brand} onChange={e => setEditForm({ ...editForm, brand: e.target.value })} /></div>
                <div className="form-group"><label>Modelo</label><input type="text" value={editForm.model} onChange={e => setEditForm({ ...editForm, model: e.target.value })} /></div>
                <div className="form-group"><label>N° Serie / ISBN</label><input type="text" value={editForm.serial_number} onChange={e => setEditForm({ ...editForm, serial_number: e.target.value })} /></div>
                <div className="form-group"><label>Fecha Adquisición</label><input required type="date" value={editForm.acquisition_date} onChange={e => setEditForm({ ...editForm, acquisition_date: e.target.value })} /></div>
                <div className="form-group"><label>Valor Unitario</label><input type="number" step="0.01" value={editForm.value} onChange={e => setEditForm({ ...editForm, value: e.target.value })} /></div>
                <div className="form-group"><label>NIT / Proveedor</label><input type="text" value={editForm.nit} onChange={e => setEditForm({ ...editForm, nit: e.target.value })} /></div>
                <div className="form-group full-width"><label>Descripción / Observaciones</label><textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} placeholder="Detalles adicionales del elemento..." rows={3} /></div>
                <div className="form-group full-width camera-section">
                  <label>Imagen del Material</label>
                  <div className="photo-manager">
                    {showCamera ? (
                      <div className="camera-view">
                        <video ref={videoRef} autoPlay playsInline />
                        <div className="camera-controls">
                          <button type="button" onClick={() => capturePhoto('edit')} className="btn-capture"><FiCamera /> Tomar Foto</button>
                          <button type="button" onClick={stopCamera} className="btn-cancel-cam">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="photo-preview-area">
                        <img src={editForm.image_url || IMAGE_PLACEHOLDER} alt="Vista previa" onError={e => { e.currentTarget.src = IMAGE_PLACEHOLDER; }} />
                        <div className="photo-actions">
                          <button type="button" onClick={startCamera} className="btn-action-cam"><FiCamera /> Usar Cámara</button>
                          <input type="file" accept="image/*" style={{ display: 'none' }} id="file-upload-edit" onChange={e => handleFileUpload(e, 'edit')} />
                          <button type="button" onClick={() => document.getElementById('file-upload-edit')?.click()} className="btn-action-cam"><FiUpload /> Subir Archivo</button>
                          <input type="text" placeholder="O pega URL de imagen..." value={editForm.image_url.startsWith('data:') ? 'Imagen capturada' : editForm.image_url} onChange={e => setEditForm({ ...editForm, image_url: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => { stopCamera(); setEditItem(null); }}>Cancelar</button>
                <button type="submit" className="btn-submit"><FiSave /> Guardar Cambios</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL NUEVO ELEMENTO */}
      {showAddModal && (
        <div className="inv-modal-overlay">
          <div className="inv-modal" onClick={e => e.stopPropagation()}>
            <div className="inv-modal-header">
              <h3><FiPlus /> Registrar Nuevo Elemento</h3>
              <button className="btn-close" onClick={() => { stopCamera(); setShowAddModal(false); }}><FiX /></button>
            </div>
            <form onSubmit={handleCreate} className="inv-form">
              <div className="form-grid">
                <div className="form-group"><label>Nombre del Elemento</label><input required type="text" value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} /></div>
                <div className="form-group"><label>Código / Referencia</label><input type="text" value={newItem.code} onChange={e => setNewItem({ ...newItem, code: e.target.value })} placeholder="Auto-generado si se deja vacío" /></div>
                <div className="form-group full-width camera-section">
                  <label>Imagen del Material</label>
                  <div className="photo-manager">
                    {showCamera ? (
                      <div className="camera-view">
                        <video ref={videoRef} autoPlay playsInline />
                        <div className="camera-controls">
                          <button type="button" onClick={() => capturePhoto('new')} className="btn-capture"><FiCamera /> Tomar Foto</button>
                          <button type="button" onClick={stopCamera} className="btn-cancel-cam">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="photo-preview-area">
                        <img src={newItem.image_url || IMAGE_PLACEHOLDER} alt="Vista previa" onError={e => { e.currentTarget.src = IMAGE_PLACEHOLDER; }} />
                        <div className="photo-actions">
                          <button type="button" onClick={startCamera} className="btn-action-cam"><FiCamera /> Usar Cámara</button>
                          <input type="file" accept="image/*" style={{ display: 'none' }} id="file-upload-new" onChange={e => handleFileUpload(e, 'new')} />
                          <button type="button" onClick={() => document.getElementById('file-upload-new')?.click()} className="btn-action-cam"><FiUpload /> Subir Archivo</button>
                          <input type="text" placeholder="O pega URL de imagen..." value={newItem.image_url.startsWith('data:') ? 'Imagen capturada' : newItem.image_url} onChange={e => setNewItem({ ...newItem, image_url: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>

                <div className="form-group"><label>Stock Inicial</label><input type="number" min="0" required value={newItem.stock} onChange={e => setNewItem({ ...newItem, stock: e.target.value })} /></div>
                <div className="form-group">
                  <CustomSelect 
                    label="Condición Física"
                    options={CONDITION_OPTIONS}
                    value={newItem.physical_condition}
                    onChange={val => setNewItem({ ...newItem, physical_condition: String(val) })}
                  />
                </div>
                <div className="form-group">
                  <CustomSelect 
                    label="Categoría"
                    options={filters.categories || []}
                    value={newItem.category_id}
                    onChange={val => setNewItem({ ...newItem, category_id: String(val) })}
                  />
                </div>
                <div className="form-group">
                  <CustomSelect 
                    label="Ubicación"
                    options={filters.locations || []}
                    value={newItem.location_id}
                    onChange={val => setNewItem({ ...newItem, location_id: String(val) })}
                  />
                </div>
                <div className="form-group"><label>Fecha Adquisición</label><input required type="date" value={newItem.acquisition_date} onChange={e => setNewItem({ ...newItem, acquisition_date: e.target.value })} /></div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => { stopCamera(); setShowAddModal(false); }}>Cancelar</button>
                <button type="submit" className="btn-submit"><FiSave /> Guardar Elemento</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
