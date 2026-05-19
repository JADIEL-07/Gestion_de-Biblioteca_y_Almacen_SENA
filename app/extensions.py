from flask_sqlalchemy import SQLAlchemy
from flask_marshmallow import Marshmallow
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from flask_mail import Mail
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

db      = SQLAlchemy()
ma      = Marshmallow()
migrate = Migrate()
jwt     = JWTManager()
mail    = Mail()
limiter = Limiter(key_func=get_remote_address, default_limits=["5000 per day", "500 per hour"])
