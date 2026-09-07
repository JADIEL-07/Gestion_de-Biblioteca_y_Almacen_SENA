import { FiArrowLeft, FiLock } from 'react-icons/fi';
import './Terms.css'; // Reutilizamos los estilos base por consistencia
import { FloatingParticles } from '../../../components/ui/FloatingParticles';
import { HeroBackground } from '../../../components/ui/HeroBackground';

export const Privacy = () => {
  return (
    <div className="terms-wrapper">
      <HeroBackground variant="panel" alt="Biblioteca SENA" />
      <FloatingParticles />
      
      <div className="terms-container">
        <div className="terms-glass-card">
          <header className="terms-header">
            <div className="terms-icon-box">
              <FiLock />
            </div>
            <h1>POLÍTICA DE PRIVACIDAD</h1>
            <p>Tratamiento de Datos Personales - SENA</p>
          </header>

          <div className="terms-content">
            <div className="tab-pane fade-in">
              <section>
                <h2>1. Introducción</h2>
                <p>
                  La presente Política de Privacidad establece los lineamientos para la recolección, uso, almacenamiento y protección de los datos personales de los usuarios del sistema, en cumplimiento de la normativa vigente en Colombia sobre protección de datos personales.
                </p>
              </section>

              <section>
                <h2>2. Información recolectada</h2>
                <p>El sistema podrá recolectar y almacenar los siguientes datos:</p>
                <ul>
                  <li>Datos de identificación (nombre, documento)</li>
                  <li>Información de contacto (correo institucional)</li>
                  <li>Rol dentro de la institución</li>
                  <li>Historial de uso del sistema</li>
                  <li>Registros de préstamos y movimientos</li>
                </ul>
              </section>

              <section>
                <h2>3. Finalidad del tratamiento de datos</h2>
                <p>Los datos personales serán utilizados para:</p>
                <ul>
                  <li>Gestionar el acceso y autenticación de usuarios</li>
                  <li>Administrar el inventario y recursos institucionales</li>
                  <li>Garantizar la trazabilidad de los activos</li>
                  <li>Generar informes y estadísticas</li>
                  <li>Mejorar la funcionalidad del sistema</li>
                </ul>
              </section>

              <section>
                <h2>4. Principios aplicables</h2>
                <p>El tratamiento de datos se regirá por los principios de:</p>
                <ul>
                  <li>Legalidad</li>
                  <li>Finalidad</li>
                  <li>Transparencia</li>
                  <li>Seguridad</li>
                  <li>Confidencialidad</li>
                </ul>
              </section>

              <section>
                <h2>5. Seguridad de la información</h2>
                <p>Se implementarán medidas técnicas, administrativas y organizativas para proteger la información contra:</p>
                <ul>
                  <li>Acceso no autorizado</li>
                  <li>Pérdida o destrucción</li>
                  <li>Alteración indebida</li>
                </ul>
              </section>

              <section>
                <h2>6. Derechos del titular de los datos</h2>
                <p>El usuario tiene derecho a:</p>
                <ul>
                  <li>Conocer, actualizar y rectificar sus datos</li>
                  <li>Solicitar prueba de la autorización otorgada</li>
                  <li>Ser informado sobre el uso de sus datos</li>
                  <li>Revocar la autorización cuando sea procedente</li>
                </ul>
              </section>

              <section>
                <h2>7. Confidencialidad de la información</h2>
                <p>La información personal no será compartida con terceros, salvo:</p>
                <ul>
                  <li>Cuando sea requerido por autoridades competentes</li>
                  <li>Cuando sea necesario para cumplir obligaciones legales</li>
                </ul>
              </section>

              <section>
                <h2>8. Conservación de la información</h2>
                <p>Los datos serán almacenados durante el tiempo necesario para cumplir con las finalidades descritas y las obligaciones legales aplicables.</p>
              </section>

              <section>
                <h2>9. Uso de tecnologías de seguimiento</h2>
                <p>El sistema podrá utilizar cookies u otras tecnologías para mejorar la experiencia del usuario, optimizar el rendimiento y recopilar estadísticas de uso.</p>
              </section>

              <section>
                <h2>10. Actualizaciones de la política</h2>
                <p>La presente política podrá ser modificada en cualquier momento. Los cambios serán comunicados oportunamente a los usuarios.</p>
              </section>
            </div>
          </div>

          <footer className="terms-footer">
            <button className="btn-back-home" onClick={() => window.history.back()}>
              <FiArrowLeft /> REGRESAR AL INICIO
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
};
