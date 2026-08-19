import os
from config import get_config
from .extensions import db, ma, migrate, jwt, mail, limiter

from flask import Flask, request, jsonify
from flask_cors import CORS


def _apply_runtime_migrations():
    """Aplica migraciones idempotentes al iniciar la app.

    - Ejecuta `db.create_all()` (idempotente) para crear tablas nuevas
      sin tocar las existentes.
    - Aplica ALTER TABLE con `ADD COLUMN IF NOT EXISTS` (PostgreSQL 9.6+).

    Nota sobre `is_verified`: la columna se crea con `DEFAULT TRUE` para que
    todos los usuarios pre-existentes queden verificados al añadirla.
    Los usuarios nuevos se insertan con `is_verified=False` explícito desde
    SQLAlchemy (el default de BD solo se aplica cuando el INSERT no incluye
    la columna).
    """
    from sqlalchemy import text

    # 1) Crear tablas nuevas (no toca existentes)
    try:
        db.create_all()
    except Exception as e:
        print(f"[runtime-migration] db.create_all aviso: {e}")

    # 2) Agregar columnas nuevas a tablas existentes (idempotente con IF NOT EXISTS).
    #    `is_verified` se añade con DEFAULT TRUE para no romper usuarios legítimos preexistentes.
    column_migrations = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(32)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN DEFAULT FALSE",
    ]
    for stmt in column_migrations:
        try:
            db.session.execute(text(stmt))
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            print(f"[runtime-migration] aviso ({stmt[:60]}...): {e}")

    # Migración de la columna biography (compatible con SQLite y Postgres)
    try:
        bind = db.engine
        is_sqlite = bind.dialect.name == 'sqlite'
        stmt_bio = "ALTER TABLE users ADD COLUMN biography TEXT" if is_sqlite else "ALTER TABLE users ADD COLUMN IF NOT EXISTS biography TEXT"
        db.session.execute(text(stmt_bio))
        db.session.commit()
        print("[runtime-migration] Columna biography agregada exitosamente.")
    except Exception as e:
        db.session.rollback()
        # Si ya existe, se ignora de forma segura
        if "duplicate column" not in str(e).lower() and "already exists" not in str(e).lower():
            print(f"[runtime-migration] aviso (biography): {e}")

    # Migración user_agent en refresh_tokens (con chequeo previo para evitar crash)
    try:
        from sqlalchemy import inspect
        insp = inspect(db.engine)
        cols = [c['name'] for c in insp.get_columns('refresh_tokens')]
        if 'user_agent' not in cols:
            stmt_ua = "ALTER TABLE refresh_tokens ADD COLUMN user_agent TEXT"
            db.session.execute(text(stmt_ua))
            db.session.commit()
            print("[runtime-migration] Columna user_agent agregada en refresh_tokens.")
    except Exception as e:
        db.session.rollback()
        print(f"[runtime-migration] aviso (user_agent): {e}")

