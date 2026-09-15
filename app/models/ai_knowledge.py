from datetime import datetime
from app.extensions import db
from app.models.base import Base

class AILearnedResponse(Base):
    __tablename__ = 'ai_learned_responses'

    id = db.Column(db.Integer, primary_key=True)
    query_text = db.Column(db.String(500), nullable=False)
    query_keywords = db.Column(db.String(500), nullable=False, index=True)
    response_text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    use_count = db.Column(db.Integer, default=0)

    # Rol del usuario cuya pregunta originó esta respuesta (ADMIN, APRENDIZ,
    # BIBLIOTECARIO, etc.). NULL = respuesta genérica servida a cualquier rol
    # (así quedan las entradas creadas antes de este campo). Con rol definido,
    # solo se sirve a usuarios de ESE mismo rol — evita que un aprendiz reciba
    # una guía pensada para un administrador solo por coincidencia de palabras.
    role = db.Column(db.String(50), nullable=True, index=True)

    # Retroalimentación de los usuarios (👍/👎 bajo la respuesta). Si se acumulan
    # más negativos que positivos, la entrada se autoelimina (ver /feedback).
    positive_feedback = db.Column(db.Integer, default=0)
    negative_feedback = db.Column(db.Integer, default=0)

    # Origen: 'gemini' (aprendida de una respuesta real de Gemini), 'manual'
    # (cargada a mano por un Admin) o 'soporte' (tomada de una resolución real
    # de un ticket de Soporte).
    source = db.Column(db.String(20), default='gemini')

    def __repr__(self):
        return f"<AILearnedResponse {self.query_text[:20]}>"


class AIUnansweredQuery(Base):
    """Registro de preguntas que ni la IA que aprende ni el sistema de reglas
    supieron responder con confianza (terminaron en el mensaje genérico de
    'no tengo una respuesta precisa'). Sirve para que un Admin identifique
    huecos de contenido y, si quiere, los convierta en una respuesta enseñada
    a mano (AILearnedResponse con source='manual')."""
    __tablename__ = 'ai_unanswered_queries'

    id = db.Column(db.Integer, primary_key=True)
    query_text = db.Column(db.String(500), nullable=False)
    role = db.Column(db.String(50), nullable=True)
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # Un Admin puede marcarla como "ya resuelta" (por ejemplo, tras enseñarle
    # la respuesta) sin necesidad de borrar el registro histórico.
    resolved = db.Column(db.Boolean, default=False)

    def __repr__(self):
        return f"<AIUnansweredQuery {self.query_text[:20]}>"
