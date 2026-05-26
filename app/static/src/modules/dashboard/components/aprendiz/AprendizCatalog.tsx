import React, { useState, useEffect } from 'react';
import { 
  FiSearch, FiFilter, FiPackage, FiMapPin, FiInfo, 
  FiArrowLeft, FiGrid, FiList, FiBook, FiCpu, FiTool,
  FiMaximize, FiBookmark, FiChevronDown, FiCalendar,
  FiChevronLeft, FiChevronRight, FiX, FiCheckCircle
} from 'react-icons/fi';
import { MdQrCodeScanner } from 'react-icons/md';
import { QRCodeCanvas } from 'qrcode.react';
import { CustomSelect } from '../admin/CustomSelect';
import './AprendizCatalog.css';

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

interface FilterData {
  categories: { id: number, name: string }[];
  statuses: { id: number, name: string }[];
  dependencies: { id: number, name: string }[];
}

interface AprendizCatalogProps {
  isGuest?: boolean;
}

export const AprendizCatalog: React.FC<AprendizCatalogProps> = ({ isGuest = false }) => {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterDependency, setFilterDependency] = useState('ALL');
  const [filters, setFilters] = useState<FilterData>({ categories: [], statuses: [], dependencies: [] });
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [showQRView, setShowQRView] = useState(false);
  const [isDark, setIsDark] = useState(!document.body.classList.contains('theme-light'));
  const [scannerStarted, setScannerStarted] = useState(false);
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    if (scannerStarted) {
      import('html5-qrcode').then(({ Html5Qrcode }) => {
        setTimeout(() => {
          if (!scannerRef.current) {
            scannerRef.current = new Html5Qrcode("qr-reader-catalog");
          }
          const config = { fps: 10, qrbox: { width: 250, height: 250 } };
          
          scannerRef.current.start(
            { facingMode: "environment" },
            config,
            (decodedText: string) => {
              setSearchTerm(decodedText);
              setScannerStarted(false);
              scannerRef.current?.stop().catch(console.error);
            },
            () => {}
          ).catch((err: any) => {
            console.error(err);
            alert("No se pudo iniciar la cámara. Verifica los permisos.");
            setScannerStarted(false);
          });
        }, 100);
      });
    }

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [scannerStarted]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(!document.body.classList.contains('theme-light'));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);



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

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        search: searchTerm,
        category_id: filterCategory === 'ALL' ? '' : filterCategory,
        dependency_id: filterDependency === 'ALL' ? '' : filterDependency
      });

      const [iRes, fRes] = await Promise.all([
        fetch(`/api/v1/items/?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/v1/items/filters', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (iRes.ok) {
        const data = await iRes.json();
        setItems(Array.isArray(data) ? data : []);
      }
      if (fRes.ok) {
        const fData = await fRes.json();
        setFilters(fData);
      }
    } catch (error) {
      console.error('Error fetching catalog:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(delayDebounce);
  }, [searchTerm, filterCategory, filterDependency]);

  const getCategoryIcon = (cat: string) => {
    const c = cat.toLowerCase();
    if (c.includes('libro')) return <FiBook />;
    if (c.includes('equipo') || c.includes('computo')) return <FiCpu />;
    if (c.includes('herramienta')) return <FiTool />;
    return <FiPackage />;
  };

  const getStatusClass = (status: string) => {
    const s = status.toUpperCase();
    if (s === 'DISPONIBLE') return 'status-available';
    if (s === 'REGULAR' || s === 'EN MANTENIMIENTO' || s === 'LOANED' || s === 'PRESTADO' || s === 'OCUPADO') return 'status-warning';
    if (s === 'DAÑADO') return 'status-unavailable';
    return '';
  };

  const isLoanedOut = (status: string) => {
    const s = status.toUpperCase();
    return s === 'LOANED' || s === 'PRESTADO' || s === 'OCUPADO';
  };

  const canReserve = (status: string) => {
    const s = status.toUpperCase();
    return ['DISPONIBLE', 'AVAILABLE', 'OCUPADO', 'PRESTADO', 'LOANED'].includes(s);
  };

  const handleReserve = async (itemId: number) => {
    const token = localStorage.getItem('token');
    const r = await fetch('/api/v1/reservations/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ item_id: itemId }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (data.status === 'READY') {
        alert('Tu reserva está lista. Tienes 15 minutos para reclamarla.');
      } else {
        alert('Te agregamos a la cola. Te avisaremos cuando esté disponible.');
      }
      setSelectedItem(null);
    } else {
      alert(data.error || 'No se pudo crear la reserva');
    }
  };

  return (
    <div className="aprendiz-catalog-container fade-in">
      {/* 1. Header Section */}
      <div className="catalog-header-pro">

        
        <div className="header-actions">
          <div className="search-wrapper-pro">
            <FiSearch className="search-icon" />
            <input 
              type="text" 
              placeholder="Buscar por nombre, marca o código..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn-scan-pro" onClick={() => setScannerStarted(true)}>
            <FiMaximize /> Escanear código
          </button>
        </div>
      </div>

      {/* QR Scanner Modal */}
      {scannerStarted && (
        <div className="catalog-scanner-overlay" onClick={() => setScannerStarted(false)}>
          <div className="catalog-scanner-content" onClick={e => e.stopPropagation()}>
            <button className="close-scanner-btn" onClick={() => setScannerStarted(false)}>✕</button>
            <h3>Escanea el código del elemento</h3>
            <div className="scanner-view-container">
              <div id="qr-reader-catalog"></div>
              <div className="scan-anim-line"></div>
            </div>
            <p className="scanner-hint">Apunta al código QR para buscarlo automáticamente</p>
          </div>
        </div>
      )}

      {/* 2. Filters Bar */}
      <div className="filters-bar-pro">
        <button className="btn-filter-main">
          <FiFilter /> Filtros
        </button>
        
        <div className="filter-selects">
          <CustomSelect 
            label="Área de Servicio"
            options={[{ id: 'ALL', name: 'Todas las áreas' }, ...(filters.dependencies || [])]}
            value={filterDependency}
            onChange={setFilterDependency}
          />
          <CustomSelect 
            label="Categoría"
            options={[{ id: 'ALL', name: 'Todas' }, ...filters.categories]}
            value={filterCategory}
            onChange={setFilterCategory}
          />
          <CustomSelect 
            label="Ubicación"
            options={[{ id: 'ALL', name: 'Todas' }]}
            value={'ALL'}
            onChange={() => {}}
          />
        </div>
      </div>

      {/* 4. Catalog Content */}
      {loading ? (
        <div className="catalog-loading">
          <div className="spinner"></div>
          <p>Cargando catálogo...</p>
        </div>
      ) : (
        <div className={`catalog-view-pro ${viewMode}`}>
          {items.length === 0 ? (
            <div className="empty-state" style={{ gridColumn: '1 / -1', minHeight: '400px' }}>
              <FiPackage size={64} style={{ opacity: 0.1, marginBottom: '1rem' }} />
              <h3>No encontramos lo que buscas</h3>
              <p>Prueba con otros términos o categorías.</p>
            </div>
          ) : items.map(item => (
            <div key={item.id} className="item-card-pro">
              <div className="card-image-area">
                <span className={`status-badge-pro ${getStatusClass(item.status_name)}`}>
                  {isLoanedOut(item.status_name) ? 'Ocupado' : translateStatus(item.status_name)}
                </span>
                <button className="btn-bookmark">
                  <FiBookmark />
                </button>
                <div className="image-holder">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} />
                  ) : (
                    <div className="placeholder-icon">{getCategoryIcon(item.category_name)}</div>
                  )}
                </div>
              </div>
              
              <div className="card-body-pro">
                <h3>{item.name}</h3>
                <div className="item-location-label">
                  <FiMapPin /> {item.location_name}
                </div>
                
                <div className="card-actions-row">
                  {isGuest ? (
                    <button
                      className="btn-reserve-pro"
                      style={{ background: 'var(--bg-card-light)', color: 'var(--text-secondary)', cursor: 'default', opacity: 0.7 }}
                      disabled
                      title="Inicia sesión para reservar"
                    >
                      <FiCalendar /> Inicia sesión
                    </button>
                  ) : (
                    <button
                      className="btn-reserve-pro"
                      disabled={!canReserve(item.status_name)}
                      onClick={() => handleReserve(item.id)}
                      title={isLoanedOut(item.status_name) ? 'Está prestado — entrarás a la cola' : 'Reservar'}
                    >
                      <FiCalendar />
                      <div className="btn-text-pro">
                        <span>Reservar</span>
                        {isLoanedOut(item.status_name) && <small>(en cola)</small>}
                      </div>
                    </button>
                  )}
                  <button className="btn-info-circle" onClick={() => setSelectedItem(item)}>
                    <FiInfo />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Item Detail Modal */}
      {selectedItem && (
        <div className="catalog-modal-overlay" onClick={() => { setSelectedItem(null); setShowQRView(false); }}>
          <div className="catalog-modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-close-btn" onClick={() => { setSelectedItem(null); setShowQRView(false); }}>

              <FiX />
            </div>
            
            <div className="modal-grid">
              <div className="modal-left">
                <div className="modal-image-container">
                  <button 
                    className={`btn-qr-toggle ${showQRView ? 'active' : ''}`}
                    onClick={() => setShowQRView(!showQRView)}
                    title={showQRView ? "Cerrar QR" : "Generar QR del Producto"}
                  >
                    <MdQrCodeScanner />
                  </button>
                  
                  {showQRView && (
                    <div className="qr-floating-panel" onClick={() => setShowQRView(false)}>
                      <div className="qr-floating-card" onClick={e => e.stopPropagation()}>
                        <QRCodeCanvas 
                          value={selectedItem.code} 
                          size={200}
                          bgColor={isDark ? "#1e293b" : "#ffffff"}
                          fgColor={isDark ? "#ffffff" : "#0f172a"}
                          level={"H"}
                          includeMargin={true}
                          imageSettings={{
                            src: "https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg",
                            x: undefined,
                            y: undefined,
                            height: 45,
                            width: 45,
                            excavate: true,
                          }}
                        />
                        <div className="qr-floating-info">
                          <span className="qr-id-text">{selectedItem.code}</span>
                        </div>

                      </div>
                    </div>
                  )}

                  
                  {selectedItem.image_url ? (
                    <img src={selectedItem.image_url} alt={selectedItem.name} />
                  ) : (
                    <div className="modal-placeholder">
                      {getCategoryIcon(selectedItem.category_name)}
                    </div>
                  )}

                </div>
              </div>
              
              <div className="modal-right">
                <div className="modal-header-info">

                  <span className="modal-badge">{selectedItem.category_name}</span>
                  <h2>{selectedItem.name}</h2>
                  <span className={`modal-status ${getStatusClass(selectedItem.status_name)}`}>
                    {translateStatus(selectedItem.status_name)}
                  </span>
                </div>

                <div className="modal-description">
                  <h4>Descripción</h4>
                  <p>{selectedItem.description || 'Sin descripción disponible.'}</p>
                </div>

                <div className="modal-specs">
                  <div className="spec-item">
                    <label>Código</label>
                    <span>{selectedItem.code}</span>
                  </div>
                  <div className="spec-item">
                    <label>Marca / Modelo</label>
                    <span>{selectedItem.brand || 'N/A'} {selectedItem.model ? `/ ${selectedItem.model}` : ''}</span>
                  </div>
                  <div className="spec-item">
                    <label>Estado Físico</label>
                    <span className="condition-badge">{selectedItem.physical_condition || 'Bueno'}</span>
                  </div>
                  <div className="spec-item">
                    <label>Ubicación</label>
                    <span>{selectedItem.location_name}</span>
                  </div>
                  <div className="spec-item">
                    <label>Disponibilidad</label>
                    <span>{selectedItem.stock > 0 ? `${selectedItem.stock} unidades` : 'No disponible'}</span>
                  </div>
                </div>

                <div className="modal-actions">

                  {!isGuest && (
                    <button
                      className="btn-reserve"
                      disabled={!canReserve(selectedItem.status_name)}
                      onClick={() => handleReserve(selectedItem.id)}
                    >
                      {isLoanedOut(selectedItem.status_name) ? 'Reservar (entrar a la cola)' : 'Solicitar Reserva'}
                    </button>
                  )}
                  <button className="btn-secondary" onClick={() => setSelectedItem(null)}>
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
