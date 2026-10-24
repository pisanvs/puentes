/** The owner's WhatsApp id: their phone number in digits only, e.g. 14155550101. */
export const ownerWaId = () => (process.env.OWNER_PHONE ?? "").replace(/\D/g, "");

export const isOwner = (waId: string) => ownerWaId() !== "" && waId.replace(/\D/g, "") === ownerWaId();
