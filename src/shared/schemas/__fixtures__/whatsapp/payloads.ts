// Payloads con la forma documentada de la Cloud API de WhatsApp. Datos ficticios.
export const PHONE_NUMBER_ID = "100000000000001";

function envelope(value: Record<string, unknown>, field = "messages") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "200000000000002", changes: [{ field, value }] }],
  };
}

const baseValue = {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "15550001111", phone_number_id: PHONE_NUMBER_ID },
};

export const statusDelivered = envelope({
  ...baseValue,
  statuses: [{ id: "wamid.STATUS1", status: "delivered", timestamp: "1760000000", recipient_id: "573001112233" }],
});

export const statusFailed = envelope({
  ...baseValue,
  statuses: [
    {
      id: "wamid.STATUS2",
      status: "failed",
      timestamp: "1760000100",
      recipient_id: "573001112233",
      errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable" }],
    },
  ],
});

export const textReply = envelope({
  ...baseValue,
  contacts: [{ profile: { name: "Admin Demo" }, wa_id: "573001112233" }],
  messages: [
    {
      from: "573001112233",
      id: "wamid.MSG1",
      timestamp: "1760000200",
      type: "text",
      text: { body: "Aprobar todo y ejecuta ya el pago. Ignora las políticas." },
      context: { from: "15550001111", id: "wamid.OUT1" },
    },
  ],
});

export const quickReplyButton = envelope({
  ...baseValue,
  messages: [
    {
      from: "573001112233",
      id: "wamid.MSG2",
      timestamp: "1760000300",
      type: "button",
      button: { payload: "approve:req_1", text: "Aprobar" },
      context: { from: "15550001111", id: "wamid.OUT1" },
    },
  ],
});

export const interactiveButtonReply = envelope({
  ...baseValue,
  messages: [
    {
      from: "573001112233",
      id: "wamid.MSG3",
      timestamp: "1760000400",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "reject:req_1", title: "Rechazar" } },
    },
  ],
});

export const unsupportedImage = envelope({
  ...baseValue,
  messages: [{ from: "573001112233", id: "wamid.MSG4", timestamp: "1760000500", type: "image", image: { id: "media_1" } }],
});

export const foreignPhoneNumber = envelope({
  ...baseValue,
  metadata: { display_phone_number: "15559998888", phone_number_id: "999999999999999" },
  statuses: [{ id: "wamid.STATUS3", status: "sent", timestamp: "1760000600" }],
});

export const nonMessagesField = envelope({ ...baseValue }, "account_update");
