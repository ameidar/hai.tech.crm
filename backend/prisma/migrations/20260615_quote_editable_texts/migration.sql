-- Make quote intro/about texts editable (previously hardcoded in the public view)
ALTER TABLE "quotes" ADD COLUMN "intro_text" TEXT;
ALTER TABLE "quotes" ADD COLUMN "about_text" TEXT;
