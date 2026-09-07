import { FiArrowLeft, FiShield } from 'react-icons/fi';
import './Terms.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';
import { HeroBackground } from '../../../components/ui/HeroBackground';

export const Terms = () => {
  return (
    <div className="terms-wrapper">
      <HeroBackground variant="panel" alt="Biblioteca SENA" />
      <FloatingParticles />
      
      <div className="terms-container">
        <div className="terms-glass-card">
          <header className="terms-header">
            <div className="terms-icon-box">
              <FiShield />
            </div>
            <h1>TÉRMINOS Y CONDICIONES DE USO</h1>
            <p>Sistema de Gestión de Inventario, Activos y Biblioteca</p>
          </header>

          <div className="terms-content">
            <div className="tab-pane fade-in">
              <section>
                <h2>1. Introducción</h2>
                <p>
                  El presente documento establece los Términos y Condiciones que regulan el acceso y uso del Sistema de Gestión de Inventario, Activos y Biblioteca, desarrollado como una herramienta tecnológica para optimizar los procesos de control, administración y seguimiento de los recursos físicos y bibliográficos dentro del Servicio Nacional de Aprendizaje (SENA).
                </p>
                <p>
                  El acceso y uso del sistema implica la aceptación expresa, libre e informada de todas las disposiciones aquí contenidas. En caso de no estar de acuerdo con estos términos, el usuario deberá abstenerse de utilizar la plataforma.
                </p>
              </section>

              <section>
                <h2>2. Finalidad del sistema</h2>
                <p>El sistema tiene como propósito principal:</p>
                <ul>
                  <li>Garantizar la trazabilidad de los activos institucionales</li>
                  <li>Facilitar la gestión de préstamos y devoluciones</li>
                  <li>Optimizar el control del inventario en tiempo real</li>
                  <li>Reducir errores asociados a procesos manuales</li>
                  <li>Generar reportes confiables para la toma de decisiones</li>
                </ul>
              </section>

              <section>
                <h2>3. Definiciones</h2>
                <p>Para efectos de interpretación del presente documento, se establecen las siguientes definiciones:</p>
                <ul>
                  <li><strong>Sistema:</strong> Plataforma web de gestión institucional</li>
                  <li><strong>Usuario:</strong> Persona autorizada que accede al sistema</li>
                  <li><strong>Activo:</strong> Bien físico o recurso asignado al inventario</li>
                  <li><strong>Préstamo:</strong> Asignación temporal de un recurso a un usuario</li>
                  <li><strong>Administrador:</strong> Usuario con privilegios de gestión y control total</li>
                </ul>
              </section>

              <section>
                <h2>4. Acceso y registro</h2>
                <p>El acceso al sistema estará restringido exclusivamente a usuarios autorizados por la institución. Cada usuario contará con credenciales únicas, personales e intransferibles.</p>
                <p>El usuario es responsable de la confidencialidad de sus credenciales y de todas las actividades realizadas bajo su cuenta.</p>
              </section>

              <section>
                <h2>5. Obligaciones del usuario</h2>
                <p>El usuario se compromete a:</p>
                <ul>
                  <li>Utilizar el sistema de manera responsable, ética y conforme a la normativa institucional</li>
                  <li>Registrar información veraz, completa y actualizada</li>
                  <li>No manipular, alterar o eliminar información sin autorización</li>
                  <li>Reportar inconsistencias o fallos en el sistema</li>
                  <li>Cumplir con los procedimientos establecidos para préstamos y devoluciones</li>
                </ul>
              </section>

              <section>
                <h2>6. Uso adecuado del sistema</h2>
                <p>Queda estrictamente prohibido:</p>
                <ul>
                  <li>Acceder sin autorización a módulos restringidos</li>
                  <li>Realizar actividades que comprometan la seguridad del sistema</li>
                  <li>Usar la plataforma para fines distintos a los institucionales</li>
                  <li>Intentar vulnerar la integridad de la información</li>
                </ul>
                <p className="highlight-text">
                  El incumplimiento podrá dar lugar a sanciones disciplinarias conforme a las políticas del SENA.
                </p>
              </section>

              <section>
                <h2>7. Gestión de inventario y préstamos</h2>
                <p>El sistema permitirá:</p>
                <ul>
                  <li>Registrar entradas y salidas de activos</li>
                  <li>Controlar disponibilidad de recursos</li>
                  <li>Gestionar préstamos con fecha y hora exacta</li>
                  <li>Asociar responsables a cada movimiento</li>
                </ul>
                <p>Todo préstamo deberá ser debidamente registrado. El usuario será responsable del recurso durante el tiempo que permanezca bajo su custodia.</p>
              </section>

              <section>
                <h2>8. Responsabilidad sobre los activos</h2>
                <p>El usuario que reciba un recurso en calidad de préstamo se compromete a:</p>
                <ul>
                  <li>Hacer uso adecuado del mismo</li>
                  <li>Devolverlo en las condiciones en que fue entregado</li>
                  <li>Respetar los tiempos establecidos</li>
                </ul>
                <p>En caso de pérdida, daño o uso indebido, se aplicarán las medidas correspondientes según la normativa institucional.</p>
              </section>

              <section>
                <h2>9. Disponibilidad del servicio</h2>
                <p>La institución no garantiza la disponibilidad continua del sistema, debido a posibles mantenimientos, actualizaciones o fallos técnicos. No obstante, se procurará minimizar las interrupciones.</p>
              </section>

              <section>
                <h2>10. Propiedad intelectual</h2>
                <p>El sistema, su diseño, estructura, código fuente y contenido son propiedad de la institución o de sus desarrolladores autorizados. Queda prohibida su reproducción, distribución o modificación sin autorización previa.</p>
              </section>

              <section>
                <h2>11. Modificaciones</h2>
                <p>La institución se reserva el derecho de modificar en cualquier momento los presentes términos. Dichas modificaciones serán notificadas a los usuarios a través del sistema.</p>
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
