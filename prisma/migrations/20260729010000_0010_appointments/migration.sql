
-- AlterTable
ALTER TABLE "activity_instances" ADD COLUMN     "gate_authorisation_reason" TEXT,
ADD COLUMN     "gate_authorised_at" TIMESTAMPTZ(6),
ADD COLUMN     "gate_authorised_by_employee_id" UUID;

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "provider_employee_id" UUID,
    "period_key" TEXT NOT NULL,
    "scheduled_start" TIMESTAMPTZ(6) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(6) NOT NULL,
    "chair_label" TEXT,
    "visit_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "arrived_at" TIMESTAMPTZ(6),
    "seated_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_organization_id_clinic_id_period_key_idx" ON "appointments"("organization_id", "clinic_id", "period_key");

-- CreateIndex
CREATE INDEX "appointments_organization_id_clinic_id_status_idx" ON "appointments"("organization_id", "clinic_id", "status");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

