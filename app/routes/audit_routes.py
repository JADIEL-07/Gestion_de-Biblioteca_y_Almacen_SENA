from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..models.audit_log import AuditLog
from ..models.user import User
from sqlalchemy import func, or_, String

audit_bp = Blueprint('audit', __name__)

def admin_required(fn):
    def wrapper(*args, **kwargs):
        # El rol se valida contra la BD, no contra el claim "role" del JWT:
        # ese claim se graba en el token al iniciar sesión y no se actualiza
        # solo. Si un Admin le daba el rol ADMIN a alguien que ya tenía la
        # sesión abierta, esa persona seguía cargando con el token viejo (con
        # el rol anterior) y esta ruta la rechazaba con "Admin privileges
        # required" aunque en la BD ya figurara como Administrador.
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        role_name = (user.role.name if user and user.role else '').strip().upper()
        if role_name not in ('ADMIN', 'ADMINISTRADOR'):
            return jsonify({"error": "Admin privileges required"}), 403
        return fn(*args, **kwargs)
    wrapper.__name__ = fn.__name__
    return jwt_required()(wrapper)

@audit_bp.route('/', methods=['GET'])
@admin_required
def get_audit_logs():
    search      = request.args.get('search', '')
    start_date  = request.args.get('startDate', '')
    end_date    = request.args.get('endDate', '')
    action_type = request.args.get('action_type', 'ALL')  # LOGIN, INSERT, UPDATE, DELETE, SECURITY, ALL

    query = AuditLog.query.outerjoin(User, AuditLog.user_id == User.id)

    # Filtro por tipo de acción (agrupado)
    if action_type and action_type not in ['ALL', '']:
        if action_type == 'LOGIN':
            query = query.filter(AuditLog.action.ilike('%LOGIN%'))
        elif action_type == 'INSERT':
            query = query.filter(AuditLog.action.ilike('%INSERT%'))
        elif action_type == 'UPDATE':
            query = query.filter(AuditLog.action.ilike('%UPDATE%'))
        elif action_type == 'DELETE':
            query = query.filter(AuditLog.action.ilike('%DELETE%'))
        elif action_type == 'SECURITY':
            query = query.filter(
                or_(
                    AuditLog.action.ilike('%BLOCK%'),
                    AuditLog.action.ilike('%SECURITY%'),
                    AuditLog.action.ilike('%PASSWORD%'),
                    AuditLog.action.ilike('%RESET%')
                )
            )

    # Búsqueda global
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                AuditLog.id.cast(String).ilike(search_filter),
                User.name.ilike(search_filter),
                User.email.ilike(search_filter),
                User.phone.ilike(search_filter),
                User.id.cast(String).ilike(search_filter),
                AuditLog.action.ilike(search_filter),
                AuditLog.entity.ilike(search_filter),
                AuditLog.ip.ilike(search_filter),
                AuditLog.details.ilike(search_filter)
            )
        )

    if start_date:
        query = query.filter(AuditLog.created_at >= f"{start_date} 00:00:00")
    if end_date:
        query = query.filter(AuditLog.created_at <= f"{end_date} 23:59:59")

    logs = query.order_by(AuditLog.created_at.desc()).all()

    result = []
    for log in logs:
        user_obj = None
        if log.user_id:
            try:
                user_obj = User.query.get(str(log.user_id))
            except Exception:
                user_obj = None

        # Resolver nombre de la entidad afectada (Priorizar el nombre guardado en el log)
        entity_name = log.entity_name
        
        if not entity_name and log.entity_id:
            try:
                e_id_str = str(log.entity_id)
                if log.entity == 'users':
                    eu = User.query.get(e_id_str)
                    entity_name = eu.name if eu else f"Usuario ID:{e_id_str}"
                elif log.entity == 'items':
                    from ..models.item import Item
                    ei = Item.query.get(int(log.entity_id))
                    entity_name = ei.name if ei else f"Elemento ID:{e_id_str}"
                elif log.entity == 'loans':
                    entity_name = f"Préstamo #{e_id_str}"
                elif log.entity == 'reservations':
                    entity_name = f"Reserva #{e_id_str}"
                elif log.entity == 'maintenance':
                    entity_name = f"Mantenimiento #{e_id_str}"
            except Exception as e:
                print(f"[DEBUG] Error resolving entity name: {e}")
                entity_name = f"ID:{log.entity_id}"

        result.append({
            "id":          log.id,
            "user":        user_obj.name  if user_obj else "Sistema/Anónimo",
            "user_id":     log.user_id,
            "user_email":  user_obj.email if user_obj else "",
            "user_phone":  user_obj.phone if user_obj else "",
            "user_role":   user_obj.role.name if (user_obj and user_obj.role) else "—",
            "action":      log.action,
            "entity":      log.entity or "—",
            "entity_id":   log.entity_id,
            "entity_name": entity_name,
            "ip":          log.ip or "—",
            "user_agent":  log.user_agent or "",
            "details":     log.details,
            "created_at":  log.created_at.isoformat()
        })

    return jsonify(result), 200
