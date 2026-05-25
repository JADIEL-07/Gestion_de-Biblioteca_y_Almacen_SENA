import uuid
import bcrypt
from datetime import datetime, timedelta
from flask_jwt_extended import create_access_token, create_refresh_token, get_jti
from ..extensions import db
from ..models.token import RefreshToken, PasswordResetToken

class TokenService:
    @staticmethod
    def generate_auth_tokens(user, user_agent=None):
        """Generates access and refresh tokens (JWT) with rotation and revocation."""
        # Access Token with custom claims
        access_claims = {
            "role": user.role.name if user.role else "GUEST", 
            "type": "access"
        }
        access_token = create_access_token(
            identity=str(user.id), 
            additional_claims=access_claims
        )
        
        # Refresh Token (JWT)
        refresh_token = create_refresh_token(identity=str(user.id))
        refresh_jti = get_jti(refresh_token)
        
        # Hash the JTI for database storage
        jti_hash = bcrypt.hashpw(refresh_jti.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        expires_at = datetime.utcnow() + timedelta(days=7)
        
        new_refresh = RefreshToken(
            user_id=user.id,
            token_hash=jti_hash,
            expires_at=expires_at,
            user_agent=user_agent
        )
        db.session.add(new_refresh)
        db.session.commit()
        
        return access_token, refresh_token

    @staticmethod
    def validate_and_rotate_refresh_token(user_id, refresh_jti):
        """Validates the JTI of the refresh token and applies rotation."""
        active_tokens = RefreshToken.query.filter_by(user_id=user_id, is_revoked=False).all()
        
        target_token = None
        for rt in active_tokens:
            if bcrypt.checkpw(refresh_jti.encode('utf-8'), rt.token_hash.encode('utf-8')):
                target_token = rt
                break
        
        if not target_token or target_token.expires_at < datetime.utcnow():
            return None, None
            
        # Revoke the current token
        target_token.is_revoked = True
        db.session.commit()
        
        # Generate new tokens preserving user_agent
        return TokenService.generate_auth_tokens(target_token.user, target_token.user_agent)

    @staticmethod
    def revoke_all_user_tokens(user_id):
        """Invalidates all sessions for a user."""
        RefreshToken.query.filter_by(user_id=user_id, is_revoked=False).update({"is_revoked": True})
        db.session.commit()

    @staticmethod
    def create_password_reset_token(user):
        """Creates a reset token (15 min)."""
        token = str(uuid.uuid4())
        expires_at = datetime.utcnow() + timedelta(minutes=15)
        reset_token = PasswordResetToken(user_id=user.id, token_hash=token, expires_at=expires_at)
        db.session.add(reset_token)
        db.session.commit()
        return token
