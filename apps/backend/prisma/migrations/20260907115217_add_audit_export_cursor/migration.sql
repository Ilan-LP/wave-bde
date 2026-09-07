-- CreateTable
CREATE TABLE "AuditExportCursor" (
    "id" TEXT NOT NULL,
    "lastExportedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditExportCursor_pkey" PRIMARY KEY ("id")
);
