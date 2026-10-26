-- 0001 referenced a non-existent column (started_at); the cycle start time is stored in created_at.
DROP TRIGGER IF EXISTS cycle_age_immutable;
--> statement-breakpoint
CREATE TRIGGER cycle_age_immutable BEFORE UPDATE ON assessment_cycles
WHEN NEW.age_at_start IS NOT OLD.age_at_start OR NEW.age_is_estimated IS NOT OLD.age_is_estimated OR NEW.created_at IS NOT OLD.created_at OR NEW.module IS NOT OLD.module OR NEW.instrument_version IS NOT OLD.instrument_version OR NEW.child_id IS NOT OLD.child_id OR NEW.fictional IS NOT OLD.fictional
BEGIN SELECT RAISE(ABORT, 'Cycle age and instrument snapshot is immutable'); END;
