CREATE TABLE assessment_responses (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), template_id TEXT NOT NULL REFERENCES assessment_templates(id), template_version_id TEXT NOT NULL, content_hash TEXT NOT NULL,
 cycle_id TEXT NOT NULL REFERENCES assessment_cycles(id), child_id TEXT NOT NULL REFERENCES children(id), guardian_id TEXT REFERENCES guardians(id), target TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','withdrawn')), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 parent_response_id TEXT REFERENCES assessment_responses(id), correction_reason TEXT, created_by TEXT NOT NULL REFERENCES staff_memberships(id), created_at INTEGER NOT NULL,
 submitted_at INTEGER, submitted_by TEXT, withdrawn_at INTEGER, withdrawn_by TEXT REFERENCES staff_memberships(id), withdrawal_reason TEXT,
 UNIQUE(organization_id,id), UNIQUE(id,template_version_id),
 FOREIGN KEY(organization_id,template_version_id) REFERENCES assessment_template_versions(organization_id,id),
 FOREIGN KEY(template_id,template_version_id) REFERENCES assessment_template_versions(template_id,id),
 CHECK((target='child' AND guardian_id IS NULL) OR (target='guardian' AND guardian_id IS NOT NULL)),
 CHECK((parent_response_id IS NULL AND correction_reason IS NULL) OR (parent_response_id IS NOT NULL AND length(correction_reason)>=5)),
 CHECK(status!='submitted' OR (submitted_at IS NOT NULL AND submitted_by IS NOT NULL)),
 CHECK(status!='withdrawn' OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND length(withdrawal_reason)>=5))
);
--> statement-breakpoint
CREATE INDEX response_context ON assessment_responses(organization_id,cycle_id,child_id,guardian_id);
--> statement-breakpoint
CREATE UNIQUE INDEX response_child_draft ON assessment_responses(template_id,cycle_id) WHERE target='child' AND status='draft';
--> statement-breakpoint
CREATE UNIQUE INDEX response_guardian_draft ON assessment_responses(template_id,cycle_id,guardian_id) WHERE target='guardian' AND status='draft';
--> statement-breakpoint
CREATE TABLE assessment_answers (
 response_id TEXT NOT NULL, template_version_id TEXT NOT NULL, question_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('answered','skipped','not_applicable')), value_json TEXT NOT NULL CHECK(json_valid(value_json)), assistance TEXT NOT NULL CHECK(assistance IN ('none','read_aloud','scribed')), skip_reason TEXT,
 PRIMARY KEY(response_id,question_id), FOREIGN KEY(response_id,template_version_id) REFERENCES assessment_responses(id,template_version_id),
 FOREIGN KEY(template_version_id,question_id) REFERENCES assessment_questions(version_id,question_id), CHECK(state='answered' OR value_json='null')
);
--> statement-breakpoint
CREATE TABLE assessment_response_sessions (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), response_id TEXT NOT NULL, cycle_id TEXT NOT NULL REFERENCES assessment_cycles(id),
 token_hash TEXT NOT NULL UNIQUE, cookie_hash TEXT UNIQUE, expires_at INTEGER NOT NULL, exchanged_at INTEGER, revoked_at INTEGER,
 created_by TEXT NOT NULL REFERENCES staff_memberships(id), created_at INTEGER NOT NULL,
 FOREIGN KEY(organization_id,response_id) REFERENCES assessment_responses(organization_id,id)
);
--> statement-breakpoint
CREATE TABLE assessment_response_attachments (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), response_id TEXT NOT NULL, template_version_id TEXT NOT NULL, question_id TEXT NOT NULL,
 storage_key TEXT NOT NULL, mime TEXT NOT NULL CHECK(mime='image/png'), size INTEGER NOT NULL CHECK(size>0), sha256 TEXT NOT NULL,
 actor_staff_id TEXT REFERENCES staff_memberships(id), actor_session_id TEXT REFERENCES assessment_response_sessions(id), created_at INTEGER NOT NULL,
 FOREIGN KEY(organization_id,response_id) REFERENCES assessment_responses(organization_id,id), FOREIGN KEY(response_id,template_version_id) REFERENCES assessment_responses(id,template_version_id),
 FOREIGN KEY(template_version_id,question_id) REFERENCES assessment_questions(version_id,question_id), CHECK((actor_staff_id IS NULL)!=(actor_session_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE assessment_response_attachment_events (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id), response_id TEXT NOT NULL, attachment_id TEXT NOT NULL REFERENCES assessment_response_attachments(id),
 event_type TEXT NOT NULL DEFAULT 'uploaded' CHECK(event_type='uploaded'), created_at INTEGER NOT NULL,
 FOREIGN KEY(organization_id,response_id) REFERENCES assessment_responses(organization_id,id)
);
--> statement-breakpoint
CREATE TRIGGER response_context_insert BEFORE INSERT ON assessment_responses
WHEN NEW.status!='draft' OR NOT EXISTS (
 SELECT 1 FROM assessment_cycles c JOIN children ch ON ch.id=c.child_id JOIN assessment_template_versions v ON v.id=NEW.template_version_id JOIN staff_memberships st ON st.id=NEW.created_by
 WHERE c.id=NEW.cycle_id AND c.organization_id=NEW.organization_id AND c.child_id=NEW.child_id AND ch.organization_id=c.organization_id
 AND st.organization_id=c.organization_id AND st.active=1 AND v.content_hash=NEW.content_hash AND v.published_at IS NOT NULL
) OR (NEW.guardian_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM guardians g JOIN child_guardians l ON l.guardian_id=g.id WHERE g.id=NEW.guardian_id AND g.organization_id=NEW.organization_id AND l.child_id=NEW.child_id AND l.organization_id=NEW.organization_id))
 OR (NEW.parent_response_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assessment_responses r WHERE r.id=NEW.parent_response_id AND r.organization_id=NEW.organization_id AND r.template_version_id=NEW.template_version_id AND r.cycle_id=NEW.cycle_id AND r.child_id=NEW.child_id AND r.target=NEW.target AND r.guardian_id IS NEW.guardian_id AND r.status='submitted'))
