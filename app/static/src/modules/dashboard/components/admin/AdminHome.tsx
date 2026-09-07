import React from 'react';
import { 
  FiBox, FiCheckCircle, FiBookOpen, FiTool, FiCalendar
} from 'react-icons/fi';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { IMAGE_PLACEHOLDER } from '../../../../shared/constants';

export const AdminHome: React.FC = () => {
  const [dashboardData, setDashboardData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/dashboard/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
      }
    } catch (err) {
      console.error("Error fetching dashboard stats:", err);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchDashboardData();
  }, []);

  if (loading) return <div className="admin-loading">Cargando estadísticas reales...</div>;

  const { metrics, pieData, catData, activity, lineData, upcomingReturns } = dashboardData || {
    metrics: { total: 0, available: 0, loans: 0, maintenance: 0, reservations: 0 },
    pieData: [],
    catData: [],
    activity: [],
    lineData: [],
    upcomingReturns: []
  };

  return (
    <div className="admin-home-content">
      {/* ── KPI CARDS ── */}
      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="kpi-icon-box" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#39A900' }}>
            <FiBox />
          </div>
          <div className="kpi-info">
            <span className="kpi-title">Total de elementos</span>
            <span className="kpi-value">{metrics.total}</span>
          </div>
        </div>
        <div className="admin-kpi-card">
          <div className="kpi-icon-box" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#39A900' }}>
            <FiCheckCircle />
          </div>
          <div className="kpi-info">
            <span className="kpi-title">Disponibles</span>
            <span className="kpi-value">{metrics.available}</span>
            <span className="kpi-sub green">{metrics.total > 0 ? (metrics.available / metrics.total * 100).toFixed(1) : 0}% del total</span>
          </div>
        </div>

        <div className="admin-kpi-card">
          <div className="kpi-icon-box" style={{ background: 'rgba(234, 179, 8, 0.1)', color: '#eab308' }}>
            <FiBookOpen />
          </div>
          <div className="kpi-info">
            <span className="kpi-title">Prestados</span>
            <span className="kpi-value">{metrics.loans}</span>
            <span className="kpi-sub yellow">{metrics.total > 0 ? (metrics.loans / metrics.total * 100).toFixed(1) : 0}% del total</span>
          </div>
        </div>

        <div className="admin-kpi-card">
          <div className="kpi-icon-box" style={{ background: 'rgba(249, 115, 22, 0.1)', color: '#f97316' }}>
            <FiTool />
          </div>
          <div className="kpi-info">
            <span className="kpi-title">Mantenimiento</span>
            <span className="kpi-value">{metrics.maintenance}</span>
            <span className="kpi-sub orange">{metrics.total > 0 ? (metrics.maintenance / metrics.total * 100).toFixed(1) : 0}% del total</span>
          </div>
        </div>

        <div className="admin-kpi-card">
          <div className="kpi-icon-box" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
            <FiCalendar />
          </div>
          <div className="kpi-info">
            <span className="kpi-title">Reservas activas</span>
            <span className="kpi-value">{metrics.reservations}</span>
            <span className="kpi-sub green">Pendientes por aprobar</span>
          </div>
        </div>
      </div>

      <div className="admin-main-grid">
        {/* COLUMNA IZQUIERDA/CENTRO */}
        <div className="admin-charts-col">
          <div className="charts-row">
            {/* Préstamos por mes */}
            <div className="admin-card line-chart-card">
              <div className="admin-card-header">
                <h3>Préstamos por mes</h3>
                <select className="admin-select"><option>Este año</option></select>
              </div>
              <div className="chart-container" style={{ height: 250, marginTop: '1rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-border-color)" vertical={false} />
                    <XAxis dataKey="name" stroke="var(--admin-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--admin-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--admin-bg-card)', border: '1px solid var(--admin-border-color)', borderRadius: '8px' }}
                      itemStyle={{ color: 'var(--sena-green)' }}
                    />
                    <Line type="monotone" dataKey="value" stroke="#39A900" strokeWidth={3} dot={{ r: 4, fill: '#39A900' }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Elementos por estado */}
            <div className="admin-card donut-chart-card">
              <div className="admin-card-header">
                <h3>Elementos por estado</h3>
              </div>
              <div className="donut-content" style={{ display: 'flex', alignItems: 'center', height: '250px' }}>
                <div style={{ width: '60%', height: '100%', position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: 'var(--admin-bg-card)', border: 'none', borderRadius: '8px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Etiqueta Central */}
                  <div className="donut-center-label" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--admin-text-primary)' }}>{metrics.total}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)' }}>Total</div>
                  </div>
                </div>
                <div className="donut-legend" style={{ width: '40%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {pieData.map((item: any) => (
                    <div key={item.name} className="legend-item" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color, marginTop: '0.3rem' }} />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-primary)' }}>{item.name}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)' }}>{item.value} ({metrics.total > 0 ? (item.value/metrics.total*100).toFixed(1) : 0}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="charts-row bottom-row">
            {/* Próximas devoluciones */}
            <div className="admin-card lists-card">
              <div className="admin-card-header">
                <h3>Próximas devoluciones</h3>
              </div>
              <div className="returns-list" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {upcomingReturns.length > 0 ? upcomingReturns.map((ret: any) => (
                  <div key={ret.id} className="return-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <img src={ret.image || IMAGE_PLACEHOLDER} alt={ret.item_name} onError={e => { e.currentTarget.src = IMAGE_PLACEHOLDER; }} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{ret.item_name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-muted)' }}>{ret.user_name}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.85rem', color: new Date(ret.date) < new Date() ? '#ef4444' : 'inherit', fontWeight: 'bold' }}>
                        {new Date(ret.date).toLocaleDateString()}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)' }}>{new Date(ret.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                )) : <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.9rem' }}>No hay devoluciones pendientes</div>}
              </div>
            </div>

            {/* Categorías principales */}
            <div className="admin-card categories-card">
              <div className="admin-card-header">
                <h3>Categorías principales</h3>
              </div>
              <div className="categories-bars" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {catData.length > 0 ? catData.map((cat: any) => (
                  <div key={cat.name} className="cat-bar-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                      <span style={{ color: 'var(--admin-text-secondary)' }}>{cat.name}</span>
                      <span style={{ color: 'var(--admin-text-muted)' }}>{cat.val} ({cat.pct}%)</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--admin-border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${cat.pct}%`, height: '100%', backgroundColor: '#39A900', borderRadius: '3px' }} />
                    </div>
                  </div>
                )) : <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.9rem' }}>Sin datos registrados</div>}
              </div>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA */}
        <div className="admin-side-col">
          <div className="admin-card activity-card" style={{ height: '100%' }}>
            <div className="admin-card-header">
              <h3>Actividad reciente</h3>
            </div>
            <div className="activity-list" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {activity.length > 0 ? activity.map((log: any) => (
                <div key={log.id} className="activity-item" style={{ display: 'flex', gap: '1rem' }}>
                  <div className="activity-icon" style={{ 
                    width: 36, height: 36, borderRadius: 8, 
                    background: log.action === 'CREATE' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(59, 130, 246, 0.1)', 
                    color: log.action === 'CREATE' ? '#39A900' : '#3b82f6', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 
                  }}>
                    {log.action === 'CREATE' ? <FiBox /> : <FiTool />}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Doc: {log.user}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--admin-text-secondary)' }}>{log.action} {log.target}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)', marginTop: '0.2rem' }}>
                      {new Intl.RelativeTimeFormat('es', { numeric: 'auto' }).format(
                        Math.round((new Date(log.time).getTime() - new Date().getTime()) / 60000), 
                        'minute'
                      )}
                    </div>
                  </div>
                </div>
              )) : <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.9rem' }}>No hay actividad reciente</div>}
            </div>
            <button className="view-all-activity" style={{ marginTop: 'auto', width: '100%', padding: '0.75rem', background: 'transparent', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#39A900', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>
              Ver todas las actividades
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
