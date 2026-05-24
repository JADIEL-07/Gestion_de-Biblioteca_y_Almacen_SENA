from datetime import datetime
from .. import db


class VerificationCode(db.Model):
    """
    Códigos de verificación por correo (6 dígitos) reutilizables para
    distintos propósitos:
      - ACCOUNT_VERIFY     → confirmar cuenta tras registro
      - PASSWORD_CHANGE    → confirmar cambio de contraseña desde Configuración
    """
    __tablename__ = 'verification_codes'

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False)
    purpose     = db.Column(db.String(30), nullable=False, index=True)
    code_hash   = db.Column(db.String(255), nullable=False)
    payload     = db.Column(db.Text, nullable=True)   # extra (ej. password hash pendiente)
    expires_at  = db.Column(db.DateTime, nullable=False)
    is_used     = db.Column(db.Boolean, default=False)
    attempts    = db.Column(db.Integer, default=0)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
