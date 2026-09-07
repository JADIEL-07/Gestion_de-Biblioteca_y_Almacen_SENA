from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..models.item import Item, Category, Status
from ..models.user import User
from ..models.loan import Loan
from ..models.reservation import Reservation
from ..models.maintenance import Maintenance
from ..models.audit_log import AuditLog
from sqlalchemy import func, desc
from datetime import datetime, timedelta
from ..extensions import db

dashboard_bp = Blueprint('dashboard', __name__)


def _full_media_url(path):
    """Normaliza rutas de media a una ruta RELATIVA ('/uploads/...').
    Así funcionan igual en dev (proxy de Vite) y en producción (nginx) sin
    hornear el host en la respuesta. Repara además valores absolutos que
    hayan quedado guardados en la BD (http://host/uploads/...)."""
    if not isinstance(path, str) or not path:
        return None
    if path.startswith('data:'):
        return path
    if path.startswith(('http://', 'https://')):
        idx = path.find('/uploads/')
        return path[idx:] if idx != -1 else path
    return path

@dashboard_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_dashboard_stats():
    try:
        # 1. Metri-Kpis Principales - Conteo directo y robusto
        total_items = Item.query.count()
        
        # Identificar estados de forma flexible
        all_statuses = Status.query.all()
        loaned_ids = [s.id for s in all_statuses if s.name.upper() in ['PRESTADO', 'LOANED', 'OCUPADO']]
        maint_ids = [s.id for s in all_statuses if s.name.upper() in ['EN MANTENIMIENTO', 'MANTENIMIENTO']]
        damaged_ids = [s.id for s in all_statuses if s.name.upper() in ['DAÑADO', 'DAÑADO', 'MALO', 'PERDIDO', 'DAÃ‘ADO']]

        active_loans = Item.query.filter(Item.status_id.in_(loaned_ids)).count() if loaned_ids else 0
        maintenance = Item.query.filter(Item.status_id.in_(maint_ids)).count() if maint_ids else 0
        damaged = Item.query.filter(Item.status_id.in_(damaged_ids)).count() if damaged_ids else 0
        
        # Disponible = Total - Prestados - Mantenimiento - Dañados
        available = total_items - active_loans - maintenance - damaged
        
        active_reservations = Reservation.query.filter(Reservation.status.in_(['QUEUED', 'READY'])).count()

        # 2. Datos para Gráfico de Torta (Estados)
        pie_data = []
        colors = {
            'DISPONIBLE': '#39A900', 'EXCELENTE': '#39A900', 'BUENO': '#4ade80',
            'REGULAR': '#fbbf24', 'PRESTADO': '#eab308', 'OCUPADO': '#eab308',
            'MANTENIMIENTO': '#f97316', 'EN MANTENIMIENTO': '#f97316',
            'DAÑADO': '#ef4444', 'MALO': '#ef4444', 'PERDIDO': '#64748b'
        }
        for s in all_statuses:
            count = Item.query.filter_by(status_id=s.id).count()
            if count > 0:
                name_upper = s.name.upper()
                pie_data.append({
                    "name": s.name.capitalize(),
                    "value": count,
                    "color": colors.get(name_upper, '#94a3b8')
                })
        
        # Si no hay datos, enviamos los básicos vacíos para el diseño
        if not pie_data:
            pie_data = [{"name": "Sin elementos", "value": 1, "color": "#f1f5f9"}]

        # 3. Datos para Gráfico de Barras (Categorías)
        categories = Category.query.all()
        cat_data = []
        for c in categories:
            count = Item.query.filter_by(category_id=c.id).count()
            if count > 0:
                pct = (count / total_items * 100) if total_items > 0 else 0
                cat_data.append({
                    "name": c.name,
                    "val": count,
                    "pct": round(pct, 1)
                })
        cat_data = sorted(cat_data, key=lambda x: x['val'], reverse=True)[:5]

        # 4. Actividad Reciente (AuditLog)
        recent_logs = AuditLog.query.order_by(desc(AuditLog.created_at)).limit(10).all()
        activity = []
        for log in recent_logs:
            activity.append({
                "id": log.id,
                "user": log.user_id, # Documento del usuario
                "action": log.action,
                "target": f"{log.entity_name} #{log.entity_id}",
                "time": log.created_at.isoformat(),
                "type": log.action.lower()
            })

        # 5. Próximas devoluciones (Reales)
        upcoming_loans = Loan.query.filter(Loan.status == 'ACTIVE').order_by(Loan.return_date.asc()).limit(5).all()
        upcoming_returns = []
        for l in upcoming_loans:
            from ..models.loan import LoanDetail
            details = LoanDetail.query.filter_by(loan_id=l.id).all()
            item_name = "Elemento"
            item_image = ""
            if details:
                item = Item.query.get(details[0].item_id)
                if item:
                    item_name = item.name
                    item_image = _full_media_url(item.image_url)
            
            from ..models.user import User
            user = User.query.get(l.user_id)
            user_name = user.name if user else "Usuario"
            upcoming_returns.append({
                "id": l.id,
                "item_name": item_name,
                "user_name": user_name,
                "date": l.return_date.isoformat() if l.return_date else datetime.now().isoformat(),
                "image": item_image
            })

        # 6. Estructura para gráfico de líneas (Últimos 6 meses)
        trends = []
        for i in range(5, -1, -1):
            month_date = datetime.now() - timedelta(days=i*30)
            month_name = month_date.strftime('%b')
            trends.append({"name": month_name, "value": 0}) 

        return jsonify({
            "metrics": {
                "total": total_items,
                "available": available,
                "loans": active_loans,
                "maintenance": maintenance,
                "reservations": active_reservations
            },
            "pieData": pie_data,
            "catData": cat_data,
            "activity": activity,
            "lineData": trends,
            "upcomingReturns": upcoming_returns
        })
    except Exception as e:
        print(f"[ERROR] dashboard_stats: {e}")
        return jsonify({"error": str(e)}), 500

@dashboard_bp.route('/aprendiz/stats', methods=['GET'])
@jwt_required()
def get_aprendiz_stats():
    try:
        user_id = str(get_jwt_identity()) # Forzamos a string para coincidir con la DB
        
        # 1. Metri-Kpis Personales - Usamos filtros más robustos
        active_loans = Loan.query.filter(
            Loan.user_id == user_id, 
            Loan.status.in_(['ACTIVE', 'active', 'PRESTADO', 'prestado'])
        ).count()
        print(f"DEBUG_APRENDIZ: User {user_id} has {active_loans} loans in DB query")
        
        active_reservations = Reservation.query.filter(
            Reservation.user_id == user_id, 
            Reservation.status.in_(['QUEUED', 'READY'])
        ).count()
        
        overdue_loans = Loan.query.filter(
            Loan.user_id == user_id, 
            Loan.status.in_(['OVERDUE', 'overdue', 'VENCIDO', 'vencido'])
        ).count()
        
        # Calcular multas pendientes
        pending_fines = db.session.query(func.sum(Loan.fine_amount)).filter(Loan.user_id == user_id).scalar() or 0.0
        
        # 2. Préstamos Activos Detallados
        loans = Loan.query.filter(
            Loan.user_id == user_id, 
            Loan.status.in_(['ACTIVE', 'active', 'PRESTADO', 'prestado'])
        ).order_by(Loan.due_date.asc()).limit(5).all()
        active_loans_list = []
        for l in loans:
            # Obtener nombres de ítems de forma garantizada
            from ..models.loan import LoanDetail
            
            # Buscamos los detalles explícitamente para evitar problemas de relación perezosa (lazy loading)
            details = LoanDetail.query.filter_by(loan_id=l.id).all()
            item_names = []
            for d in details:
                item = Item.query.get(d.item_id)
                if item:
                    item_names.append(item.name)
            
            active_loans_list.append({
                "id": l.id,
                "items": ", ".join(item_names) if item_names else "Elemento sin nombre",
                "due_date": l.due_date.isoformat() if l.due_date else datetime.now().isoformat(),
                "status": l.status
            })

        # 3. Reservas Recientes
        reservations = Reservation.query.filter(
            Reservation.user_id == user_id,
            Reservation.status.in_(['QUEUED', 'READY'])
        ).order_by(Reservation.reservation_date.desc()).limit(5).all()
        res_list = []
        for r in reservations:
            item = Item.query.get(r.item_id)
            res_list.append({
                "id": r.id,
                "item_name": item.name if item else "Elemento",
                "expiration": r.expiration_date.isoformat() if r.expiration_date else "En espera",
                "status": r.status
            })

        # 4. Actividad Reciente del Usuario
        recent_logs = AuditLog.query.filter_by(user_id=user_id).order_by(desc(AuditLog.created_at)).limit(10).all()
        activity = []
        for log in recent_logs:
            activity.append({
                "id": log.id,
                "action": log.action,
                "target": f"{log.entity_name} #{log.entity_id}",
                "time": log.created_at.isoformat()
            })

        return jsonify({
            "metrics": {
                "loans": active_loans,
                "reservations": active_reservations,
                "overdue": overdue_loans,
                "fines": pending_fines
            },
            "active_loans": active_loans_list,
            "reservations": res_list,
            "activity": activity
        })
    except Exception as e:
        print(f"[ERROR] aprendiz_stats: {e}")
        return jsonify({"error": str(e)}), 500
