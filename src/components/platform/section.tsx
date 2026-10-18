export function PlatformSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-1 flex-col">
      <header className="animate-rise border-b px-4 py-5 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </header>
      {/* platform-content: las tarjetas de cada página entran escalonadas (globals.css). */}
      <div className="platform-content flex flex-1 flex-col px-4 py-8 md:px-6">{children}</div>
    </section>
  );
}
