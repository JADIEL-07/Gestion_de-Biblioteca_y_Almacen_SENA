from .. import db
from .base import Base

class Category(db.Model):
    __tablename__ = 'categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    # A qué área de servicio (Biblioteca/Almacén) pertenece — igual que
    # Location.dependency_id. Nullable para no romper categorías ya
    # existentes creadas antes de esta separación.
    dependency_id = db.Column(db.Integer, db.ForeignKey('dependencies.id'), nullable=True)
    items = db.relationship('Item', backref='category', lazy=True)

class Location(db.Model):
    __tablename__ = 'locations'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    type = db.Column(db.String(50)) # internal/external
    dependency_id = db.Column(db.Integer, db.ForeignKey('dependencies.id'), nullable=True) # Relación con Dependencia
    items = db.relationship('Item', backref='location', lazy=True)

class Status(db.Model):
    __tablename__ = 'statuses'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False) # AVAILABLE, LOANED, etc.
    items = db.relationship('Item', backref='status_obj', lazy=True)

class Supplier(db.Model):
    __tablename__ = 'suppliers'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    contact = db.Column(db.String(100))
    phone = db.Column(db.String(20))
    email = db.Column(db.String(120))
    items = db.relationship('Item', backref='supplier', lazy=True)

class Item(Base):
    __tablename__ = 'items'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text)
    code = db.Column(db.String(100), unique=True, nullable=False) # QR / Serial
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=False)
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=False)
    status_id = db.Column(db.Integer, db.ForeignKey('statuses.id'), nullable=False)
    supplier_id = db.Column(db.Integer, db.ForeignKey('suppliers.id'))
    acquisition_date = db.Column(db.DateTime)
    value = db.Column(db.Float)
    nit = db.Column(db.String(50)) # NIT si aplica
    stock = db.Column(db.Integer, default=1) # Cantidad disponible
    brand = db.Column(db.String(100))
    model = db.Column(db.String(100))
    serial_number = db.Column(db.String(100)) # ISBN para libros, Serial para equipos
    physical_condition = db.Column(db.String(100)) # Excelente, Bueno, etc.
    image_url = db.Column(db.Text) # URL o Base64 de la imagen
    is_deleted = db.Column(db.Boolean, default=False) # Soft delete flag

    # Relations
    movements = db.relationship('Movement', backref='item', lazy=True)
    maintenance_records = db.relationship('Maintenance', backref='item', lazy=True)
    reservations = db.relationship('Reservation', backref='item', lazy=True)
    outputs = db.relationship('ItemOutput', backref='item', lazy=True)
    # loan_details remains for historical data
