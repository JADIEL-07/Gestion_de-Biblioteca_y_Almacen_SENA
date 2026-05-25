from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.maintenance import Maintenance
from ..models.item import Item, Status, Category
from ..models.movement import Notification
from ..models.user import User, Role
from sqlalchemy import func, or_, String
from datetime import datetime

maintenance_bp = Blueprint('maintenance', __name__)


def _full_media_url(path):
    if not path:
        return None
    try:
        if isinstance(path, str) and (path.startswith('http://') or path.startswith('https://')):
            return path
        if isinstance(path, str) and path.startswith('/uploads'):
            from flask import request
            return request.url_root.rstrip('/') + path
    except RuntimeError:
        return path
    return path

@maintenance_bp.route('/', methods=['GET'])
@jwt_required()
def get_maintenances():
    search = request.args.get('search', '')
    start_date = request.args.get('startDate', '')
    end_date = request.args.get('endDate', '')
    severity = request.args.get('severity', 'ALL')
    
    query = Maintenance.query.filter_by(is_deleted=False).join(Item, Maintenance.item_id == Item.id).join(User, Maintenance.reported_by == User.id)
    
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                Maintenance.id.cast(String).ilike(search_filter),
                Item.name.ilike(search_filter),
                Item.code.ilike(search_filter),
                User.name.ilike(search_filter),
                User.email.ilike(search_filter),
                Maintenance.status.ilike(search_filter),
                Maintenance.maintenance_type.ilike(search_filter)
            )
        )
        
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date).replace(hour=0, minute=0, second=0)
            query = query.filter(Maintenance.report_date >= start_dt)
        except ValueError:
            pass
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
            query = query.filter(Maintenance.report_date <= end_dt)
        except ValueError:
            pass
    if severity != 'ALL':
        query = query.filter(Maintenance.severity == severity)

    m_list = query.order_by(Maintenance.report_date.desc()).all()
    
    # Pre-fetch all users to avoid N+1 queries
    user_ids = set([m.reported_by for m in m_list] + [m.technician_id for m in m_list if m.technician_id])
    item_ids = set([m.item_id for m in m_list])
    users_cache = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
    items_cache = {i.id: i for i in Item.query.filter(Item.id.in_(item_ids)).all()} if item_ids else {}
    
    result = []
    for m in m_list:
        item = items_cache.get(m.item_id)
        reporter = users_cache.get(m.reported_by)
        tech = users_cache.get(m.technician_id) if m.technician_id else None
        
        result.append({
            "id": m.id,
            "item_name": item.name if item else "Eliminado",
            "item_code": item.code if item else "N/A",
            "item_category": item.category.name if item and item.category else "N/A",
            "item_id": m.item_id,
            "reported_by_name": reporter.name if reporter else "N/A",
            "reported_by_email": reporter.email if reporter else "",
            "technician_name": tech.name if tech else "Pendiente",
            "technician_email": tech.email if tech else "",
            "severity": m.severity,
            "status": m.status,
            "report_date": m.report_date.isoformat(),
            "maintenance_type": m.maintenance_type,
            "cost": m.cost,
            "evidence_photo": _full_media_url(m.evidence_photo)
        })
    return jsonify(result), 200

@maintenance_bp.route('/', methods=['POST'])
@jwt_required()
def create_maintenance():
    data = request.get_json()
    item_id = data.get('item_id')
    
    item = Item.query.get_or_404(item_id)
    
    # Bloquear equipo
    maint_status = Status.query.filter_by(name='IN_MAINTENANCE').first()
    if not maint_status:
        maint_status = Status(name='IN_MAINTENANCE')
        db.session.add(maint_status)
        db.session.flush()
    
    item.status_id = maint_status.id
    
    new_m = Maintenance(
        item_id=item_id,
        reported_by=get_jwt_identity(),
        failure_description=data.get('description'),
        severity=data.get('severity', 'LOW'),
        maintenance_type=data.get('type', 'CORRECTIVE'),
        status='PENDING'
    )
    
    db.session.add(new_m)
    db.session.commit()

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
                type='MAINTENANCE_CREATED',
                title='Nuevo reporte de mantenimiento',
                message=f'Se reportó una falla en "{item.name}": {new_m.failure_description[:100]}',
                related_type='item',
                related_id=new_m.id,
            ))
        db.session.commit()
    
    return jsonify({"success": True, "id": new_m.id}), 201

@maintenance_bp.route('/<int:id>/status', methods=['PUT'])
@jwt_required()
def update_status(id):
    m = Maintenance.query.get_or_404(id)
    data = request.get_json()
    new_status = data.get('status')
    
    if new_status not in ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']:
        return jsonify({"error": "Estado inválido"}), 400
        
    m.status = new_status
    
    # Manage item status based on maintenance status
    item = Item.query.get(m.item_id)
    if new_status in ['COMPLETED', 'CANCELLED']:
        m.end_date = datetime.utcnow()
        avail_status = Status.query.filter_by(name='AVAILABLE').first()
        if item and avail_status:
            item.status_id = avail_status.id
    elif new_status == 'IN_PROGRESS':
        maint_status = Status.query.filter_by(name='IN_MAINTENANCE').first()
        if item and maint_status:
            item.status_id = maint_status.id
    elif new_status == 'PENDING':
        maint_status = Status.query.filter_by(name='IN_MAINTENANCE').first()
        if item and maint_status:
            item.status_id = maint_status.id

    db.session.commit()
    return jsonify({"success": True}), 200

@maintenance_bp.route('/<int:id>/complete', methods=['POST'])
@jwt_required()
def complete_maintenance(id):
    m = Maintenance.query.get_or_404(id)
    data = request.get_json()
    
    m.status = 'COMPLETED'
    m.end_date = datetime.utcnow()
    m.solution = data.get('solution')
    m.diagnosis = data.get('diagnosis')
    m.cost = data.get('cost', 0.0)
    m.evidence_photo = None # Se procesará a continuación si hay una
    
    # Liberar equipo
    item = Item.query.get(m.item_id)
    avail_status = Status.query.filter_by(name='AVAILABLE').first()
    if item and avail_status:
        item.status_id = avail_status.id
        
    db.session.commit()

    # Procesar imagen en Base64 y guardarla físicamente
    evidence_photo_b64 = data.get('evidence_photo')
    if evidence_photo_b64 and evidence_photo_b64.startswith('data:image'):
        try:
            import os
            import base64
            from flask import current_app
            
            header, encoded = evidence_photo_b64.split(',', 1)
            ext = header.split(';')[0].split('/')[1]
            if ext == 'jpeg': ext = 'jpg'
            
            filename = f"maintenance_{m.id}.{ext}"
            filepath = os.path.join(current_app.root_path, 'uploads', filename)

            with open(filepath, "wb") as fh:
                fh.write(base64.b64decode(encoded))

            # Store absolute URL for the evidence photo
            m.evidence_photo = request.url_root.rstrip('/') + f"/uploads/{filename}"
            db.session.commit()
        except Exception as e:
            print("Error guardando foto del mantenimiento:", e)
    return jsonify({"success": True}), 200
