from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from ..models.loan import Loan
from ..models.reservation import Reservation
from ..models.item import Item

history_bp = Blueprint('history', __name__)


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


@history_bp.route('/my', methods=['GET'])
@jwt_required()
def my_history():
    """Tabla unificada del aprendiz: préstamos + reservas pasados y activos."""
    user_id = get_jwt_identity()
    rows = []

    # Préstamos
    loans = Loan.query.filter_by(user_id=str(user_id)).all()
    for loan in loans:
        items = [
            {
                "id": d.item_id,
                "name": d.item.name if d.item else "Ítem eliminado",
                "category": d.item.category.name if d.item and d.item.category else "N/A",
                "image_url": _full_media_url(d.item.image_url) if d.item else None
            }
            for d in loan.details
        ]
        rows.append({
            "kind": "LOAN",
            "id": loan.id,
            "date": loan.loan_date.isoformat() if loan.loan_date else None,
            "due_date": loan.due_date.isoformat() if loan.due_date else None,
            "return_date": loan.return_date.isoformat() if loan.return_date else None,
            "status": loan.status,
            "items": items,
            "fine_amount": loan.fine_amount,
        })

    # Reservas
    reservations = Reservation.query.filter_by(user_id=str(user_id)).all()
    for r in reservations:
        item = Item.query.get(r.item_id)
        rows.append({
            "kind": "RESERVATION",
            "id": r.id,
            "token": r.token,
            "date": r.reservation_date.isoformat() if r.reservation_date else None,
            "ready_at": r.ready_at.isoformat() if r.ready_at else None,
            "expiration_date": r.expiration_date.isoformat() if r.expiration_date else None,
            "status": r.status,
            "items": [{
                "id": r.item_id,
                "name": item.name if item else "Ítem eliminado",
                "category": item.category.name if item and item.category else "N/A",
                "image_url": _full_media_url(item.image_url) if item else None
            }],
        })

    rows.sort(key=lambda x: x.get("date") or "", reverse=True)
    return jsonify(rows), 200