BEGIN SELECT RAISE(ABORT,'Response context must match the published version and respondent'); END;
--> statement-breakpoint
CREATE TRIGGER response_guard BEFORE UPDATE ON assessment_responses
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.template_id IS NOT OLD.template_id OR NEW.template_version_id IS NOT OLD.template_version_id OR NEW.content_hash IS NOT OLD.content_hash
 OR NEW.cycle_id IS NOT OLD.cycle_id OR NEW.child_id IS NOT OLD.child_id OR NEW.guardian_id IS NOT OLD.guardian_id OR NEW.target IS NOT OLD.target
 OR NEW.parent_response_id IS NOT OLD.parent_response_id OR NEW.correction_reason IS NOT OLD.correction_reason OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.status='withdrawn') OR (OLD.status='submitted' AND (NEW.status!='withdrawn' OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.submitted_by IS NOT OLD.submitted_by OR NEW.revision IS NOT OLD.revision))
BEGIN SELECT RAISE(ABORT,'Response identity and submissions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER response_no_delete BEFORE DELETE ON assessment_responses BEGIN SELECT RAISE(ABORT,'Response history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER response_answer_insert BEFORE INSERT ON assessment_answers WHEN (SELECT status FROM assessment_responses WHERE id=NEW.response_id)!='draft' BEGIN SELECT RAISE(ABORT,'Submitted answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER response_answer_update BEFORE UPDATE ON assessment_answers WHEN NEW.response_id IS NOT OLD.response_id OR NEW.template_version_id IS NOT OLD.template_version_id OR NEW.question_id IS NOT OLD.question_id OR (SELECT status FROM assessment_responses WHERE id=OLD.response_id)!='draft' BEGIN SELECT RAISE(ABORT,'Submitted answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER response_answer_delete BEFORE DELETE ON assessment_answers WHEN (SELECT status FROM assessment_responses WHERE id=OLD.response_id)!='draft' BEGIN SELECT RAISE(ABORT,'Submitted answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER response_session_insert BEFORE INSERT ON assessment_response_sessions WHEN NOT EXISTS (
 SELECT 1 FROM assessment_responses r JOIN staff_memberships st ON st.id=NEW.created_by WHERE r.id=NEW.response_id AND r.organization_id=NEW.organization_id AND r.cycle_id=NEW.cycle_id AND r.status='draft' AND st.organization_id=r.organization_id AND st.active=1
) BEGIN SELECT RAISE(ABORT,'Invalid response session context'); END;
--> statement-breakpoint
CREATE TRIGGER response_session_guard BEFORE UPDATE ON assessment_response_sessions
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.response_id IS NOT OLD.response_id OR NEW.cycle_id IS NOT OLD.cycle_id OR NEW.token_hash IS NOT OLD.token_hash OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.exchanged_at IS NOT NULL AND (NEW.exchanged_at IS NOT OLD.exchanged_at OR NEW.cookie_hash IS NOT OLD.cookie_hash)) OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Session identity and exchange are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER response_attachment_insert BEFORE INSERT ON assessment_response_attachments WHEN NOT EXISTS (
 SELECT 1 FROM assessment_responses r JOIN assessment_questions q ON q.version_id=r.template_version_id AND q.question_id=NEW.question_id WHERE r.id=NEW.response_id AND r.status='draft' AND json_extract(q.data_json,'$.type')='file'
) OR (NEW.actor_staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff_memberships st WHERE st.id=NEW.actor_staff_id AND st.organization_id=NEW.organization_id AND st.active=1))
 OR (NEW.actor_session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assessment_response_sessions se WHERE se.id=NEW.actor_session_id AND se.response_id=NEW.response_id AND se.organization_id=NEW.organization_id AND se.exchanged_at IS NOT NULL AND se.revoked_at IS NULL))
