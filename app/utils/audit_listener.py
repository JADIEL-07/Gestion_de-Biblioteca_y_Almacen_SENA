from sqlalchemy import event
from flask import request, has_request_context
from flask_jwt_extended import get_jwt_identity
from ..extensions import db
from ..models.audit_log import AuditLog
import json

def get_current_user_id():
    try:
        if has_request_context():
            # Intentar obtener de JWT
            identity = get_jwt_identity()
            if identity:
                return str(identity)
    except:
        pass
    return None

def get_remote_address():
    if has_request_context():
        return request.remote_addr
    return None

def get_user_agent():
    if has_request_context():
        return request.user_agent.string
    return None

def register_audit_listeners():
    # Lista de modelos a auditar (evitar AuditLog para no entrar en bucle)
    from ..models.user import User, Role
    from ..models.item import Item
    from ..models.loan import Loan
    from ..models.reservation import Reservation
    
    models = [User, Role, Item, Loan, Reservation]

    for model in models:
        @event.listens_for(model, 'after_insert')
        def receive_after_insert(mapper, connection, target):
            log_change(target, 'INSERT')

        @event.listens_for(model, 'after_update')
        def receive_after_update(mapper, connection, target):
            log_change(target, 'UPDATE')

        @event.listens_for(model, 'after_delete')
        def receive_after_delete(mapper, connection, target):
            log_change(target, 'DELETE')

def log_change(target, action):
    # Evitar recursividad si algo sale mal
    if isinstance(target, AuditLog):
        return

    user_id = get_current_user_id()
    entity = target.__tablename__
    entity_id = getattr(target, 'id', None)
    
    # Capturar cambios si es UPDATE
    details = None
    if action == 'UPDATE':
        changes = {}
        for column in target.__table__.columns:
            attr = getattr(target, column.name)
            history = db.inspect(target).attrs.get(column.name).history
            if history.has_changes():
                old_val = history.deleted[0] if history.deleted else None
                new_val = history.added[0] if history.added else None
                # No loguear passwords
                if 'password' in column.name.lower():
                    changes[column.name] = "[MODIFICADO]"
                else:
                    changes[column.name] = {"from": str(old_val), "to": str(new_val)}
        if changes:
            details = json.dumps(changes, ensure_ascii=False)
    elif action == 'INSERT':
        # Para insert, podemos guardar los datos iniciales
        data = {}
        for column in target.__table__.columns:
            if 'password' in column.name.lower():
                data[column.name] = "[PROTEGIDO]"
            else:
                data[column.name] = str(getattr(target, column.name))
        details = json.dumps(data, ensure_ascii=False)

    # Crear el log de auditoría
    # Usamos una conexión directa o un nuevo objeto para evitar interferir con la sesión actual
    # Pero SQLAlchemy event listeners pueden ser delicados con db.session.add dentro de un hook.
    # Usaremos el objeto connection proporcionado por el evento si es posible, 
    # o simplemente agregamos a la sesión si estamos en el mismo hilo.
    
    # IMPORTANTE: No podemos usar db.session.add(log) directamente en after_insert/update 
    # porque causaría un flush infinito o conflictos de estado.
    # Lo ideal es usar `connection.execute` o programar una inserción posterior.
    
    # Para simplicidad y seguridad, usaremos una inserción SQL directa vía connection.
    from datetime import datetime
    
    # Preparar valores
    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    ip = get_remote_address()
    ua = get_user_agent()
    
    # Inserción manual para evitar bucles de eventos de SQLAlchemy
    stmt = AuditLog.__table__.insert().values(
        user_id=user_id,
        action=action,
        entity=entity,
        entity_id=str(entity_id) if entity_id else None,
        ip=ip,
        user_agent=ua,
        details=details,
        created_at=datetime.utcnow()
    )
    
    # Ejecutar en el objeto connection
    try:
        from sqlalchemy import create_mock_engine
        # Estamos en un evento, la conexión ya está abierta
        # target_connection = db.engine.connect() # No, mejor usar una transacción separada o la misma
        # Pero after_update ya tiene una transacción activa.
        
        # Como no tenemos acceso fácil a 'connection' en todos los decoradores de arriba 
        # (algunos eventos no lo pasan si no se pide), usaremos db.session de forma cautelosa
        # o mejor aún, capturamos 'connection' en los listeners.
        pass
    except:
        pass

