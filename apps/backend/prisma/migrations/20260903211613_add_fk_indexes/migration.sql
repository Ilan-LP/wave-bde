-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "Member_poleId_idx" ON "Member"("poleId");

-- CreateIndex
CREATE INDEX "PoleAccessGrant_poleId_idx" ON "PoleAccessGrant"("poleId");

-- CreateIndex
CREATE INDEX "PoleAccessGrant_grantedById_idx" ON "PoleAccessGrant"("grantedById");

-- CreateIndex
CREATE INDEX "Todo_poleId_idx" ON "Todo"("poleId");

-- CreateIndex
CREATE INDEX "Todo_assigneeId_idx" ON "Todo"("assigneeId");

-- CreateIndex
CREATE INDEX "Todo_creatorId_idx" ON "Todo"("creatorId");

-- CreateIndex
CREATE INDEX "Transaction_performedById_idx" ON "Transaction"("performedById");