def create_app():
    config = get_config()
    app = Flask(
        __name__,
        template_folder='static/dist',
        static_folder='static/dist',
        static_url_path=''
    )
    app.config.from_object(config)

    # ── Extensions ────────────────────────────────────────────────────────────
    db.init_app(app)
    ma.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    mail.init_app(app)
    limiter.init_app(app)

    # ── JWT User Lookup ───────────────────────────────────────────────────────
    from .models.user import User
    
    @jwt.user_lookup_loader
    def user_lookup_callback(_jwt_header, jwt_data):
        identity = jwt_data["sub"]
        user = User.query.filter_by(id=str(identity), is_deleted=False).first()
        if not user:
            print(f"DEBUG AUTH: Usuario con ID {identity} no encontrado o inactivo.")
        return user

    # ── CORS ──────────────────────────────────────────────────────────────────
    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    # ── Audit Listeners ───────────────────────────────────────────────────────
    from .utils.audit_listener import register_audit_listeners_v2
    with app.app_context():
        register_audit_listeners_v2()

    # ── Runtime migrations (idempotentes) ─────────────────────────────────────
    # Aplica columnas nuevas a tablas existentes sin requerir Flask-Migrate.
    # Cada sentencia usa `ADD COLUMN IF NOT EXISTS` (PostgreSQL 9.6+).
    with app.app_context():
        _apply_runtime_migrations()

    # ── Scheduler (cola FIFO de reservas) ─────────────────────────────────────
    # Evitar doble-lanzamiento bajo el reloader de Flask en desarrollo.
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        from .services.scheduler import init_scheduler
        init_scheduler(app)

    # ── Blueprints ────────────────────────────────────────────────────────────
    from .routes.auth_routes import auth_bp
    from .routes.item_routes import items_bp
    from .routes.dashboard_routes import dashboard_bp
    from .routes.user_routes import user_bp
    from .routes.audit_routes import audit_bp
    from .routes.loan_routes import loan_bp
    from .routes.reservation_routes import reservation_bp
    from .routes.maintenance_routes import maintenance_bp
    from .routes.report_routes import report_bp
    from .routes.output_routes import output_bp
    from .routes.notification_routes import notification_bp
    from .routes.history_routes import history_bp
    from .routes.assistant_routes import assistant_bp
    from .routes.spare_part_routes import spare_part_bp
    from .routes.chat_routes import chat_bp


    app.register_blueprint(auth_bp,      url_prefix='/api/v1/auth')
    app.register_blueprint(items_bp,     url_prefix='/api/v1/items')
    app.register_blueprint(dashboard_bp, url_prefix='/api/v1/dashboard')
    app.register_blueprint(user_bp,      url_prefix='/api/v1/users_mgmt')
    app.register_blueprint(audit_bp,     url_prefix='/api/v1/audit')
    app.register_blueprint(loan_bp,      url_prefix='/api/v1/loans')
    app.register_blueprint(reservation_bp, url_prefix='/api/v1/reservations')
    app.register_blueprint(maintenance_bp, url_prefix='/api/v1/maintenance')
    app.register_blueprint(report_bp,      url_prefix='/api/v1/reports_mgmt')
    app.register_blueprint(output_bp,      url_prefix='/api/v1/outputs')
    app.register_blueprint(notification_bp, url_prefix='/api/v1/notifications')
    app.register_blueprint(history_bp,     url_prefix='/api/v1/history')
    app.register_blueprint(assistant_bp,   url_prefix='/api/v1/assistant')
    app.register_blueprint(spare_part_bp,  url_prefix='/api/v1/spare_parts')
    app.register_blueprint(chat_bp,        url_prefix='/api/v1/chat')


    # ── Security & Cache Headers ──────────────────────────────────────────────────────
    @app.after_request
    def set_security_headers(response):
        response.headers['X-Frame-Options']        = 'DENY'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy']        = 'strict-origin-when-cross-origin'
        if not app.debug:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        
        # Prevent caching of index.html and HTML responses so frontend updates are loaded instantly
        if request.path == '/' or request.path.endswith('.html') or response.mimetype == 'text/html':
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response

    # ── Error Handling ────────────────────────────────────────────────────────
    def _try_serve_index():
        """Sirve app/static/dist/index.html si existe (modo SPA-hosting).

        En el despliegue real (docker-compose.yml) el frontend se sirve desde
        un contenedor Nginx separado y este backend es solo API, por lo que
        `dist/index.html` normalmente NO existe aquí. Sin ese chequeo,
        `send_static_file` lanza `NotFound`, y si eso ocurre dentro de un
        errorhandler (p.ej. `handle_404`) la excepción no vuelve a capturarse
        y escapa como un 500 crudo de Werkzeug/Gunicorn en vez de un JSON.
        """
        index_path = os.path.join(app.static_folder or '', 'index.html')
        if not os.path.exists(index_path):
            return jsonify({"message": "Not found", "path": request.path}), 404
        return app.send_static_file('index.html')

    @app.errorhandler(404)
    def handle_404(e):
        if request.path.startswith('/api/'):
            return jsonify({"message": "Not found", "path": request.path}), 404
        return _try_serve_index()

    @app.errorhandler(429)
    def handle_rate_limit(e):
        return jsonify({"message": "Too many requests"}), 429

    @app.errorhandler(405)
    def handle_method_not_allowed(e):
        return jsonify({"error": "Method not allowed", "path": request.path}), 405

    @app.errorhandler(500)
    def handle_500(e):
        return jsonify({"error": "Internal server error", "detail": str(e)}), 500

    @app.errorhandler(Exception)
    def handle_exception(e):
        import traceback
        print("EXCEPCION NO CAPTURADA:", traceback.format_exc())
        if request.path.startswith('/api/'):
            return jsonify({"error": str(e)}), 500
        return jsonify({"error": "Unexpected error"}), 500

    @app.route('/')
    def index():
        return _try_serve_index()

    # ── Uploads Config & Route ────────────────────────────────────────────────
    UPLOAD_FOLDER = os.path.join(app.root_path, 'uploads')
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
        
    @app.route('/uploads/<filename>')
    def uploaded_file(filename):
        from flask import send_from_directory
        return send_from_directory(UPLOAD_FOLDER, filename)

    # Catch-all for React Router: serve index.html for all non-API routes
    @app.route('/<path:path>')
    def spa_fallback(path):
        if path.startswith('api/') or path.startswith('uploads/'):
            return jsonify({"message": "Not found"}), 404
        return _try_serve_index()

    return app
