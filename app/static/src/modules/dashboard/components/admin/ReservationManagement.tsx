import React, { useState, useEffect } from 'react';
import { 
  FiCalendar, FiBarChart2, FiCheckCircle, FiClock, FiAlertCircle, 
  FiArrowUpRight, FiUsers, FiTrendingUp, FiSearch, FiEye, FiPackage 
} from 'react-icons/fi';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell 
} from 'recharts';
import { CustomSelect } from './CustomSelect';
import './ReservationManagement.css';

interface ResMetric {
  total: number;
  active: number;
  pending: number;
  expired: number;
  completed: number;
}

interface ResIndicator {
  conversion_rate: number;
  expiry_rate: number;
  avg_wait: string;
}

interface Reservation {
  id: number;
  user_name: string;
  user_email: string;
  user_phone: string;
  user_role: string;
  item_name: string;
  item_category?: string;
  reservation_date: string;
  expiration_date: string;
  status: string;
  admin_name: string;
}

export const ReservationManagement: React.FC = () => {
  const [metrics, setMetrics] = useState<ResMetric>({ total: 0, active: 0, pending: 0, expired: 0, completed: 0 });
  const [indicators, setIndicators] = useState<ResIndicator>({ conversion_rate: 0, expiry_rate: 0, avg_wait: '0' });
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const categories = Array.from(new Set(reservations.map(r => r.item_category || 'N/A')));

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: searchTerm,
        startDate: startDate,
        endDate: endDate,
        category: filterCategory
      });

      const [resData, statsData] = await Promise.all([
        fetch(`/api/v1/reservations/?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.json()),
        fetch('/api/v1/reservations/stats', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.json())
      ]);

      setReservations(Array.isArray(resData) ? resData : []);
      if (statsData.metrics) setMetrics(statsData.metrics);
      if (statsData.indicators) setIndicators(statsData.indicators);
    } catch (error) {
      console.error('Error fetching reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [searchTerm, startDate, endDate, filterCategory]);

  const chartData = [
    { name: 'Lunes', reservas: 4 },
    { name: 'Martes', reservas: 7 },
    { name: 'Miércoles', reservas: 5 },
    { name: 'Jueves', reservas: 9 },
    { name: 'Viernes', reservas: 12 },
    { name: 'Sábado', reservas: 3 },
    { name: 'Domingo', reservas: 1 },
  ];

  const pieData = [
    { name: 'Convertidas', value: metrics.completed },
    { name: 'Expiradas', value: metrics.expired },
    { name: 'Pendientes', value: metrics.pending },
  ];

  const filteredReservations = reservations.filter(res => {
    const s = searchTerm.toLowerCase();
    const resDate = new Date(res.reservation_date);
    
    const matchesSearch = 
      res.user_name.toLowerCase().includes(s) || 
      (res.user_email?.toLowerCase() || '').includes(s) ||
      (res.user_phone?.toLowerCase() || '').includes(s) ||
      res.item_name.toLowerCase().includes(s) || 
      res.id.toString().includes(searchTerm);
    
    const matchesCategory = filterCategory === 'ALL' || res.item_category === filterCategory;
    
    const start = startDate ? new Date(startDate + 'T00:00:00') : null;
    const end = endDate ? new Date(endDate + 'T23:59:59') : null;
    let matchesDate = true;
    if (start && resDate < start) matchesDate = false;
    if (end && resDate > end) matchesDate = false;
    
    return matchesSearch && matchesCategory && matchesDate;
  });

  const COLORS = ['#39A900', '#ef4444', '#f59e0b'];

  return (
    <div className="res-mgmt-container fade-in">
      <div className="res-mgmt-header">
        <div className="header-title">
          <div className="header-icon-box"><FiCalendar /></div>
          <div>
            <h1>Dashboard de Reservas</h1>
          </div>
        </div>
      </div>

      {/* 1. MÉTRICAS PRINCIPALES */}
      <div className="res-metrics-grid">
        <div className="metric-card">
          <div className="metric-icon total"><FiCalendar /></div>
          <div className="metric-info">
            <h3>Total Reservas</h3>
            <span className="value">{metrics.total}</span>
          </div>
          <div className="metric-trend up"><FiArrowUpRight /> +12%</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon active"><FiCheckCircle /></div>
          <div className="metric-info">
            <h3>Activas</h3>
            <span className="value">{metrics.active}</span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon pending"><FiClock /></div>
          <div className="metric-info">
            <h3>Pendientes</h3>
            <span className="value">{metrics.pending}</span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon expired"><FiAlertCircle /></div>
          <div className="metric-info">
            <h3>Expiradas</h3>
            <span className="value">{metrics.expired}</span>
          </div>
        </div>
      </div>

      {/* FILTROS COMPLEJOS */}
      <div className="loan-filters-complex">
        <div className="filter-row">
          <div className="filter-item search">
            <label>BÚSQUEDA RÁPIDA</label>
            <div className="input-with-icon">
              <FiSearch />
              <input 
                type="text" 
                placeholder="Nombre o ID..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-item">
            <CustomSelect 
              label="CATEGORÍA DEL ELEMENTO"
              options={[{ id: 'ALL', name: 'Todas las categorías' }, ...categories.map(cat => ({ id: cat, name: cat }))]}
              value={filterCategory}
              onChange={setFilterCategory}
              icon={<FiPackage />}
            />
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-item">
            <label>DESDE (FECHA)</label>
            <div className="input-with-icon">
              <FiCalendar />
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-item">
            <label>HASTA (FECHA)</label>
            <div className="input-with-icon">
              <FiCalendar />
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          
          <div className="filter-item-actions">
            <button className="btn-reset" onClick={() => {
              setStartDate('');
              setEndDate('');
              setFilterCategory('ALL');
              setSearchTerm('');
            }}>Limpiar Filtros</button>
          </div>
        </div>
      </div>

      {/* 4. TABLA DE RESERVAS */}
      <div className="res-table-section">
        <div className="table-header">
          <h3>Historial Reciente</h3>
        </div>
        <div className="res-table-wrapper">
          <table className="res-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Elemento</th>
                <th>F. Reserva</th>
                <th>F. Límite</th>
                <th>Estado</th>
                <th>Procesado por</th>
              </tr>
            </thead>
            <tbody>
              {filteredReservations.map(res => (
                <tr key={res.id}>
                  <td><span className="id-badge">#{res.id}</span></td>
                  <td>{res.user_name}</td>
                  <td><span className="role-badge">{res.user_role}</span></td>
                  <td>{res.item_name}</td>
                  <td className="date-cell">{new Date(res.reservation_date).toLocaleDateString()}</td>
                  <td className="date-cell">{new Date(res.expiration_date).toLocaleDateString()}</td>
                  <td>
                    <span className={`status-pill ${res.status.toLowerCase()}`}>
                      {res.status}
                    </span>
                  </td>
                  <td>{res.admin_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
