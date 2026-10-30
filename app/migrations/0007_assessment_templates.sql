CREATE TABLE assessment_templates (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
 active_publication_id TEXT REFERENCES assessment_publications(id), revision INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES staff_memberships(id), created_at INTEGER NOT NULL,
 UNIQUE(organization_id,id)
);
--> statement-breakpoint
CREATE INDEX template_org_name ON assessment_templates(organization_id,name);
--> statement-breakpoint
CREATE TABLE assessment_template_versions (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), template_id TEXT NOT NULL,
 number INTEGER NOT NULL CHECK(number > 0), parent_version_id TEXT REFERENCES assessment_template_versions(id),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','published','archived')),
 revision INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL, content_hash TEXT NOT NULL, snapshot_json TEXT,
 demo_only INTEGER NOT NULL DEFAULT 0 CHECK(demo_only IN (0,1)), published_at INTEGER,
 created_by TEXT NOT NULL REFERENCES staff_memberships(id), created_at INTEGER NOT NULL,
 UNIQUE(template_id,number), UNIQUE(organization_id,id), UNIQUE(template_id,id),
 FOREIGN KEY(organization_id,template_id) REFERENCES assessment_templates(organization_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX template_one_working_version ON assessment_template_versions(template_id) WHERE status IN ('draft','in_review');
--> statement-breakpoint
CREATE TABLE assessment_sections (
 version_id TEXT NOT NULL REFERENCES assessment_template_versions(id), section_id TEXT NOT NULL,
 position INTEGER NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(version_id,section_id)
);
--> statement-breakpoint
CREATE TABLE assessment_questions (
 version_id TEXT NOT NULL, question_id TEXT NOT NULL, section_id TEXT NOT NULL, position INTEGER NOT NULL, data_json TEXT NOT NULL,
 PRIMARY KEY(version_id,question_id), FOREIGN KEY(version_id,section_id) REFERENCES assessment_sections(version_id,section_id)
);
--> statement-breakpoint
CREATE TABLE assessment_question_options (
 version_id TEXT NOT NULL, question_id TEXT NOT NULL, option_id TEXT NOT NULL, position INTEGER NOT NULL, data_json TEXT NOT NULL,
 PRIMARY KEY(version_id,option_id), FOREIGN KEY(version_id,question_id) REFERENCES assessment_questions(version_id,question_id)
);
--> statement-breakpoint
CREATE TABLE assessment_conditional_rules (
 version_id TEXT NOT NULL, question_id TEXT NOT NULL, expression_json TEXT NOT NULL,
 PRIMARY KEY(version_id,question_id), FOREIGN KEY(version_id,question_id) REFERENCES assessment_questions(version_id,question_id)
);
--> statement-breakpoint
CREATE TABLE assessment_template_reviews (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), version_id TEXT NOT NULL,
 revision INTEGER NOT NULL, content_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('submitted','approved','changes_requested','revoked')), note TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES staff_memberships(id), created_at INTEGER NOT NULL,
 FOREIGN KEY(organization_id,version_id) REFERENCES assessment_template_versions(organization_id,id)
);
--> statement-breakpoint
CREATE INDEX template_review_latest ON assessment_template_reviews(version_id,created_at);
--> statement-breakpoint
CREATE TABLE assessment_publications (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), template_id TEXT NOT NULL, version_id TEXT NOT NULL UNIQUE,
 review_id TEXT NOT NULL REFERENCES assessment_template_reviews(id), content_hash TEXT NOT NULL,
 published_by TEXT NOT NULL REFERENCES staff_memberships(id), created_at INTEGER NOT NULL,
 FOREIGN KEY(organization_id,version_id) REFERENCES assessment_template_versions(organization_id,id),
 FOREIGN KEY(template_id,version_id) REFERENCES assessment_template_versions(template_id,id)
);
--> statement-breakpoint
CREATE TRIGGER template_identity BEFORE UPDATE ON assessment_templates
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'Template identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER template_active_publication BEFORE UPDATE OF active_publication_id ON assessment_templates
WHEN NEW.active_publication_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM assessment_publications p JOIN assessment_template_versions v ON v.id=p.version_id
 WHERE p.id=NEW.active_publication_id AND p.template_id=NEW.id AND p.organization_id=NEW.organization_id AND v.status='published'
) BEGIN SELECT RAISE(ABORT,'Active publication must belong to this template'); END;
--> statement-breakpoint
CREATE TRIGGER template_no_delete BEFORE DELETE ON assessment_templates BEGIN SELECT RAISE(ABORT,'Template history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER template_version_guard BEFORE UPDATE ON assessment_template_versions
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.template_id IS NOT OLD.template_id OR NEW.number IS NOT OLD.number OR NEW.parent_version_id IS NOT OLD.parent_version_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.demo_only=1 AND NEW.demo_only!=1)
 OR (OLD.status!='draft' AND (NEW.metadata_json IS NOT OLD.metadata_json OR NEW.content_hash IS NOT OLD.content_hash OR NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.demo_only IS NOT OLD.demo_only))
 OR (OLD.published_at IS NOT NULL AND (NEW.published_at IS NOT OLD.published_at OR NEW.status NOT IN ('published','archived') OR NEW.revision IS NOT OLD.revision))
 OR (OLD.status='archived' AND NEW.status!='archived')
 OR (NEW.status='published' AND NEW.snapshot_json IS NULL)
