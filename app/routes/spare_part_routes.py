from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.spare_part import SparePartRequest
from ..models.item import Item
from ..models.user import User
from ..models.audit_log import AuditLog
from datetime import datetime
import json

spare_part_bp = Blueprint('spare_parts', __name__)

@spare_part_bp.route('/', methods=['GET'])
@jwt_required()
def get_spare_parts():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    # Allow support and admin to see these requests
    role_name = user.role.name.upper() if user.role else ""
    if 'SOPORTE' not in role_name and role_name != 'ADMIN':
        return jsonify({"error": "Unauthorized"}), 403

    requests = SparePartRequest.query.filter_by(is_deleted=False).order_by(SparePartRequest.created_at.desc()).all()
    
    result = []
    for req in requests:
        item = Item.query.get(req.item_id)
        reporter = User.query.get(req.requested_by)
        result.append({
            "id": req.id,
            "item_name": item.name if item else "Elemento Eliminado",
            "item_code": item.code if item else "N/A",
            "item_id": req.item_id,
            "reason": req.reason,
            "cost": req.cost,
            "supplier": req.supplier,
            "status": req.status,
            "requested_by_name": reporter.name if reporter else "N/A",
            "created_at": req.created_at.isoformat(),
            "received_at": req.received_at.isoformat() if req.received_at else None,
            "invoice_image": req.invoice_image,
            "received_image": req.received_image
        })
        
    return jsonify(result), 200

@spare_part_bp.route('/', methods=['POST'])
@jwt_required()
def create_spare_part_request():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    role_name = user.role.name.upper() if user.role else ""
    if 'SOPORTE' not in role_name and role_name != 'ADMIN':
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json()
    item_id = data.get('item_id')
    reason = data.get('reason')
    cost = data.get('cost')
    supplier = data.get('supplier')
    invoice_image = data.get('invoice_image')

    if not all([item_id, reason, cost, supplier, invoice_image]):
        return jsonify({"error": "Missing required fields"}), 400

    item = Item.query.get(item_id)
    if not item:
        return jsonify({"error": "Item not found"}), 404

    new_req = SparePartRequest(
        item_id=item_id,
        requested_by=user.id,
        reason=reason,
        cost=float(cost),
        supplier=supplier,
        invoice_image=invoice_image,
        status='PENDING'
    )
    
    db.session.add(new_req)
    db.session.commit()

    db.session.add(AuditLog(
        user_id=user_id, action="SPARE_PART_CREATED", entity="spare_parts",
        entity_id=str(new_req.id), entity_name=item.name,
        details=json.dumps({"Motivo": reason, "Costo": cost, "Proveedor": supplier}),
        ip=request.remote_addr,
    ))
    db.session.commit()

    return jsonify({"success": True, "message": "Solicitud de repuesto creada", "id": new_req.id}), 201

@spare_part_bp.route('/<int:id>/receive', methods=['PUT'])
@jwt_required()
def receive_spare_part(id):
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    role_name = user.role.name.upper() if user.role else ""
    if 'SOPORTE' not in role_name and role_name != 'ADMIN':
        return jsonify({"error": "Unauthorized"}), 403

    req = SparePartRequest.query.get_or_404(id)
    if req.status == 'RECEIVED':
        return jsonify({"error": "Este repuesto ya fue recibido"}), 400

    data = request.get_json()
    received_image = data.get('received_image')

    if not received_image:
        return jsonify({"error": "Se requiere evidencia fotográfica (imagen del repuesto recibido)"}), 400

    req.status = 'RECEIVED'
    req.received_image = received_image
    req.received_at = datetime.utcnow()

    item = Item.query.get(req.item_id)
    db.session.add(AuditLog(
        user_id=user_id, action="SPARE_PART_RECEIVED", entity="spare_parts",
        entity_id=str(req.id), entity_name=item.name if item else None,
        ip=request.remote_addr,
    ))
    db.session.commit()

    return jsonify({"success": True, "message": "Repuesto marcado como recibido"}), 200
