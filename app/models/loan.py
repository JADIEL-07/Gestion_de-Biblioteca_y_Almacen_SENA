from datetime import datetime
from .. import db

class Loan(db.Model):
    __tablename__ = 'loans'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False)
    loan_date = db.Column(db.DateTime, default=datetime.utcnow)
    due_date = db.Column(db.DateTime, nullable=False)
    return_date = db.Column(db.DateTime)
    admin_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=True) # El que realizó el préstamo
    status = db.Column(db.String(50), default='ACTIVE') # ACTIVE, RETURNED, OVERDUE, NOT_RETURNED
    fine_amount = db.Column(db.Float, default=0.0) # Multa automática por devolución tardía (informativa, no bloquea)

    # Sanción manual que un Admin impone cuando el préstamo queda NOT_RETURNED
    # (el aprendiz nunca devolvió el elemento). Mientras sanction_active sea
    # True, el usuario no puede crear nuevas reservas (ver enqueue_reservation
    # en reservation_queue.py) hasta que un Admin la "levante".
    sanction_type = db.Column(db.String(20), nullable=True)          # 'DAYS' | 'CUSTOM'
    sanction_days = db.Column(db.Integer, nullable=True)             # solo si sanction_type == 'DAYS'
    sanction_description = db.Column(db.Text, nullable=True)         # motivo escrito por el Admin
    sanction_active = db.Column(db.Boolean, default=False)
    sanction_created_at = db.Column(db.DateTime, nullable=True)
    sanction_lifted_at = db.Column(db.DateTime, nullable=True)
    sanction_lifted_by = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=True)

    # N:M relationship via LoanDetail
    details = db.relationship('LoanDetail', backref='loan', lazy=True)

class LoanDetail(db.Model):
    __tablename__ = 'loan_details'
    id = db.Column(db.Integer, primary_key=True)
    loan_id = db.Column(db.Integer, db.ForeignKey('loans.id'), nullable=False)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=False)
    delivery_status = db.Column(db.String(100))
    return_status = db.Column(db.String(100))
    
    item = db.relationship('Item', backref='loan_details')
