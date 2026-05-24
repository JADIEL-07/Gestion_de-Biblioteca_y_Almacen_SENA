import os
import sys
import socket
import subprocess
from dotenv import load_dotenv

load_dotenv()


def _discover_container_ip(ssh_host, ssh_user, ssh_password, container_name):
    """Conecta SSH al VPS y obtiene la IP interna del container Postgres
    en la red Docker (el container NO expone puerto al host, asi que hay
    que reenviar el tunel a su IP interna)."""
    import paramiko
    if not hasattr(paramiko, 'DSSKey'):
        paramiko.DSSKey = paramiko.RSAKey

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(ssh_host, username=ssh_user, password=ssh_password,
                   allow_agent=False, look_for_keys=False, timeout=10)

    cmd = (
        f"docker inspect {container_name} "
        f"--format '{{{{range $k, $v := .NetworkSettings.Networks}}}}"
        f"{{{{$k}}}}={{{{$v.IPAddress}}}}|{{{{end}}}}'"
    )
    _, stdout, _ = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    client.close()

    networks = {}
    for entry in out.split('|'):
        if '=' in entry:
            net, ip = entry.split('=', 1)
            if ip:
                networks[net] = ip
    if not networks:
        return None
    return networks.get('coolify') or next(iter(networks.values()))


def _find_free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def start_ssh_tunnel():
    """Levanta tunel SSH si hay credenciales SSH_* en .env.
    Reenvía el puerto expuesto por el contenedor Postgres en el VPS
    (REMOTE_DB_PORT) a un puerto local libre.
    Retorna el tunnel o None si no hay credenciales."""
    ssh_host = os.environ.get('SSH_HOST')
    ssh_user = os.environ.get('SSH_USER')
    ssh_password = os.environ.get('SSH_PASSWORD')
    remote_db_port = int(os.environ.get('REMOTE_DB_PORT', 5437))

    if not all([ssh_host, ssh_user, ssh_password]):
        return None

    local_port = _find_free_port()

    import paramiko
    if not hasattr(paramiko, 'DSSKey'):
        paramiko.DSSKey = paramiko.RSAKey

    from sshtunnel import SSHTunnelForwarder
    tunnel = SSHTunnelForwarder(
        (ssh_host, 22),
        ssh_username=ssh_user,
        ssh_password=ssh_password,
        remote_bind_address=('127.0.0.1', remote_db_port),
        local_bind_address=('127.0.0.1', local_port),
        allow_agent=False,
        host_pkey_directories=[],
    )
    tunnel.start()
    print(f"  Tunel SSH activo: 127.0.0.1:{local_port} -> {ssh_host}:{remote_db_port} (Postgres)")

    # Parchear DATABASE_URL para que Flask use el puerto del tunel
    from urllib.parse import urlparse, urlunparse
    raw_url = os.environ.get('DATABASE_URL', '')
    parsed = urlparse(raw_url)
    patched = parsed._replace(
        netloc=f"{parsed.username}:{parsed.password}@127.0.0.1:{local_port}"
    )
    os.environ['DATABASE_URL'] = urlunparse(patched)
    os.environ['SQLALCHEMY_DATABASE_URI'] = os.environ['DATABASE_URL']
    print(f"  DATABASE_URL -> 127.0.0.1:{local_port}")

    return tunnel


if __name__ == "__main__":
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app', 'static')

    # WERKZEUG_RUN_MAIN='true' indica que somos el proceso hijo del reloader.
    # En ese caso DATABASE_URL ya viene parcheada en os.environ desde el proceso
    # padre, y el tunel ya esta corriendo alli — no hay que levantarlo de nuevo.
    is_reloader_child = os.environ.get('WERKZEUG_RUN_MAIN') == 'true'

    if not is_reloader_child:
        # Proceso padre: levanta tunel (parchea DATABASE_URL) y arranca Vite.
        tunnel = start_ssh_tunnel()

        frontend_proc = subprocess.Popen(
            ['npm', 'run', 'dev'],
            cwd=static_dir,
            shell=True
        )

        print("\n" + "=" * 50)
        print("  SISTEMA INTEGRAL BIBLIOTECA SENA")
        print("=" * 50)
        print(f"  Frontend:  http://localhost:5173")
        print(f"  API:       http://localhost:5000/api/v1")
        print("-" * 50)
        print("  Presiona Ctrl+C para detener todo")
        print("=" * 50 + "\n")
    else:
        tunnel = None
        frontend_proc = None

    from app import create_app, db
    from app.models.user import Role, FormationProgram

    app = create_app()

    @app.cli.command("init-db")
    def init_db():
        db.create_all()
        _seed_basic_roles()
        print("Base de datos inicializada correctamente.")

    def _seed_basic_roles():
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

    try:
        # Solo en el padre (no reloader): verificar si hay BD remota activa
        ssh_configurado = bool(os.environ.get('SSH_HOST'))
        if not ssh_configurado:
            with app.app_context():
                db.create_all()
                _seed_basic_roles()
        elif not is_reloader_child:
            print("  BD remota detectada (tunel activo): se omite create_all/seed.")

        is_dev = os.environ.get('FLASK_ENV', 'development') == 'development'
        app.run(host="0.0.0.0", port=5000, debug=is_dev)
    finally:
        if not is_reloader_child:
            print("\nDeteniendo Frontend...")
            if frontend_proc:
                if sys.platform == "win32":
                    subprocess.run(
                        ['taskkill', '/F', '/T', '/PID', str(frontend_proc.pid)],
                        capture_output=True
                    )
                else:
                    frontend_proc.terminate()
            if tunnel:
                tunnel.stop()
                print("Túnel SSH cerrado.")
            print("Sistema cerrado correctamente.")
