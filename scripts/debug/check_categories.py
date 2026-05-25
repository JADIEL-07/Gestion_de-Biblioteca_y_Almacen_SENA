import os, sys
# Add project root to path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(project_root)

from app import create_app
from app.models.item import Category

app = create_app()
with app.app_context():
    cats = Category.query.all()
    print('Category count:', len(cats))
    for c in cats:
        print(c.id, c.name)
