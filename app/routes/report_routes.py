from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.ticket import Ticket
from ..models.user import User, Role
from ..models.movement import Notification
from sqlalchemy import func
from datetime import datetime

report_bp = Blueprint('reports', __name__)

@report_bp.route('/', methods=['GET'])
@jwt_required()
def get_reports():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    search = request.args.get('search', '')
    start_date = request.args.get('startDate', '')
    end_date = request.args.get('endDate', '')
    
    # Solo ADMIN y SOPORTE TÉCNICO tienen acceso
    role_name = user.role.name.upper() if user.role else ""
    is_admin = role_name == 'ADMIN'
    is_support = 'SOPORTE' in role_name
    
    if not is_admin and not is_support:
        return jsonify({"error": "Acceso denegado. No tienes permisos para ver reportes."}), 403

    query = Ticket.query.filter_by(is_deleted=False).join(User, Ticket.user_id == User.id)

    # Restricción para Soporte Técnico: solo ver reportes asignados a sí mismo
    if is_support:
        query = query.filter(Ticket.assigned_to == user.id)
        
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            func.concat(Ticket.id, ' ', Ticket.subject, ' ', User.name).ilike(search_filter)
        )
        
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date).replace(hour=0, minute=0, second=0)
            query = query.filter(Ticket.created_at >= start_dt)
        except ValueError:
            pass
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
            query = query.filter(Ticket.created_at <= end_dt)
        except ValueError:
            pass

    tickets = query.order_by(Ticket.created_at.desc()).all()
    
    # Pre-fetch all users to avoid N+1 queries
    user_ids = set([t.user_id for t in tickets] + [t.assigned_to for t in tickets if t.assigned_to])
    users_cache = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
    
    result = []
    for t in tickets:
        reporter = users_cache.get(t.user_id)
        support = users_cache.get(t.assigned_to) if t.assigned_to else None
        
        result.append({
            "id": t.id,
            "subject": t.subject,
            "description": t.description,
            "severity": t.severity,
            "status": t.status,
            "reported_by": reporter.name if reporter else "N/A",
            "support_person": support.name if support else "Pendiente",
            "created_at": t.created_at.isoformat(),
            "photo": t.photo
        })
    return jsonify(result), 200

@report_bp.route('/', methods=['POST'])
@jwt_required()
def create_report():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    data = request.get_json() or {}
    subject = data.get('subject', '').strip()
    description = data.get('description', '').strip()
    severity = data.get('severity', 'MEDIUM').strip().upper()
    photo = data.get('photo') # Base64 string
    
    if not subject or not description:
        return jsonify({"error": "El asunto y la descripción son obligatorios."}), 400
        
    if severity not in ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']:
        severity = 'MEDIUM'
        
    ticket = Ticket(
        user_id=user.id,
        subject=subject,
        description=description,
        severity=severity,
        status='OPEN',
        photo=None # Se guarda temporalmente vacío para obtener el ID
    )
    
    db.session.add(ticket)
    db.session.commit()

    if photo and photo.startswith('data:image'):
        try:
            import os
            import base64
            from flask import current_app
            
            # extract extension and base64 string
            header, encoded = photo.split(',', 1)
            ext = header.split(';')[0].split('/')[1]
            if ext == 'jpeg': ext = 'jpg'
            
            filename = f"ticket_{ticket.id}.{ext}"
            filepath = os.path.join(current_app.root_path, 'uploads', filename)
            
            with open(filepath, "wb") as fh:
                fh.write(base64.b64decode(encoded))
                
            ticket.photo = f"/uploads/{filename}"
            db.session.commit()
        except Exception as e:
            print("Error guardando foto del ticket:", e)
    
    # Notificar a todos los usuarios de Soporte
    soporte_role = Role.query.filter(
        Role.name.in_(['SOPORTE_TECNICO', 'SOPORTE', 'SOPORTE TÉCNICO', 'SOPORTE TECNICO'])
    ).first()
    if soporte_role:
        soporte_users = User.query.filter(
            User.role_id == soporte_role.id,
            User.is_deleted == False,
            User.is_active == True,
        ).all()
        for su in soporte_users:
            db.session.add(Notification(
                user_id=str(su.id),
                type='TICKET_CREATED',
                title='Nuevo reporte de incidencia',
                message=f'{user.name} reportó: {subject}',
                related_type='ticket',
                related_id=ticket.id,
            ))
        db.session.commit()

    return jsonify({
        "message": "Reporte creado exitosamente.",
        "id": ticket.id
    }), 201

