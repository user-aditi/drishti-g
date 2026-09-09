-- DropForeignKey
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actorId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_prevHash_key" ON "audit_events"("prevHash");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

