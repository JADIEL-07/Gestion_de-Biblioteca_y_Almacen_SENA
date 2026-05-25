from datetime import datetime
from ..extensions import db
from .base import Base


class PendingRegistration(Base):
    """
    Registros temporales de usuarios que aún no han confirmado su correo.
    Una vez confirman, se crea el registro en la tabla users y se elimina este.
    """
    __tablename__ = 'pending_registrations'

    id              = db.Column(db.Integer, primary_key=True)
    email           = db.Column(db.String(120), unique=True, nullable=False, index=True)
    document_number = db.Column(db.String(50), nullable=False)
    payload         = db.Column(db.Text, nullable=False)   # JSON string con datos del usuario
    code_hash       = db.Column(db.String(255), nullable=False)
    expires_at      = db.Column(db.DateTime, nullable=False)
    attempts        = db.Column(db.Integer, default=0)
