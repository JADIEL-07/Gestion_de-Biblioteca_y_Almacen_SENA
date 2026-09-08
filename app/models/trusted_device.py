from datetime import datetime
from .. import db


class TrustedDevice(db.Model):
    """Dispositivos (navegadores) que el usuario ya aprobó por correo.
    Mientras el dispositivo esté aquí, el login no vuelve a pedir aprobación."""
    __tablename__ = 'trusted_devices'

    id            = db.Column(db.Integer, primary_key=True)
    user_id       = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False, index=True)
    device_id     = db.Column(db.String(64), nullable=False, index=True)   # UUID generado en el navegador
    label         = db.Column(db.String(160))                             # "Chrome en Windows"
    last_ip       = db.Column(db.String(64))
    last_location = db.Column(db.String(200))
    approved_at   = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen_at  = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'device_id', name='uq_trusted_user_device'),
    )
