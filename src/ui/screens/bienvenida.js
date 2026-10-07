// bienvenida.js · primera pantalla (sin barras): promesa honesta, instalación ANTES de pedir datos (iPhone y navegador de WhatsApp),
// "Empezar", "Ver cómo se ve con un ejemplo" (solo si no hay datos propios) y "Ya tengo una copia de seguridad".
// Si el armado quedó a medias, ofrece seguir donde quedó. Todo texto en voseo; sin emojis.

import { demo } from '../../demo.js';
import { estilos } from '../_ed-style.js';
import { cajaInstalar, detectarEntorno } from '../_install.js';
import { hojaRestaurar, mandarCopia } from '../_backup.js';
import { tieneDatos, tieneDatosPropios } from '../_ed-logic.js';

export default {
  id: 'bienvenida',
  title: 'Bienvenida',
  mount(root, ctx) {
    estilos();
    const { ui } = ctx;
    ctx.header(false);
    const s = ctx.state;
    const hayDatos = tieneDatos(s);
    const propios = tieneDatosPropios(s);
    const aMedias = hayDatos && !s.settings.onboarded && s.settings.onboardingStep > 0;
    const entorno = detectarEntorno();

    const empezar = () => ctx.nav(aMedias ? `#/armar/${Math.min(7, Math.max(1, s.settings.onboardingStep))}` : '#/armar/0');
    const verEjemplo = () => {
      ctx.update(() => demo(ctx.today()), { rerender: false });
      ctx.nav('#/hoy');
    };

    const acciones = [
      ui.btn({ label: aMedias ? `Seguir en el paso ${Math.min(7, Math.max(1, s.settings.onboardingStep))} de 7` : 'Empezar', variant: 'onhero', onClick: empezar }),
      aMedias ? ui.btn({ label: 'Ir a mi tablero', variant: 'onhero-ghost', onClick: () => ctx.nav('#/hoy') }) : null,
      !propios && !aMedias ? ui.btn({ label: 'Ver cómo se ve con un ejemplo', variant: 'onhero-ghost', onClick: verEjemplo }) : null,
    ];

    const caja = cajaInstalar(ctx, {
      entorno,
      onCopia: hayDatos && !entorno.instalada ? () => mandarCopia(ctx) : null,
    });

    root.append(ui.welcome({
      title: ['Tu plata,', 'clara.'],
      lead: 'Cargá tus números y mirá cómo te va a ir en los próximos meses y cuándo terminás de pagar cada deuda.',
      bullets: [
        { icon: 'escudo', text: 'Tus datos quedan solo en tu celular.' },
        { icon: 'tilde', text: 'Sin retos ni culpas: solo números claros.' },
        { icon: 'calendario', text: 'Son unos 10 minutos, y podés frenar y seguir cuando quieras.' },
      ],
      children: caja ? [caja] : undefined,
      actions: acciones,
      footLink: { label: 'Ya tengo una copia de seguridad', onClick: () => hojaRestaurar(ctx, { alRestaurar: () => ctx.nav('#/hoy') }) },
    }));
  },
};