BEGIN SELECT RAISE(ABORT,'Template version is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_version_no_delete BEFORE DELETE ON assessment_template_versions BEGIN SELECT RAISE(ABORT,'Version history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER template_section_insert BEFORE INSERT ON assessment_sections WHEN (SELECT status FROM assessment_template_versions WHERE id=NEW.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_section_update BEFORE UPDATE ON assessment_sections WHEN NEW.version_id IS NOT OLD.version_id OR NEW.section_id IS NOT OLD.section_id OR (SELECT status FROM assessment_template_versions WHERE id=OLD.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_section_delete BEFORE DELETE ON assessment_sections WHEN (SELECT status FROM assessment_template_versions WHERE id=OLD.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_question_insert BEFORE INSERT ON assessment_questions WHEN (SELECT status FROM assessment_template_versions WHERE id=NEW.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_question_update BEFORE UPDATE ON assessment_questions WHEN NEW.version_id IS NOT OLD.version_id OR NEW.question_id IS NOT OLD.question_id OR (SELECT status FROM assessment_template_versions WHERE id=OLD.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_question_delete BEFORE DELETE ON assessment_questions WHEN (SELECT status FROM assessment_template_versions WHERE id=OLD.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_option_insert BEFORE INSERT ON assessment_question_options WHEN (SELECT status FROM assessment_template_versions WHERE id=NEW.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_option_update BEFORE UPDATE ON assessment_question_options WHEN NEW.version_id IS NOT OLD.version_id OR NEW.question_id IS NOT OLD.question_id OR NEW.option_id IS NOT OLD.option_id OR (SELECT status FROM assessment_template_versions WHERE id=OLD.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_option_delete BEFORE DELETE ON assessment_question_options WHEN (SELECT status FROM assessment_template_versions WHERE id=OLD.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_rule_insert BEFORE INSERT ON assessment_conditional_rules WHEN (SELECT status FROM assessment_template_versions WHERE id=NEW.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_rule_update BEFORE UPDATE ON assessment_conditional_rules WHEN NEW.version_id IS NOT OLD.version_id OR NEW.question_id IS NOT OLD.question_id OR (SELECT status FROM assessment_template_versions WHERE id=OLD.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_rule_delete BEFORE DELETE ON assessment_conditional_rules WHEN (SELECT status FROM assessment_template_versions WHERE id=OLD.version_id)!='draft' BEGIN SELECT RAISE(ABORT,'Definition is frozen'); END;
--> statement-breakpoint
CREATE TRIGGER template_review_no_update BEFORE UPDATE ON assessment_template_reviews BEGIN SELECT RAISE(ABORT,'Reviews are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER template_review_no_delete BEFORE DELETE ON assessment_template_reviews BEGIN SELECT RAISE(ABORT,'Reviews are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER template_publication_validate BEFORE INSERT ON assessment_publications WHEN NOT EXISTS (
 SELECT 1 FROM assessment_template_versions v JOIN assessment_template_reviews r ON r.id=NEW.review_id
 WHERE v.id=NEW.version_id AND v.organization_id=NEW.organization_id AND v.template_id=NEW.template_id
 AND v.content_hash=NEW.content_hash AND r.version_id=v.id AND r.revision=v.revision AND r.content_hash=v.content_hash AND r.decision='approved'
) BEGIN SELECT RAISE(ABORT,'Publication needs a matching reviewed version'); END;
--> statement-breakpoint
CREATE TRIGGER template_publication_no_update BEFORE UPDATE ON assessment_publications BEGIN SELECT RAISE(ABORT,'Publications are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER template_publication_no_delete BEFORE DELETE ON assessment_publications BEGIN SELECT RAISE(ABORT,'Publications are append-only'); END;
--> statement-breakpoint
CREATE VIEW assessment_audit_logs AS SELECT * FROM audit_logs WHERE action LIKE 'form.%' OR action LIKE 'response.%' OR action LIKE 'question_ai.%';
