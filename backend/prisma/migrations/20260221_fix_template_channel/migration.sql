-- Fix message_templates channel: all templates should be available for both WhatsApp and email
UPDATE "message_templates" SET "channel" = 'both';
