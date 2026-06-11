-- Customer self-service for lead appointments: public view/cancel link.
-- calendar_event_id lets us delete the Google Calendar event when the customer cancels.
ALTER TABLE "lead_appointments" ADD COLUMN "calendar_event_id" TEXT;
ALTER TABLE "lead_appointments" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "lead_appointments" ADD COLUMN "cancel_reason" TEXT;
