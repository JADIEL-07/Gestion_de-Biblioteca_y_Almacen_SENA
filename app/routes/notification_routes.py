from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from ..extensions import db
from ..models.movement import Notification

notification_bp = Blueprint('notifications', __name__)


def _serialize(n):
    return {
        "id": n.id,
        "title": n.title,
        "message": n.message,
        "type": n.type,
        "related_type": n.related_type,
        "related_id": n.related_id,
        "is_read": n.is_read,
        "date": n.date.isoformat() if n.date else None,
    }


@notification_bp.route('/', methods=['GET'])
@jwt_required()
def list_notifications():
    user_id = get_jwt_identity()
    limit = min(int(request.args.get('limit', 30)), 100)
    offset = max(int(request.args.get('offset', 0)), 0)
    only_unread = request.args.get('unread_only', 'false').lower() == 'true'

    q = Notification.query.filter_by(user_id=str(user_id))
    if only_unread:
        q = q.filter_by(is_read=False)
    items = q.order_by(Notification.date.desc()).offset(offset).limit(limit).all()
    return jsonify([_serialize(n) for n in items]), 200


@notification_bp.route('/unread-count', methods=['GET'])
@jwt_required()
def unread_count():
    user_id = get_jwt_identity()
    count = Notification.query.filter_by(user_id=str(user_id), is_read=False).count()
    return jsonify({"count": count}), 200


@notification_bp.route('/<int:nid>/read', methods=['POST'])
@jwt_required()
def mark_read(nid):
    user_id = get_jwt_identity()
    n = Notification.query.filter_by(id=nid, user_id=str(user_id)).first()
    if not n:
        return jsonify({"error": "No encontrada"}), 404
    n.is_read = True
    db.session.commit()
    return jsonify({"success": True}), 200


@notification_bp.route('/read-all', methods=['POST'])
@jwt_required()
def mark_all_read():
    user_id = get_jwt_identity()
    Notification.query.filter_by(user_id=str(user_id), is_read=False).update({"is_read": True})
    db.session.commit()
    return jsonify({"success": True}), 200


@notification_bp.route('/<int:nid>', methods=['DELETE'])
@jwt_required()
def delete_notification(nid):
    user_id = get_jwt_identity()
    n = Notification.query.filter_by(id=nid, user_id=str(user_id)).first()
    if not n:
        return jsonify({"error": "No encontrada"}), 404
    db.session.delete(n)
    db.session.commit()
    return jsonify({"success": True}), 200


@notification_bp.route('/clear-all', methods=['DELETE'])
@jwt_required()
def clear_all_notifications():
    user_id = get_jwt_identity()
    Notification.query.filter_by(user_id=str(user_id)).delete()
    db.session.commit()
    return jsonify({"success": True}), 200
