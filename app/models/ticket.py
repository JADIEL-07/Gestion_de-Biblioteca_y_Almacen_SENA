from datetime import datetime
from .. import db
from .base import Base

class Ticket(Base):
    __tablename__ = 'tickets'
    id = db.Column(db.Integer, primary_key=True)
    
    # Usuarios
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False) # Quien hizo el reporte
    assigned_to = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=True) # Soporte que tomó el caso
    
    # Contenido
    subject = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    
    # Clasificación
    severity = db.Column(db.String(20), default='MEDIUM') # LOW, MEDIUM, HIGH, CRITICAL
    status = db.Column(db.String(20), default='OPEN') # OPEN, IN_PROGRESS, CLOSED, CANCELLED
    
    # Gestión
    response = db.Column(db.Text, nullable=True)
    closed_at = db.Column(db.DateTime, nullable=True)
    
    photo = db.Column(db.Text, nullable=True) # Foto adjunta de la incidencia en base64
    source_thread_id = db.Column(db.String(100), nullable=True)  # Thread del asistente que originó el ticket

    is_deleted = db.Column(db.Boolean, default=False)
