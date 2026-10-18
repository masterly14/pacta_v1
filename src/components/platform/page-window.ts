// Paginación por URL: página pedida acotada y números de página a mostrar. Funciones puras.

// Página pedida (1-based) acotada a las que existen; un valor inválido en la URL da la página 1.
export function clampPage(requested: unknown, total: number, pageSize: number): { page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const parsed = typeof requested === "string" && /^\d+$/.test(requested) ? Number(requested) : 1;
  return { page: Math.min(Math.max(parsed, 1), pageCount), pageCount };
}

// Números de página a mostrar alrededor de la actual, con "gap" donde se omiten páginas:
// pageWindow(6, 12) → [1, "gap", 5, 6, 7, "gap", 12].
export function pageWindow(page: number, pageCount: number, radius = 1): (number | "gap")[] {
  const pages = new Set<number>([1, pageCount]);
  for (let p = page - radius; p <= page + radius; p++) if (p >= 1 && p <= pageCount) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    const previous = sorted[i - 1];
    if (previous !== undefined && p - previous === 2) out.push(previous + 1);
    else if (previous !== undefined && p - previous > 2) out.push("gap");
    out.push(p);
  });
  return out;
}
