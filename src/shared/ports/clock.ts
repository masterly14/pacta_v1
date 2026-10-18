// Reloj inyectable (platform-core §5). El de demo vive en memoria: no se persiste aquí.

export type Clock = {
  now(): Date;
};

export type SystemClock = Clock & {
  readonly mode: "system";
};

export type DemoClock = Clock & {
  readonly mode: "demo";
  set(instant: Date): void;
};

export function createSystemClock(): SystemClock {
  return {
    mode: "system",
    now() {
      return new Date();
    },
  };
}

export function createDemoClock(initial: Date): DemoClock {
  let current = new Date(initial.getTime());
  return {
    mode: "demo",
    now() {
      return new Date(current.getTime());
    },
    set(instant: Date) {
      current = new Date(instant.getTime());
    },
  };
}
