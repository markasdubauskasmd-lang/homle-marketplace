BEGIN;

-- The final review is a separate encrypted onboarding record. Keeping it in
-- the existing owner-scoped table preserves the same RLS, audit and retention
-- boundary as every stage the Cleaner reviewed before submission.
ALTER TABLE cleaner_onboarding_sections
  DROP CONSTRAINT cleaner_onboarding_sections_section_code_check;

ALTER TABLE cleaner_onboarding_sections
  ADD CONSTRAINT cleaner_onboarding_sections_section_code_check
  CHECK (section_code IN (
    'personal','business','identity','rtw','dbs','tax','experience','references','insurance',
    'banking','equipment','transport','availability','areas','languages','skills','training','compliance','review'
  ));

COMMIT;
