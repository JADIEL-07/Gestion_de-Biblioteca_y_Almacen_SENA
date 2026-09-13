import React, { useState, useEffect, useMemo } from 'react';
import { FiClock, FiDownload, FiPackage } from 'react-icons/fi';
import './AprendizHistory.css';

interface HistoryItem {
  id: number;
  name: string;
  category: string;
  image_url: string | null;
}

interface Row {
  kind: 'LOAN' | 'RESERVATION';
  id: number;
  date: string | null;
  due_date?: string | null;
  return_date?: string | null;
  ready_at?: string | null;
  expiration_date?: string | null;
  status: string;
  items: HistoryItem[];
  fine_amount?: number;
  token?: string;
}

interface FlattenedRow {
  kind: 'LOAN' | 'RESERVATION';
  parentId: number;
  item: HistoryItem;
  date: string | null;
  statusText: string;
  statusClass: string;
  detailText: string;
  detailSub: string;
  token?: string;
  statusRaw: string;
}

const formatDateObj = (iso: string | null) => {
  if (!iso) return { dateStr: '—', timeStr: '' };
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  return { dateStr, timeStr };
};

const parseStatus = (row: Row): { text: string, cls: string, detailText: string, detailSub: string } => {
  if (row.kind === 'LOAN') {
    if (row.status === 'RETURNED') {
      return { 
        text: 'Devuelto', cls: 'success', 
        detailText: row.return_date ? `Devuelto el ${formatDateObj(row.return_date).dateStr}` : 'Devuelto',
        detailSub: 'Sin novedades'
      };
    }
    if (row.status === 'OVERDUE') {
      return { 
        text: 'Vencido', cls: 'danger', 
        detailText: row.due_date ? `Debió entregarse el ${formatDateObj(row.due_date).dateStr}` : 'Vencido',
        detailSub: row.fine_amount ? `Multa: $${row.fine_amount}` : 'Sin multa'
      };
    }
    if (row.status === 'ACTIVE') {
      return { 
        text: 'Activo', cls: 'success', 
        detailText: row.due_date ? `Vence el ${formatDateObj(row.due_date).dateStr}` : 'Activo',
        detailSub: 'En poder del aprendiz'
      };
    }
  } else {
    // RESERVATION
    if (row.status === 'CANCELLED') {
      return {
        text: 'Cancelada', cls: 'danger',
        detailText: 'Cancelada',
        detailSub: 'Por el usuario o sistema'
      };
    }
    if (row.status === 'EXPIRED') {
      return {
        text: 'Expirada', cls: 'danger',
        detailText: row.expiration_date ? `Expiró el ${formatDateObj(row.expiration_date).dateStr}` : 'Expirada',
        detailSub: 'Tiempo agotado'
      };
    }
    if (row.status === 'CLAIMED') {
      return {
        text: 'Reclamada', cls: 'success',
        detailText: 'Reserva completada',
        detailSub: 'Préstamo iniciado'
      };
    }
    if (row.status === 'READY') {
      return {
        text: 'Lista', cls: 'success',
        detailText: row.expiration_date ? `Expira el ${formatDateObj(row.expiration_date).dateStr}` : 'Lista',
        detailSub: 'Esperando reclamo'
      };
    }
    if (row.status === 'QUEUED') {
      return {
        text: 'En cola', cls: 'warning',
        detailText: 'En espera de disponibilidad',
        detailSub: 'Se notificará al estar lista'
      };
    }
  }
  return { text: row.status, cls: 'default', detailText: '—', detailSub: '—' };
};

export const AprendizHistory: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedQR, setSelectedQR] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const r = await fetch('/api/v1/history/my', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) setRows(await r.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const flattenedRows = useMemo(() => {
    const list: FlattenedRow[] = [];
    rows.forEach(row => {
      const parsed = parseStatus(row);
      row.items.forEach(item => {
        list.push({
          kind: row.kind,
          parentId: row.id,
          item,
          date: row.date,
          statusText: parsed.text,
          statusClass: parsed.cls,
          detailText: parsed.detailText,
          detailSub: parsed.detailSub,
          token: row.token,
          statusRaw: row.status
        });
      });
    });
    return list;
  }, [rows]);

  const filteredData = useMemo(() => {
    return flattenedRows.filter(r => {
      if (typeFilter !== 'ALL' && r.kind !== typeFilter) return false;
      
      if (statusFilter !== 'ALL') {
        const checkStatus = r.statusText.toUpperCase();
        if (statusFilter === 'DEVUELTO' && checkStatus !== 'DEVUELTO') return false;
        if (statusFilter === 'CANCELADA' && checkStatus !== 'CANCELADA') return false;
        if (statusFilter === 'ACTIVA' && !['ACTIVO', 'LISTA', 'EN COLA'].includes(checkStatus)) return false;
      }
      return true;
    });
  }, [flattenedRows, typeFilter, statusFilter]);

  return (
    <div className="history-container fade-in">
      <div className="history-header-section">
        <h1>Historial</h1>
        <p>Consulta el historial de tus préstamos y devoluciones.</p>
        
        <div className="history-filters-bar">
          <div className="filter-group">
            <select 
              className="history-select" 
              value={typeFilter} 
              onChange={e => setTypeFilter(e.target.value)}
            >
              <option value="ALL">Todos los tipos</option>
              <option value="LOAN">Préstamo</option>
              <option value="RESERVATION">Reserva</option>
            </select>
            
            <select 
              className="history-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="ALL">Todos los estados</option>
              <option value="DEVUELTO">Devuelto</option>
              <option value="CANCELADA">Cancelada / Expirada</option>
              <option value="ACTIVA">En curso (Activos)</option>
            </select>
          </div>
          
          <div className="filter-group right">
            <div className="date-filter">
              <span>Desde</span>
              <input type="date" className="history-date-input" />
            </div>
            <div className="date-filter">
              <span>Hasta</span>
              <input type="date" className="history-date-input" />
            </div>
            
            <button className="btn-export">
              <FiDownload /> Exportar
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-spinner-container">
          <div className="spinner"></div>
          <p>Cargando historial...</p>
        </div>
      ) : filteredData.length === 0 ? (
        <div className="history-empty-state">
          <FiClock size={48} />
          <p>No se encontraron registros que coincidan con los filtros.</p>
        </div>
      ) : (
        <div className="history-table-wrapper">
          <table className="history-table">
            <thead>
              <tr>
                <th>Elemento</th>
                <th>Tipo</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((r, i) => {
                const dateObj = formatDateObj(r.date);
                
                return (
                  <tr key={`${r.kind}-${r.parentId}-${r.item.id}-${i}`}>
                    <td className="item-col">
                      <div className="item-cell-content">
                        <div className="item-mini-img">
                          {r.item.image_url ? (
                            <img src={r.item.image_url} alt={r.item.name} />
                          ) : (
                            <FiPackage size={20} />
                          )}
                        </div>
                        <div className="item-titles">
                          <span className="item-name">{r.item.name}</span>
                          <span className="item-cat">{r.item.category}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`kind-text ${r.kind.toLowerCase()}`}>
                        {r.kind === 'LOAN' ? 'Préstamo' : 'Reserva'}
                      </span>
                    </td>
                    <td>
                      <div className="date-cell">
                        <span className="date-str">{dateObj.dateStr}</span>
                        <span className="time-str">{dateObj.timeStr}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`status-text ${r.statusClass}`}>{r.statusText}</span>
                    </td>
                    <td>
                      <div className="detail-cell">
                        <span className="detail-main">{r.detailText}</span>
                        <span className="detail-sub">{r.detailSub}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
