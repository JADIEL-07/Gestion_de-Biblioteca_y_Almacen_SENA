from datetime import datetime
from .. import db


class SavedItem(db.Model):
    """Elemento del catálogo que un usuario "guardó" (bookmark) para
    encontrarlo rápido — aparece primero en su catálogo y en su lista de
    Favoritos. Es solo una preferencia visual: NO afecta el orden en el que
    se asignan los elementos al liberarse (la cola de reservas sigue siendo
    por orden de llegada, igual para todos)."""
    __tablename__ = 'saved_items'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False, index=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'item_id', name='uq_saved_user_item'),
    )
