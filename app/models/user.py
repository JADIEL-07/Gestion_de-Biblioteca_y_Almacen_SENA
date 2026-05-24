from ..extensions import db
from .base import Base

class Role(Base):
    __tablename__ = 'roles'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    users = db.relationship('User', backref='role', lazy=True)

class FormationProgram(Base):
    __tablename__ = 'formation_programs'
    id = db.Column(db.String(50), primary_key=True) # Num de Ficha
    name = db.Column(db.String(100), nullable=False)

class User(Base):
    __tablename__ = 'users'
    # El ID ahora es el documento de identidad
    id = db.Column(db.String(50), primary_key=True) 
    document_type = db.Column(db.String(50), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    phone = db.Column(db.String(20), nullable=True)
    password = db.Column(db.String(255), nullable=False)
    profile_image = db.Column(db.Text, nullable=True) # Almacena Base64 o URL
    
    # FKs
    role_id = db.Column(db.Integer, db.ForeignKey('roles.id'), nullable=False)
    formation_ficha = db.Column(db.String(50), nullable=True) # Sin validación de FK
    dependency_id = db.Column(db.Integer, db.ForeignKey('dependencies.id'), nullable=True) # Para Bibliotecario/Almacenista
    
    # Status
    is_active = db.Column(db.Boolean, default=True)
    is_deleted = db.Column(db.Boolean, default=False)
    is_verified = db.Column(db.Boolean, default=False)   # Correo verificado al registrar
    must_change_password = db.Column(db.Boolean, default=False)   # Forzar cambio (post-recuperación)
    
    # Security & Tracking
    failed_attempts = db.Column(db.Integer, default=0)
    is_blocked = db.Column(db.Boolean, default=False)
    last_failed_login = db.Column(db.DateTime, nullable=True)
    last_login = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.String(50), nullable=True) # ID del admin que lo creó
    
    # Relationships
    refresh_tokens = db.relationship('RefreshToken', backref='user', lazy=True)
    audit_logs = db.relationship('AuditLog', backref='user', lazy=True)
    tickets_created = db.relationship('Ticket', backref='reporter', lazy=True, foreign_keys='Ticket.user_id')
    tickets_assigned = db.relationship('Ticket', backref='assignee', lazy=True, foreign_keys='Ticket.assigned_to')
