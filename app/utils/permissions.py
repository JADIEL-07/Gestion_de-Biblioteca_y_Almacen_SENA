from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from ..models.user import User

ADMIN = 'ADMIN'
INVENTORY_STAFF = ('ADMIN', 'BIBLIOTECARIO', 'ALMACENISTA')


def role_required(*roles):
    """Exige un JWT válido cuyo usuario tenga uno de los roles indicados.
    Reemplaza a @jwt_required(): responde 401 sin sesión y 403 con el rol equivocado."""
    allowed = {r.upper() for r in roles}

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user = User.query.get(get_jwt_identity())
            role_name = (user.role.name if user and user.role else '').strip().upper()
            if not user or role_name not in allowed:
                return jsonify({"error": "No tienes permiso para realizar esta acción."}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator
