import type { Metadata } from "next";
import Link from "next/link";
import { SigmaPulsoLogo } from "@/components/brand/sigma-shield";

export const metadata: Metadata = {
  title: "Aviso de privacidad",
  description: "Aviso de privacidad de Sigma Pulso y de su canal de WhatsApp para funcionarios municipales.",
};

const COMPANY = "TCI Consultoria Internacional S de RL de CV";
const EMAIL = "jec@tci.services";
const UPDATED = "11 de octubre de 2026";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-8 flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Public privacy notice (also the URL Meta requires to publish the WhatsApp app). */
export default function PrivacyPage() {
  const mail = (
    <a href={`mailto:${EMAIL}`} className="font-medium text-primary underline-offset-4 hover:underline">
      {EMAIL}
    </a>
  );
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 text-sm leading-relaxed text-foreground/90 sm:text-base">
      <header className="flex flex-col gap-4">
        <SigmaPulsoLogo variant="full" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aviso de privacidad</h1>
          <p className="text-muted-foreground">Sigma Pulso y su canal de WhatsApp · Última actualización: {UPDATED}</p>
        </div>
      </header>

      <Section title="Responsable">
        <p>
          {COMPANY} («TCI») es responsable del tratamiento de los datos personales en Sigma Pulso, plataforma de escucha
          social y atención ciudadana que opera para gobiernos municipales, conforme a la Ley Federal de Protección de
          Datos Personales en Posesión de los Particulares. Contacto: {mail}.
        </p>
      </Section>

      <Section title="Qué datos tratamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Usuarios de la plataforma</strong> (funcionarios invitados por su municipio): nombre, correo
            institucional, rol, dependencia y registro de accesos y acciones (bitácora).
          </li>
          <li>
            <strong>Canal de WhatsApp</strong> (sólo funcionarios que lo aceptan): número de WhatsApp, fecha de
            aceptación o baja, y los mensajes intercambiados sobre los turnos de su dependencia (avisos, cambios de
            estado y notas), con su estado de entrega.
          </li>
          <li>
            <strong>Contenido público</strong>: publicaciones públicas sobre el municipio obtenidas por APIs oficiales o
            RSS. No creamos perfiles de ciudadanos, periodistas ni opositores; el análisis de autores se limita a medios
            y figuras públicas.
          </li>
        </ul>
        <p>
          Si una persona que no es funcionario registrado escribe al número de WhatsApp, sólo recibe un aviso automático:
          no guardamos su número ni el contenido de su mensaje.
        </p>
      </Section>

      <Section title="Para qué los usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Dar acceso a la plataforma según el rol de cada funcionario.</li>
          <li>Avisar por WhatsApp a la persona responsable de cada dependencia las menciones ciudadanas que se le turnan.</li>
          <li>Registrar lo que responde (en proceso, resuelto, notas) para dar seguimiento a la atención ciudadana.</li>
          <li>Mantener la seguridad, la auditoría y la mejora del servicio.</li>
        </ul>
        <p>No usamos los datos para publicidad ni los vendemos.</p>
      </Section>

      <Section title="Consentimiento en WhatsApp">
        <p>
          El número de un funcionario sólo se activa cuando él mismo toca <strong>Acepto</strong> en el mensaje de
          invitación. Puede retirar su consentimiento en cualquier momento escribiendo <strong>BAJA</strong> al mismo
          número; con <strong>ALTA</strong> vuelve a recibir mensajes.
        </p>
      </Section>

      <Section title="Con quién se comparten">
        <p>
          Con el municipio para el que trabaja el funcionario y con proveedores que prestan la infraestructura del
          servicio bajo sus propias obligaciones de confidencialidad: Meta Platforms (WhatsApp Business Platform),
          Supabase (base de datos), Vercel (alojamiento), Resend (correo) y Anthropic (análisis de texto de publicaciones
          públicas). No hacemos otras transferencias salvo requerimiento de autoridad competente.
        </p>
      </Section>

      <Section title="Cuánto tiempo los conservamos">
        <p>
          Las menciones y el historial de mensajes de WhatsApp se eliminan automáticamente a los 24 meses, o antes si el
          municipio fija un plazo menor. Los datos de cuenta se conservan mientras el funcionario tenga acceso.
        </p>
      </Section>

      <Section id="eliminacion" title="Derechos ARCO y eliminación de datos">
        <p>
          Puede solicitar el acceso, rectificación, cancelación u oposición al tratamiento de sus datos, o la
          eliminación de su número y mensajes de WhatsApp, escribiendo a {mail} con su nombre, municipio y número o
          correo registrado. Respondemos en un máximo de 20 días hábiles. Para dejar de recibir mensajes de inmediato
          basta con escribir <strong>BAJA</strong> al número de WhatsApp; el administrador de su municipio también puede
          quitar su número desde la plataforma.
        </p>
      </Section>

      <Section title="Cambios a este aviso">
        <p>Publicaremos cualquier cambio en esta misma página con su fecha de actualización.</p>
      </Section>

      <footer className="border-t pt-6 text-muted-foreground">
        {COMPANY} · {mail} ·{" "}
        <Link href="/login" className="underline-offset-4 hover:underline">
          Entrar a Sigma Pulso
        </Link>
      </footer>
    </main>
  );
}
