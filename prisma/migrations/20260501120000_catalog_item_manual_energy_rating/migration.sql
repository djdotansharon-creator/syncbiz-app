-- Stage 6.2A — nullable manual energy rating 1–10 on CatalogItem (unset = NULL).
ALTER TABLE "CatalogItem" ADD COLUMN "manualEnergyRating" INTEGER;
