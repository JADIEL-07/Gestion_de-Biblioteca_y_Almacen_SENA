from datetime import datetime
from .. import db

class Movement(db.Model):
    __tablename__ = 'movements'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=False)
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False)
    movement_type = db.Column(db.String(50)) # ENTRY, EXIT, LOAN, RETURN, MAINTENANCE
    reference_id = db.Column(db.Integer) # ID of loan, maintenance, etc.
    date = db.Column(db.DateTime, default=datetime.utcnow)
    description = db.Column(db.Text)

class Notification(db.Model):
    __tablename__ = 'notifications'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False, index=True)
    title = db.Column(db.String(150))
    message = db.Column(db.Text, nullable=False)
    type = db.Column(db.String(50), index=True)
    # NEW_LOGIN, USER_CREATED, TICKET_CREATED, STAFF_MESSAGE,
    # ITEM_CREATED, LOCATION_CREATED, CATEGORY_CREATED,
    # MAINTENANCE_CREATED, LOAN_OVERDUE, LOAN_80_PERCENT,
    # RESERVATION_READY, RESERVATION_REMINDER, RESERVATION_EXPIRED,
    # RESERVATION_QUEUED, LOAN_CREATED, LOAN_RETURNED, LOAN_DUE, GENERIC
    related_type = db.Column(db.String(50))   # 'reservation' | 'loan' | 'item'
    related_id = db.Column(db.Integer)
    is_read = db.Column(db.Boolean, default=False, index=True)
    date = db.Column(db.DateTime, default=datetime.utcnow, index=True)
