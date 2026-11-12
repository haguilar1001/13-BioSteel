// Módulo Ventas: sub-navegación. Cada página valida su permiso.
// (La gestión —importar, exclusiones, parámetros, ajustes— vive en
//  Administración ▸ Varios.)
import { requireUsuario } from "@/server/auth-context";
import { SubNav } from "../_components/SubNav";

const ITEMS = [
  { href: "/ventas", label: "Ventas x Mes" },
  { href: "/ventas/historico", label: "Históricas" },
  { href: "/ventas/consumos", label: "Consumos" },
  { href: "/ventas/proveedores", label: "Proveedores" },
  { href: "/ventas/clientes", label: "Por Cliente" },
  { href: "/ventas/descuentos", label: "Descuentos" },
];

export default async function VentasLayout({ children }: { children: React.ReactNode }) {
  await requireUsuario();
  return (
    <>
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <div className="eyebrow">Comercial</div>
          <h1>Ventas</h1>
        </div>
      </div>
      <SubNav items={ITEMS} />
      {children}
    </>
  );
}
