import sys, os
project_root = r'c:/Users/JADIEL/Desktop/Gestion de Biblioteca'
if project_root not in sys.path:
    sys.path.append(project_root)
from app import create_app
app = create_app()
with app.app_context():
    from app.models.item import Status
    sts = Status.query.all()
    print('Status count:', len(sts))
    for s in sts:
        print(s.id, s.name)
