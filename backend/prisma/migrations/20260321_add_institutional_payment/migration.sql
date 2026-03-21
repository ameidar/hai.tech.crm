-- Add institutional payment method (paid by external institution)
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'institutional';