BEGIN SELECT RAISE(ABORT,'Invalid attachment context'); END;
--> statement-breakpoint
CREATE TRIGGER response_attachment_update BEFORE UPDATE ON assessment_response_attachments BEGIN SELECT RAISE(ABORT,'Attachments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER response_attachment_delete BEFORE DELETE ON assessment_response_attachments BEGIN SELECT RAISE(ABORT,'Attachments are retained'); END;
--> statement-breakpoint
CREATE TRIGGER response_attachment_event_insert BEFORE INSERT ON assessment_response_attachment_events WHEN NOT EXISTS (SELECT 1 FROM assessment_response_attachments a WHERE a.id=NEW.attachment_id AND a.organization_id=NEW.organization_id AND a.response_id=NEW.response_id) BEGIN SELECT RAISE(ABORT,'Invalid attachment event context'); END;
--> statement-breakpoint
CREATE TRIGGER response_attachment_event_update BEFORE UPDATE ON assessment_response_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER response_attachment_event_delete BEFORE DELETE ON assessment_response_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER response_cycle_closed AFTER UPDATE OF status ON assessment_cycles WHEN NEW.status='closed' BEGIN UPDATE assessment_response_sessions SET revoked_at=coalesce(revoked_at,unixepoch()*1000) WHERE cycle_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER response_withdrawn AFTER UPDATE OF status ON assessment_responses WHEN NEW.status='withdrawn' BEGIN UPDATE assessment_response_sessions SET revoked_at=coalesce(revoked_at,NEW.withdrawn_at) WHERE response_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER response_template_revoked AFTER INSERT ON assessment_template_reviews WHEN NEW.decision='revoked' BEGIN UPDATE assessment_response_sessions SET revoked_at=coalesce(revoked_at,NEW.created_at) WHERE response_id IN (SELECT id FROM assessment_responses WHERE template_version_id=NEW.version_id); END;
