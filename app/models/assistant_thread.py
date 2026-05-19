from datetime import datetime
from .. import db

class AssistantThread(db.Model):
    __tablename__ = 'assistant_threads'

    id = db.Column(db.String(50), primary_key=True)
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False)
    title = db.Column(db.String(200), default='Nueva conversación')
    messages = db.Column(db.Text, default='[]')  # JSON serializado
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