# Redefinimos los listeners para pasar 'connection'
def register_audit_listeners_v2():
    from ..models.user import User, Role

    # Item, Loan y Reservation SALIERON de esta lista: ahora se auditan con
    # llamadas manuales en sus propias rutas (ITEM_CREATED/UPDATED/DELETED,
    # RESERVATION_CREATED/CANCELLED/APPROVED, LOAN_CREATED/RETURNED), que dan
    # una acción con nombre propio, un entity_name resuelto correctamente y
    # un detalle legible — en vez del volcado genérico de todas las columnas
    # que hacía este listener, que además quedaba DUPLICADO con esas llamadas
    # manuales (dos registros de auditoría por cada cambio).
    models = [User, Role]

    for model in models:
        @event.listens_for(model, 'after_insert')
        def receive_after_insert(mapper, connection, target):
            do_manual_log(connection, target, 'INSERT')

        @event.listens_for(model, 'after_update')
        def receive_after_update(mapper, connection, target):
            do_manual_log(connection, target, 'UPDATE')

        @event.listens_for(model, 'after_delete')
        def receive_after_delete(mapper, connection, target):
            do_manual_log(connection, target, 'DELETE')

def do_manual_log(connection, target, action):
    if isinstance(target, AuditLog): return
    
    user_id = get_current_user_id()
    entity = target.__tablename__
    entity_id = getattr(target, 'id', None)
    
    # Helper para limpiar datos extensos (Base64)
    def clean_val(v):
        if v is None: return None
        if isinstance(v, str) and (len(v) > 500 or v.startswith('data:image')):
            return "[DATO_EXTENSO_OMITIDO]"
        return str(v)

    details = None
    if action == 'UPDATE':
        changes = {}
        ignored_fields = ['last_login', 'updated_at']
        
        for column in target.__table__.columns:
            if column.name in ignored_fields:
                continue
                
            state = db.inspect(target)
            attr = state.attrs.get(column.name)
            if attr.history.has_changes():
                old_val = attr.history.deleted[0] if attr.history.deleted else None
                new_val = attr.history.added[0] if attr.history.added else None
                
                if 'password' in column.name.lower():
                    changes[column.name] = "[MODIFICADO]"
                else:
                    changes[column.name] = {"from": clean_val(old_val), "to": clean_val(new_val)}
        
        if not changes:
            return
            
        details = json.dumps(changes, ensure_ascii=False)
    elif action == 'INSERT':
        data = {}
        for c in target.__table__.columns:
            val = getattr(target, c.name)
            if 'password' in c.name.lower():
                data[c.name] = "[PROTEGIDO]"
            else:
                data[c.name] = clean_val(val)
        details = json.dumps(data, ensure_ascii=False)

    # Intentar obtener el nombre representativo del objeto (name, nombre, etc)
    entity_name = getattr(target, 'name', getattr(target, 'nombre', None))
    if not entity_name and entity == 'loans':
        entity_name = f"Préstamo de {getattr(target.user, 'name', 'Usuario')}" if getattr(target, 'user', None) else "Préstamo"

    from datetime import datetime
    connection.execute(
        AuditLog.__table__.insert(),
        {
            "user_id": user_id,
            "action": action,
            "entity": entity,
            "entity_id": str(entity_id) if entity_id else None,
            "entity_name": str(entity_name) if entity_name else None,
            "ip": get_remote_address(),
            "user_agent": get_user_agent(),
            "details": details,
            "created_at": datetime.now()
        }
    )
