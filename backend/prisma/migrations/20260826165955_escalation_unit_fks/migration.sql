-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_fromUnitId_fkey" FOREIGN KEY ("fromUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_toUnitId_fkey" FOREIGN KEY ("toUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