@report_bp.route('/<int:ticket_id>/take', methods=['PUT'])
@jwt_required()
def take_case(ticket_id):
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    role_name = user.role.name.upper() if user.role else ""
    is_support = 'SOPORTE' in role_name
    is_admin = role_name == 'ADMIN'
    
    if not is_support and not is_admin:
        return jsonify({"error": "No autorizado. Solo personal de soporte técnico puede tomar casos."}), 403
        
    ticket = Ticket.query.get(ticket_id)
    if not ticket or ticket.is_deleted:
        return jsonify({"error": "Reporte no encontrado."}), 404
        
    if ticket.assigned_to:
        return jsonify({"error": "Este caso ya ha sido tomado por otro técnico."}), 400
        
    ticket.assigned_to = user.id
    ticket.status = 'IN_PROGRESS'
    db.session.commit()
    
    return jsonify({
        "message": "Caso tomado exitosamente.",
        "ticket": {
            "id": ticket.id,
            "status": ticket.status,
            "assigned_to": ticket.assigned_to,
            "support_person": user.name
        }
    }), 200

@report_bp.route('/unassigned', methods=['GET'])
@jwt_required()
def get_unassigned_reports():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    role_name = user.role.name.upper() if user.role else ""
    is_support = 'SOPORTE' in role_name
    is_admin = role_name == 'ADMIN'
    
    if not is_support and not is_admin:
        return jsonify({"error": "No tienes permisos para ver incidencias pendientes."}), 403
        
    tickets = Ticket.query.filter_by(is_deleted=False, assigned_to=None, status='OPEN')\
        .order_by(Ticket.created_at.desc()).all()
        
    result = []
    for t in tickets:
        reporter = User.query.get(t.user_id)
        result.append({
            "id": t.id,
            "subject": t.subject,
            "description": t.description,
            "severity": t.severity,
            "status": t.status,
            "reported_by": reporter.name if reporter else "N/A",
            "created_at": t.created_at.isoformat(),
            "photo": t.photo
        })
        
    return jsonify(result), 200

@report_bp.route('/all_incidents', methods=['GET'])
@jwt_required()
def get_all_incidents():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    role_name = user.role.name.upper() if user.role else ""
    is_support = 'SOPORTE' in role_name
    is_admin = role_name == 'ADMIN'
    
    if not is_support and not is_admin:
        return jsonify({"error": "No tienes permisos para ver todas las incidencias."}), 403
        
    tickets = Ticket.query.filter_by(is_deleted=False).order_by(Ticket.created_at.desc()).all()
        
    result = []
    for t in tickets:
        reporter = User.query.get(t.user_id)
        support = User.query.get(t.assigned_to) if t.assigned_to else None
        result.append({
            "id": t.id,
            "subject": t.subject,
            "description": t.description,
            "severity": t.severity,
            "status": t.status,
            "reported_by": reporter.name if reporter else "N/A",
            "support_person": support.name if support else "Pendiente",
            "created_at": t.created_at.isoformat(),
            "photo": t.photo
        })
        
    return jsonify(result), 200

@report_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_report_stats():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    role_name = user.role.name.upper() if user.role else ""
    is_admin = role_name == 'ADMIN'
    is_support = 'SOPORTE' in role_name

    if not is_admin and not is_support:
        return jsonify({"error": "Acceso denegado. No tienes permisos para ver estadísticas."}), 403

    # Restricción de estadísticas para Soporte Técnico
    if is_support:
        total = Ticket.query.filter_by(is_deleted=False, assigned_to=user.id).count()
        open_t = Ticket.query.filter_by(is_deleted=False, status='OPEN', assigned_to=user.id).count()
        critical = Ticket.query.filter_by(is_deleted=False, severity='CRITICAL', assigned_to=user.id).count()
    else:
        total = Ticket.query.filter_by(is_deleted=False).count()
        open_t = Ticket.query.filter_by(is_deleted=False, status='OPEN').count()
        critical = Ticket.query.filter_by(is_deleted=False, severity='CRITICAL').count()
    
    return jsonify({
        "total": total,
        "open": open_t,
        "critical": critical
    }), 200

