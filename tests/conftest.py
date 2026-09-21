"""Fixtures compartidos de pytest para las pruebas de modelos.

La base sale de TEST_DATABASE_URL (PostgreSQL) o, si no existe, SQLite en memoria con
las llaves foráneas activadas. Una base limpia por cada prueba.
"""
import tests  # noqa: F401  (fija DATABASE_URL antes de importar la app)
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine

from app import create_app
from app.extensions import db as _db
from app.models import Category, Item, Location, Role, Status, User


@event.listens_for(Engine, "connect")
def _foreign_keys_on(dbapi_conn, _record):
    if dbapi_conn.__class__.__module__.startswith("sqlite3"):  # PostgreSQL ya las valida
        dbapi_conn.execute("PRAGMA foreign_keys=ON")


@pytest.fixture(scope="session")
def app():
    return create_app()


@pytest.fixture()
def db(app):
    with app.app_context():
        _db.drop_all()
        _db.create_all()
        yield _db
        _db.session.remove()


@pytest.fixture()
def session(db):
    return db.session


@pytest.fixture()
def make_role(session):
    def _make(name="APRENDIZ"):
        role = Role.query.filter_by(name=name).first()
        if role is None:
            role = Role(name=name)
            session.add(role)
            session.commit()
        return role
    return _make


@pytest.fixture()
def make_user(session, make_role):
    counter = {"n": 0}

    def _make(role="APRENDIZ", **kw):
        counter["n"] += 1
        n = counter["n"]
        user = User(
            id=kw.pop("id", str(1000 + n)), document_type="CC", name=f"Usuario {n}",
            email=kw.pop("email", f"u{n}@test.com"), password="hash",
            role_id=make_role(role).id, **kw,
        )
        session.add(user)
        session.commit()
        return user
    return _make


@pytest.fixture()
def user(make_user):
    return make_user()


@pytest.fixture()
def make_item(session):
    counter = {"n": 0}

    def _make(**kw):
        counter["n"] += 1
        n = counter["n"]
        category = Category.query.first() or Category(name="Categoría")
        location = Location.query.first() or Location(name="Ubicación")
        status = Status.query.first() or Status(name="AVAILABLE")
        session.add_all([category, location, status])
        session.commit()
        item = Item(
            name=kw.pop("name", f"Elemento {n}"), code=kw.pop("code", f"COD{n}"),
            category_id=category.id, location_id=location.id, status_id=status.id, **kw,
        )
        session.add(item)
        session.commit()
        return item
    return _make


@pytest.fixture()
def item(make_item):
    return make_item()
