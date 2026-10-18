import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, ScheduleSchema, type Schedule } from "./calendar";
import { adjustBusinessDay, computeDueDates, dueDatesInMonth, duePhases, isBusinessDay, lastDayOfMonth, phaseInstant, phasesFor } from "./dates";
import { holidaysFrom, isColombiaHolidayFixture } from "./holidays";

const none = holidaysFrom([]);
const schedule = (input: object): Schedule => ScheduleSchema.parse(input);

describe("calendario", () => {
  it("valida con valores por omisión (día hábil anterior, preparar 7 días antes)", () => {
    expect(DEFAULT_SCHEDULE).toEqual({ rule: "month_end", businessDayAdjust: "previous", leadDays: 7 });
    expect(schedule({ rule: "semi_monthly" })).toMatchObject({ firstDay: 15 });
  });

  it("rechaza campos desconocidos y valores fuera de rango", () => {
    expect(() => schedule({ rule: "month_end", extra: 1 })).toThrow();
    expect(() => schedule({ rule: "day_of_month", day: 0 })).toThrow();
    expect(() => schedule({ rule: "day_of_month", day: 32 })).toThrow();
    expect(() => schedule({ rule: "semi_monthly", firstDay: 29 })).toThrow();
    expect(() => schedule({ rule: "month_end", leadDays: 31 })).toThrow();
    expect(() => schedule({ rule: "weekly" })).toThrow();
  });
});

describe("días hábiles", () => {
  it("sábado y domingo no son hábiles", () => {
    expect(isBusinessDay("2026-10-30", none)).toBe(true); // viernes
    expect(isBusinessDay("2026-10-31", none)).toBe(false); // sábado
    expect(isBusinessDay("2026-11-01", none)).toBe(false); // domingo
  });

  it("ajusta hacia atrás, hacia adelante o no ajusta", () => {
    expect(adjustBusinessDay("2026-10-31", "previous", none)).toBe("2026-10-30");
    expect(adjustBusinessDay("2026-10-31", "next", none)).toBe("2026-11-02");
    expect(adjustBusinessDay("2026-10-31", "none", none)).toBe("2026-10-31");
    expect(adjustBusinessDay("2026-10-30", "previous", none)).toBe("2026-10-30");
  });

  it("un festivo pegado a un fin de semana empuja más lejos", () => {
    const holiday = holidaysFrom(["2026-11-02"]); // lunes festivo
    expect(adjustBusinessDay("2026-11-01", "next", holiday)).toBe("2026-11-03");
    expect(adjustBusinessDay("2026-11-01", "previous", holiday)).toBe("2026-10-30");
  });

  it("el fixture reconoce los festivos cargados y solo fines de semana fuera de ellos", () => {
    expect(isColombiaHolidayFixture("2026-12-25")).toBe(true);
    expect(isColombiaHolidayFixture("2026-12-24")).toBe(false);
    expect(isColombiaHolidayFixture("2031-12-25")).toBe(false);
  });
});

