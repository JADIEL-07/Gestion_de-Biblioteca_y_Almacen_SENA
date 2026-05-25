import sys
import os

# Add project root to sys.path
project_root = r'c:/Users/JADIEL/Desktop/Gestion de Biblioteca'
if project_root not in sys.path:
    sys.path.append(project_root)

from app import create_app

app = create_app()

with app.app_context():
    from app.models.item import Category
    cats = Category.query.all()
    print('Category count:', len(cats))
    for c in cats:
        print(c.id, c.name)
