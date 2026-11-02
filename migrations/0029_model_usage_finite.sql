-- PostgreSQL numeric accepts NaN; it must never enter monetary aggregates.
UPDATE image_attempts SET reference_usd=NULL WHERE reference_usd>='Infinity'::numeric;
UPDATE planning_attempts SET reference_usd=NULL WHERE reference_usd>='Infinity'::numeric;
ALTER TABLE image_attempts ADD CONSTRAINT image_attempts_reference_usd_finite CHECK(reference_usd<'Infinity'::numeric);
ALTER TABLE planning_attempts ADD CONSTRAINT planning_attempts_reference_usd_finite CHECK(reference_usd<'Infinity'::numeric);
