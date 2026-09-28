// Módulo Indicadores: sub-navegación. Cada página valida su permiso.
// El encabezado vive aquí para que las dos pestañas compartan el mismo título
// del módulo y solo cambien de contenido, como en Compras y Pedidos.
import { requireUsuario } from "@/server/auth-context";
import { SubNav } from "../_components/SubNav";

const ITEMS = [
  { href: "/indicadores", label: "Financieros" },
  { href: "/indicadores/compras", label: "Compras" },
  { href: "/indicadores/almacen", label: "Almacén" },
];

export default async function IndicadoresLayout({ children }: { children: React.ReactNode }) {
  await requireUsuario();
  return (
    <>
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <div className="eyebrow">Análisis</div>
          <h1>Indicadores</h1>
        </div>
      </div>
      <SubNav items={ITEMS} />
      {children}
    </>
  );
}
