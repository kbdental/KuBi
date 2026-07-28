-- CreateTable
CREATE TABLE "activity_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "standard_text" TEXT NOT NULL,
    "process" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "execution_mode" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL,
    "instance_scope" TEXT NOT NULL,
    "due_rule" JSONB NOT NULL,
    "assignment_rule" JSONB NOT NULL,
    "sod_policy" TEXT NOT NULL,
    "self_verify_allowed" BOOLEAN NOT NULL DEFAULT false,
    "evidence_type" TEXT NOT NULL,
    "gate_requirement" TEXT,
    "gate_enforcement" TEXT,
    "failure_definition" TEXT NOT NULL,
    "escalation_policy" TEXT NOT NULL,
    "capa_policy" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_item_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "requires_value" BOOLEAN NOT NULL DEFAULT false,
    "value_unit" TEXT,
    "value_min" DOUBLE PRECISION,
    "value_max" DOUBLE PRECISION,

    CONSTRAINT "checklist_item_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "definition_version" INTEGER NOT NULL,
    "scope_key" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignee_employee_id" UUID,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_employee_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "blocked_by_item_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "numeric_value" DOUBLE PRECISION,
    "responded_by_employee_id" UUID NOT NULL,
    "responded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "captured_by_employee_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by_id" UUID,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "verifier_employee_id" UUID NOT NULL,
    "result" TEXT NOT NULL,
    "self_verified" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attention_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "detail" TEXT,
    "source_instance_id" UUID,
    "owner_employee_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "escalation_level" TEXT NOT NULL DEFAULT 'INITIAL',
    "escalated_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_employee_id" UUID,
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attention_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "recipient_employee_id" UUID NOT NULL,
    "priority" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "attention_item_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ux_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID,
    "event_name" TEXT NOT NULL,
    "instance_id" UUID,
    "session_key" TEXT,
    "duration_ms" INTEGER,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ux_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "rule_code" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" JSONB,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_definitions_organization_id_idx" ON "activity_definitions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_definitions_organization_id_code_version_key" ON "activity_definitions"("organization_id", "code", "version");

-- CreateIndex
CREATE INDEX "checklist_item_definitions_organization_id_idx" ON "checklist_item_definitions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_item_definitions_definition_id_ordinal_key" ON "checklist_item_definitions"("definition_id", "ordinal");

-- CreateIndex
CREATE INDEX "activity_instances_organization_id_clinic_id_status_idx" ON "activity_instances"("organization_id", "clinic_id", "status");

-- CreateIndex
CREATE INDEX "activity_instances_assignee_employee_id_status_idx" ON "activity_instances"("assignee_employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "activity_instances_definition_id_scope_key_period_key_key" ON "activity_instances"("definition_id", "scope_key", "period_key");

-- CreateIndex
CREATE INDEX "checklist_responses_organization_id_idx" ON "checklist_responses"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_responses_instance_id_item_id_key" ON "checklist_responses"("instance_id", "item_id");

-- CreateIndex
CREATE INDEX "evidence_organization_id_idx" ON "evidence"("organization_id");

-- CreateIndex
CREATE INDEX "evidence_instance_id_idx" ON "evidence"("instance_id");

-- CreateIndex
CREATE INDEX "verifications_organization_id_idx" ON "verifications"("organization_id");

-- CreateIndex
CREATE INDEX "verifications_instance_id_idx" ON "verifications"("instance_id");

-- CreateIndex
CREATE INDEX "attention_items_organization_id_clinic_id_status_idx" ON "attention_items"("organization_id", "clinic_id", "status");

-- CreateIndex
CREATE INDEX "attention_items_owner_employee_id_status_idx" ON "attention_items"("owner_employee_id", "status");

-- CreateIndex
CREATE INDEX "notifications_organization_id_idx" ON "notifications"("organization_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_employee_id_read_at_idx" ON "notifications"("recipient_employee_id", "read_at");

-- CreateIndex
CREATE INDEX "ux_events_organization_id_event_name_idx" ON "ux_events"("organization_id", "event_name");

-- CreateIndex
CREATE INDEX "automation_executions_organization_id_clinic_id_rule_code_idx" ON "automation_executions"("organization_id", "clinic_id", "rule_code");

-- AddForeignKey
ALTER TABLE "activity_definitions" ADD CONSTRAINT "activity_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item_definitions" ADD CONSTRAINT "checklist_item_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_item_definitions" ADD CONSTRAINT "checklist_item_definitions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "activity_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_instances" ADD CONSTRAINT "activity_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_instances" ADD CONSTRAINT "activity_instances_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "activity_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "activity_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "checklist_item_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "activity_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "activity_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_source_instance_id_fkey" FOREIGN KEY ("source_instance_id") REFERENCES "activity_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_attention_item_id_fkey" FOREIGN KEY ("attention_item_id") REFERENCES "attention_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ux_events" ADD CONSTRAINT "ux_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
