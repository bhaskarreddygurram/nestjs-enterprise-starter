-- CreateIndex
CREATE INDEX "projects_code_idx" ON "projects" USING GIN ("code" gin_trgm_ops);
