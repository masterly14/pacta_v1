"use client";
/**
 * Purpose: submit a form to a server action without React's automatic form reset, so a
 *   rejected submission keeps what the person typed; optionally clear it after success.
 * Runs in: browser (React client hook).
 * Triggered by: client forms in features/policies and features/contracts.
 * Receives → Returns: (server action, { resetOnSuccess, onSuccess }) → { state, pending, formRef, onSubmit }.
 * Talks to: React useActionState/startTransition.
 */
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";

export type FormActionState = { ok: boolean; message: string } | null;

// Con `<form action={…}>` React vacía los campos tras cada envío, incluso si el servidor lo
// rechaza. Enviando desde onSubmit dentro de una transición, solo se limpia al tener éxito.
export function useFormAction(
  action: (previous: FormActionState, formData: FormData) => Promise<FormActionState>,
  options: { resetOnSuccess?: boolean; onSuccess?: (state: NonNullable<FormActionState>) => void } = {},
) {
  const { resetOnSuccess = false, onSuccess } = options;
  // onSuccess corre apenas responde el servidor, antes del refresh: si el control desaparece
  // con los datos nuevos (p. ej. "Terminar"), el componente ya no existe para un efecto.
  const [state, dispatch, pending] = useActionState(async (previous: FormActionState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result?.ok) onSuccess?.(result);
    return result;
  }, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
    // Solo debe reaccionar a un resultado nuevo, no a cambios de las opciones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Incluye el botón pulsado (name/value), p. ej. "Aprobar" vs "Rechazar" en el mismo formulario.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }

  return { state, pending, formRef, onSubmit };
}
