from datetime import datetime
from .. import db

class AuditLog(db.Model):
    __tablename__ = 'audit_logs'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=True)
    action = db.Column(db.String(50), nullable=False) # LOGIN_SUCCESS, etc.
    entity = db.Column(db.String(50), nullable=True) # loan, item, user
    entity_id = db.Column(db.String(50), nullable=True)
    entity_name = db.Column(db.String(100), nullable=True)
    ip = db.Column(db.String(45), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)
    details = db.Column(db.Text, nullable=True) # JSON o string con cambios
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
