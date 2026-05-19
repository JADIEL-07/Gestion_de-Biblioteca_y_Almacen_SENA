"""
WSGI entry point for Gunicorn in production.
This file is used by gunicorn and NOT used in development (run.py is used instead).
"""
import os
from dotenv import load_dotenv

load_dotenv()

# Start SSH tunnel if credentials are available
from run import start_ssh_tunnel
tunnel = start_ssh_tunnel()

from app import create_app, db
from app.models.user import Role, FormationProgram

app = create_app()

# Initialize database if needed (one-time setup)
with app.app_context():
    try:
        db.create_all()
        # Seed basic roles and programs
        if not Role.query.first():
            for r_name in ['ADMIN', 'BIBLIOTECARIO', 'ALMACENISTA',
                           'SOPORTE_TECNICO', 'EMPRESA', 'APRENDIZ', 'USUARIO']:
                db.session.add(Role(name=r_name))
            db.session.commit()
            print("Roles básicos creados.")
        if not FormationProgram.query.first():
            db.session.add(FormationProgram(id='2672153', name='ADSO'))
            db.session.commit()
            print("Programa de formación por defecto creado.")
    except Exception as e:
        print(f"[WARN] Error during DB initialization: {e}")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
