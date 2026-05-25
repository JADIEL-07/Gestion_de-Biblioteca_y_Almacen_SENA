"""APScheduler in-process. Lanza process_reservation_queue cada 10 min.

Cuidado con multi-worker: en gunicorn solo un worker debe correr el job.
Usamos un lockfile simple en `instance/scheduler.lock` para asegurarlo.
"""
import os
import atexit
import logging

from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)
_scheduler = None
_LOCK_PATH = None


def _acquire_lock(lock_path):
    """Intenta crear un lockfile exclusivo. Devuelve True si lo logra."""
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        # Verificar si el PID guardado sigue vivo
        try:
            with open(lock_path, 'r') as f:
                pid = int(f.read().strip() or '0')
            if pid and _pid_alive(pid):
                return False
            # Lock huérfano
            os.remove(lock_path)
            return _acquire_lock(lock_path)
        except (ValueError, OSError):
            return False


def _pid_alive(pid):
    if os.name == 'nt':
        import ctypes
        PROCESS_QUERY = 0x1000
        h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY, 0, pid)
        if h:
            ctypes.windll.kernel32.CloseHandle(h)
            return True
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def init_scheduler(app):
    global _scheduler, _LOCK_PATH
    if _scheduler is not None:
        return _scheduler

    instance_dir = os.path.join(app.root_path, '..', 'instance')
    os.makedirs(instance_dir, exist_ok=True)
    _LOCK_PATH = os.path.abspath(os.path.join(instance_dir, 'scheduler.lock'))

    if not _acquire_lock(_LOCK_PATH):
        logger.info("Scheduler ya está corriendo en otro worker — este no lo lanza.")
        return None

    def _reservation_job():
        with app.app_context():
            try:
                from .reservation_queue import process_reservation_queue
                result = process_reservation_queue()
                if any(result.values()):
                    logger.info(f"Reservation queue tick: {result}")
            except Exception:
                logger.exception("Error en process_reservation_queue")

    def _loan_notification_job():
        with app.app_context():
            try:
                from .loan_notification_service import process_loan_notifications
                result = process_loan_notifications()
                if any(v > 0 for v in result.values()):
                    logger.info(f"Loan notifications tick: {result}")
            except Exception:
                logger.exception("Error en process_loan_notifications")

    _scheduler = BackgroundScheduler(daemon=True, timezone='UTC')
    _scheduler.add_job(_reservation_job, 'interval', minutes=10, id='reservation_queue', max_instances=1)
    _scheduler.add_job(_loan_notification_job, 'interval', minutes=10, id='loan_notifications', max_instances=1)
    _scheduler.start()
    logger.info("APScheduler iniciado (reservation_queue + loan_notifications cada 10 min).")

    def _shutdown():
        try:
            if _scheduler and _scheduler.running:
                _scheduler.shutdown(wait=False)
        finally:
            try:
                if _LOCK_PATH and os.path.exists(_LOCK_PATH):
                    os.remove(_LOCK_PATH)
            except OSError:
                pass

    atexit.register(_shutdown)
    return _scheduler
