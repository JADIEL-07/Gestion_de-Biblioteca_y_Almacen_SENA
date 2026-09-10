import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    """Configuración base compartida."""
    SECRET_KEY                     = os.environ.get('SECRET_KEY')
    SQLALCHEMY_DATABASE_URI        = os.environ.get('DATABASE_URL', 'sqlite:///biblioteca.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS      = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }
    MAX_CONTENT_LENGTH             = 16 * 1024 * 1024  # Límite de 16MB para fotos

    JWT_SECRET_KEY                 = os.environ.get('JWT_SECRET_KEY')
    JWT_ACCESS_TOKEN_EXPIRES       = 7 * 86400   # 7 días (se renueva vía /auth/refresh)
    JWT_REFRESH_TOKEN_EXPIRES      = 30 * 86400  # 30 días

    MAIL_SERVER                    = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT                      = int(os.environ.get('MAIL_PORT', 587))
    MAIL_USE_TLS                   = os.environ.get('MAIL_USE_TLS', 'True') == 'True'
    MAIL_USERNAME                  = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD                  = os.environ.get('MAIL_PASSWORD')
    # Nombre visible del remitente (lo que ve quien recibe el correo, en vez de
    # "gestion.sena.b"). La dirección debe seguir siendo la cuenta autenticada en Gmail.
    MAIL_SENDER_NAME               = os.environ.get('MAIL_SENDER_NAME', 'Gestión de Inventario SENA')
    _mail_from                     = os.environ.get('MAIL_DEFAULT_SENDER') or os.environ.get('MAIL_USERNAME')
    MAIL_DEFAULT_SENDER            = (MAIL_SENDER_NAME, _mail_from) if _mail_from else None

    # URL pública del sitio: se usa para construir enlaces e imágenes absolutas
    # dentro de los correos (la plantilla de marca carga /assets/images/... del backend).
    PUBLIC_BASE_URL               = os.environ.get('PUBLIC_BASE_URL', 'https://sena.newonline.digital').rstrip('/')

    # CORS: dominios permitidos (separados por coma en la variable de entorno)
    CORS_ORIGINS                   = os.environ.get('CORS_ORIGINS', 'http://localhost:5173').split(',')

    # Flask-Limiter: configuración de almacenamiento
    # Para desarrollo: memory:// (almacenamiento en memoria)
    # Para producción: redis://localhost:6379 o similar
    RATELIMIT_STORAGE_URL          = os.environ.get('RATELIMIT_STORAGE_URL', 'memory://')
    RATELIMIT_STRATEGY             = os.environ.get('RATELIMIT_STRATEGY', 'fixed-window')


class DevelopmentConfig(Config):
    """Configuración para desarrollo local."""
    DEBUG   = True
    TESTING = False


class ProductionConfig(Config):
    """Configuración segura para servidor de producción."""
    DEBUG   = False
    TESTING = False
    # En producción usar PostgreSQL, no SQLite
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')


# Selector de entorno
config_map = {
    'development': DevelopmentConfig,
    'production':  ProductionConfig,
}

def get_config():
    env = os.environ.get('FLASK_ENV', 'development')
    return config_map.get(env, DevelopmentConfig)
