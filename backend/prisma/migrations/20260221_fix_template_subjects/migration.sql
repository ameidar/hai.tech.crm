-- Add email subjects to message templates
UPDATE "message_templates" SET "subject" = 'תזכורת לשיעור - {{cycle_name}}' WHERE "name" = 'תזכורת לשיעור';
UPDATE "message_templates" SET "subject" = 'עדכון סטטוס שיעור - {{cycle_name}}' WHERE "name" = 'תזכורת מילוי סטטוס';
