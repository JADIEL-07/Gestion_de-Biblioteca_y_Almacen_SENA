import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FiBox, FiCheckCircle, FiBook, FiClock, FiCalendar, 
  FiAlertTriangle, FiInfo, FiLayers 
} from 'react-icons/fi';
import { 
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer 
} from 'recharts';
import { IMAGE_PLACEHOLDER } from '../../../../shared/constants';
import './StaffHome.css';

interface StaffHomeProps {
  user: any;
}

export const StaffHome: React.FC<StaffHomeProps> = ({ user }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const depId = user?.dependency_id;
  const depName = user?.dependency_name || 'Mi Dependencia';

  // Determinar rol para redirección
  const isAlmacenista = (user?.role?.name || user?.rol?.nombre || '').toUpperCase().includes('ALMACENISTA');
  const loansPath = isAlmacenista ? '/almacenista/loans' : '/bibliotecario/loans';

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('token');
        const [itemsRes, loansRes, resvRes] = await Promise.all([
          fetch(`/api/v1/items/?dependency_id=${depId || ''}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/v1/loans/`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/v1/reservations/', { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        const items = itemsRes.ok ? await itemsRes.json() : [];
        const loans = loansRes.ok ? await loansRes.json() : [];
        const reservations = resvRes.ok ? await resvRes.json() : [];

        // 1. Filtrar los préstamos que pertenecen a esta dependencia
        const myItemIds = new Set(items.map((i: any) => i.id));
        const myLoans = loans.filter((l: any) =>
          l.items?.some((item: any) => myItemIds.has(item.id))
        );

        // 2. Filtrar las reservas que pertenecen a esta dependencia
        const myReservations = reservations.filter((r: any) =>
          ['QUEUED', 'READY'].includes(r.status) &&
          (!depId || r.dependency_id === depId)
        );

        // --- Cálculos ---
        // A. Préstamos por Estado
        const activeLoans = myLoans.filter((l: any) => l.status === 'ACTIVE');
        
        const isToday = (dateStr: string) => {
          if (!dateStr) return false;
          const d = new Date(dateStr);
          const today = new Date();
          return d.getDate() === today.getDate() &&
                 d.getMonth() === today.getMonth() &&
                 d.getFullYear() === today.getFullYear();
        };

        const isOverdue = (dateStr: string) => {
          if (!dateStr) return false;
          return new Date(dateStr) < new Date();
        };

        const isNearDue = (dateStr: string) => {
          if (!dateStr) return false;
          const diffTime = new Date(dateStr).getTime() - new Date().getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          return diffDays >= 0 && diffDays <= 3;
        };

        const activosCount = activeLoans.filter((l: any) => !isOverdue(l.due_date)).length;
        const devueltosHoyCount = myLoans.filter((l: any) => l.status === 'RETURNED' && l.return_date && isToday(l.return_date)).length;
        const retrasadosCount = activeLoans.filter((l: any) => isOverdue(l.due_date)).length;
        const proximosCount = activeLoans.filter((l: any) => !isOverdue(l.due_date) && isNearDue(l.due_date)).length;

        // B. Préstamos por Categoría
        const categoryCounts: Record<string, number> = {};
        myLoans.forEach((l: any) => {
          l.items?.forEach((item: any) => {
            const cat = item.category || 'Otros';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
          });
        });

        const standardCategories = ['Libros', 'Revistas', 'Tesis', 'Material Digital', 'Otros'];
        const barData = standardCategories.map(cat => ({
          name: cat,
          value: categoryCounts[cat] || 0
        }));

        // C. Elementos más prestados
        const itemBorrows: Record<number, { name: string; count: number; image_url: string | null }> = {};
        myLoans.forEach((l: any) => {
          l.items?.forEach((item: any) => {
            if (!itemBorrows[item.id]) {
              const originalItem = items.find((i: any) => i.id === item.id);
              itemBorrows[item.id] = {
                name: item.name,
                count: 0,
                image_url: originalItem?.image_url || null
              };
            }
            itemBorrows[item.id].count += 1;
          });
        });

        const mostBorrowed = Object.values(itemBorrows)
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);

        // D. Préstamos activos detallados
        const activeLoansList = activeLoans.slice(0, 4).map((l: any) => {
          const diffTime = new Date(l.due_date).getTime() - new Date().getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          return {
            id: l.id,
            user_name: l.user_name,
            user_id: l.user_id,
            element: l.items?.map((i: any) => i.name).join(', ') || '—',
            due_date: new Date(l.due_date).toLocaleDateString('es-CO'),
            daysLeft: diffDays,
          };
        });

        // E. Reservas próximas a vencer
        const nearExpireReservations = myReservations
          .slice(0, 4)
          .map((r: any) => {
            const diffTime = r.expiration_date ? new Date(r.expiration_date).getTime() - new Date().getTime() : 0;
            const diffDays = r.expiration_date ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0;
            return {
              id: r.id,
              user_name: r.user_name,
              user_id: r.user_id,
              element: r.item_name || '—',
              expiration_date: r.expiration_date ? new Date(r.expiration_date).toLocaleDateString('es-CO') : '—',
              daysLeft: diffDays,
            };
          });

        // F. Elementos agregados la última semana
        const itemsLastWeek = items.filter((i: any) => {
          if (!i.acquisition_date) return false;
          const diff = new Date().getTime() - new Date(i.acquisition_date).getTime();
          return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
        }).length;

        // G. Avisos y Notificaciones Dinámicas
        const notices = [];
        if (retrasadosCount > 0) {
          notices.push({
            type: 'warning',
            title: 'Retrasos detectados',
            desc: `Hay ${retrasadosCount} préstamo(s) activo(s) vencido(s) que requieren atención urgente.`,
            time: 'Hoy'
          });
        }
        
        // Agregar avisos de reservas listas
        const readyCount = myReservations.filter((r: any) => r.status === 'READY').length;
        if (readyCount > 0) {
          notices.push({
            type: 'info',
            title: 'Reservas listas',
            desc: `Tienes ${readyCount} material(es) listo(s) en mostrador esperando entrega al aprendiz.`,
            time: 'Hace poco'
          });
        }

        // Agregar aviso del estado del inventario
        const totalItems = items.length;
        const lowStockItems = items.filter((i: any) => i.stock <= 1).length;
        if (lowStockItems > 0) {
          notices.push({
            type: 'warning',
            title: 'Stock bajo en inventario',
            desc: `Hay ${lowStockItems} artículo(s) con existencias iguales o menores a 1 unidad.`,
            time: 'Hoy'
          });
        } else if (totalItems > 0) {
          notices.push({
            type: 'success',
            title: 'Inventario actualizado',
            desc: `Se registran ${totalItems} elementos activos y controlados en la base de datos de ${depName}.`,
            time: 'Hoy'
          });
        }

        setData({
          total: totalItems,
          available: items.filter((i: any) => ['AVAILABLE','DISPONIBLE'].includes(i.status_name?.toUpperCase())).length,
          loaned: items.filter((i: any) => ['LOANED','PRESTADO'].includes(i.status_name?.toUpperCase())).length,
          activosCount,
          devueltosHoyCount,
          retrasadosCount,
          proximosCount,
          barData,
          mostBorrowed,
          activeLoansList,
          nearExpireReservations,
          itemsLastWeek,
          myReservationsCount: myReservations.length,
          notices
        });

      } catch (err) {
        console.error("Error fetching dashboard statistics: ", err);
        setData({
          total: 0,
          available: 0,
          loaned: 0,
          activosCount: 0,
          devueltosHoyCount: 0,
          retrasadosCount: 0,
          proximosCount: 0,
          barData: [],
          mostBorrowed: [],
          activeLoansList: [],
          nearExpireReservations: [],
          itemsLastWeek: 0,
          myReservationsCount: 0,
          notices: []
        });
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [depId]);

  if (loading) return <div className="admin-loading">Cargando panel de estadísticas...</div>;

  const {
    total,
    available,
    loaned,
    activosCount,
    devueltosHoyCount,
    retrasadosCount,
    proximosCount,
    barData,
    mostBorrowed,
    activeLoansList,
    nearExpireReservations,
    itemsLastWeek,
    myReservationsCount,
    notices
  } = data;

  const totalStatesSum = activosCount + devueltosHoyCount + retrasadosCount + proximosCount;

  const pieChartData = [
    { name: 'Activos', value: activosCount, color: '#3b82f6' },
    { name: 'Devueltos hoy', value: devueltosHoyCount, color: '#22c55e' },
    { name: 'Retrasados', value: retrasadosCount, color: '#ef4444' },
    { name: 'Próximos a vencer', value: proximosCount, color: '#f59e0b' }
  ].filter(d => d.value > 0);

  return (
    <div className="staff-home-container fade-in">
      {/* HEADER SECTION */}
      <div className="staff-home-header">
        <h1>Panel de {depName}</h1>
        <p>Resumen operativo real y estado del inventario de tu dependencia</p>
      </div>

      {/* TOP KPI ROW (EXACTLY AS IN SCREENSHOT) */}
      <div className="staff-kpi-row">
        {/* Card 1: Total de elementos */}
        <div className="staff-kpi-card">
          <div className="staff-kpi-icon-box" style={{ color: '#22c55e', background: 'rgba(34, 197, 94, 0.12)' }}>
            <FiBox />
          </div>
          <div className="staff-kpi-card-content">
            <span className="staff-kpi-label">Total de elementos</span>
            <span className="staff-kpi-value" style={{ color: '#22c55e' }}>{total}</span>
            <span className="staff-kpi-subtext green">
              ↳ {itemsLastWeek} desde la última semana ↗
            </span>
          </div>
        </div>

        {/* Card 2: Disponibles */}
        <div className="staff-kpi-card">
          <div className="staff-kpi-icon-box" style={{ color: '#22c55e', background: 'rgba(34, 197, 94, 0.12)' }}>
            <FiCheckCircle />
          </div>
          <div className="staff-kpi-card-content">
            <span className="staff-kpi-label">Disponibles</span>
            <span className="staff-kpi-value" style={{ color: '#22c55e' }}>{available}</span>
            <span className="staff-kpi-subtext green">
              {total > 0 ? Math.round((available / total) * 100) : 0}% del total
            </span>
          </div>
        </div>

        {/* Card 3: Prestados */}
        <div className="staff-kpi-card">
          <div className="staff-kpi-icon-box" style={{ color: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)' }}>
            <FiBook />
          </div>
          <div className="staff-kpi-card-content">
            <span className="staff-kpi-label">Prestados</span>
            <span className="staff-kpi-value" style={{ color: '#f59e0b' }}>{loaned}</span>
            <span className="staff-kpi-subtext orange">
              {total > 0 ? Math.round((loaned / total) * 100) : 0}% del total
            </span>
          </div>
        </div>

        {/* Card 4: Préstamos activos */}
        <div className="staff-kpi-card">
          <div className="staff-kpi-icon-box" style={{ color: '#3b82f6', background: 'rgba(59, 130, 246, 0.12)' }}>
            <FiClock />
          </div>
          <div className="staff-kpi-card-content">
            <span className="staff-kpi-label">Préstamos activos</span>
            <span className="staff-kpi-value" style={{ color: '#3b82f6' }}>{activosCount + retrasadosCount}</span>
            <span className="staff-kpi-subtext link" onClick={() => navigate(loansPath)}>
              Ver detalles ＞
            </span>
          </div>
        </div>

        {/* Card 5: Reservas pendientes */}
        <div className="staff-kpi-card">
          <div className="staff-kpi-icon-box" style={{ color: '#a855f7', background: 'rgba(168, 85, 247, 0.12)' }}>
            <FiCalendar />
          </div>
          <div className="staff-kpi-card-content">
            <span className="staff-kpi-label">Reservas pendientes</span>
            <span className="staff-kpi-value" style={{ color: '#a855f7' }}>{myReservationsCount}</span>
            <span className="staff-kpi-subtext link" onClick={() => navigate(loansPath)}>
              Ver detalles ＞
            </span>
          </div>
        </div>
      </div>

      {/* ROW 1: CHARTS & RANKINGS */}
      <div className="staff-home-row">
        {/* Card 1: Préstamos por Estado */}
        <div className="staff-home-card">
          <div className="staff-home-card-header">
            <h3>Préstamos por estado</h3>
          </div>
          {totalStatesSum === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon-wrapper"><FiBook /></div>
              <p>No hay préstamos registrados en esta dependencia.</p>
            </div>
          ) : (
            <div className="staff-chart-container">
              <div className="staff-chart-wrapper">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieChartData}
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {pieChartData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={_entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '25%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  pointerEvents: 'none'
                }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', display: 'block' }}>Total</span>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>{totalStatesSum}</span>
                </div>
              </div>
              <div className="staff-chart-legend">
                {pieChartData.map((d, i) => (
                  <div key={i} className="legend-item">
                    <span className="legend-label-group">
                      <span className="legend-color-dot" style={{ backgroundColor: d.color }} />
                      {d.name}
                    </span>
                    <span className="legend-value">{d.value} ({Math.round((d.value / totalStatesSum) * 100)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Préstamos por Categoría */}
        <div className="staff-home-card">
          <div className="staff-home-card-header">
            <h3>Préstamos por categoría</h3>
            <select className="header-select">
              <option>Esta semana</option>
              <option>Este mes</option>
            </select>
          </div>
          {barData.every((b: any) => b.value === 0) ? (
            <div className="empty-state">
              <div className="empty-state-icon-wrapper"><FiLayers /></div>
              <p>No se registran préstamos categorizados recientemente.</p>
            </div>
          ) : (
            <div style={{ height: '180px', width: '100%', marginTop: '1rem' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <XAxis 
                    dataKey="name" 
                    stroke="var(--admin-text-muted)" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <YAxis 
                    stroke="var(--admin-text-muted)" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <Tooltip 
                    contentStyle={{ 
                      background: 'var(--admin-bg-card)', 
                      border: '1px solid var(--admin-border-color)',
                      borderRadius: '8px' 
                    }} 
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={30}>
                    {barData.map((_entry: any, index: number) => {
                      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
                      return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Card 3: Elementos más Prestados */}
        <div className="staff-home-card">
          <div className="staff-home-card-header">
            <h3>Elementos más prestados</h3>
          </div>
          {mostBorrowed.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon-wrapper"><FiBox /></div>
              <p>Aún no hay historial de préstamos para calcular el ranking.</p>
            </div>
          ) : (
            <div className="ranking-list">
              {mostBorrowed.map((item: any, index: number) => (
                <div key={index} className="ranking-item">
                  <div className={`ranking-badge rank-${index + 1}`}>{index + 1}</div>
                  <img
                    src={item.image_url || IMAGE_PLACEHOLDER}
                    alt={item.name}
                    className="ranking-thumb"
                    onError={e => { e.currentTarget.src = IMAGE_PLACEHOLDER; }}
                  />
                  <div className="ranking-info">
                    <h4 className="ranking-title" title={item.name}>{item.name}</h4>
                    <p className="ranking-count">Préstamos: <strong>{item.count}</strong></p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ROW 2: DETAILED DATA LISTS */}
      <div className="staff-home-row">
        {/* Card 4: Préstamos Activos */}
        <div className="staff-home-card">
          <div className="staff-home-card-header">
            <h3>Préstamos activos</h3>
          </div>
          {activeLoansList.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon-wrapper"><FiCheckCircle /></div>
              <p>No tienes préstamos activos en circulación.</p>
              <span className="empty-state-sub">¡Todo en orden!</span>
            </div>
          ) : (
            <div className="active-loans-list">
              {activeLoansList.map((loan: any) => (
                <div key={loan.id} className="loan-item-card">
                  <div className="loan-user-avatar">
                    {loan.user_name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="loan-details">
                    <h4 className="loan-user-name">{loan.user_name}</h4>
                    <p className="loan-user-id">ID: {loan.user_id}</p>
                  </div>
                  <div className="loan-element-info">
                    <h4 className="loan-element-title" title={loan.element}>{loan.element}</h4>
                  </div>
                  <div className="loan-due-info">
                    <span className="loan-due-date">{loan.due_date}</span>
                    <p className={`loan-due-countdown ${loan.daysLeft <= 1 ? 'near' : ''}`}>
                      {loan.daysLeft < 0 ? 'Vencido' : `(${loan.daysLeft} días)`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card 5: Reservas Próximas a Vencer */}
        <div className="staff-home-card">
          <div className="staff-home-card-header">
            <h3>Reservas próximas a vencer</h3>
          </div>
          {nearExpireReservations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon-wrapper"><FiCalendar /></div>
              <p>No hay reservas próximas a vencer.</p>
              <span className="empty-state-sub">¡Todo al día!</span>
            </div>
          ) : (
            <div className="active-loans-list">
              {nearExpireReservations.map((res: any) => (
                <div key={res.id} className="loan-item-card">
                  <div className="loan-user-avatar" style={{ background: '#a855f7' }}>
                    {res.user_name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="loan-details">
                    <h4 className="loan-user-name">{res.user_name}</h4>
                    <p className="loan-user-id">ID: {res.user_id}</p>
                  </div>
                  <div className="loan-element-info">
                    <h4 className="loan-element-title" title={res.element}>{res.element}</h4>
                  </div>
                  <div className="loan-due-info">
                    <span className="loan-due-date">{res.expiration_date}</span>
                    <p className={`loan-due-countdown ${res.daysLeft <= 1 ? 'near' : ''}`}>
                      {res.daysLeft < 0 ? 'Expirada' : `(${res.daysLeft} días)`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card 6: Avisos y Notificaciones */}
        <div className="staff-home-card">
          <div className="staff-home-card-header">
            <h3>Avisos y notificaciones</h3>
          </div>
          {notices.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon-wrapper"><FiInfo /></div>
              <p>No tienes notificaciones pendientes.</p>
              <span className="empty-state-sub">¡Sistemas estables!</span>
            </div>
          ) : (
            <div className="notices-list">
              {notices.map((n: any, i: number) => (
                <div key={i} className="notice-item">
                  <div className={`notice-icon-box ${n.type}`}>
                    {n.type === 'warning' ? <FiAlertTriangle size={15} /> : (n.type === 'success' ? <FiCheckCircle size={15} /> : <FiInfo size={15} />)}
                  </div>
                  <div className="notice-content">
                    <h4 className="notice-title">{n.title}</h4>
                    <p className="notice-desc">{n.desc}</p>
                  </div>
                  <span className="notice-time">{n.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