describe("vencimientos", () => {
  it("fin de mes en domingo pasa al viernes anterior (octubre y noviembre 2026)", () => {
    const [due] = dueDatesInMonth(DEFAULT_SCHEDULE, "2026-11", none);
    expect(due).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-30", nominalDueDate: "2026-11-30", dueDate: "2026-11-30" });
    const [october] = dueDatesInMonth(DEFAULT_SCHEDULE, "2026-10", none);
    expect(october!.nominalDueDate).toBe("2026-10-31");
    expect(october!.dueDate).toBe("2026-10-30");
  });

  it("fin de mes en festivo usa el hábil anterior", () => {
    expect(dueDatesInMonth(DEFAULT_SCHEDULE, "2026-12", holidaysFrom(["2026-12-31"]))[0]!.dueDate).toBe("2026-12-30");
  });

  it("febrero bisiesto y no bisiesto", () => {
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
    expect(lastDayOfMonth("2027-02")).toBe("2027-02-28");
    expect(dueDatesInMonth(schedule({ rule: "day_of_month", day: 31, businessDayAdjust: "none" }), "2027-02", none)[0]!.nominalDueDate).toBe("2027-02-28");
  });

  it("31 de diciembre", () => {
    expect(dueDatesInMonth(schedule({ rule: "month_end", businessDayAdjust: "none" }), "2026-12", none)[0]!.dueDate).toBe("2026-12-31");
  });

  it("día fijo del mes con ajuste al hábil siguiente", () => {
    const due = dueDatesInMonth(schedule({ rule: "day_of_month", day: 15, businessDayAdjust: "next" }), "2026-11", none)[0]!;
    expect(due.nominalDueDate).toBe("2026-11-15"); // domingo
    expect(due.dueDate).toBe("2026-11-16");
  });

  it("quincenal: dos pagos al mes con periodos contiguos", () => {
    const [first, second] = dueDatesInMonth(schedule({ rule: "semi_monthly" }), "2026-11", none);
    expect(first).toMatchObject({ periodStart: "2026-11-01", periodEnd: "2026-11-15", nominalDueDate: "2026-11-15", dueDate: "2026-11-13" });
    expect(second).toMatchObject({ periodStart: "2026-11-16", periodEnd: "2026-11-30", dueDate: "2026-11-30" });
  });

  it("los próximos N vencimientos son cronológicos e incluyen el de hoy", () => {
    const dues = computeDueDates(DEFAULT_SCHEDULE, "2026-10-30", 6, none);
    expect(dues.map((due) => due.dueDate)).toEqual(["2026-10-30", "2026-11-30", "2026-12-31", "2027-01-29", "2027-02-26", "2027-03-31"]);
    expect(computeDueDates(DEFAULT_SCHEDULE, "2026-10-31", 1, none)[0]!.dueDate).toBe("2026-11-30");
  });

  it("un ajuste hacia atrás puede traer un vencimiento del mes siguiente a los primeros días del siguiente", () => {
    const sundayStart = schedule({ rule: "day_of_month", day: 1, businessDayAdjust: "previous" });
    const dues = computeDueDates(sundayStart, "2026-10-30", 2, none);
    expect(dues[0]!.nominalDueDate).toBe("2026-11-01");
    expect(dues[0]!.dueDate).toBe("2026-10-30");
  });

  it("cuenta quincenales en orden entre meses", () => {
    const dues = computeDueDates(schedule({ rule: "semi_monthly" }), "2026-11-14", 4, none);
    expect(dues.map((due) => due.dueDate)).toEqual(["2026-11-30", "2026-12-15", "2026-12-31", "2027-01-15"].map((date) => adjust(date)));
    function adjust(date: string) {
      return adjustBusinessDay(date, "previous", none);
    }
  });
});

describe("fases de una ocurrencia", () => {
  const config = { leadDays: 7, earlyAlertDays: 7, urgentAlertDays: 3 };

  it("preparar, aviso temprano, aviso urgente y ejecutar, en orden", () => {
    const slots = phasesFor("2026-10-30", config, none);
    expect(slots.map((slot) => [slot.phase, slot.date])).toEqual([
      ["prepare", "2026-10-23"],
      ["alert_early", "2026-10-23"],
      ["alert_urgent", "2026-10-27"],
      ["execute", "2026-10-30"],
    ]);
    expect(slots[0]!.instant).toBe("2026-10-23T14:00:00Z"); // 09:00 Bogotá
  });

  it("preparar cae en día hábil: si T-lead es sábado se adelanta al viernes", () => {
    const slots = phasesFor("2026-11-30", { ...config, leadDays: 9 }, none); // 21 de nov = sábado
    expect(slots.find((slot) => slot.phase === "prepare")!.date).toBe("2026-11-20");
  });

  it("un aviso que cae antes de preparar no se emite; el que cae el mismo día de preparar sí", () => {
    const late = phasesFor("2026-10-30", { leadDays: 3, earlyAlertDays: 7, urgentAlertDays: 3 }, none);
    expect(late.map((slot) => slot.phase)).toEqual(["prepare", "alert_urgent", "execute"]);
    // leadDays 5: T-5 es domingo y se prepara el viernes 23, el mismo día que cae el aviso temprano (T-7)
    const sameDay = phasesFor("2026-10-30", { leadDays: 5, earlyAlertDays: 7, urgentAlertDays: 3 }, none);
    expect(sameDay.map((slot) => [slot.phase, slot.date])).toEqual([
      ["prepare", "2026-10-23"],
      ["alert_early", "2026-10-23"],
      ["alert_urgent", "2026-10-27"],
      ["execute", "2026-10-30"],
    ]);
  });

  it("con anticipación 0 se prepara el mismo día del vencimiento", () => {
    const slots = phasesFor("2026-10-30", { leadDays: 0, earlyAlertDays: 7, urgentAlertDays: 3 }, none);
    expect(slots.map((slot) => slot.phase)).toEqual(["prepare", "execute"]);
  });

  it("fases vencidas a un instante dado", () => {
    const slots = phasesFor("2026-10-30", config, none);
    expect(duePhases(slots, "2026-10-22T20:00:00Z")).toEqual([]);
    expect(duePhases(slots, "2026-10-27T14:00:00Z").map((slot) => slot.phase)).toEqual(["prepare", "alert_early", "alert_urgent"]);
    expect(duePhases(slots, "2026-10-30T14:00:00Z")).toHaveLength(4);
    expect(phaseInstant("2026-10-30")).toBe("2026-10-30T14:00:00Z");
  });
});
